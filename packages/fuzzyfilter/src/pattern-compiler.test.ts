/**
 * Tests for Pattern Compiler
 */

import { describe, it, expect } from "bun:test";
import {
  parsePattern,
  compilePattern,
  compileOperator,
  compileOperatorDefinition,
} from "./pattern-compiler.ts";
import type { I18nProvider } from "./types/i18n.ts";
import type { OperatorKey } from "./operators.ts";

// Mock i18n provider for testing
function createMockI18nProvider(translations: Record<string, string>): I18nProvider {
  return {
    getOperatorLabel: (id: OperatorKey) => id,
    getOperatorAliases: () => [],
    translate: (key: string) => translations[key],
  };
}

describe("parsePattern", () => {
  it("should parse a simple literal pattern", () => {
    const result = parsePattern("empty");
    expect(result.raw).toBe("empty");
    expect(result.segments).toEqual([{ type: "literal", value: "empty" }]);
    expect(result.argCount).toBe(0);
    expect(result.aliasRefs).toEqual([]);
    expect(result.i18nRefs).toEqual([]);
  });

  it("should parse a pattern with single argument", () => {
    const result = parsePattern("equals {value}");
    expect(result.argCount).toBe(1);
    expect(result.argNames).toEqual(["value"]);
    expect(result.segments).toEqual([
      { type: "literal", value: "equals" },
      { type: "arg", name: "value" },
    ]);
  });

  it("should parse a pattern with multiple arguments", () => {
    const result = parsePattern("between {min} and {max}");
    expect(result.argCount).toBe(2);
    expect(result.argNames).toEqual(["min", "max"]);
  });

  it("should parse @aliasRef references", () => {
    const result = parsePattern("@is {value}");
    expect(result.aliasRefs).toEqual(["@is"]);
    expect(result.segments).toEqual([
      { type: "aliasRef", key: "@is" },
      { type: "arg", name: "value" },
    ]);
  });

  it("should parse t(key) i18n references", () => {
    const result = parsePattern("t(between) {min} @and {max}");
    expect(result.i18nRefs).toEqual(["between"]);
    expect(result.aliasRefs).toEqual(["@and"]);
    expect(result.segments).toEqual([
      { type: "i18nRef", key: "between" },
      { type: "arg", name: "min" },
      { type: "aliasRef", key: "@and" },
      { type: "arg", name: "max" },
    ]);
  });

  it("should parse t(nested.key) i18n references", () => {
    const result = parsePattern("t(operators.neq) {}");
    expect(result.i18nRefs).toEqual(["operators.neq"]);
    expect(result.argCount).toBe(1);
  });

  it("should parse mixed pattern with multiple refs", () => {
    const result = parsePattern("t(from) {start} @to {end}");
    expect(result.i18nRefs).toEqual(["from"]);
    expect(result.aliasRefs).toEqual(["@to"]);
    expect(result.argCount).toBe(2);
  });

  it("should parse anonymous {} arguments", () => {
    const result = parsePattern("@eq {} {} {}");
    expect(result.argCount).toBe(3);
    expect(result.argNames).toEqual(["arg0", "arg1", "arg2"]);
  });
});

describe("compilePattern", () => {
  it("should compile a simple pattern without expansion", () => {
    const result = compilePattern("empty", "isEmpty", {});
    expect(result.raw).toBe("empty");
    expect(result.argCount).toBe(0);
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0]!.pattern).toBe("empty");
    expect(result.expansions[0]!.keywords).toEqual(["empty"]);
  });

  it("should expand @aliasRef from local aliases", () => {
    const result = compilePattern("@is {value}", "eq", {
      aliases: {
        "@is": ["=", "==", "is"],
      },
    });
    
    expect(result.expansions).toHaveLength(3);
    expect(result.expansions.map(e => e.pattern)).toEqual([
      "= {value}",
      "== {value}",
      "is {value}",
    ]);
  });

  it("should expand t(key) via i18n provider", () => {
    const i18nProvider = createMockI18nProvider({
      "between": "zwischen",
    });
    
    const result = compilePattern("t(between) {min} and {max}", "between", {
      i18nProvider,
    });
    
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0]!.pattern).toBe("zwischen {min} and {max}");
  });

  it("should expand nested t() refs in aliases", () => {
    const i18nProvider = createMockI18nProvider({
      "is": "ist",
      "equals": "gleich",
    });
    
    const result = compilePattern("@op {value}", "eq", {
      aliases: {
        "@op": ["=", "t(is)", "t(equals)"],
      },
      i18nProvider,
    });
    
    expect(result.expansions).toHaveLength(3);
    expect(result.expansions.map(e => e.pattern)).toEqual([
      "= {value}",
      "ist {value}",
      "gleich {value}",
    ]);
  });

  it("should generate all permutations for multiple @refs", () => {
    const result = compilePattern("@start {a} @mid {b}", "test", {
      aliases: {
        "@start": ["from", "beginning"],
        "@mid": ["to", "until"],
      },
    });
    
    // 2 x 2 = 4 permutations
    expect(result.expansions).toHaveLength(4);
    expect(result.expansions.map(e => e.pattern)).toContain("from {a} to {b}");
    expect(result.expansions.map(e => e.pattern)).toContain("from {a} until {b}");
    expect(result.expansions.map(e => e.pattern)).toContain("beginning {a} to {b}");
    expect(result.expansions.map(e => e.pattern)).toContain("beginning {a} until {b}");
  });

  it("should fallback to key name when alias not found", () => {
    const result = compilePattern("@unknown {value}", "test", {});
    
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0]!.pattern).toBe("unknown {value}");
  });

  it("should fallback to key name when i18n translation not found", () => {
    const i18nProvider = createMockI18nProvider({});
    
    const result = compilePattern("t(missing) {value}", "test", {
      i18nProvider,
    });
    
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0]!.pattern).toBe("missing {value}");
  });
});

describe("compileOperator", () => {
  it("should compile multiple patterns", () => {
    const result = compileOperator("eq", [
      "= {value}",
      "is {value}",
      "equals {value}",
    ], {});
    
    expect(result.key).toBe("eq");
    expect(result.patterns).toHaveLength(3);
    expect(result.minArguments).toBe(1);
    expect(result.maxArguments).toBe(1);
    expect(result.requiresArgument).toBe(true);
    expect(result.isVariadic).toBe(false);
  });

  it("should detect variadic operators", () => {
    const result = compileOperator("between", [
      "between {min} and {max}",
      "range {a} {b}",
    ], {});
    
    expect(result.minArguments).toBe(2);
    expect(result.maxArguments).toBe(2);
    expect(result.isVariadic).toBe(true);
  });

  it("should detect non-argument operators", () => {
    const result = compileOperator("isEmpty", [
      "empty",
      "null",
      "blank",
    ], {});
    
    expect(result.minArguments).toBe(0);
    expect(result.maxArguments).toBe(0);
    expect(result.requiresArgument).toBe(false);
    expect(result.isVariadic).toBe(false);
  });

  it("should collect all trie keywords", () => {
    const result = compileOperator("eq", [
      "= {value}",
      "is {value}",
    ], {});
    
    expect(result.trieKeywords).toContain("eq");
    expect(result.trieKeywords).toContain("=");
    expect(result.trieKeywords).toContain("is");
  });

  it("should expand aliases into trie keywords", () => {
    const result = compileOperator("eq", [
      "@is {value}",
    ], {
      aliases: {
        "@is": ["=", "==", "is"],
      },
    });
    
    expect(result.trieKeywords).toContain("eq");
    expect(result.trieKeywords).toContain("=");
    expect(result.trieKeywords).toContain("==");
    expect(result.trieKeywords).toContain("is");
  });
});

describe("compileOperatorDefinition", () => {
  it("should compile full operator definition", () => {
    const result = compileOperatorDefinition({
      key: "equals",
      patterns: ["@is {value}"],
      aliases: {
        "@is": ["=", "==", "is"],
      },
    });
    
    expect(result.key).toBe("equals");
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]!.expansions).toHaveLength(3);
    expect(result.requiresArgument).toBe(true);
  });

  it("should compile operator patterns", () => {
    const result = compileOperatorDefinition({
      key: "equals",
      patterns: ["t(operators.equals) {value}"],
    });
    
    expect(result.patterns).toHaveLength(1);
    expect(result.trieKeywords.length).toBeGreaterThan(0);
    expect(result.typeSpecificTrieKeywords).toBeDefined();
    expect(result.typeSpecificTrieKeywords?.date).toContain("at");
    expect(result.typeSpecificTrieKeywords?.date).toContain("on");
  });

  it("should work with i18n provider", () => {
    const i18nProvider = createMockI18nProvider({
      "between": "zwischen",
      "and": "und",
    });
    
    const result = compileOperatorDefinition({
      key: "between",
      patterns: ["t(between) {min} t(and) {max}"],
    }, i18nProvider);
    
    expect(result.patterns[0]!.expansions[0]!.pattern).toBe("zwischen {min} und {max}");
  });
});

describe("pattern matching", () => {
  it("should match exact keyword patterns", () => {
    const compiled = compilePattern("is {value}", "eq", {});
    const matcher = compiled.expansions[0]!.match;
    
    const result = matcher([
      { text: "is", normalized: "is", start: 0, end: 2 },
      { text: "Open", normalized: "open", start: 3, end: 7 },
    ]);
    
    expect(result).not.toBeNull();
    expect(result!.operatorKey).toBe("eq");
    expect(result!.args).toEqual(["Open"]);
  });

  it("should not match when keyword is only partial prefix", () => {
    const compiled = compilePattern("equals {value}", "eq", {});
    const matcher = compiled.expansions[0]!.match;
    
    const result = matcher([
      { text: "eq", normalized: "eq", start: 0, end: 2 },
      { text: "Open", normalized: "open", start: 3, end: 7 },
    ]);
    
    // "eq" is NOT a match for "equals" - keywords must match exactly
    expect(result).toBeNull();
  });
  
  it("should match when keyword matches exactly", () => {
    const compiled = compilePattern("equals {value}", "eq", {});
    const matcher = compiled.expansions[0]!.match;
    
    const result = matcher([
      { text: "equals", normalized: "equals", start: 0, end: 6 },
      { text: "Open", normalized: "open", start: 7, end: 11 },
    ]);
    
    expect(result).not.toBeNull();
    expect(result!.args).toEqual(["Open"]);
  });

  it("should not match when keyword is wrong", () => {
    const compiled = compilePattern("is {value}", "eq", {});
    const matcher = compiled.expansions[0]!.match;
    
    const result = matcher([
      { text: "not", normalized: "not", start: 0, end: 3 },
      { text: "Open", normalized: "open", start: 4, end: 8 },
    ]);
    
    expect(result).toBeNull();
  });

  it("should extract multiple arguments", () => {
    const compiled = compilePattern("between {min} and {max}", "between", {});
    const matcher = compiled.expansions[0]!.match;
    
    const result = matcher([
      { text: "between", normalized: "between", start: 0, end: 7 },
      { text: "10", normalized: "10", start: 8, end: 10 },
      { text: "and", normalized: "and", start: 11, end: 14 },
      { text: "20", normalized: "20", start: 15, end: 17 },
    ]);
    
    expect(result).not.toBeNull();
    expect(result!.args).toEqual(["10", "20"]);
  });
});
