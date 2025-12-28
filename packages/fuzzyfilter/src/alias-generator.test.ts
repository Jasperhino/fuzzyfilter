/**
 * Alias Generator Tests
 * 
 * Tests for the combinatorial alias generation system.
 */

import { test, expect, describe } from "bun:test";
import {
  expandPattern,
  expandAliasPatterns,
  expandSpreadPattern,
  getAllSpreadKeywordPairs,
  getSpreadStartKeywords,
  getSpreadSeparatorKeywords,
} from "./alias-generator.ts";
import type { AliasPattern, SpreadPattern } from "./types/index.ts";

describe("expandPattern", () => {
  test("expands simple pattern with no optional parts", () => {
    const pattern: AliasPattern = { parts: ["less", "equal"] };
    const result = expandPattern(pattern);
    
    // Should contain all combinations of synonyms
    expect(result).toContain("less equal");
    expect(result).toContain("less equals");
    expect(result).toContain("less eq");
    expect(result).toContain("smaller equal");
    expect(result).toContain("smaller equals");
    expect(result).toContain("smaller eq");
    expect(result).toContain("lower equal");
    expect(result).toContain("under equal");
  });

  test("expands pattern with optional parts", () => {
    const pattern: AliasPattern = { parts: ["less", "than?", "equal"] };
    const result = expandPattern(pattern);
    
    // Without "than"
    expect(result).toContain("less equal");
    expect(result).toContain("smaller equal");
    
    // With "than"
    expect(result).toContain("less than equal");
    expect(result).toContain("smaller than equal");
  });

  test("expands pattern with multiple optional parts", () => {
    const pattern: AliasPattern = { parts: ["less", "than?", "or?", "equal"] };
    const result = expandPattern(pattern);
    
    // All combinations of optional parts
    expect(result).toContain("less equal");           // neither
    expect(result).toContain("less than equal");      // just than
    expect(result).toContain("less or equal");        // just or
    expect(result).toContain("less than or equal");   // both
    
    // Also with synonyms
    expect(result).toContain("smaller equal");
    expect(result).toContain("smaller than or equal");
    expect(result).toContain("lower or eq");
    expect(result).toContain("under than or equals");
  });

  test("handles single-word patterns", () => {
    const pattern: AliasPattern = { parts: ["greater"] };
    const result = expandPattern(pattern);
    
    expect(result).toContain("greater");
    expect(result).toContain("bigger");
    expect(result).toContain("larger");
    expect(result).toContain("more");
    expect(result).toContain("over");
    expect(result).toContain("above");
  });

  test("treats unknown keys as literal words", () => {
    const pattern: AliasPattern = { parts: ["unknown_word", "equal"] };
    const result = expandPattern(pattern);
    
    // unknown_word should be treated as a literal
    expect(result).toContain("unknown_word equal");
    expect(result).toContain("unknown_word equals");
  });

  test("generates starts with pattern correctly", () => {
    const pattern: AliasPattern = { parts: ["starts", "with?"] };
    const result = expandPattern(pattern);
    
    expect(result).toContain("starts");
    expect(result).toContain("begins");
    expect(result).toContain("starts with");
    expect(result).toContain("begins with");
  });
});

describe("expandAliasPatterns", () => {
  test("combines multiple patterns", () => {
    const patterns: AliasPattern[] = [
      { parts: ["less", "equal"] },
      { parts: ["greater", "equal"] },
    ];
    const result = expandAliasPatterns(patterns);
    
    // Should contain aliases from both patterns
    expect(result).toContain("less equal");
    expect(result).toContain("greater equal");
    expect(result).toContain("smaller eq");
    expect(result).toContain("bigger equals");
  });

  test("deduplicates results", () => {
    const patterns: AliasPattern[] = [
      { parts: ["less", "equal"] },
      { parts: ["less", "equal"] }, // duplicate
    ];
    const result = expandAliasPatterns(patterns);
    
    // Should not have duplicates
    const uniqueCount = new Set(result).size;
    expect(result.length).toBe(uniqueCount);
  });
});

describe("expandSpreadPattern", () => {
  test("expands from/to pattern", () => {
    const pattern: SpreadPattern = {
      keywords: ["from", "to"],
      keywordSets: ["from", "to"],
    };
    const result = expandSpreadPattern(pattern);
    
    expect(result).toContainEqual(["from", "to"]);
    expect(result).toContainEqual(["from", "till"]);
    expect(result).toContainEqual(["from", "until"]);
  });

  test("expands between/and pattern", () => {
    const pattern: SpreadPattern = {
      keywords: ["between", "and"],
      keywordSets: ["between", "and"],
    };
    const result = expandSpreadPattern(pattern);
    
    expect(result).toContainEqual(["between", "and"]);
  });
});

describe("getAllSpreadKeywordPairs", () => {
  test("combines pairs from multiple patterns", () => {
    const patterns: SpreadPattern[] = [
      { keywords: ["from", "to"], keywordSets: ["from", "to"] },
      { keywords: ["between", "and"], keywordSets: ["between", "and"] },
    ];
    const result = getAllSpreadKeywordPairs(patterns);
    
    expect(result).toContainEqual(["from", "to"]);
    expect(result).toContainEqual(["from", "till"]);
    expect(result).toContainEqual(["between", "and"]);
  });
});

describe("getSpreadStartKeywords", () => {
  test("returns all start keywords", () => {
    const patterns: SpreadPattern[] = [
      { keywords: ["from", "to"], keywordSets: ["from", "to"] },
      { keywords: ["between", "and"], keywordSets: ["between", "and"] },
    ];
    const result = getSpreadStartKeywords(patterns);
    
    expect(result.has("from")).toBe(true);
    expect(result.has("between")).toBe(true);
    // Should not include separators
    expect(result.has("to")).toBe(false);
    expect(result.has("and")).toBe(false);
  });
});

describe("getSpreadSeparatorKeywords", () => {
  test("returns all separator keywords", () => {
    const patterns: SpreadPattern[] = [
      { keywords: ["from", "to"], keywordSets: ["from", "to"] },
      { keywords: ["between", "and"], keywordSets: ["between", "and"] },
    ];
    const result = getSpreadSeparatorKeywords(patterns);
    
    expect(result.has("to")).toBe(true);
    expect(result.has("till")).toBe(true);
    expect(result.has("until")).toBe(true);
    expect(result.has("and")).toBe(true);
    // Should not include start keywords
    expect(result.has("from")).toBe(false);
    expect(result.has("between")).toBe(false);
  });
});
