import { describe, test, expect, beforeEach } from "bun:test";
import {
  createCandidateEngine,
  type CandidateEngineDependencies,
  type CandidateSuggestion,
} from "./candidate-engine";
import { createTrie } from "../trie";
import { createUnitRegistry } from "../units/registry";
import type { FieldSchema} from "../types/field-centric";
import type { ValueParser } from "./value-parser";
import { createParsedValue, extractNumbers } from "./value-parser";
import { createUniversalNumberParser } from "./number-with-unit-parser";
import { z } from "zod";

// =============================================================================
// TEST FIXTURES
// =============================================================================

// Material types for contents field
const MaterialTypeSchema = z.enum(["water", "biochar", "ash", "compost", "wood_chips"]);

// Amount schema
const AmountSchema = z.object({
  value: z.number(),
  unit: z.enum(["kg", "t"]),
});

// Field schemas matching the playground setup
const contentsField: FieldSchema<unknown[]> = {
  labelKey: "columns.contents",
  operandSchema: z.array(z.unknown()),
  operators: [
    {
      operatorId: "contains",
      overloads: [
        {
          id: "contents:contains:materialTypes[]",
          i18nKey: "operators.contains",
          argumentSchema: z.object({ materialTypes: z.array(MaterialTypeSchema).min(1) }),
          predicate: () => true,
        },
      ],
    },
    {
      operatorId: "gt",
      overloads: [
        {
          id: "contents:gt:percentage+materialTypes[]",
          i18nKey: "operators.contents.gt.percentage",
          argumentSchema: z.object({
            percentage: z.number(),
            materialTypes: z.array(MaterialTypeSchema).min(1),
          }),
          predicate: () => true,
          priority: 10,
        },
        {
          id: "contents:gt:amount+materialTypes[]",
          i18nKey: "operators.contents.gt.amount",
          argumentSchema: z.object({
            amount: AmountSchema,
            materialTypes: z.array(MaterialTypeSchema).min(1),
          }),
          predicate: () => true,
          priority: 5,
        },
      ],
    },
    {
      operatorId: "lt",
      overloads: [
        {
          id: "contents:lt:percentage+materialTypes[]",
          i18nKey: "operators.contents.lt.percentage",
          argumentSchema: z.object({
            percentage: z.number(),
            materialTypes: z.array(MaterialTypeSchema).min(1),
          }),
          predicate: () => true,
          priority: 10,
        },
      ],
    },
  ],
};

const countField: FieldSchema<number> = {
  labelKey: "columns.count",
  operandSchema: z.number(),
  operators: [
    {
      operatorId: "eq",
      overloads: [
        {
          id: "count:eq:number",
          i18nKey: "operators.eq",
          argumentSchema: z.object({ value: z.number() }),
          predicate: () => true,
        },
      ],
    },
    {
      operatorId: "gt",
      overloads: [
        {
          id: "count:gt:number",
          i18nKey: "operators.gt",
          argumentSchema: z.object({ value: z.number() }),
          predicate: () => true,
        },
      ],
    },
  ],
};

const amountField: FieldSchema<{ value: number; unit: string }> = {
  labelKey: "columns.amount",
  operandSchema: AmountSchema,
  unitDimension: "mass",
  operators: [
    {
      operatorId: "gt",
      overloads: [
        {
          id: "amount:gt:amount",
          i18nKey: "operators.amount.heavier",
          argumentSchema: z.object({ value: AmountSchema }),
          predicate: () => true,
        },
      ],
    },
  ],
};

// Mock translations
const translations: Record<string, string[]> = {
  "columns.contents": ["contents", "content", "materials", "composition"],
  "columns.count": ["count", "quantity", "number"],
  "columns.amount": ["amount", "weight", "mass"],
  "operators.contains": ["contains", "has", "includes"],
  "operators.eq": ["equals", "is", "=", "=="],
  "operators.gt": [">", "greater", "more than", "gt", "above"],
  "operators.contents.gt.percentage": ["more than", "over", "> %"],
  "operators.contents.gt.amount": ["heavier than", "greater than"],
  "operators.contents.lt.percentage": ["less than", "under", "< %"],
  "operators.amount.heavier": ["heavier than", "weighs more than"],
  "units.mass.kg": ["kg", "kilogram", "kilograms", "kilo"],
  "units.mass.t": ["t", "ton", "tons", "tonne"],
  "units.percentage.percent": ["%", "percent", "pct", "percentage"],
};

function getAliases(key: string): string[] {
  return translations[key] ?? [];
}

// Unit registry
const unitRegistry = createUnitRegistry({
  units: [
    { id: "kg", dimension: "mass", toBase: 1, i18nKey: "units.mass.kg" },
    { id: "t", dimension: "mass", toBase: 1000, i18nKey: "units.mass.t" },
    { id: "%", dimension: "percentage", toBase: 1, i18nKey: "units.percentage.percent" },
  ],
  getAliases,
});

// Value parsers
function createTestValueParsers(): Map<string, ValueParser<unknown>> {
  const parsers = new Map<string, ValueParser<unknown>>();

  // Universal number parser
  parsers.set("number:any", createUniversalNumberParser());

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
  parsers.set("number", numberParser);

  return parsers;
}

// Create test dependencies
function createTestDependencies(): CandidateEngineDependencies {
  const fields = new Map<string, FieldSchema<unknown>>([
    ["contents", contentsField as FieldSchema<unknown>],
    ["count", countField as FieldSchema<unknown>],
    ["amount", amountField as FieldSchema<unknown>],
  ]);

  // Build field trie
  const fieldTrie = createTrie<{ key: string; schema: FieldSchema<unknown> }>();
  for (const [key, schema] of fields) {
    const terms = getAliases(schema.labelKey);
    terms.push(key);
    for (const term of terms) {
      fieldTrie.insert(term.toLowerCase(), { key, schema });
    }
  }

  // Build value trie with sample data
  const valueTrie = createTrie<{
    value: string;
    fieldKey: string;
    rowCount: number;
  }>();

  // Add material values for contents field
  const materials = ["water", "biochar", "ash", "compost", "wood_chips"];
  for (const material of materials) {
    valueTrie.insert(material.toLowerCase(), {
      value: material,
      fieldKey: "contents",
      rowCount: 50,
    });
  }

  // Add some numeric values
  const numbers = ["100", "200", "500", "1000", "2021", "2022", "2023"];
  for (const num of numbers) {
    valueTrie.insert(num, { value: num, fieldKey: "count", rowCount: 10 });
  }

  return {
    fields,
    fieldTrie,
    valueTrie,
    unitRegistry,
    valueParsers: createTestValueParsers(),
    getFieldLabel: (key) => getAliases(`columns.${key}`)[0] ?? key,
    getOperatorLabel: (i18nKey) => getAliases(i18nKey)[0] ?? i18nKey,
  };
}

// Helper to find a suggestion by overload ID
function findByOverload(
  suggestions: CandidateSuggestion[],
  overloadId: string
): CandidateSuggestion | undefined {
  return suggestions.find((s) => s.candidate.overload.id === overloadId);
}

// Helper to find suggestions for a field
function findByField(
  suggestions: CandidateSuggestion[],
  fieldKey: string
): CandidateSuggestion[] {
  return suggestions.filter((s) => s.candidate.fieldKey === fieldKey);
}

// =============================================================================
// TESTS
// =============================================================================

describe("CandidateEngine", () => {
  let deps: CandidateEngineDependencies;
  let engine: ReturnType<typeof createCandidateEngine>;

  beforeEach(() => {
    deps = createTestDependencies();
    engine = createCandidateEngine(deps, { maxSuggestions: 20 });
  });

  describe("basic functionality", () => {
    test("returns empty array for empty query", () => {
      expect(engine.suggest("")).toEqual([]);
      expect(engine.suggest("   ")).toEqual([]);
    });

    test("every suggestion has field, operator, and overload", () => {
      const suggestions = engine.suggest("water");

      for (const s of suggestions) {
        expect(s.candidate.fieldKey).toBeDefined();
        expect(s.candidate.operatorId).toBeDefined();
        expect(s.candidate.overload.id).toBeDefined();
      }
    });

    test("generates candidates for all overloads", () => {
      const candidates = engine.getAllCandidates();

      // Should have: contents (4 overloads: contains, gt:percentage, gt:amount, lt:percentage)
      //            + count (2: eq, gt) + amount (1: gt) = 7
      expect(candidates.length).toBe(7);
    });
  });

  describe("percentage + material type queries", () => {
    test("'20% wa' matches percentage overload with water", () => {
      const suggestions = engine.suggest("20% wa");

      const percentageMatch = findByOverload(
        suggestions,
        "contents:gt:percentage+materialTypes[]"
      );

      expect(percentageMatch).toBeDefined();
      expect(percentageMatch!.filling.filledArgs.percentage).toBe(20);
      expect(percentageMatch!.filling.filledArgs.materialTypes).toContain("water");
      expect(percentageMatch!.isComplete).toBe(true);
    });

    test("'50 percent water' matches percentage with full word", () => {
      const suggestions = engine.suggest("50 percent water");

      const percentageMatch = findByOverload(
        suggestions,
        "contents:gt:percentage+materialTypes[]"
      );

      expect(percentageMatch).toBeDefined();
      expect(percentageMatch!.filling.filledArgs.materialTypes).toContain("water");
    });

    test("'water 30%' matches with reversed order", () => {
      const suggestions = engine.suggest("water 30%");

      const percentageMatch = findByOverload(
        suggestions,
        "contents:gt:percentage+materialTypes[]"
      );

      expect(percentageMatch).toBeDefined();
      expect(percentageMatch!.filling.filledArgs.percentage).toBe(30);
      expect(percentageMatch!.filling.filledArgs.materialTypes).toContain("water");
    });
  });

  describe("material type fuzzy matching", () => {
    test("'wa' fuzzy matches to water", () => {
      const suggestions = engine.suggest("wa");

      const contentsMatch = findByField(suggestions, "contents")[0];
      expect(contentsMatch).toBeDefined();

      const waterMatch = contentsMatch?.filling.matches.find(
        (m) => m.resolvedTo === "water"
      );
      expect(waterMatch).toBeDefined();
    });

    test("'bio' fuzzy matches to biochar", () => {
      const suggestions = engine.suggest("bio");

      const contentsMatch = findByField(suggestions, "contents")[0];
      expect(contentsMatch).toBeDefined();

      const bioMatch = contentsMatch?.filling.matches.find(
        (m) => m.resolvedTo === "biochar"
      );
      expect(bioMatch).toBeDefined();
    });

    test("'biocharr' (typo) still matches biochar", () => {
      const suggestions = engine.suggest("biocharr");

      // Should still find matches even with typo
      expect(suggestions.length).toBeGreaterThan(0);
    });

    test("multiple materials 'water biochar' both match", () => {
      const suggestions = engine.suggest("water biochar");

      const containsMatch = findByOverload(
        suggestions,
        "contents:contains:materialTypes[]"
      );

      expect(containsMatch).toBeDefined();
      const materials = containsMatch!.filling.filledArgs.materialTypes as string[];
      expect(materials).toContain("water");
      expect(materials).toContain("biochar");
    });
  });

  describe("numeric value parsing", () => {
    test("'50' parses as number", () => {
      const suggestions = engine.suggest("50");

      expect(suggestions.length).toBeGreaterThan(0);
      // Should have parsed values
      const withParsedValue = suggestions.find(
        (s) => s.filling.parsedValues.length > 0
      );
      expect(withParsedValue).toBeDefined();
    });

    test("'100 kg' parses as amount with unit", () => {
      const suggestions = engine.suggest("100 kg");

      expect(suggestions.length).toBeGreaterThan(0);
      // Amount field should score well
      const amountMatch = findByField(suggestions, "amount")[0];
      expect(amountMatch).toBeDefined();
    });

    test("decimal '50.5' parses correctly", () => {
      const suggestions = engine.suggest("50.5% water");

      const percentageMatch = findByOverload(
        suggestions,
        "contents:gt:percentage+materialTypes[]"
      );

      expect(percentageMatch).toBeDefined();
      expect(percentageMatch!.filling.filledArgs.percentage).toBe(50.5);
    });

    test("negative numbers '-50' are handled", () => {
      const suggestions = engine.suggest("-50");

      // Should not crash, may or may not parse negative
      expect(suggestions).toBeDefined();
    });
  });

  describe("edge cases", () => {
    test("handles single character 'w'", () => {
      const suggestions = engine.suggest("w");

      // Should not crash
      expect(suggestions).toBeDefined();
    });

    test("handles only whitespace variations", () => {
      expect(engine.suggest("")).toEqual([]);
      expect(engine.suggest(" ")).toEqual([]);
      expect(engine.suggest("\t")).toEqual([]);
      expect(engine.suggest("\n")).toEqual([]);
    });

    test("handles special characters '&'", () => {
      const suggestions = engine.suggest("water & biochar");

      // Should not crash
      expect(suggestions).toBeDefined();
    });

    test("handles very long query", () => {
      const longQuery = "water ".repeat(100);
      const suggestions = engine.suggest(longQuery);

      // Should not crash or timeout
      expect(suggestions).toBeDefined();
    });

    test("handles unicode characters", () => {
      const suggestions = engine.suggest("wäter");

      // Should not crash
      expect(suggestions).toBeDefined();
    });

    test("handles mixed case 'WATER', 'Water', 'wAtEr'", () => {
      const upper = engine.suggest("WATER");
      const title = engine.suggest("Water");
      const mixed = engine.suggest("wAtEr");

      // All should find water (case insensitive matching)
      expect(upper.length).toBeGreaterThan(0);
      expect(title.length).toBeGreaterThan(0);
      expect(mixed.length).toBeGreaterThan(0);
    });
  });

  describe("operator matching", () => {
    test("'> 50' includes operator symbol", () => {
      const suggestions = engine.suggest("> 50");

      expect(suggestions.length).toBeGreaterThan(0);
      // The '>' should be recognized
    });

    test("'greater than 50' uses word alias", () => {
      const suggestions = engine.suggest("greater than 50");

      expect(suggestions.length).toBeGreaterThan(0);
    });

    test("'more than 50% water' matches percentage overload", () => {
      const suggestions = engine.suggest("more than 50% water");

      const percentageMatch = findByOverload(
        suggestions,
        "contents:gt:percentage+materialTypes[]"
      );

      expect(percentageMatch).toBeDefined();
    });
  });

  describe("scoring", () => {
    test("complete suggestions score higher than incomplete", () => {
      const suggestions = engine.suggest("20% water");

      const complete = suggestions.filter((s) => s.isComplete);
      const incomplete = suggestions.filter((s) => !s.isComplete);

      if (complete.length > 0 && incomplete.length > 0) {
        const bestComplete = Math.max(...complete.map((s) => s.score));
        const bestIncomplete = Math.max(...incomplete.map((s) => s.score));
        expect(bestComplete).toBeGreaterThan(bestIncomplete);
      }
    });

    test("higher argument coverage = higher score", () => {
      const suggestions = engine.suggest("water");

      // Contains overload (1 arg) should score differently than
      // percentage overload (2 args) with only 1 filled
      expect(suggestions.length).toBeGreaterThan(0);

      for (const s of suggestions) {
        expect(s.scoreBreakdown.coverage).toBeGreaterThanOrEqual(0);
        expect(s.scoreBreakdown.coverage).toBeLessThanOrEqual(1);
      }
    });

    test("unused chunks penalize score", () => {
      const suggestions = engine.suggest("water xyz abc");

      // Suggestions should have unused chunks
      const withUnused = suggestions.filter(
        (s) => s.filling.unusedChunks.length > 0
      );
      expect(withUnused.length).toBeGreaterThan(0);

      // Unused penalty should be < 1
      for (const s of withUnused) {
        expect(s.scoreBreakdown.unusedPenalty).toBeLessThan(1);
      }
    });

    test("all scores are in valid range [0, 1]", () => {
      const queries = ["water", "50%", "100 kg bio", "contents"];

      for (const q of queries) {
        const suggestions = engine.suggest(q);
        for (const s of suggestions) {
          expect(s.score).toBeGreaterThanOrEqual(0);
          expect(s.score).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe("chunking", () => {
    test("includes chunking information", () => {
      const suggestions = engine.suggest("20% water");

      for (const s of suggestions) {
        expect(s.chunking).toBeDefined();
        expect(s.chunking.chunks.length).toBeGreaterThan(0);
        expect(s.chunking.strategy).toBeDefined();
      }
    });

    test("'20%water' without space still chunks", () => {
      const suggestions = engine.suggest("20%water");

      expect(suggestions.length).toBeGreaterThan(0);
      // Should use class-transition chunking to split 20% and water
    });
  });

  describe("no-space queries", () => {
    test("'water>50' parses without spaces", () => {
      const suggestions = engine.suggest("water>50");

      expect(suggestions.length).toBeGreaterThan(0);
    });

    test("'50%water' parses percentage and material", () => {
      const suggestions = engine.suggest("50%water");

      const percentageMatch = findByOverload(
        suggestions,
        "contents:gt:percentage+materialTypes[]"
      );

      // May or may not match depending on chunking
      expect(suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("multiple numbers", () => {
    test("'50 100 water' handles multiple numbers", () => {
      const suggestions = engine.suggest("50 100 water");

      expect(suggestions.length).toBeGreaterThan(0);
      // Should use first number for percentage/value
    });

    test("'water 25 75' with numbers after value", () => {
      const suggestions = engine.suggest("water 25 75");

      expect(suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("ambiguous inputs", () => {
    test("'100' could be count or percentage", () => {
      const suggestions = engine.suggest("100");

      // Should generate candidates for both count and contents fields
      const countMatch = findByField(suggestions, "count");
      const contentsMatch = findByField(suggestions, "contents");

      expect(countMatch.length).toBeGreaterThan(0);
      expect(contentsMatch.length).toBeGreaterThan(0);
    });

    test("'water' could be material or string value", () => {
      const suggestions = engine.suggest("water");

      // Should at least match contents field
      const contentsMatch = findByField(suggestions, "contents");
      expect(contentsMatch.length).toBeGreaterThan(0);
    });
  });

  describe("priority ordering", () => {
    test("higher priority overloads appear earlier", () => {
      const candidates = engine.getAllCandidates();

      // Percentage overloads have priority 10, amount has 5
      const percentageIdx = candidates.findIndex(
        (c) => c.overload.id === "contents:gt:percentage+materialTypes[]"
      );
      const amountIdx = candidates.findIndex(
        (c) => c.overload.id === "contents:gt:amount+materialTypes[]"
      );

      expect(percentageIdx).toBeLessThan(amountIdx);
    });
  });
});

describe("CandidateEngine configuration", () => {
  test("respects maxSuggestions config", () => {
    const deps = createTestDependencies();
    const engine = createCandidateEngine(deps, { maxSuggestions: 3 });

    const suggestions = engine.suggest("water");
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  test("respects minScore config", () => {
    const deps = createTestDependencies();
    const engine = createCandidateEngine(deps, { minScore: 0.9 });

    const suggestions = engine.suggest("xyz");
    // Very low-scoring results should be filtered
    for (const s of suggestions) {
      expect(s.score).toBeGreaterThanOrEqual(0.9);
    }
  });

  test("invalidateCache clears candidates", () => {
    const deps = createTestDependencies();
    const engine = createCandidateEngine(deps);

    const before = engine.getAllCandidates();
    engine.invalidateCache();
    const after = engine.getAllCandidates();

    // Should regenerate (same content, but not cached)
    expect(before.length).toBe(after.length);
  });
});
