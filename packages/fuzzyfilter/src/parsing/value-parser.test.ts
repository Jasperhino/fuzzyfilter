import { describe, test, expect } from "bun:test";
import {
  createValueParserRegistry,
  createParsedValue,
  extractNumbers,
  extractUnitTextAfterNumber,
  multiplyScores,
  type ValueParser,
} from "./value-parser";
import type { UnitRegistry } from "../units/types";
import type { ParsedValue } from "./types";

describe("createValueParserRegistry", () => {
  test("creates registry from array of parsers", () => {
    const mockParser1: ValueParser<number> = {
      type: "number",
      parse: () => [],
    };
    const mockParser2: ValueParser<string> = {
      type: "string",
      parse: () => [],
    };

    const registry = createValueParserRegistry([mockParser1, mockParser2]);

    expect(registry.size).toBe(2);
    expect(registry.get("number")).toBe(mockParser1);
    expect(registry.get("string")).toBe(mockParser2);
  });

  test("handles empty array", () => {
    const registry = createValueParserRegistry([]);
    expect(registry.size).toBe(0);
  });

  test("later parser overwrites earlier with same type", () => {
    const parser1: ValueParser<number> = {
      type: "dup",
      parse: () => [createParsedValue(1, "1", 0, 1, 1)],
    };
    const parser2: ValueParser<number> = {
      type: "dup",
      parse: () => [createParsedValue(2, "2", 0, 1, 1)],
    };

    const registry = createValueParserRegistry([parser1, parser2]);
    expect(registry.size).toBe(1);
    expect(registry.get("dup")).toBe(parser2);
  });
});

describe("createParsedValue", () => {
  test("creates ParsedValue with all fields", () => {
    const result = createParsedValue(42, "42", 0, 2, 0.9);

    expect(result.value).toBe(42);
    expect(result.rawText).toBe("42");
    expect(result.start).toBe(0);
    expect(result.end).toBe(2);
    expect(result.score).toBe(0.9);
    expect(result.unit).toBeUndefined();
  });

  test("includes unit when provided", () => {
    const mockUnit = {
      item: { id: "kg", dimension: "mass", toBase: 1, i18nKey: "units.kg" },
      score: 0.95,
    };
    const result = createParsedValue({ value: 50, unit: "kg" }, "50kg", 0, 4, 0.9, mockUnit);

    expect(result.unit).toBe(mockUnit);
  });

  test("clamps score to [0, 1]", () => {
    const tooHigh = createParsedValue(1, "1", 0, 1, 1.5);
    expect(tooHigh.score).toBe(1);

    const tooLow = createParsedValue(1, "1", 0, 1, -0.5);
    expect(tooLow.score).toBe(0);
  });
});

describe("extractNumbers", () => {
  test("extracts single integer", () => {
    const results = extractNumbers("42");
    expect(results).toEqual([{ value: 42, text: "42", start: 0, end: 2 }]);
  });

  test("extracts single decimal", () => {
    const results = extractNumbers("3.14");
    expect(results).toEqual([{ value: 3.14, text: "3.14", start: 0, end: 4 }]);
  });

  test("extracts multiple numbers", () => {
    const results = extractNumbers("weight 50 to 100");
    expect(results).toEqual([
      { value: 50, text: "50", start: 7, end: 9 },
      { value: 100, text: "100", start: 13, end: 16 },
    ]);
  });

  test("extracts numbers from mixed content", () => {
    const results = extractNumbers("50kg");
    expect(results).toEqual([{ value: 50, text: "50", start: 0, end: 2 }]);
  });

  test("returns empty array for no numbers", () => {
    const results = extractNumbers("no numbers here");
    expect(results).toEqual([]);
  });

  test("handles leading zeros", () => {
    const results = extractNumbers("007");
    expect(results).toEqual([{ value: 7, text: "007", start: 0, end: 3 }]);
  });
});

describe("extractUnitTextAfterNumber", () => {
  test("extracts text immediately after number", () => {
    const result = extractUnitTextAfterNumber("50kg", 2);
    expect(result).toEqual({ text: "kg", start: 2, end: 4 });
  });

  test("extracts text with space after number", () => {
    const result = extractUnitTextAfterNumber("50 kg", 2);
    expect(result).toEqual({ text: "kg", start: 3, end: 5 });
  });

  test("extracts text with multiple spaces", () => {
    const result = extractUnitTextAfterNumber("50   kg", 2);
    expect(result).toEqual({ text: "kg", start: 5, end: 7 });
  });

  test("returns null when no text after number", () => {
    const result = extractUnitTextAfterNumber("50", 2);
    expect(result).toBeNull();
  });

  test("returns null when only whitespace after number", () => {
    const result = extractUnitTextAfterNumber("50   ", 2);
    expect(result).toBeNull();
  });

  test("stops at non-letter character", () => {
    const result = extractUnitTextAfterNumber("50kg/m", 2);
    expect(result).toEqual({ text: "kg", start: 2, end: 4 });
  });

  test("extracts full unit name", () => {
    const result = extractUnitTextAfterNumber("50 kilograms", 2);
    expect(result).toEqual({ text: "kilograms", start: 3, end: 12 });
  });
});

describe("multiplyScores", () => {
  test("multiplies multiple factors", () => {
    expect(multiplyScores(0.9, 0.8)).toBeCloseTo(0.72, 5);
    expect(multiplyScores(0.9, 0.8, 0.7)).toBeCloseTo(0.504, 5);
  });

  test("handles single factor", () => {
    expect(multiplyScores(0.5)).toBe(0.5);
  });

  test("handles no factors", () => {
    expect(multiplyScores()).toBe(1);
  });

  test("clamps factors above 1", () => {
    expect(multiplyScores(1.5, 0.5)).toBe(0.5);
  });

  test("clamps factors below 0", () => {
    expect(multiplyScores(-0.5, 0.5)).toBe(0);
  });

  test("result stays in (0, 1]", () => {
    const result = multiplyScores(0.9, 0.9, 0.9, 0.9, 0.9);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe("ValueParser interface", () => {
  test("parser can return multiple interpretations", () => {
    // Example: a number parser that returns multiple possible values
    const parser: ValueParser<number> = {
      type: "number",
      parse(query) {
        const results: ParsedValue<number>[] = [];
        const numbers = extractNumbers(query);

        for (const num of numbers) {
          results.push(
            createParsedValue(num.value, num.text, num.start, num.end, 1.0)
          );
        }

        return results;
      },
    };

    const results = parser.parse("10 to 20", null as unknown as UnitRegistry);
    expect(results.length).toBe(2);
    expect(results[0].value).toBe(10);
    expect(results[1].value).toBe(20);
  });

  test("parser can use expectedDimension for unit filtering", () => {
    const parser: ValueParser<{ value: number; unit?: string }> = {
      type: "mass",
      expectedDimension: "mass",
      parse(query, unitRegistry) {
        // In real implementation, would use unitRegistry.search(text, this.expectedDimension)
        return [
          createParsedValue({ value: 50, unit: "kg" }, "50kg", 0, 4, 0.9),
        ];
      },
    };

    expect(parser.expectedDimension).toBe("mass");
  });

  test("parser can provide suggestions", () => {
    const parser: ValueParser<number> = {
      type: "number",
      parse: () => [],
      suggest(partial) {
        if (/\d+$/.test(partial)) {
          return [
            { completion: "kg", label: "kg (kilogram)", category: "unit", score: 0.9 },
            { completion: "g", label: "g (gram)", category: "unit", score: 0.8 },
          ];
        }
        return [];
      },
    };

    const suggestions = parser.suggest!("50", null as unknown as UnitRegistry);
    expect(suggestions.length).toBe(2);
    expect(suggestions[0].completion).toBe("kg");
  });
});
