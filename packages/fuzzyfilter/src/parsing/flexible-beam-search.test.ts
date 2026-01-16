import { describe, test, expect } from "bun:test";
import {
  createFlexibleBeamSearchEngine,
  type FlexibleBeamSearchDependencies,
} from "./flexible-beam-search";
import { createTrie } from "../trie";
import { createUnitRegistry } from "../units/registry";
import type { FieldSchema, OperatorOverload } from "../types/field-centric";
import type { ValueParser } from "./value-parser";
import { createParsedValue, extractNumbers } from "./value-parser";
import { createUniversalNumberParser } from "./number-with-unit-parser";
import { z } from "zod";

// =============================================================================
// TEST FIXTURES
// =============================================================================

// Field schemas for testing
const contentsField: FieldSchema<string[]> = {
  labelKey: "columns.contents",
  operandSchema: z.array(z.string()),
  operators: [
    {
      operatorId: "contains",
      overloads: [
        {
          id: "contents:contains:string",
          i18nKey: "operators.contains",
          argumentSchema: z.object({ value: z.string() }),
          predicate: (operand, args) =>
            operand.includes(args.value as string),
        },
      ],
    },
    {
      operatorId: "gt",
      overloads: [
        {
          id: "contents:gt:percentage",
          i18nKey: "operators.gt.percentage",
          argumentSchema: z.object({ percentage: z.number() }),
          predicate: () => true,
        },
      ],
    },
  ],
};

const amountField: FieldSchema<number> = {
  labelKey: "columns.amount",
  operandSchema: z.number(),
  unitDimension: "mass",
  operators: [
    {
      operatorId: "gt",
      overloads: [
        {
          id: "amount:gt:number",
          i18nKey: "operators.gt",
          argumentSchema: z.object({ value: z.number() }),
          predicate: (operand, args) => operand > args.value,
        },
      ],
    },
    {
      operatorId: "eq",
      overloads: [
        {
          id: "amount:eq:number",
          i18nKey: "operators.eq",
          argumentSchema: z.object({ value: z.number() }),
          predicate: (operand, args) => operand === args.value,
        },
      ],
    },
  ],
};

// Mock translations
const translations: Record<string, string[]> = {
  "columns.contents": ["contents", "content", "materials", "composition"],
  "columns.amount": ["amount", "weight", "mass"],
  "operators.contains": ["contains", "has", "includes"],
  "operators.gt": [">", "greater", "more than", "gt"],
  "operators.gt.percentage": [">", "greater", "more than"],
  "operators.eq": ["=", "equals", "is", "eq"],
  "units.mass.kg": ["kg", "kilogram", "kilograms", "kilo"],
  "units.mass.t": ["t", "ton", "tons", "tonne"],
  "units.percentage.percent": ["%", "percent", "pct", "percentage"],
};

function getAliases(key: string): string[] {
  return translations[key] ?? [];
}

// Unit registry with mass and percentage
const unitRegistry = createUnitRegistry({
  units: [
    { id: "kg", dimension: "mass", toBase: 1, i18nKey: "units.mass.kg" },
    { id: "t", dimension: "mass", toBase: 1000, i18nKey: "units.mass.t" },
    { id: "%", dimension: "percentage", toBase: 1, i18nKey: "units.percentage.percent" },
  ],
  getAliases,
});

// Simple number parser
const numberParser: ValueParser<number> = {
  type: "number",
  parse(query) {
    const numbers = extractNumbers(query);
    return numbers.map((n) =>
      createParsedValue(n.value, n.text, n.start, n.end, 0.9)
    );
  },
};

// Create test dependencies
function createTestDependencies(): FlexibleBeamSearchDependencies {
  const fields = { contents: contentsField, amount: amountField };

  // Build field trie
  const fieldTrie = createTrie<{ key: string; schema: FieldSchema<unknown> }>();
  for (const [key, schema] of Object.entries(fields)) {
    const terms = getAliases(schema.labelKey);
    terms.push(key);
    for (const term of terms) {
      fieldTrie.insert(term.toLowerCase(), { key, schema });
    }
  }

  // Build operator trie
  const operatorTrie = createTrie<{
    fieldKey: string;
    operatorId: string;
    overload: OperatorOverload<unknown, Record<string, unknown>>;
  }>();

  for (const [fieldKey, schema] of Object.entries(fields)) {
    for (const opConfig of schema.operators) {
      for (const overload of opConfig.overloads) {
        const terms = getAliases(overload.i18nKey);
        terms.push(opConfig.operatorId);
        for (const term of terms) {
          operatorTrie.insert(term.toLowerCase(), {
            fieldKey,
            operatorId: opConfig.operatorId,
            overload: overload as OperatorOverload<unknown, Record<string, unknown>>,
          });
        }
      }
    }
  }

  // Build value trie with sample data
  const valueTrie = createTrie<{
    value: string;
    fieldKey: string;
    rowCount: number;
  }>();

  // Add sample values for contents field
  const sampleValues = ["water", "biochar", "ash", "compost", "wood_chips"];
  for (const value of sampleValues) {
    valueTrie.insert(value.toLowerCase(), {
      value,
      fieldKey: "contents",
      rowCount: 10,
    });
  }

  // Value parsers
  const valueParsers = new Map<string, ValueParser<unknown>>();
  valueParsers.set("number", numberParser);
  valueParsers.set("number:any", createUniversalNumberParser());

  // Get overloads helper
  function getOverloads(fieldKey: string, operatorId: string) {
    const field = fields[fieldKey as keyof typeof fields];
    if (!field) return [];
    const opConfig = field.operators.find((o) => o.operatorId === operatorId);
    return (opConfig?.overloads ?? []) as OperatorOverload<
      unknown,
      Record<string, unknown>
    >[];
  }

  return {
    fieldTrie,
    operatorTrie,
    valueTrie,
    unitRegistry,
    valueParsers,
    getOverloads,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe("createFlexibleBeamSearchEngine", () => {
  const deps = createTestDependencies();
  const engine = createFlexibleBeamSearchEngine(deps);

  describe("suggest", () => {
    test("returns empty array for empty query", () => {
      expect(engine.suggest("")).toEqual([]);
      expect(engine.suggest("   ")).toEqual([]);
    });

    test("matches field from query", () => {
      const suggestions = engine.suggest("contents");

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].fieldKey).toBe("contents");
    });

    test("matches value from value trie and infers field", () => {
      const suggestions = engine.suggest("water");

      expect(suggestions.length).toBeGreaterThan(0);
      // Should infer contents field from the water value
      const match = suggestions.find((s) => s.fieldKey === "contents");
      expect(match).toBeDefined();
    });

    test("fuzzy matches partial value 'wa' to 'water'", () => {
      const suggestions = engine.suggest("wa");

      expect(suggestions.length).toBeGreaterThan(0);
      // Should have a match that resolved 'wa' to 'water'
      const match = suggestions.find((s) =>
        s.matches.some((m) => m.resolvedTo === "water")
      );
      expect(match).toBeDefined();
    });

    test("parses percentage and matches value", () => {
      const suggestions = engine.suggest("20% wa");

      expect(suggestions.length).toBeGreaterThan(0);

      // Should have a suggestion that:
      // 1. Parsed 20% as a percentage
      // 2. Matched 'wa' to 'water'
      // 3. Inferred contents field
      const match = suggestions.find(
        (s) =>
          s.fieldKey === "contents" &&
          s.matches.some((m) => m.resolvedTo === "water") &&
          s.parsedValues.some((pv) => {
            const val = pv.value as { dimension?: string };
            return val.dimension === "percentage";
          })
      );
      expect(match).toBeDefined();
    });

    test("handles value-first queries", () => {
      const suggestions = engine.suggest("biochar");

      expect(suggestions.length).toBeGreaterThan(0);
      // Should infer contents field from biochar value
      const match = suggestions.find((s) => s.fieldKey === "contents");
      expect(match).toBeDefined();
    });

    test("handles amount with unit", () => {
      const suggestions = engine.suggest("100 kg");

      expect(suggestions.length).toBeGreaterThan(0);
      // Should have parsed the amount with unit
      const match = suggestions.find((s) =>
        s.parsedValues.some((pv) => {
          const val = pv.value as { unit?: { id: string } };
          return val.unit?.id === "kg";
        })
      );
      expect(match).toBeDefined();
    });

    test("traditional field-operator-value pattern still works", () => {
      const suggestions = engine.suggest("contents contains water");

      expect(suggestions.length).toBeGreaterThan(0);
      const match = suggestions.find(
        (s) => s.fieldKey === "contents" && s.operatorId === "contains"
      );
      expect(match).toBeDefined();
    });
  });

  describe("field inference", () => {
    test("infers field from value trie match", () => {
      const suggestions = engine.suggest("biochar");

      const match = suggestions.find((s) => s.fieldKey === "contents");
      expect(match).toBeDefined();
    });

    test("infers field from operator match", () => {
      const suggestions = engine.suggest("contains water");

      // 'contains' operator is associated with contents field
      const match = suggestions.find((s) => s.fieldKey === "contents");
      expect(match).toBeDefined();
    });
  });

  describe("scoring", () => {
    test("value-first queries score reasonably", () => {
      const suggestions = engine.suggest("water");

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].score).toBeGreaterThan(0.5);
    });

    test("complete queries score higher than incomplete", () => {
      const complete = engine.suggest("contents contains water");
      const incomplete = engine.suggest("contents contains");

      const completeBest = complete.find((s) => s.isComplete);
      const incompleteBest = incomplete.find((s) => !s.isComplete);

      expect(completeBest).toBeDefined();
      expect(incompleteBest).toBeDefined();
      expect(completeBest!.score).toBeGreaterThan(incompleteBest!.score);
    });

    test("provides coherence score in breakdown", () => {
      const suggestions = engine.suggest("20% water");

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].scoreBreakdown.coherence).toBeDefined();
      expect(suggestions[0].scoreBreakdown.coherence).toBeGreaterThan(0);
    });
  });

  describe("chunking", () => {
    test("includes chunking information", () => {
      const suggestions = engine.suggest("20% water");

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].chunking).toBeDefined();
      expect(suggestions[0].chunking.chunks.length).toBeGreaterThan(0);
    });

    test("handles different chunking strategies", () => {
      const suggestions = engine.suggest("20%water");

      expect(suggestions.length).toBeGreaterThan(0);
      // Should still be able to parse even without spaces
    });
  });

  describe("matches", () => {
    test("includes match details for highlighting", () => {
      const suggestions = engine.suggest("wa");

      const match = suggestions.find((s) =>
        s.matches.some((m) => m.resolvedTo === "water")
      );
      expect(match).toBeDefined();

      const waterMatch = match!.matches.find((m) => m.resolvedTo === "water");
      expect(waterMatch).toBeDefined();
      expect(waterMatch!.indexes).toBeDefined();
      expect(waterMatch!.score).toBeGreaterThan(0);
    });
  });
});

describe("edge cases", () => {
  const deps = createTestDependencies();
  const engine = createFlexibleBeamSearchEngine(deps);

  test("handles single character input", () => {
    const suggestions = engine.suggest("w");
    expect(suggestions).toBeDefined();
    // May or may not have matches depending on fuzzy threshold
  });

  test("handles unknown values gracefully", () => {
    const suggestions = engine.suggest("unknownvalue");
    expect(suggestions).toBeDefined();
    // Should still return suggestions (possibly with low scores)
  });

  test("handles multiple values", () => {
    const suggestions = engine.suggest("water biochar");

    expect(suggestions.length).toBeGreaterThan(0);
    // Should have matches for both values
  });

  test("handles numbers without units", () => {
    const suggestions = engine.suggest("50");

    expect(suggestions.length).toBeGreaterThan(0);
    // Should parse as a number
  });
});
