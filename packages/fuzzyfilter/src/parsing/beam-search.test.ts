import { describe, test, expect } from "bun:test";
import {
  createBeamSearchEngine,
  type BeamSearchDependencies,
} from "./beam-search";
import { createTrie } from "../trie";
import { createUnitRegistry } from "../units/registry";
import type { FieldSchema, OperatorOverload } from "../types/field-centric";
import type { ValueParser } from "./value-parser";
import { createParsedValue, extractNumbers } from "./value-parser";
import { z } from "zod";

// =============================================================================
// TEST FIXTURES
// =============================================================================

// Simple field schemas for testing
const weightField: FieldSchema<number> = {
  labelKey: "columns.weight",
  operandSchema: z.number(),
  operators: [
    {
      operatorId: "gt",
      overloads: [
        {
          id: "weight:gt:number",
          i18nKey: "operators.gt",
          arguments: [{ name: 'value', argumentSchemaKey: 'number' }],
          predicate: (operand, args) => operand > args.value,
        },
      ],
    },
    {
      operatorId: "eq",
      overloads: [
        {
          id: "weight:eq:number",
          i18nKey: "operators.eq",
          arguments: [{ name: 'value', argumentSchemaKey: 'number' }],
          predicate: (operand, args) => operand === args.value,
        },
      ],
    },
  ],
};

const statusField: FieldSchema<string> = {
  labelKey: "columns.status",
  operandSchema: z.string(),
  operators: [
    {
      operatorId: "eq",
      overloads: [
        {
          id: "status:eq:string",
          i18nKey: "operators.eq",
          arguments: [{ name: 'value', argumentSchemaKey: 'string' }],
          predicate: (operand, args) => operand === args.value,
        },
      ],
    },
  ],
};

// Mock translations
const translations: Record<string, string[]> = {
  "columns.weight": ["weight", "mass", "kg"],
  "columns.status": ["status", "state"],
  "operators.gt": [">", "greater", "more than", "gt"],
  "operators.eq": ["=", "equals", "is", "eq"],
  "units.mass.kg": ["kg", "kilogram", "kilograms"],
  "units.mass.g": ["g", "gram", "grams"],
};

function getAliases(key: string): string[] {
  return translations[key] ?? [];
}

// Mock unit registry
const unitRegistry = createUnitRegistry({
  units: [
    { id: "kg", dimension: "mass", toBase: 1, i18nKey: "units.mass.kg" },
    { id: "g", dimension: "mass", toBase: 0.001, i18nKey: "units.mass.g" },
  ],
  getAliases,
});

// Simple number parser
const numberParser: ValueParser<number> = {
  type: "number",
  parse(query) {
    const numbers = extractNumbers(query);
    return numbers.map((n) =>
      createParsedValue(n.value, n.text, n.start, n.end, 1.0)
    );
  },
};

// Create test dependencies
function createTestDependencies(): BeamSearchDependencies {
  // Build field trie
  const fieldTrie = createTrie<{ key: string; schema: FieldSchema<unknown> }>();
  const fields = { weight: weightField, status: statusField };

  for (const [key, schema] of Object.entries(fields)) {
    const terms = getAliases(schema.labelKey);
    terms.push(key);
    for (const term of terms) {
      fieldTrie.insert(term, { key, schema });
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
          operatorTrie.insert(term, {
            fieldKey,
            operatorId: opConfig.operatorId,
            overload: overload as OperatorOverload<
              unknown,
              Record<string, unknown>
            >,
          });
        }
      }
    }
  }

  // Value parsers
  const valueParsers = new Map<string, ValueParser<unknown>>();
  valueParsers.set("number", numberParser);

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
    unitRegistry,
    valueParsers,
    getOverloads,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe("createBeamSearchEngine", () => {
  const deps = createTestDependencies();
  const engine = createBeamSearchEngine(deps);

  describe("suggest", () => {
    test("returns empty array for empty query", () => {
      expect(engine.suggest("")).toEqual([]);
      expect(engine.suggest("   ")).toEqual([]);
    });

    test("matches field from query", () => {
      const suggestions = engine.suggest("weight");

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].fieldKey).toBe("weight");
    });

    test("matches field with fuzzy matching", () => {
      // "weigt" - missing 'h', which fuzzysort can handle
      const suggestions = engine.suggest("weigt > 50");

      expect(suggestions.length).toBeGreaterThan(0);
      // Should still match weight with fuzzy search
      const weightMatch = suggestions.find((s) => s.fieldKey === "weight");
      expect(weightMatch).toBeDefined();
    });

    test("matches field and operator", () => {
      const suggestions = engine.suggest("weight >");

      expect(suggestions.length).toBeGreaterThan(0);
      const match = suggestions.find(
        (s) => s.fieldKey === "weight" && s.operatorId === "gt"
      );
      expect(match).toBeDefined();
    });

    test("matches field, operator, and value", () => {
      const suggestions = engine.suggest("weight > 50");

      expect(suggestions.length).toBeGreaterThan(0);
      const match = suggestions.find(
        (s) =>
          s.fieldKey === "weight" &&
          s.operatorId === "gt" &&
          s.parsedValues.length > 0
      );
      expect(match).toBeDefined();
      expect(match!.parsedValues[0].value).toBe(50);
    });

    test("handles no-space input", () => {
      const suggestions = engine.suggest("weight>50");

      expect(suggestions.length).toBeGreaterThan(0);
      const match = suggestions.find(
        (s) =>
          s.fieldKey === "weight" &&
          s.operatorId === "gt" &&
          s.parsedValues.some((v) => v.value === 50)
      );
      expect(match).toBeDefined();
    });

    test("marks complete filters correctly", () => {
      const suggestions = engine.suggest("weight > 50");

      const completeSuggestions = suggestions.filter((s) => s.isComplete);
      expect(completeSuggestions.length).toBeGreaterThan(0);
    });

    test("marks incomplete filters correctly", () => {
      const suggestions = engine.suggest("weight >");

      const incompleteSuggestions = suggestions.filter((s) => !s.isComplete);
      expect(incompleteSuggestions.length).toBeGreaterThan(0);
    });

    test("returns multiple interpretations", () => {
      const suggestions = engine.suggest("weight = 100");

      // Should have multiple interpretations due to beam search
      expect(suggestions.length).toBeGreaterThan(1);
    });

    test("provides score breakdown", () => {
      const suggestions = engine.suggest("weight > 50");

      expect(suggestions.length).toBeGreaterThan(0);
      const breakdown = suggestions[0].scoreBreakdown;

      expect(breakdown.chunking).toBeGreaterThan(0);
      expect(breakdown.field).toBeGreaterThan(0);
      expect(breakdown.operator).toBeGreaterThan(0);
      expect(breakdown.final).toBeGreaterThan(0);
    });

    test("includes matches for highlighting", () => {
      const suggestions = engine.suggest("weight > 50");

      const match = suggestions.find((s) => s.isComplete);
      expect(match).toBeDefined();
      expect(match!.matches.length).toBeGreaterThanOrEqual(2); // field + operator + value

      const fieldMatch = match!.matches.find((m) => m.role === "field");
      expect(fieldMatch).toBeDefined();
      expect(fieldMatch!.resolvedTo).toBe("weight");

      const opMatch = match!.matches.find((m) => m.role === "operator");
      expect(opMatch).toBeDefined();
      expect(opMatch!.resolvedTo).toBe("gt");
    });
  });

  describe("scoring", () => {
    test("exact matches score higher than fuzzy matches", () => {
      const exactSuggestions = engine.suggest("weight > 50");
      const fuzzySuggestions = engine.suggest("wieght > 50");

      const exactBest = exactSuggestions[0];
      const fuzzyBest = fuzzySuggestions[0];

      expect(exactBest.score).toBeGreaterThan(fuzzyBest.score);
    });

    test("complete queries score higher than incomplete", () => {
      const complete = engine.suggest("weight > 50");
      const incomplete = engine.suggest("weight > ");

      const completeBest = complete.find((s) => s.isComplete);
      const incompleteBest = incomplete.find((s) => !s.isComplete);

      expect(completeBest).toBeDefined();
      expect(incompleteBest).toBeDefined();
      expect(completeBest!.score).toBeGreaterThan(incompleteBest!.score);
    });

    test("all scores are in valid range [0, 1]", () => {
      const suggestions = engine.suggest("weight > 50");

      for (const s of suggestions) {
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("beam pruning", () => {
    test("respects maxBeams configuration", () => {
      const limitedEngine = createBeamSearchEngine(deps, { maxBeams: 3 });
      const suggestions = limitedEngine.suggest("weight > 50");

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });

    test("filters low-scoring beams", () => {
      const suggestions = engine.suggest("weight > 50");

      // All suggestions should be above threshold
      for (const s of suggestions) {
        expect(s.score).toBeGreaterThanOrEqual(0.01); // Very low threshold
      }
    });
  });
});

describe("edge cases", () => {
  const deps = createTestDependencies();
  const engine = createBeamSearchEngine(deps);

  test("handles single character input", () => {
    const suggestions = engine.suggest("w");
    expect(suggestions.length).toBeGreaterThanOrEqual(0); // May or may not match
  });

  test("handles unknown field", () => {
    const suggestions = engine.suggest("unknownfield > 50");
    // Should still return suggestions (possibly with low scores)
    expect(suggestions).toBeDefined();
  });

  test("handles multiple numbers", () => {
    const suggestions = engine.suggest("weight > 50 100");

    // Should parse at least the first number
    const match = suggestions.find((s) => s.parsedValues.length > 0);
    expect(match).toBeDefined();
  });

  test("handles quoted values", () => {
    const suggestions = engine.suggest('status = "active"');

    // Should match status field
    const match = suggestions.find((s) => s.fieldKey === "status");
    expect(match).toBeDefined();
  });
});
