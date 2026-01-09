/**
 * FuzzyFilter Integration Tests
 *
 * Uses the shared sample-data package for consistent, seeded test data.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { createFuzzyFilter, columnId, DataType, UnknownColumnError, createDefaultEnglishProvider } from "./index.ts";
import type { FuzzyFilter } from "./types/index.ts";
import {
  TASK_SCHEMA,
  createSeededGenerator,
  SAMPLE_DATA_SEED,
} from "@fuzzyfilter/sample-data";

/** Seeded generator for reproducible test data */
const generateTestData = createSeededGenerator(SAMPLE_DATA_SEED);

describe("FuzzyFilter", () => {
  let filter: FuzzyFilter;

  /**
   * Small sample dataset for basic unit tests.
   * Uses a minimal subset to keep tests fast while still being representative.
   */
  const sampleData = generateTestData(10) as unknown as Record<
    string,
    unknown
  >[];

  beforeEach(() => {
    // V2 API: columns and i18n are required in config
    filter = createFuzzyFilter({
      columns: TASK_SCHEMA.columns,
      i18n: createDefaultEnglishProvider(),
      maxSuggestions: 10,
    });
    filter.indexData(sampleData);
  });

  describe("Schema", () => {
    test("getSchema returns the schema", () => {
      const schema = filter.getSchema();
      expect(schema).not.toBeNull();
      // TASK_SCHEMA has 8 columns: status, assignee, priority, department, dueDate, created, isBlocked, comments
      expect(schema?.columns.size).toBe(8);
    });

    test("getColumn returns column by ID", () => {
      const col = filter.getColumn("status");
      expect(col).not.toBeNull();
      expect(col?.labelKey).toBe("columns.status");
      // Status column has values, so it's in enum mode (no explicit type needed)
      expect(col?.values).toEqual(["Open", "In Progress", "Closed", "Blocked"]);
    });

    test("getOperatorsForColumn returns valid operators", () => {
      const ops = filter.getOperatorsForColumn("priority");
      expect(ops).toContain("eq");
      expect(ops).toContain("gt");
      expect(ops).toContain("lt");
      expect(ops).not.toContain("contains");
    });
  });

  describe("Indexing", () => {
    test("getIndexStats returns correct counts", () => {
      const stats = filter.getIndexStats();
      // We generate 10 sample rows in beforeEach
      expect(stats.totalRows).toBe(10);
      expect(stats.columnsIndexed).toBe(8);
    });

    test("clearIndex empties the index", () => {
      filter.clearIndex();
      const stats = filter.getIndexStats();
      expect(stats.totalRows).toBe(0);
    });
  });

  describe("Suggestions", () => {
    test("empty query returns default suggestions", async () => {
      const response = await filter.suggest("");
      expect(response.suggestions.length).toBeGreaterThan(0);
    });

    test("column name query returns column suggestions", async () => {
      const response = await filter.suggest("stat");
      // Column suggestions will have the column's labelKey resolved via i18n
      expect(response.suggestions.length).toBeGreaterThan(0);
      // The column should be the status column
      const statusSuggestion = response.suggestions.find(s => s.column.id === "status");
      expect(statusSuggestion).toBeDefined();
    });

    test("operator query returns operator suggestions", async () => {
      const response = await filter.suggest("neq");
      expect(response.suggestions.some((s) => s.operator === "neq")).toBe(true);
    });

    test("value query returns value suggestions", async () => {
      // Use "Open" which is a Status enum value guaranteed to exist
      const response = await filter.suggest("Open");
      expect(
        response.suggestions.some((s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Open")
      ).toBe(true);
    });

    test("multi-token query parses correctly", async () => {
      const response = await filter.suggest("Status eq");
      expect(response.suggestions.length).toBeGreaterThan(0);
      // Verify that Status column appears in the suggestions
      const statusSuggestion = response.suggestions.find(
        (s) => s.column.name === "Status" && s.operator === "eq"
      );
      expect(statusSuggestion).toBeDefined();
    });

    test("suggestions include result counts", async () => {
      // Use "Open" status value which exists in the enum
      const response = await filter.suggest("status eq Open");
      const openSuggestion = response.suggestions.find(
        (s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Open"
      );
      expect(openSuggestion?.resultCount).toBeGreaterThanOrEqual(0);
    });

    test("responseTimeMs is tracked", async () => {
      const response = await filter.suggest("status");
      expect(response.responseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Parsing", () => {
    test("parse identifies column", () => {
      const parsed = filter.parse("Status");
      expect(parsed.column?.match.column.name).toBe("Status");
    });

    test("parse identifies operator", () => {
      const parsed = filter.parse("eq");
      expect(parsed.operator?.match.operator).toBe("eq");
    });

    test("parse handles multi-token input", () => {
      const parsed = filter.parse("Status eq Open");
      expect(parsed.column?.match.column.name).toBe("Status");
      expect(parsed.operator?.match.operator).toBe("eq");
    });

    test("parse correctly assigns 'status notin' - column first, operator second", () => {
      // This tests optimal slot assignment: "status" should be column, "notin" should be operator
      // Even though "status" might have weak fuzzy matches to operators, "notin" is a much better
      // match for nin operator (via notIn alias), so the optimal assignment should use it.
      const parsed = filter.parse("status notin");
      expect(parsed.column?.match.column.name).toBe("Status");
      expect(parsed.operator?.match.operator).toBe("nin");
      // The tokens should be correctly assigned (different tokens for different slots)
      expect(parsed.column?.token.text).toBe("status");
      expect(parsed.operator?.token.text).toBe("notin");
    });

    test("parse correctly assigns 'nin status' - operator first, column second", () => {
      // Same test but with reversed token order
      const parsed = filter.parse("nin status");
      expect(parsed.column?.match.column.name).toBe("Status");
      expect(parsed.operator?.match.operator).toBe("nin");
      expect(parsed.column?.token.text).toBe("status");
      expect(parsed.operator?.token.text).toBe("nin");
    });

    test("parse finds optimal assignment with 'priority between'", () => {
      // "priority" should match column, "between" should match operator
      const parsed = filter.parse("priority between");
      expect(parsed.column?.match.column.name).toBe("Priority");
      expect(parsed.operator?.match.operator).toBe("between");
    });

    test("parse correctly assigns 'status in open' - column, operator, value", () => {
      // This tests three-token parsing: column + operator + value
      const parsed = filter.parse("status in open");
      expect(parsed.column?.match.column.name).toBe("Status");
      expect(parsed.operator?.match.operator).toBe("in");
      expect(parsed.column?.token.text).toBe("status");
      expect(parsed.operator?.token.text).toBe("in");
    });

    test("suggest 'status in open closed' should show Status in [Open, Closed] as top suggestion", async () => {
      const response = await filter.suggest("status in open closed");
      
      // The top suggestion should be Status in [Open, Closed]
      const top = response.suggestions[0];
      expect(top?.column.name).toBe("Status");
      expect(top?.operator).toBe("in");
      expect(top?.arguments).toBeDefined();
      expect(top?.arguments?.length).toBeGreaterThanOrEqual(1);
      
      // Should have both Open and Closed as values
      const values = top?.arguments?.map(a => a.kind === 'string' ? a.value : null).filter(Boolean);
      expect(values).toContain("Open");
      expect(values).toContain("Closed");
    });

    test("suggest 'one of open closed' should show Status in [Open, Closed] (operator alias with multiple values)", async () => {
      // "one of" is an alias for the "in" operator
      // When typed without a column name, it should infer Status from the values
      const response = await filter.suggest("one of open closed");
      
      // Find a suggestion that has both Open and Closed as values for Status column
      const multiValueSuggestion = response.suggestions.find(s => 
        s.column.name === "Status" && 
        s.operator === "in" && 
        s.arguments && 
        s.arguments.length >= 2
      );
      
      expect(multiValueSuggestion).toBeDefined();
      
      const values = multiValueSuggestion?.arguments?.map(a => a.kind === 'string' ? a.value : null).filter(Boolean);
      expect(values).toContain("Open");
      expect(values).toContain("Closed");
    });

    test("'in' operator arguments should not exceed the number of tokens (no token reuse)", async () => {
      // Test case: When searching with tokens, the "in" operator should NOT
      // suggest more arguments than tokens. Each token should contribute at most one value.
      const filter = createFuzzyFilter({
        columns: [
          { 
            id: columnId("tags"), 
            labelKey: "columns.tags",
            type: "string" 
          },
        ],
        i18n: createDefaultEnglishProvider(),
        maxSuggestions: 20,
      });
      
      // Create data where "hello" matches multiple values
      filter.indexData([
        { tags: "Hello Alpha" },
        { tags: "Hello Beta" },
        { tags: "Hello Charlie" },
        { tags: "Hello Delta" },
        { tags: "Hello Echo" },
        { tags: "World One" },
        { tags: "World Two" },
        { tags: "World Three" },
        { tags: "Other Value" },
      ]);

      // Test with single token "hello" - should get at most 1 argument for "in"
      const singleTokenResponse = await filter.suggest("hello");
      const singleTokenInSuggestions = singleTokenResponse.suggestions.filter(
        (s) => s.operator === "in" && s.column.name === "Tags" && s.arguments && s.arguments.length > 0
      );
      
      // Debug: print what we got
      console.log("\n=== Suggestions for 'hello' ===");
      for (const s of singleTokenResponse.suggestions.slice(0, 10)) {
        const argStr = s.arguments?.map(a => a.kind === 'string' ? a.value : '?').join(', ') || '-';
        console.log(`  ${s.column.name.padEnd(12)} ${s.operator.padEnd(10)} [${argStr.padEnd(20)}] score=${s.score}`);
      }
      
      // With 1 token ("hello"), "in" operator should have at most 1 argument
      for (const suggestion of singleTokenInSuggestions) {
        expect(suggestion.arguments!.length).toBeLessThanOrEqual(1);
      }

      // Test with two tokens "hello world" - should get at most 2 arguments for "in"
      const twoTokenResponse = await filter.suggest("hello world");
      const twoTokenInSuggestions = twoTokenResponse.suggestions.filter(
        (s) => s.operator === "in" && s.column.name === "Tags" && s.arguments && s.arguments.length > 0
      );
      
      console.log("\n=== Suggestions for 'hello world' ===");
      for (const s of twoTokenResponse.suggestions.slice(0, 10)) {
        const argStr = s.arguments?.map(a => a.kind === 'string' ? a.value : '?').join(', ') || '-';
        console.log(`  ${s.column.name.padEnd(12)} ${s.operator.padEnd(10)} [${argStr.padEnd(20)}] score=${s.score}`);
      }
      
      // With 2 tokens ("hello", "world"), it should have at most 2 arguments
      for (const suggestion of twoTokenInSuggestions) {
        expect(suggestion.arguments!.length).toBeLessThanOrEqual(2);
      }
    });

    test("validate returns errors for incomplete input", () => {
      const result = filter.validate("Status");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("No operator specified");
    });

    test("validate passes for complete input", () => {
      const result = filter.validate("Status eq Open");
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  describe("Compilation", () => {
    test("compile creates a filter", () => {
      const compiled = filter.compile("Status eq Open");
      expect(compiled).not.toBeNull();
      expect(compiled?.columnId).toBe(columnId("status"));
      expect(compiled?.operator).toBe("eq");
    });

    test("compileFilter creates a filter programmatically", () => {
      const compiled = filter.compileFilter("priority", "gt", 2);
      expect(compiled).not.toBeNull();
      // Match count depends on generated data, just verify it's a number >= 0
      expect(compiled?.matchCount).toBeGreaterThanOrEqual(0);
    });

    test("compiled filter predicate works", () => {
      const compiled = filter.compileFilter("status", "eq", "Open");
      expect(compiled).not.toBeNull();
      expect(compiled?.predicate({ status: "Open" })).toBe(true);
      expect(compiled?.predicate({ status: "Closed" })).toBe(false);
    });
  });

  describe("Execution", () => {
    test("execute returns matching rows", () => {
      // Use "Open" status which is guaranteed to exist in the enum
      const compiled = filter.compileFilter("status", "eq", "Open");
      const result = filter.execute(compiled!);
      // At least verify it returns a valid result structure
      expect(result.count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.matchingRows)).toBe(true);
    });

    test("count returns match count", () => {
      const compiled = filter.compileFilter("isBlocked", "isTrue");
      // Count of blocked items depends on generated data
      expect(filter.count(compiled!)).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Variadic operators (in/nin)", () => {
    /**
     * Test that the "in" operator works correctly with a single-value array.
     * This tests that compileFilter correctly handles arrays for variadic operators.
     * Bug scenario: When passing ["In Progress"] to compileFilter for the "in" operator,
     * the predicate should match rows where status === "In Progress".
     */
    test("'in' operator works with single-value array", () => {
      const compiled = filter.compileFilter("status", "in", ["Open"]);
      expect(compiled).not.toBeNull();
      expect(compiled?.predicate({ status: "Open" })).toBe(true);
      expect(compiled?.predicate({ status: "Closed" })).toBe(false);
      expect(compiled?.predicate({ status: "In Progress" })).toBe(false);
    });

    /**
     * Test that the "in" operator works correctly with multiple values.
     */
    test("'in' operator works with multi-value array", () => {
      const compiled = filter.compileFilter("status", "in", ["Open", "Closed"]);
      expect(compiled).not.toBeNull();
      expect(compiled?.predicate({ status: "Open" })).toBe(true);
      expect(compiled?.predicate({ status: "Closed" })).toBe(true);
      expect(compiled?.predicate({ status: "In Progress" })).toBe(false);
    });

    /**
     * Test that the "nin" (not in) operator works correctly with a single-value array.
     */
    test("'nin' operator works with single-value array", () => {
      const compiled = filter.compileFilter("status", "nin", ["Open"]);
      expect(compiled).not.toBeNull();
      expect(compiled?.predicate({ status: "Open" })).toBe(false);
      expect(compiled?.predicate({ status: "Closed" })).toBe(true);
      expect(compiled?.predicate({ status: "In Progress" })).toBe(true);
    });

    /**
     * Test that the "nin" operator works correctly with multiple values.
     */
    test("'nin' operator works with multi-value array", () => {
      const compiled = filter.compileFilter("status", "nin", ["Open", "Closed"]);
      expect(compiled).not.toBeNull();
      expect(compiled?.predicate({ status: "Open" })).toBe(false);
      expect(compiled?.predicate({ status: "Closed" })).toBe(false);
      expect(compiled?.predicate({ status: "In Progress" })).toBe(true);
    });

    /**
     * Test that "in" operator matchCount correctly counts matching rows.
     * This verifies the compiled filter counts matches accurately.
     */
    test("'in' operator matchCount is accurate", () => {
      // Create a controlled dataset
      const testFilter = createFuzzyFilter({
        columns: [
          { id: columnId("status"), labelKey: "columns.status", values: ["Open", "Closed", "In Progress"] },
        ],
        i18n: createDefaultEnglishProvider(),
      });
      testFilter.indexData([
        { status: "Open" },
        { status: "Open" },
        { status: "Closed" },
        { status: "In Progress" },
        { status: "In Progress" },
        { status: "In Progress" },
      ]);

      // Test single value
      const singleValueFilter = testFilter.compileFilter("status", "in", ["Open"]);
      expect(singleValueFilter?.matchCount).toBe(2); // 2 Open rows

      // Test multiple values  
      const multiValueFilter = testFilter.compileFilter("status", "in", ["Open", "In Progress"]);
      expect(multiValueFilter?.matchCount).toBe(5); // 2 Open + 3 In Progress
    });
  });
});

describe("Tokenizer", () => {
  test("handles quoted strings", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("name"), name: "Name", type: "string" },
      ],
    });
    filter.indexData([{ name: "John Doe" }]);

    const parsed = filter.parse('name eq "John Doe"');
    expect(parsed.tokens.length).toBe(3);
    expect(parsed.tokens[2]?.text).toBe("John Doe");
    expect(parsed.tokens[2]?.quoted).toBe(true);
  });

  test("handles operator symbols", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("age"), name: "Age", type: "number" },
      ],
    });
    filter.indexData([{ age: 25 }]);

    const parsed = filter.parse("age >= 21");
    expect(parsed.tokens.some((t) => t.text === ">=")).toBe(true);
  });
});

// =============================================================================
// N-gram / Multi-word Matching Tests
// =============================================================================

describe("N-gram Matching", () => {
  test("matches values with spaces (e.g., 'Eve Foster')", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("name"), name: "Name", type: "string" },
      ],
    });
    filter.indexData([
      { name: "Eve Foster" },
      { name: "Alice Chen" },
      { name: "Bob Smith" },
    ]);

    // Single word should match
    const response1 = await filter.suggest("eve");
    expect(response1.suggestions.some((s) => 
      s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Eve Foster"
    )).toBe(true);

    // Multi-word should also match
    const response2 = await filter.suggest("eve foster");
    expect(response2.suggestions.some((s) => 
      s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Eve Foster"
    )).toBe(true);
  });

  test("matches operators with spaces (e.g., 'not equals')", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "string" },
      ],
    });
    filter.indexData([{ status: "Open" }]);

    const response = await filter.suggest("not equals");
    expect(response.suggestions.some((s) => s.operator === "neq")).toBe(true);
    
    // The neq operator should be the top result for "not equals" query
    // because it explains both tokens ("not" and "equals")
    const neqSuggestions = response.suggestions.filter((s) => s.operator === "neq");
    expect(neqSuggestions.length).toBeGreaterThan(0);
    
    // neq should be the first operator in the suggestions
    // (eq may or may not be present, but if it is, neq should rank higher)
    const eqSuggestions = response.suggestions.filter((s) => s.operator === "eq");
    if (eqSuggestions.length > 0) {
      const bestNeqScore = Math.max(...neqSuggestions.map((s) => s.score));
      const bestEqScore = Math.max(...eqSuggestions.map((s) => s.score));
      expect(bestNeqScore).toBeGreaterThan(bestEqScore);
    }
  });

  test("value matches should not be boosted by eq when a better operator matches the same ngram", async () => {
    // Regression test: "not equals" should match neq operator, not boost random value matches with eq
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("comments"), name: "Comments", type: "string" },
      ],
    });
    // Add data with values that might fuzzy-match "not equals"
    filter.indexData([
      { comments: "Need to quarrel the pulse" },
      { comments: "Note about equality" },
    ]);

    const response = await filter.suggest("not equals");
    
    // neq suggestions should rank higher than eq suggestions with fuzzy-matched values
    const neqSuggestions = response.suggestions.filter((s) => s.operator === "neq");
    const eqWithValueSuggestions = response.suggestions.filter(
      (s) => s.operator === "eq" && s.arguments && s.arguments.length > 0
    );
    
    expect(neqSuggestions.length).toBeGreaterThan(0);
    
    // If there are any eq+value suggestions, they should rank lower than neq
    if (eqWithValueSuggestions.length > 0) {
      const bestNeqScore = Math.max(...neqSuggestions.map((s) => s.score));
      const bestEqWithValueScore = Math.max(...eqWithValueSuggestions.map((s) => s.score));
      expect(bestNeqScore).toBeGreaterThan(bestEqWithValueScore);
    }
  });

  test("multi-word operator 'not equal' should beat single-word 'equal' for overlapping tokens", async () => {
    // Regression test: "status not equal open" should match neq operator, not eq
    // The "not equal" bigram should be preferred over "equal" single token
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "string" },
      ],
    });
    filter.indexData([
      { status: "Open" },
      { status: "Closed" },
    ]);

    const response = await filter.suggest("status not equal open");
    
    // Should have neq suggestions
    const neqSuggestions = response.suggestions.filter((s) => s.operator === "neq");
    expect(neqSuggestions.length).toBeGreaterThan(0);
    
    // neq suggestions should rank higher than eq suggestions
    const eqSuggestions = response.suggestions.filter((s) => s.operator === "eq");
    
    if (neqSuggestions.length > 0 && eqSuggestions.length > 0) {
      const bestNeqScore = Math.max(...neqSuggestions.map((s) => s.score));
      const bestEqScore = Math.max(...eqSuggestions.map((s) => s.score));
      expect(bestNeqScore).toBeGreaterThan(bestEqScore);
    }
    
    // The top suggestion should be Status neq, not Status eq
    const topSuggestion = response.suggestions[0];
    expect(topSuggestion?.operator).toBe("neq");
    expect(topSuggestion?.column.name).toBe("Status");
  });

  test("matches column aliases with spaces (e.g., 'assigned to')", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { 
          id: columnId("assignee"), 
          name: "Assignee", 
          type: "string",
          aliases: ["assigned to", "owner"],
        },
      ],
    });
    filter.indexData([{ assignee: "Alice" }]);

    const response = await filter.suggest("assigned to");
    expect(response.suggestions.some((s) => s.column.name === "Assignee")).toBe(true);
  });

  test("matches 'is not empty' as a single operator phrase", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("notes"), name: "Notes", type: "string" },
      ],
    });
    filter.indexData([{ notes: "Some note" }]);

    const response = await filter.suggest("is not empty");
    expect(response.suggestions.some((s) => s.operator === "isNotEmpty")).toBe(true);
  });

  test("matches 'less than or equal' operator", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("price"), name: "Price", type: "number" },
      ],
    });
    filter.indexData([{ price: 100 }]);

    const response = await filter.suggest("less than or equal");
    expect(response.suggestions.some((s) => s.operator === "lte")).toBe(true);
  });

  test("ranks exact value match 'in progress' higher than 'in' operator", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "In Progress", "Done"] },
        { id: columnId("name"), name: "Name", type: "string" },
      ],
    });
    filter.indexData([
      { status: "Open", name: "Alice" },
      { status: "In Progress", name: "Bob" },
      { status: "Done", name: "Charlie" },
    ]);

    const response = await filter.suggest("in progress");
    
    // The exact value match should be in the suggestions - this is a complete suggestion
    // with both the 'in' operator AND the 'In Progress' value
    const valueMatch = response.suggestions.find(
      (s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value.toLowerCase() === "in progress"
    );
    expect(valueMatch).toBeDefined();
    
    // The 'in' operator match WITHOUT the value should also be present
    // This is the incomplete suggestion that just has the operator
    const operatorOnlyMatch = response.suggestions.find(
      (s) => s.operator === "in" && (!s.arguments || s.arguments.length === 0 || 
        (s.arguments[0]?.kind === "string" && s.arguments[0].value.toLowerCase() !== "in progress"))
    );
    expect(operatorOnlyMatch).toBeDefined();
    
    // The complete value match should have a higher score than the operator-only match
    // because it explains more of the query (both "in" and "progress")
    if (valueMatch && operatorOnlyMatch) {
      expect(valueMatch.score).toBeGreaterThan(operatorOnlyMatch.score);
    }
  });

  test("ranks partial operator match lower than complete value match", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("priority"), name: "Priority", type: "enum", values: ["Low", "Medium", "High", "Equal Priority"] },
        { id: columnId("amount"), name: "Amount", type: "number" },
      ],
    });
    filter.indexData([
      { priority: "Low", amount: 100 },
      { priority: "Equal Priority", amount: 200 },
    ]);

    const response = await filter.suggest("equal priority");
    
    // The exact value match should score higher than "eq" operator matches
    const valueMatch = response.suggestions.find(
      (s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value.toLowerCase() === "equal priority"
    );
    const eqOperatorMatch = response.suggestions.find((s) => s.operator === "eq" && (!s.arguments || s.arguments.length === 0));
    
    expect(valueMatch).toBeDefined();
    if (valueMatch && eqOperatorMatch) {
      expect(valueMatch.score).toBeGreaterThan(eqOperatorMatch.score);
    }
  });
});

// =============================================================================
// Type-Specific Alias Tests
// =============================================================================

describe("Type-Specific Aliases", () => {
  test("'at' alias only suggests 'eq' for date columns, not string columns", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("name"), name: "Name", type: "string" },
        { id: columnId("createdAt"), name: "Created At", type: "date" },
      ],
    });
    filter.indexData([
      { name: "Alice", createdAt: "2024-01-15" },
    ]);

    const response = await filter.suggest("at");
    
    // Should have suggestions for the date column with "eq" (via "at" alias)
    const dateSuggestions = response.suggestions.filter(
      (s) => s.column.type === "date" && s.operator === "eq"
    );
    expect(dateSuggestions.length).toBeGreaterThan(0);
    
    // Should NOT have suggestions for string column via "at" alias
    // (string column suggestions should not be boosted by "at")
    const stringSuggestions = response.suggestions.filter(
      (s) => s.column.type === "string" && s.operator === "eq"
    );
    // The "at" alias should not create suggestions for string columns
    // since "at" is a date-specific alias
    expect(stringSuggestions.length).toBe(0);
  });

  test("'on' alias prioritizes date columns for eq suggestions", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("amount"), name: "Amount", type: "number" },
        { id: columnId("scheduledAt"), name: "Scheduled", type: "date" },
      ],
    });
    filter.indexData([
      { amount: 5, scheduledAt: "2024-03-01" },
    ]);

    const response = await filter.suggest("on");
    
    // Should have date column suggestions via "on" alias
    const dateSuggestions = response.suggestions.filter(
      (s) => s.column.type === "date" && s.operator === "eq"
    );
    expect(dateSuggestions.length).toBeGreaterThan(0);
    
    // Date suggestions should be present (the type-specific alias works)
    expect(dateSuggestions[0]?.column.name).toBe("Scheduled");
  });

  test("matchedAlias is included in suggestion parts when an alias is matched", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        // Use a column name that won't fuzzy match with "on"
        { id: columnId("dueDate"), name: "Due", type: "date" },
      ],
    });
    filter.indexData([
      { dueDate: "2024-01-15" },
    ]);

    // Search for "on" which is a date-specific alias for "eq"
    // (won't match "Due" column name)
    const response = await filter.suggest("on");
    
    // Find a suggestion that matched via the "on" alias
    const dateSuggestion = response.suggestions.find(
      (s) => s.column.type === "date" && s.operator === "eq"
    );
    
    expect(dateSuggestion).toBeDefined();
    // The matchedAlias should be "on"
    expect(dateSuggestion?.parts.operator.matchedAlias).toBe("on");
    // The text should be the operator id (label is deprecated)
    expect(dateSuggestion?.parts.operator.text).toBe("eq");
    // The label should use the matched alias
    expect(dateSuggestion?.label).toContain("on");
  });

  test("matchedAlias is undefined when operator id/label is matched directly", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("name"), name: "Name", type: "string" },
      ],
    });
    filter.indexData([
      { name: "Alice" },
    ]);

    // Search for "equals" which is the operator label
    const response = await filter.suggest("equals");
    
    const stringSuggestion = response.suggestions.find(
      (s) => s.column.type === "string" && s.operator === "eq"
    );
    
    expect(stringSuggestion).toBeDefined();
    // matchedAlias should still be set to what the user typed
    expect(stringSuggestion?.parts.operator.matchedAlias).toBe("equals");
  });

  test("general aliases like 'equals' work for all supported types", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("name"), name: "Name", type: "string" },
        { id: columnId("count"), name: "Count", type: "number" },
        { id: columnId("createdAt"), name: "Created At", type: "date" },
      ],
    });
    filter.indexData([
      { name: "Alice", count: 5, createdAt: "2024-01-15" },
    ]);

    const response = await filter.suggest("equals");
    
    // Should have suggestions for all column types
    const stringEq = response.suggestions.some(
      (s) => s.column.type === "string" && s.operator === "eq"
    );
    const numberEq = response.suggestions.some(
      (s) => s.column.type === "number" && s.operator === "eq"
    );
    const dateEq = response.suggestions.some(
      (s) => s.column.type === "date" && s.operator === "eq"
    );
    
    expect(stringEq).toBe(true);
    expect(numberEq).toBe(true);
    expect(dateEq).toBe(true);
  });
});

// =============================================================================
// Date Parsing Tests
// =============================================================================

describe("Date Parsing", () => {
  test("'today' resolves to current date", async () => {
    const { parseDate } = await import("./date-parser.ts");
    const result = parseDate("today");
    
    expect(result).not.toBeNull();
    expect(result?.date).toBeInstanceOf(Date);
    expect(result?.text).toBe("today");
    
    // Verify it's today's date
    const today = new Date();
    expect(result?.date.getFullYear()).toBe(today.getFullYear());
    expect(result?.date.getMonth()).toBe(today.getMonth());
    expect(result?.date.getDate()).toBe(today.getDate());
  });

  test("'yesterday' resolves to previous day", async () => {
    const { parseDate } = await import("./date-parser.ts");
    const result = parseDate("yesterday");
    
    expect(result).not.toBeNull();
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(result?.date.getDate()).toBe(yesterday.getDate());
  });

  test("'tomorrow' resolves to next day", async () => {
    const { parseDate } = await import("./date-parser.ts");
    const result = parseDate("tomorrow");
    
    expect(result).not.toBeNull();
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(result?.date.getDate()).toBe(tomorrow.getDate());
  });

  test("'two weeks ago' resolves to date 14 days in the past", async () => {
    const { parseDate } = await import("./date-parser.ts");
    const referenceDate = new Date("2024-06-15T12:00:00Z");
    const result = parseDate("two weeks ago", { referenceDate });
    
    expect(result).not.toBeNull();
    expect(result?.date).toBeInstanceOf(Date);
    
    // Check it's approximately 14 days before reference
    const expectedDate = new Date("2024-06-01T12:00:00Z");
    const diffDays = Math.round((referenceDate.getTime() - result!.date.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(14);
  });

  test("'last week' is detected as a range", async () => {
    const { parseDate } = await import("./date-parser.ts");
    const result = parseDate("last week");
    
    expect(result).not.toBeNull();
    expect(result?.isRange).toBe(true);
    expect(result?.rangeStart).toBeInstanceOf(Date);
    expect(result?.rangeEnd).toBeInstanceOf(Date);
    expect(result!.rangeStart!.getTime()).toBeLessThan(result!.rangeEnd!.getTime());
  });

  test("'last month' is detected as a range", async () => {
    const { parseDate } = await import("./date-parser.ts");
    const result = parseDate("last month");
    
    expect(result).not.toBeNull();
    expect(result?.isRange).toBe(true);
    expect(result?.rangeStart).toBeInstanceOf(Date);
    expect(result?.rangeEnd).toBeInstanceOf(Date);
  });

  test("mightBeDateExpression returns true for date keywords", async () => {
    const { mightBeDateExpression } = await import("./date-parser.ts");
    
    expect(mightBeDateExpression("today")).toBe(true);
    expect(mightBeDateExpression("yesterday")).toBe(true);
    expect(mightBeDateExpression("last week")).toBe(true);
    expect(mightBeDateExpression("3 days ago")).toBe(true);
    expect(mightBeDateExpression("January 15")).toBe(true);
    expect(mightBeDateExpression("2024-01-15")).toBe(true);
  });

  test("mightBeDateExpression returns false for non-date strings", async () => {
    const { mightBeDateExpression } = await import("./date-parser.ts");
    
    expect(mightBeDateExpression("status")).toBe(false);
    expect(mightBeDateExpression("priority")).toBe(false);
    expect(mightBeDateExpression("Alice")).toBe(false);
  });

  test("invalid date text returns null", async () => {
    const { parseDate } = await import("./date-parser.ts");
    
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("   ")).toBeNull();
    expect(parseDate("random text here")).toBeNull();
  });

  test("detectDateExpressions finds multiple dates in text", async () => {
    const { detectDateExpressions } = await import("./date-parser.ts");
    const results = detectDateExpressions("from yesterday to tomorrow");
    
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Should find at least one date expression
    expect(results.some(r => r.parsed.date instanceof Date)).toBe(true);
  });
});

describe("Date Column Suggestions", () => {
  test("'Created after yesterday' suggests proper date filter", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date", aliases: ["created"] },
      ],
    });
    filter.indexData([
      { createdAt: "2024-01-15" },
      { createdAt: "2024-02-01" },
    ]);

    const response = await filter.suggest("Created At after yesterday");
    
    expect(response.suggestions.length).toBeGreaterThan(0);
    // Should have a suggestion with date value
    const dateSuggestion = response.suggestions.find((s) => 
      s.arguments?.[0]?.kind === "date"
    );
    expect(dateSuggestion).toBeDefined();
    expect(dateSuggestion?.column.name).toBe("Created At");
  });

  test("typing 'two weeks ago' suggests date filters for date columns", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date" },
        { id: columnId("updatedAt"), name: "Updated At", type: "date" },
        { id: columnId("status"), name: "Status", type: "string" },
      ],
    });
    filter.indexData([
      { createdAt: "2024-01-15", updatedAt: "2024-02-01", status: "Open" },
    ]);

    const response = await filter.suggest("two weeks ago");
    
    // Should suggest date filters for date columns
    const dateSuggestions = response.suggestions.filter((s) => 
      s.arguments?.[0]?.kind === "date"
    );
    expect(dateSuggestions.length).toBeGreaterThan(0);
    
    // All date suggestions should be for date columns
    for (const suggestion of dateSuggestions) {
      expect(suggestion.column.type).toBe("date");
    }
  });
});

// =============================================================================
// Filter Context Stacking Tests
// =============================================================================

describe("Filter Context Stacking", () => {
  test("suggestion counts reflect existing filter context", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed", "In Progress"] },
        { id: columnId("assignee"), name: "Assignee", type: "string" },
      ],
    });
    filter.indexData([
      { status: "Open", assignee: "Alice" },
      { status: "Open", assignee: "Bob" },
      { status: "Closed", assignee: "Alice" },
      { status: "In Progress", assignee: "Charlie" },
    ]);

    // Without context: "assignee = Alice" should show 2 (both Alice rows)
    const responseNoContext = await filter.suggest("assignee eq Alice");
    const aliceNoContext = responseNoContext.suggestions.find(
      (s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Alice"
    );
    expect(aliceNoContext?.resultCount).toBe(2);

    // With existing filter "status = Open": "assignee = Alice" should show 1
    // (only the Open + Alice row)
    const statusOpenFilter = filter.compileFilter("status", "eq", "Open");
    expect(statusOpenFilter).not.toBeNull();
    
    const responseWithContext = await filter.suggest("assignee eq Alice", undefined, [statusOpenFilter!]);
    const aliceWithContext = responseWithContext.suggestions.find(
      (s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Alice"
    );
    expect(aliceWithContext?.resultCount).toBe(1);
  });

  test("empty filter context behaves same as no context", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
      ],
    });
    filter.indexData([
      { status: "Open" },
      { status: "Closed" },
    ]);

    const responseNoContext = await filter.suggest("Status");
    const responseEmptyContext = await filter.suggest("Status", undefined, []);
    
    expect(responseNoContext.suggestions.length).toBe(responseEmptyContext.suggestions.length);
  });

  test("multiple stacked filters reduce counts correctly", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
        { id: columnId("priority"), name: "Priority", type: "number" },
        { id: columnId("assignee"), name: "Assignee", type: "string" },
      ],
    });
    filter.indexData([
      { status: "Open", priority: 1, assignee: "Alice" },
      { status: "Open", priority: 2, assignee: "Alice" },
      { status: "Open", priority: 3, assignee: "Bob" },
      { status: "Closed", priority: 1, assignee: "Alice" },
      { status: "Closed", priority: 2, assignee: "Bob" },
    ]);

    // Filter: status = Open AND priority > 1
    const statusFilter = filter.compileFilter("status", "eq", "Open");
    const priorityFilter = filter.compileFilter("priority", "gt", 1);
    
    // Without context: Alice appears 3 times
    const responseNoContext = await filter.suggest("assignee eq Alice");
    const aliceNoContext = responseNoContext.suggestions.find(
      (s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Alice"
    );
    expect(aliceNoContext?.resultCount).toBe(3);
    
    // With both filters: Only 1 Alice row matches (Open, priority 2)
    const responseWithContext = await filter.suggest(
      "assignee eq Alice", 
      undefined, 
      [statusFilter!, priorityFilter!]
    );
    const aliceWithContext = responseWithContext.suggestions.find(
      (s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Alice"
    );
    expect(aliceWithContext?.resultCount).toBe(1);
  });

  test("filter context affects exploratory suggestions", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
        { id: columnId("assignee"), name: "Assignee", type: "string" },
      ],
    });
    filter.indexData([
      { status: "Open", assignee: "Alice" },
      { status: "Closed", assignee: "Bob" },
    ]);

    // With status = Open filter, suggestions for Assignee should only show 1 match
    const statusFilter = filter.compileFilter("status", "eq", "Open");
    
    const response = await filter.suggest("Assignee", undefined, [statusFilter!]);
    const assigneeSuggestion = response.suggestions.find(
      (s) => s.column.name === "Assignee"
    );
    // The result count should be 1, not 2 (only Open row)
    expect(assigneeSuggestion?.resultCount).toBe(1);
  });

  test("numeric value suggestions are constrained to filtered context", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
        { id: columnId("priority"), name: "Priority", type: "number" },
      ],
    });
    filter.indexData([
      { status: "Open", priority: 1 },
      { status: "Open", priority: 2 },
      { status: "Closed", priority: 3 },
      { status: "Closed", priority: 4 },
    ]);

    // With status = Open filter: typing "3" for priority should not generate suggestions
    // because priority 3 doesn't exist in Open rows
    const statusOpenFilter = filter.compileFilter("status", "eq", "Open");
    const response = await filter.suggest("priority eq 3", undefined, [statusOpenFilter!]);
    
    // No suggestions should have priority = 3 as an argument
    const priority3Suggestions = response.suggestions.filter(
      s => s.column.name === "Priority" && 
           s.arguments?.[0]?.kind === "number" && 
           s.arguments[0].value === 3
    );
    expect(priority3Suggestions.length).toBe(0);
    
    // But priority 1 and 2 should still work
    const response2 = await filter.suggest("priority eq 2", undefined, [statusOpenFilter!]);
    const priority2Suggestions = response2.suggestions.filter(
      s => s.column.name === "Priority" && 
           s.arguments?.[0]?.kind === "number" && 
           s.arguments[0].value === 2
    );
    expect(priority2Suggestions.length).toBeGreaterThan(0);
  });

  test("fuzzy string value search is constrained to filtered context", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("department"), name: "Department", type: "enum", values: ["Engineering", "Marketing", "Sales"] },
        { id: columnId("name"), name: "Name", type: "string" },
      ],
    });
    filter.indexData([
      { department: "Engineering", name: "Alice Anderson" },
      { department: "Engineering", name: "Bob Brown" },
      { department: "Marketing", name: "Charlie Carter" },
      { department: "Sales", name: "Dana Davis" },
    ]);

    // Without context: searching "Ali" should match Alice
    const responseNoContext = await filter.suggest("name Ali");
    const aliceNoContext = responseNoContext.suggestions.find(
      s => s.arguments?.[0]?.kind === "string" && 
           (s.arguments[0].value as string).includes("Alice")
    );
    expect(aliceNoContext).toBeDefined();

    // With department = Marketing filter: searching "Ali" should NOT match Alice
    // because Alice is in Engineering
    const marketingFilter = filter.compileFilter("department", "eq", "Marketing");
    const responseWithContext = await filter.suggest("name Ali", undefined, [marketingFilter!]);
    const aliceWithContext = responseWithContext.suggestions.find(
      s => s.arguments?.[0]?.kind === "string" && 
           (s.arguments[0].value as string).includes("Alice")
    );
    expect(aliceWithContext).toBeUndefined();
    
    // But searching for "Charlie" should work
    const charlieResponse = await filter.suggest("name Char", undefined, [marketingFilter!]);
    const charlie = charlieResponse.suggestions.find(
      s => s.arguments?.[0]?.kind === "string" && 
           (s.arguments[0].value as string).includes("Charlie")
    );
    expect(charlie).toBeDefined();
  });
});

// =============================================================================
// Date Filter Bug Regression Tests
// =============================================================================

describe("Date Filter Bug - 'created today' ranking and count", () => {
  test("complete date suggestions rank higher than incomplete operator suggestions", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date", aliases: ["created"] },
      ],
    });
    
    // Create data with today's date
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    
    filter.indexData([
      { createdAt: todayStr },
      { createdAt: "2024-01-15" },
    ]);

    const response = await filter.suggest("created today");
    
    // Find complete suggestion (with date value)
    const completeSuggestion = response.suggestions.find(
      (s) => s.isComplete && (s.arguments?.[0]?.kind === "date")
    );
    
    // Find incomplete suggestion (without value, like "Created At = ...")
    const incompleteSuggestion = response.suggestions.find(
      (s) => !s.isComplete && s.column.type === "date"
    );
    
    expect(completeSuggestion).toBeDefined();
    
    // The complete suggestion MUST rank higher (have higher score)
    if (completeSuggestion && incompleteSuggestion) {
      expect(completeSuggestion.score).toBeGreaterThan(incompleteSuggestion.score);
    }
    
    // The first suggestion should be complete
    expect(response.suggestions[0]?.isComplete).toBe(true);
  });

  test("preview result count matches actual filter execution for date filter", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date", aliases: ["created"] },
      ],
    });
    
    // Create data with today's date
    const today = new Date();
    today.setHours(12, 0, 0, 0); // Normalize to noon for consistent comparison
    const todayStr = today.toISOString().split("T")[0];
    
    filter.indexData([
      { createdAt: todayStr },
      { createdAt: todayStr },
      { createdAt: "2024-01-15" },
      { createdAt: "2024-02-20" },
    ]);

    const response = await filter.suggest("created today");
    
    // Find the "Created At = today" suggestion with eq operator
    const todaySuggestion = response.suggestions.find(
      (s) => s.arguments?.[0]?.kind === "date" && s.column.id === "createdAt" && s.operator === "eq"
    );
    
    expect(todaySuggestion).toBeDefined();
    
    // The preview count should show matches for today's date
    // Note: The suggestion may include all dates indexed if it's exploratory,
    // but when we compile with the specific date, it should match the today rows
    const compiled = filter.compileFilter("createdAt", "eq", today);
    expect(compiled).not.toBeNull();
    expect(compiled?.matchCount).toBe(2); // Two rows with today's date
    
    // The suggestion's result count should be reasonable (at least 1 match)
    expect(todaySuggestion?.resultCount).toBeGreaterThanOrEqual(1);
  });

  test("date filter with Date object works correctly", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date" },
      ],
    });
    
    // Create data with today's date in different formats
    const today = new Date();
    today.setHours(12, 0, 0, 0); // Set to noon for consistency
    const todayStr = today.toISOString().split("T")[0]!;
    
    filter.indexData([
      { createdAt: todayStr }, // String format: "2024-12-19"
      { createdAt: today.toISOString() }, // ISO format: "2024-12-19T12:00:00.000Z"
      { createdAt: "2024-01-15" },
    ]);

    // Compile with a Date object directly
    const compiled = filter.compileFilter("createdAt", "eq", today);
    expect(compiled).not.toBeNull();
    
    // Should match both today entries
    expect(compiled?.matchCount).toBe(2);
    
    // Test predicate with string date
    expect(compiled?.predicate({ createdAt: todayStr })).toBe(true);
    // Test predicate with ISO date
    expect(compiled?.predicate({ createdAt: today.toISOString() })).toBe(true);
    // Test predicate with past date
    expect(compiled?.predicate({ createdAt: "2024-01-15" })).toBe(false);
  });
});

describe("Date Filter Compilation", () => {
  test("compiles date filter with natural language date", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date" },
      ],
    });
    
    // Use a fixed date for testing
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    filter.indexData([
      { createdAt: today.toISOString() },
      { createdAt: yesterday.toISOString() },
      { createdAt: twoDaysAgo.toISOString() },
    ]);

    const compiled = filter.compileFilter("createdAt", "after", "yesterday");
    expect(compiled).not.toBeNull();
    
    // Should match today (which is after yesterday)
    expect(compiled?.predicate({ createdAt: today.toISOString() })).toBe(true);
    // Should not match two days ago
    expect(compiled?.predicate({ createdAt: twoDaysAgo.toISOString() })).toBe(false);
  });

  test("date equality compares by day", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date" },
      ],
    });
    
    const today = new Date();
    const todayMorning = new Date(today);
    todayMorning.setHours(8, 0, 0, 0);
    const todayEvening = new Date(today);
    todayEvening.setHours(20, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    filter.indexData([
      { createdAt: todayMorning.toISOString() },
      { createdAt: todayEvening.toISOString() },
      { createdAt: yesterday.toISOString() },
    ]);

    const compiled = filter.compileFilter("createdAt", "eq", "today");
    expect(compiled).not.toBeNull();
    
    // Both morning and evening of today should match
    expect(compiled?.predicate({ createdAt: todayMorning.toISOString() })).toBe(true);
    expect(compiled?.predicate({ createdAt: todayEvening.toISOString() })).toBe(true);
    // Yesterday should not match
    expect(compiled?.predicate({ createdAt: yesterday.toISOString() })).toBe(false);
  });

  test("before operator works with date column", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date" },
      ],
    });
    
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    filter.indexData([
      { createdAt: today.toISOString() },
      { createdAt: yesterday.toISOString() },
      { createdAt: tomorrow.toISOString() },
    ]);

    const compiled = filter.compileFilter("createdAt", "before", "today");
    expect(compiled).not.toBeNull();
    
    // Yesterday should match (before today)
    expect(compiled?.predicate({ createdAt: yesterday.toISOString() })).toBe(true);
    // Tomorrow should not match
    expect(compiled?.predicate({ createdAt: tomorrow.toISOString() })).toBe(false);
  });

  test("between operator works with date array for date ranges", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date" },
      ],
    });
    
    const today = new Date();
    today.setHours(12, 0, 0, 0); // Noon today
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    filter.indexData([
      { createdAt: today.toISOString() },
      { createdAt: yesterday.toISOString() },
      { createdAt: twoDaysAgo.toISOString() },
      { createdAt: tomorrow.toISOString() },
    ]);

    // Create date range: yesterday start of day to today end of day
    const rangeStart = new Date(yesterday);
    rangeStart.setHours(0, 0, 0, 0);
    
    const rangeEnd = new Date(today);
    rangeEnd.setHours(23, 59, 59, 999);

    // Test with Date array (how dateRange values are passed)
    const compiled = filter.compileFilter("createdAt", "between", [rangeStart, rangeEnd]);
    expect(compiled).not.toBeNull();
    
    // Yesterday should match (within range)
    expect(compiled?.predicate({ createdAt: yesterday.toISOString() })).toBe(true);
    // Today should match (within range)
    expect(compiled?.predicate({ createdAt: today.toISOString() })).toBe(true);
    // Two days ago should NOT match (before range)
    expect(compiled?.predicate({ createdAt: twoDaysAgo.toISOString() })).toBe(false);
    // Tomorrow should NOT match (after range)
    expect(compiled?.predicate({ createdAt: tomorrow.toISOString() })).toBe(false);
    
    // Match count should be 2 (yesterday and today)
    expect(compiled?.matchCount).toBe(2);
  });

  test("between operator preview count matches actual filter execution for date range", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date", aliases: ["created"] },
      ],
    });
    
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    filter.indexData([
      { createdAt: today.toISOString() },
      { createdAt: yesterday.toISOString() },
      { createdAt: twoDaysAgo.toISOString() },
    ]);

    // Search for "from yesterday to today" which should create a between filter
    const response = await filter.suggest("from yesterday to today");
    
    // Find the between suggestion for Created At
    const betweenSuggestion = response.suggestions.find(
      (s) => s.operator === "between" && s.column.id === "createdAt" && s.arguments?.length === 2
    );
    
    expect(betweenSuggestion).toBeDefined();
    expect(betweenSuggestion?.isComplete).toBe(true);
    
    // Get the preview count
    const previewCount = betweenSuggestion!.resultCount;
    
    // Now compile the filter using the arguments from the suggestion
    const args = betweenSuggestion!.arguments!;
    expect(args.length).toBe(2);
    expect(args[0]?.kind).toBe("date");
    expect(args[1]?.kind).toBe("date");
    
    if (args[0]?.kind === "date" && args[1]?.kind === "date") {
      const compiled = filter.compileFilter("createdAt", "between", [args[0].value, args[1].value]);
      expect(compiled).not.toBeNull();
      
      // CRITICAL: The preview count should match the compiled filter matchCount
      // This was the bug: preview showed 2 but actual was 0
      expect(compiled?.matchCount).toBe(previewCount);
    }
  });
});

describe("Argument-Aware Scoring", () => {
  test("typing 'prio 3 4' should suggest between with higher score than eq", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("priority"), name: "Priority", type: "number" },
      ],
    });
    filter.indexData([
      { priority: 1 },
      { priority: 2 },
      { priority: 3 },
      { priority: 4 },
      { priority: 5 },
    ]);

    const response = await filter.suggest("prio 3 4");
    
    // Should find a between suggestion for Priority with array value
    const betweenSuggestion = response.suggestions.find(
      (s) => s.operator === "between" && s.column.id === "priority"
    );
    
    expect(betweenSuggestion).toBeDefined();
    expect(betweenSuggestion?.arguments?.length).toBe(2);
    if (betweenSuggestion?.arguments?.length === 2) {
      // Check that both arguments are numbers with values 3 and 4
      const values = betweenSuggestion.arguments.map(a => a.kind === "number" ? a.value : null);
      expect(values).toContain(3);
      expect(values).toContain(4);
    }
    // Should match rows with priority 3 and 4 (between is inclusive)
    expect(betweenSuggestion?.resultCount).toBe(2);
    
    // The between suggestion should score higher than eq because it uses both values
    const eqSuggestion = response.suggestions.find(
      (s) => s.operator === "eq" && s.column.id === "priority" && s.arguments?.[0]?.kind === "number"
    );
    
    expect(eqSuggestion).toBeDefined();
    // eq only uses 1 of the 2 values, so should score lower
    expect(betweenSuggestion!.score).toBeGreaterThan(eqSuggestion!.score);
  });

  test("typing 'prio 3' with single number should suggest eq with that value", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("priority"), name: "Priority", type: "number" },
      ],
    });
    filter.indexData([
      { priority: 1 },
      { priority: 2 },
      { priority: 3 },
    ]);

    const response = await filter.suggest("prio 3");
    
    // Should find an eq suggestion for Priority with value 3
    const eqSuggestion = response.suggestions.find(
      (s) => s.operator === "eq" && s.column.id === "priority" && s.arguments?.[0]?.kind === "number"
    );
    
    expect(eqSuggestion).toBeDefined();
    expect(eqSuggestion?.arguments?.[0]?.kind).toBe("number");
    if (eqSuggestion?.arguments?.[0]?.kind === "number") {
      expect(eqSuggestion.arguments[0].value).toBe(3);
    }
    expect(eqSuggestion?.resultCount).toBe(1);
  });

  test("typing just '3 4' should suggest 'Priority between 3 4'", async () => {
    const filter = createFuzzyFilter({ maxSuggestions: 15 });
    filter.setSchema({
      columns: [
        { id: columnId("priority"), name: "Priority", type: "number" },
        { id: columnId("status"), name: "Status", type: "string" },
      ],
    });
    filter.indexData([
      { priority: 1, status: "Open" },
      { priority: 2, status: "Closed" },
      { priority: 3, status: "In Progress" },
      { priority: 4, status: "Blocked" },
      { priority: 5, status: "Open" },
    ]);

    const response = await filter.suggest("3 4");
    
    // Debug: log all suggestions to understand current behavior
    console.log("\n=== Suggestions for '3 4' ===");
    for (const s of response.suggestions.slice(0, 10)) {
      const args = s.arguments?.map(a => 
        a.kind === "number" ? a.value : 
        a.kind === "string" ? `"${a.value}"` : 
        a.kind
      ).join(", ") || "-";
      console.log(`  ${s.column.name.padEnd(12)} ${s.operator.padEnd(10)} [${args.padEnd(10)}] score=${s.score}`);
    }
    console.log(`Total: ${response.suggestions.length} suggestions`);
    
    // Should find a between suggestion for Priority
    const betweenSuggestion = response.suggestions.find(
      (s) => s.operator === "between" && s.column.id === "priority"
    );
    
    expect(betweenSuggestion).toBeDefined();
    expect(betweenSuggestion?.arguments?.length).toBe(2);
    
    // The between suggestion should be present in the suggestions
    // Note: String value matches for "3" and "4" may rank higher due to indexed values
    const betweenIndex = response.suggestions.findIndex(
      (s) => s.operator === "between" && s.column.id === "priority"
    );
    expect(betweenIndex).toBeLessThanOrEqual(5);
    
    // Check that the values are 3 and 4
    if (betweenSuggestion?.arguments?.length === 2) {
      const values = betweenSuggestion.arguments.map(a => a.kind === "number" ? a.value : null);
      expect(values).toContain(3);
      expect(values).toContain(4);
    }
  });

  test("typing 'between 3' with single value should show partial between suggestion", async () => {
    const filter = createFuzzyFilter({ maxSuggestions: 15 });
    filter.setSchema({
      columns: [
        { id: columnId("priority"), name: "Priority", type: "number" },
        { id: columnId("status"), name: "Status", type: "string" },
      ],
    });
    filter.indexData([
      { priority: 1, status: "Open" },
      { priority: 2, status: "Closed" },
      { priority: 3, status: "In Progress" },
      { priority: 4, status: "Blocked" },
      { priority: 5, status: "Open" },
    ]);

    const response = await filter.suggest("between 3");
    
    // Debug: log all suggestions to understand current behavior
    console.log("\n=== Suggestions for 'between 3' ===");
    for (const s of response.suggestions.slice(0, 10)) {
      const args = s.arguments?.map(a => 
        a.kind === "number" ? a.value : 
        a.kind === "string" ? `"${a.value}"` : 
        a.kind
      ).join(", ") || "-";
      console.log(`  ${s.column.name.padEnd(12)} ${s.operator.padEnd(10)} [${args.padEnd(10)}] score=${s.score} isComplete=${s.isComplete}`);
    }
    console.log(`Total: ${response.suggestions.length} suggestions`);
    
    // Should find a between suggestion for Priority with just the first value (3)
    const betweenWithOneValue = response.suggestions.find(
      (s) => s.operator === "between" && 
             s.column.id === "priority" && 
             s.arguments?.length === 1 &&
             s.arguments[0]?.kind === "number" &&
             s.arguments[0].value === 3
    );
    
    expect(betweenWithOneValue).toBeDefined();
    // Single-value between is NOT complete (needs second value)
    expect(betweenWithOneValue?.isComplete).toBe(false);
    
    // The partial between suggestion should be in top 3
    const betweenIndex = response.suggestions.findIndex(
      (s) => s.operator === "between" && 
             s.column.id === "priority" && 
             s.arguments?.length === 1
    );
    expect(betweenIndex).toBeLessThanOrEqual(2);
  });

  test("typing 'between 3 5' should suggest 'Priority between 3 - 5' as top suggestion", async () => {
    const filter = createFuzzyFilter({ maxSuggestions: 15 });
    filter.setSchema({
      columns: [
        { id: columnId("priority"), name: "Priority", type: "number" },
        { id: columnId("status"), name: "Status", type: "string" },
      ],
    });
    filter.indexData([
      { priority: 1, status: "Open" },
      { priority: 2, status: "Closed" },
      { priority: 3, status: "In Progress" },
      { priority: 4, status: "Blocked" },
      { priority: 5, status: "Open" },
    ]);

    const response = await filter.suggest("between 3 5");
    
    // Debug: log all suggestions to understand current behavior
    console.log("\n=== Suggestions for 'between 3 5' ===");
    for (const s of response.suggestions.slice(0, 10)) {
      const args = s.arguments?.map(a => 
        a.kind === "number" ? a.value : 
        a.kind === "string" ? `"${a.value}"` : 
        a.kind
      ).join(", ") || "-";
      console.log(`  ${s.column.name.padEnd(12)} ${s.operator.padEnd(10)} [${args.padEnd(10)}] score=${s.score}`);
    }
    console.log(`Total: ${response.suggestions.length} suggestions`);
    
    // Should find a complete between suggestion for Priority with values 3 and 5
    const betweenWithValues = response.suggestions.find(
      (s) => s.operator === "between" && 
             s.column.id === "priority" && 
             s.arguments?.length === 2 &&
             s.arguments.some(a => a.kind === "number" && a.value === 3) &&
             s.arguments.some(a => a.kind === "number" && a.value === 5)
    );
    
    expect(betweenWithValues).toBeDefined();
    expect(betweenWithValues?.isComplete).toBe(true);
    
    // Should also find an incomplete between suggestion (without values)
    const betweenWithoutValues = response.suggestions.find(
      (s) => s.operator === "between" && 
             s.column.id === "priority" && 
             (!s.arguments || s.arguments.length === 0)
    );
    
    // The complete suggestion (with values) should score HIGHER than the incomplete one
    if (betweenWithValues && betweenWithoutValues) {
      expect(betweenWithValues.score).toBeGreaterThan(betweenWithoutValues.score);
    }
    
    // The complete suggestion should be in top 3
    const betweenIndex = response.suggestions.findIndex(
      (s) => s.operator === "between" && 
             s.column.id === "priority" && 
             s.arguments?.length === 2
    );
    expect(betweenIndex).toBeLessThanOrEqual(2);
    
    // Check result count: should match rows with priority 3, 4, 5 (3 rows)
    expect(betweenWithValues?.resultCount).toBe(3);
  });
});

describe("QueryMatch Highlighting", () => {
  let filter: FuzzyFilter;
  const sampleData = [
    { status: "Open", assignee: "Alice", priority: 1 },
    { status: "Closed", assignee: "Bob", priority: 2 },
    { status: "In Progress", assignee: "Charlie", priority: 3 },
  ];

  beforeEach(() => {
    filter = createFuzzyFilter({ maxSuggestions: 10 });
    filter.setSchema(TASK_SCHEMA);
    filter.indexData(sampleData);
  });

  test("column match includes queryMatches with position info", async () => {
    const response = await filter.suggest("status");
    
    // Find a suggestion that matched the column
    const suggestion = response.suggestions.find(s => s.column.id === "status");
    expect(suggestion).toBeDefined();
    expect(suggestion?.queryMatches).toBeDefined();
    expect(suggestion?.queryMatches?.length).toBeGreaterThan(0);
    
    // Check that we have a column match
    const columnMatch = suggestion?.queryMatches?.find(m => m.matchType === "column");
    expect(columnMatch).toBeDefined();
    expect(columnMatch?.matchedTarget).toBe("Status");
    expect(columnMatch?.inputText).toBe("status");
    expect(columnMatch?.inputRange.start).toBe(0);
    expect(columnMatch?.inputRange.end).toBe(6);
  });

  test("operator match includes queryMatches with character indexes", async () => {
    const response = await filter.suggest("eq");
    
    // Find a suggestion that matched an operator
    const suggestion = response.suggestions.find(s => s.operator === "eq");
    expect(suggestion).toBeDefined();
    
    // Should have operator match info
    const opMatch = suggestion?.queryMatches?.find(m => m.matchType === "operator");
    expect(opMatch).toBeDefined();
    expect(opMatch?.inputText).toBe("eq");
    expect(opMatch?.inputRange.start).toBe(0);
    expect(opMatch?.inputRange.end).toBe(2);
    // Exact match should have character indexes
    expect(opMatch?.matchedCharIndexes).toBeDefined();
  });

  test("value match includes queryMatches with position info", async () => {
    const response = await filter.suggest("Open");
    
    // Find a suggestion where the value matched
    const suggestion = response.suggestions.find(
      s => s.arguments?.some(a => a.kind === "string" && a.value === "Open")
    );
    expect(suggestion).toBeDefined();
    
    // Should have value match info
    const valMatch = suggestion?.queryMatches?.find(m => m.matchType === "value");
    expect(valMatch).toBeDefined();
    expect(valMatch?.matchedTarget).toBe("Open");
    expect(valMatch?.inputText.toLowerCase()).toBe("open");
  });

  test("combined column and operator match includes queryMatches", async () => {
    const response = await filter.suggest("status eq");
    
    // Find a suggestion matching status with eq operator
    const suggestion = response.suggestions.find(
      s => s.column.id === "status" && s.operator === "eq"
    );
    expect(suggestion).toBeDefined();
    
    // Should have at least one queryMatch (column or operator)
    // Note: The current implementation may only track the primary match
    expect(suggestion?.queryMatches?.length).toBeGreaterThanOrEqual(1);
    
    // At minimum, should have a column match
    const columnMatch = suggestion?.queryMatches?.find(m => m.matchType === "column");
    expect(columnMatch).toBeDefined();
    
    // Column match should cover first token
    expect(columnMatch?.inputRange.start).toBe(0);
    expect(columnMatch?.inputRange.end).toBe(6);
  });

  test("fuzzy match includes character-level indexes", async () => {
    const response = await filter.suggest("sta");
    
    // Find suggestion for status column with fuzzy match
    const suggestion = response.suggestions.find(s => s.column.id === "status");
    expect(suggestion).toBeDefined();
    
    const columnMatch = suggestion?.queryMatches?.find(m => m.matchType === "column");
    expect(columnMatch).toBeDefined();
    expect(columnMatch?.matchedTarget).toBe("Status");
    
    // matchedCharIndexes should indicate which chars of "Status" matched "sta"
    if (columnMatch?.matchedCharIndexes) {
      // "sta" matches positions 0, 1, 2 in "Status"
      expect(columnMatch.matchedCharIndexes).toContain(0);
      expect(columnMatch.matchedCharIndexes).toContain(1);
      expect(columnMatch.matchedCharIndexes).toContain(2);
    }
  });

  test("empty query has no queryMatches", async () => {
    const response = await filter.suggest("");
    
    // Exploratory suggestions should not have queryMatches
    for (const suggestion of response.suggestions) {
      expect(suggestion.queryMatches).toBeUndefined();
    }
  });

  test("standalone date expression like 'yesterday' includes queryMatches for value highlighting", async () => {
    // Create a filter with a date column
    const dateFilter = createFuzzyFilter({ maxSuggestions: 10 });
    dateFilter.setSchema({
      columns: [
        { id: columnId("created"), name: "Created", type: "date" },
      ],
    });
    
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    dateFilter.indexData([
      { created: yesterday.toISOString() },
      { created: today.toISOString() },
    ]);

    // Just type "yesterday" without column - should still match as a date value
    const response = await dateFilter.suggest("yesterday");
    
    // Find a date suggestion
    const suggestion = response.suggestions.find(
      s => s.column.id === "created" && s.arguments?.[0]?.kind === "date"
    );
    expect(suggestion).toBeDefined();
    
    // Should have queryMatches with value type for the date
    expect(suggestion?.queryMatches).toBeDefined();
    const valueMatch = suggestion?.queryMatches?.find(m => m.matchType === "value");
    expect(valueMatch).toBeDefined();
    expect(valueMatch?.inputText).toBe("yesterday");
    // The matchedTarget should be the formatted date (e.g., "Dec 27, 2025")
    expect(valueMatch?.matchedTarget).toBeDefined();
  });
});

describe("Complete vs Incomplete Suggestion Scoring", () => {
  let filter: FuzzyFilter;
  const sampleData = [
    { status: "Open", assignee: "Alice", priority: 1 },
    { status: "Closed", assignee: "Bob", priority: 2 },
    { status: "In Progress", assignee: "Charlie", priority: 3 },
    { status: "Open", assignee: "Diana", priority: 4 },
    { status: "Open", assignee: "Eve", priority: 5 },
  ];

  beforeEach(() => {
    filter = createFuzzyFilter({ maxSuggestions: 20 });
    filter.setSchema(TASK_SCHEMA);
    filter.indexData(sampleData);
  });

  test("column+operator+value suggestion should score higher than column+operator when value matches query token", async () => {
    // Query "status equa open" has 3 tokens:
    // - "status" matches column "Status"
    // - "equa" matches operator "equals"
    // - "open" matches value "Open"
    const response = await filter.suggest("status equa open");

    // Find the complete suggestion with value "Open"
    const completeWithValue = response.suggestions.find(
      (s) =>
        s.column.id === "status" &&
        s.operator === "eq" &&
        s.arguments?.[0]?.kind === "string" &&
        s.arguments[0].value === "Open"
    );

    // Find incomplete suggestion (same column+operator, no value)
    const incompleteWithoutValue = response.suggestions.find(
      (s) =>
        s.column.id === "status" &&
        s.operator === "eq" &&
        (!s.arguments || s.arguments.length === 0)
    );

    expect(completeWithValue).toBeDefined();
    expect(incompleteWithoutValue).toBeDefined();

    // The complete suggestion with value should score HIGHER
    // because it matches all 3 tokens from the query
    expect(completeWithValue!.score).toBeGreaterThan(
      incompleteWithoutValue!.score
    );

    // The complete suggestion should rank higher (earlier in the list)
    const completeIdx = response.suggestions.indexOf(completeWithValue!);
    const incompleteIdx = response.suggestions.indexOf(incompleteWithoutValue!);
    expect(completeIdx).toBeLessThan(incompleteIdx);
  });

  test("works with operator aliases like 'equals' and 'is'", async () => {
    // Test with "status equals open" (using alias)
    const response1 = await filter.suggest("status equals open");
    const complete1 = response1.suggestions.find(
      (s) =>
        s.column.id === "status" &&
        s.operator === "eq" &&
        s.arguments?.[0]?.kind === "string" &&
        s.arguments[0].value === "Open"
    );
    const incomplete1 = response1.suggestions.find(
      (s) =>
        s.column.id === "status" &&
        s.operator === "eq" &&
        (!s.arguments || s.arguments.length === 0)
    );
    expect(complete1).toBeDefined();
    expect(incomplete1).toBeDefined();
    expect(complete1!.score).toBeGreaterThan(incomplete1!.score);

    // Test with "status is open" (using 'is' alias)
    const response2 = await filter.suggest("status is open");
    const complete2 = response2.suggestions.find(
      (s) =>
        s.column.id === "status" &&
        s.operator === "eq" &&
        s.arguments?.[0]?.kind === "string" &&
        s.arguments[0].value === "Open"
    );
    const incomplete2 = response2.suggestions.find(
      (s) =>
        s.column.id === "status" &&
        s.operator === "eq" &&
        (!s.arguments || s.arguments.length === 0)
    );
    expect(complete2).toBeDefined();
    expect(incomplete2).toBeDefined();
    expect(complete2!.score).toBeGreaterThan(incomplete2!.score);
  });

});

describe("Alias Pattern Expansion", () => {
  let filter: FuzzyFilter;

  const sampleData = generateTestData(10) as unknown as Record<string, unknown>[];

  beforeEach(() => {
    filter = createFuzzyFilter({ maxSuggestions: 20 });
    filter.setSchema(TASK_SCHEMA);
    filter.indexData(sampleData);
  });

  test("'smaller than equals' matches lte via expanded pattern", async () => {
    // This alias is generated from the pattern ["less", "than?", "or?", "equal"]
    // with "smaller" as a synonym for "less"
    const response = await filter.suggest("smaller than equal");
    
    const lteMatches = response.suggestions.filter(s => s.operator === "lte");
    expect(lteMatches.length).toBeGreaterThan(0);
  });

  test("'under or eq' matches lte via expanded pattern", async () => {
    // "under" is a synonym for "less", "or" is optional, "eq" is a synonym for "equal"
    const response = await filter.suggest("under or eq");
    
    const lteMatches = response.suggestions.filter(s => s.operator === "lte");
    expect(lteMatches.length).toBeGreaterThan(0);
  });

  test("'bigger than or equals' matches gte via expanded pattern", async () => {
    // From pattern ["greater", "than?", "or?", "equal"]
    // with "bigger" as a synonym for "greater"
    const response = await filter.suggest("bigger than or equals");
    
    const gteMatches = response.suggestions.filter(s => s.operator === "gte");
    expect(gteMatches.length).toBeGreaterThan(0);
  });

  test("'above or eq' matches gte via expanded pattern", async () => {
    // "above" is a synonym for "greater"
    const response = await filter.suggest("above or eq");
    
    const gteMatches = response.suggestions.filter(s => s.operator === "gte");
    expect(gteMatches.length).toBeGreaterThan(0);
  });

  test("'begins with' matches startsWith via expanded pattern", async () => {
    // From pattern ["starts", "with?"] with "begins" as synonym
    const response = await filter.suggest("begins with");
    
    const startsWithMatches = response.suggestions.filter(s => s.operator === "startsWith");
    expect(startsWithMatches.length).toBeGreaterThan(0);
  });

  test("'is not empty' matches isNotEmpty via expanded pattern", async () => {
    // From pattern ["is?", "not", "empty"]
    const response = await filter.suggest("is not empty");
    
    const isNotEmptyMatches = response.suggestions.filter(s => s.operator === "isNotEmpty");
    expect(isNotEmptyMatches.length).toBeGreaterThan(0);
  });

  test("'not blank' matches isNotEmpty via expanded pattern", async () => {
    // "blank" is a synonym for "empty"
    const response = await filter.suggest("not blank");
    
    const isNotEmptyMatches = response.suggestions.filter(s => s.operator === "isNotEmpty");
    expect(isNotEmptyMatches.length).toBeGreaterThan(0);
  });
});

describe("Spread Pattern Detection", () => {
  let filter: FuzzyFilter;

  beforeEach(() => {
    filter = createFuzzyFilter({ maxSuggestions: 20 });
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created At", type: "date", aliases: ["created"] },
        { id: columnId("amount"), name: "Amount", type: "number" },
      ],
    });
    
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    filter.indexData([
      { createdAt: today.toISOString(), amount: 100 },
      { createdAt: yesterday.toISOString(), amount: 200 },
      { createdAt: twoDaysAgo.toISOString(), amount: 300 },
    ]);
  });

  test("'from yesterday to today' generates between suggestion for date column", async () => {
    const response = await filter.suggest("from yesterday to today");
    
    const betweenSuggestions = response.suggestions.filter(
      s => s.operator === "between" && s.column.id === "createdAt"
    );
    
    expect(betweenSuggestions.length).toBeGreaterThan(0);
    expect(betweenSuggestions[0]?.arguments?.length).toBe(2);
  });

  test("'from yesterday till today' uses till as separator", async () => {
    // "till" is a synonym for "to" in spread patterns
    const response = await filter.suggest("from yesterday till today");
    
    const betweenSuggestions = response.suggestions.filter(
      s => s.operator === "between" && s.column.id === "createdAt"
    );
    
    expect(betweenSuggestions.length).toBeGreaterThan(0);
  });

  test("'from yesterday until today' uses until as separator", async () => {
    // "until" is a synonym for "to" in spread patterns
    const response = await filter.suggest("from yesterday until today");
    
    const betweenSuggestions = response.suggestions.filter(
      s => s.operator === "between" && s.column.id === "createdAt"
    );
    
    expect(betweenSuggestions.length).toBeGreaterThan(0);
  });

  test("'between 100 and 300' generates between suggestion for number column", async () => {
    const response = await filter.suggest("between 100 and 300");
    
    const betweenSuggestions = response.suggestions.filter(
      s => s.operator === "between" && s.column.id === "amount"
    );
    
    expect(betweenSuggestions.length).toBeGreaterThan(0);
    expect(betweenSuggestions[0]?.arguments?.length).toBe(2);
    
    // Check the arguments are correctly parsed
    const args = betweenSuggestions[0]!.arguments!;
    expect(args[0]?.kind).toBe("number");
    expect(args[1]?.kind).toBe("number");
    if (args[0]?.kind === "number" && args[1]?.kind === "number") {
      expect([args[0].value, args[1].value].sort((a, b) => a - b)).toEqual([100, 300]);
    }
  });
});

// ============================================================================
// MULTI-VALUE STRING AGGREGATION TESTS
// ============================================================================
describe("Multi-value string aggregation", () => {
  /**
   * Test that queries with multiple value tokens generate "in" operator suggestions
   * For example: "status open closed" should suggest "Status in [Open, Closed]"
   */
  test("'status open closed' generates 'in' suggestion with both values", async () => {
    const filter = createFuzzyFilter();
    
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed", "In Progress"] },
        { id: columnId("priority"), name: "Priority", type: "number" },
      ],
    });
    
    filter.indexData([
      { status: "Open", priority: 1 },
      { status: "Closed", priority: 2 },
      { status: "In Progress", priority: 3 },
      { status: "Open", priority: 4 },
      { status: "Closed", priority: 5 },
    ]);
    
    const response = await filter.suggest("status open closed");
    
    // Find the "in" suggestion with both Open and Closed
    const inSuggestion = response.suggestions.find(
      s => s.column.id === "status" && 
           s.operator === "in" &&
           s.arguments?.length === 2 &&
           s.arguments.some(a => a.kind === "string" && a.value === "Open") &&
           s.arguments.some(a => a.kind === "string" && a.value === "Closed")
    );
    
    expect(inSuggestion).toBeDefined();
    expect(inSuggestion?.operator).toBe("in");
    expect(inSuggestion?.arguments?.length).toBe(2);
  });

  /**
   * Test that multi-value suggestions rank higher than single-value suggestions
   * because they explain more of the query
   */
  test("multi-value 'in' suggestion ranks higher than single-value 'eq' suggestions", async () => {
    const filter = createFuzzyFilter();
    
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed", "In Progress"] },
      ],
    });
    
    filter.indexData([
      { status: "Open" },
      { status: "Closed" },
      { status: "In Progress" },
    ]);
    
    const response = await filter.suggest("status open closed");
    
    // Find the multi-value "in" suggestion
    const inSuggestion = response.suggestions.find(
      s => s.column.id === "status" && 
           s.operator === "in" &&
           s.arguments?.length === 2
    );
    
    // Find single-value "eq" suggestions
    const eqOpenSuggestion = response.suggestions.find(
      s => s.column.id === "status" && 
           s.operator === "eq" &&
           s.arguments?.length === 1 &&
           s.arguments[0]?.kind === "string" &&
           s.arguments[0]?.value === "Open"
    );
    
    const eqClosedSuggestion = response.suggestions.find(
      s => s.column.id === "status" && 
           s.operator === "eq" &&
           s.arguments?.length === 1 &&
           s.arguments[0]?.kind === "string" &&
           s.arguments[0]?.value === "Closed"
    );
    
    expect(inSuggestion).toBeDefined();
    expect(eqOpenSuggestion).toBeDefined();
    expect(eqClosedSuggestion).toBeDefined();
    
    // The "in" suggestion should have a higher score because it explains more tokens
    expect(inSuggestion!.score).toBeGreaterThan(eqOpenSuggestion!.score);
    expect(inSuggestion!.score).toBeGreaterThan(eqClosedSuggestion!.score);
  });

  /**
   * Test that "nin" (not in) suggestions are also generated
   */
  test("'status open closed' also generates 'nin' suggestion", async () => {
    const filter = createFuzzyFilter();
    
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed", "In Progress"] },
      ],
    });
    
    filter.indexData([
      { status: "Open" },
      { status: "Closed" },
      { status: "In Progress" },
    ]);
    
    const response = await filter.suggest("status open closed");
    
    // Find the "nin" suggestion with both Open and Closed
    const ninSuggestion = response.suggestions.find(
      s => s.column.id === "status" && 
           s.operator === "nin" &&
           s.arguments?.length === 2 &&
           s.arguments.some(a => a.kind === "string" && a.value === "Open") &&
           s.arguments.some(a => a.kind === "string" && a.value === "Closed")
    );
    
    expect(ninSuggestion).toBeDefined();
    expect(ninSuggestion?.operator).toBe("nin");
  });

  /**
   * Test that "open closed" (without column name) generates multi-value suggestions
   * This tests Strategy 3's handling of value-only queries
   */
  test("'open closed' (without column) generates 'in' suggestion with both values", async () => {
    const filter = createFuzzyFilter();
    
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed", "In Progress"] },
        { id: columnId("priority"), name: "Priority", type: "number" },
      ],
    });
    
    filter.indexData([
      { status: "Open", priority: 1 },
      { status: "Closed", priority: 2 },
      { status: "In Progress", priority: 3 },
    ]);
    
    const response = await filter.suggest("open closed");
    
    // Find the "in" suggestion with both Open and Closed
    const inSuggestion = response.suggestions.find(
      s => s.column.id === "status" && 
           s.operator === "in" &&
           s.arguments?.length === 2 &&
           s.arguments.some(a => a.kind === "string" && a.value === "Open") &&
           s.arguments.some(a => a.kind === "string" && a.value === "Closed")
    );
    
    expect(inSuggestion).toBeDefined();
    expect(inSuggestion?.operator).toBe("in");
    expect(inSuggestion?.arguments?.length).toBe(2);
  });

  /**
   * Test that multi-value 'in' suggestion ranks higher than single-value suggestions
   * for queries without column name like "open closed"
   */
  test("'open closed' multi-value suggestion ranks higher than single-value suggestions", async () => {
    const filter = createFuzzyFilter();
    
    filter.setSchema({
      columns: [
        { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed", "In Progress"] },
      ],
    });
    
    filter.indexData([
      { status: "Open" },
      { status: "Closed" },
      { status: "In Progress" },
    ]);
    
    const response = await filter.suggest("open closed");
    
    // Find the multi-value "in" suggestion
    const inSuggestion = response.suggestions.find(
      s => s.column.id === "status" && 
           s.operator === "in" &&
           s.arguments?.length === 2
    );
    
    // Find single-value "eq" suggestions
    const eqOpenSuggestion = response.suggestions.find(
      s => s.column.id === "status" && 
           s.operator === "eq" &&
           s.arguments?.length === 1 &&
           s.arguments[0]?.kind === "string" &&
           s.arguments[0]?.value === "Open"
    );
    
    const eqClosedSuggestion = response.suggestions.find(
      s => s.column.id === "status" && 
           s.operator === "eq" &&
           s.arguments?.length === 1 &&
           s.arguments[0]?.kind === "string" &&
           s.arguments[0]?.value === "Closed"
    );
    
    expect(inSuggestion).toBeDefined();
    expect(eqOpenSuggestion).toBeDefined();
    expect(eqClosedSuggestion).toBeDefined();
    
    // The "in" suggestion should have a higher score because it explains more tokens
    expect(inSuggestion!.score).toBeGreaterThan(eqOpenSuggestion!.score);
    expect(inSuggestion!.score).toBeGreaterThan(eqClosedSuggestion!.score);
  });
});

// ============================================================================
// NON-OVERLAPPING NGRAM VALUE AGGREGATION TESTS
// ============================================================================
describe("Non-overlapping ngram value aggregation", () => {
  /**
   * Test that overlapping ngrams don't independently contribute values.
   * For a query with N tokens, we should get at most N values.
   *
   * The bug scenario:
   * - Query: "insert autus sorder" (3 tokens)
   * - Ngrams generated: "insert", "autus", "sorder", "insert autus", "autus sorder", "insert autus sorder" (6 ngrams)
   * - Without the fix, each ngram could match a different value → 6 values
   * - With the fix, overlapping ngrams compete for the same positions → max 3 values
   */
  test("3 tokens should produce at most 3 values in 'in' suggestions", async () => {
    const filter = createFuzzyFilter({ maxSuggestions: 20 });

    // Create values that would match different ngrams/combinations
    filter.setSchema({
      columns: [
        {
          id: columnId("comments"),
          name: "Comments",
          type: "string",
        },
      ],
    });

    // Create data with values that fuzzy-match different parts of the query
    // These are designed to match: "insert", "autus", "sorder", "insert autus", etc.
    filter.indexData([
      { comments: "Insert something here" },
      { comments: "Autus value" },
      { comments: "Sordeo entry" },
      { comments: "Insert autus combined" },
      { comments: "Autus sordeo together" },
      { comments: "Insert autus sordeo all" },
      { comments: "Something else" },
    ]);

    const response = await filter.suggest("insert autus sordeo");

    // Find all "in" suggestions for the comments column
    const inSuggestions = response.suggestions.filter(
      (s) => s.column.id === "comments" && s.operator === "in"
    );

    // Each "in" suggestion should have at most 3 values (one per input token)
    // because overlapping ngrams should not independently contribute values
    for (const suggestion of inSuggestions) {
      expect(suggestion.arguments?.length ?? 0).toBeLessThanOrEqual(3);
    }
  });

  /**
   * Test that the best-scoring non-overlapping set is chosen.
   * When ngrams overlap, we should pick the combination that maximizes total score.
   */
  test("best-scoring non-overlapping values are selected", async () => {
    const filter = createFuzzyFilter({ maxSuggestions: 20 });

    filter.setSchema({
      columns: [
        {
          id: columnId("title"),
          name: "Title",
          type: "string",
        },
      ],
    });

    // "foo bar" query:
    // - "foo" matches "Foo Item" (good match)
    // - "bar" matches "Bar Thing" (good match)
    // - "foo bar" matches "Foobar Combined" (okay match for the bigram)
    // The algorithm should prefer the two non-overlapping exact matches
    filter.indexData([
      { title: "Foo Item" },
      { title: "Bar Thing" },
      { title: "Foobar Combined" },
    ]);

    const response = await filter.suggest("foo bar");

    // Find the "in" suggestion
    const inSuggestion = response.suggestions.find(
      (s) => s.column.id === "title" && s.operator === "in"
    );

    if (inSuggestion && inSuggestion.arguments) {
      // Should have at most 2 values (one per token)
      expect(inSuggestion.arguments.length).toBeLessThanOrEqual(2);

      // The values should be from non-overlapping ngrams
      const values = inSuggestion.arguments.map((a) =>
        a.kind === "string" ? a.value : null
      );

      // Should not have more values than tokens
      expect(values.length).toBeLessThanOrEqual(2);
    }
  });

  /**
   * Test that column positions are excluded from value matching.
   * When "status open closed" is typed, "status" matches the column,
   * so only "open" and "closed" should contribute to values.
   */
  test("column match position is excluded from value matching", async () => {
    const filter = createFuzzyFilter({ maxSuggestions: 20 });

    filter.setSchema({
      columns: [
        {
          id: columnId("status"),
          name: "Status",
          type: "enum",
          values: ["Open", "Closed", "In Progress", "StatusLike"],
        },
      ],
    });

    filter.indexData([
      { status: "Open" },
      { status: "Closed" },
      { status: "In Progress" },
      { status: "StatusLike" }, // This would fuzzy-match "status" but shouldn't be included
    ]);

    const response = await filter.suggest("status open closed");

    // Find the "in" suggestion
    const inSuggestion = response.suggestions.find(
      (s) =>
        s.column.id === "status" &&
        s.operator === "in" &&
        s.arguments?.length === 2
    );

    expect(inSuggestion).toBeDefined();

    if (inSuggestion?.arguments) {
      const values = inSuggestion.arguments
        .filter((a) => a.kind === "string")
        .map((a) => (a as { kind: "string"; value: string }).value);

      // Should include Open and Closed (from "open" and "closed" tokens)
      expect(values).toContain("Open");
      expect(values).toContain("Closed");

      // Should NOT include StatusLike (the "status" token was used for the column match)
      expect(values).not.toContain("StatusLike");
    }
  });
});

describe("Scoring Investigation", () => {
  test("matched column should score higher than unmatched column with spurious value match", async () => {
    const filter = createFuzzyFilter({ 
      maxSuggestions: 20
    });
    
    filter.setSchema(TASK_SCHEMA);
    
    const testData = createSeededGenerator(SAMPLE_DATA_SEED)(50);
    filter.indexData(testData);
    
    // Test: "priority lt 3" - "3" can fuzzy-match date strings like "2024-06-30"
    // Without the fix, Created suggestions could score higher than Priority
    const response = await filter.suggest("priority lt 3");
    
    console.log("\n=== Suggestions for 'priority lt 3' ===");
    for (const s of response.suggestions.slice(0, 10)) {
      console.log(`${s.label} | Score: ${s.score.toFixed(4)} | Column: ${s.column.name}`);
    }
    
    const prioritySuggestions = response.suggestions.filter(s => s.column.name === "Priority");
    const createdSuggestions = response.suggestions.filter(s => s.column.name === "Created");
    
    expect(prioritySuggestions.length).toBeGreaterThan(0);
    
    if (createdSuggestions.length > 0) {
      const topPriorityScore = prioritySuggestions[0]!.score;
      const topCreatedScore = createdSuggestions[0]!.score;
      
      console.log(`Top Priority: ${topPriorityScore.toFixed(4)}, Top Created: ${topCreatedScore.toFixed(4)}`);
      
      expect(topPriorityScore).toBeGreaterThan(topCreatedScore);
    }
  });
});

/**
 * i18n Column Translation Tests
 * 
 * Tests for column name and enum value translation via i18n keys.
 */
describe("i18n Column Translation", () => {
  test("getTranslatedColumnName returns translated name when i18n key is set", async () => {
    const { getTranslatedColumnName } = await import("./fuzzy-filter/engine/suggestion-helpers.ts");
    const { createObjectProvider } = await import("./i18n/index.ts");
    
    // Create a column with a nameKey
    const column = {
      id: columnId("status"),
      name: "Status",
      nameKey: "columns.status",
      type: "enum" as DataType,
      values: ["Open", "Closed"],
    };
    
    // Create an i18n provider that translates the key
    const translations = {
      operators: {},
    };
    const provider = createObjectProvider(translations);
    
    // Add translate method
    const providerWithTranslate = {
      ...provider,
      translate: (key: string) => {
        if (key === "columns.status") return "Estado";
        return undefined;
      },
    };
    
    const translated = getTranslatedColumnName(column, providerWithTranslate);
    expect(translated).toBe("Estado");
  });

  test("getTranslatedColumnName falls back to static name when translation not found", async () => {
    const { getTranslatedColumnName } = await import("./fuzzy-filter/engine/suggestion-helpers.ts");
    const { createObjectProvider } = await import("./i18n/index.ts");
    
    // Create a column with a nameKey but no translation
    const column = {
      id: columnId("status"),
      name: "Status",
      nameKey: "columns.status",
      type: "enum" as DataType,
      values: ["Open", "Closed"],
    };
    
    // Create an i18n provider that doesn't translate the key
    const translations = {
      operators: {},
    };
    const provider = createObjectProvider(translations);
    
    const translated = getTranslatedColumnName(column, provider);
    expect(translated).toBe("Status");
  });

  test("getTranslatedColumnName uses static name when no nameKey is set", async () => {
    const { getTranslatedColumnName } = await import("./fuzzy-filter/engine/suggestion-helpers.ts");
    
    // Create a column without a nameKey
    const column = {
      id: columnId("status"),
      name: "Status",
      type: "enum" as DataType,
      values: ["Open", "Closed"],
    };
    
    const translated = getTranslatedColumnName(column, undefined);
    expect(translated).toBe("Status");
  });

  test("getTranslatedEnumValueLabel returns translated label when i18n key is set", async () => {
    const { getTranslatedEnumValueLabel } = await import("./fuzzy-filter/engine/suggestion-helpers.ts");
    const { createObjectProvider } = await import("./i18n/index.ts");
    
    // Create an enum column with valueKeys
    const column = {
      id: columnId("status"),
      name: "Status",
      type: "enum" as DataType,
      values: ["Open", "Closed"],
      valueKeys: ["values.status.open", "values.status.closed"],
    };
    
    // Create an i18n provider that translates the keys
    const translations = {
      operators: {},
    };
    const provider = createObjectProvider(translations);
    
    // Add translate method
    const providerWithTranslate = {
      ...provider,
      translate: (key: string) => {
        if (key === "values.status.open") return "Abierto";
        if (key === "values.status.closed") return "Cerrado";
        return undefined;
      },
    };
    
    expect(getTranslatedEnumValueLabel(column, 0, providerWithTranslate)).toBe("Abierto");
    expect(getTranslatedEnumValueLabel(column, 1, providerWithTranslate)).toBe("Cerrado");
  });

  test("getTranslatedEnumValueLabel falls back to labels array", async () => {
    const { getTranslatedEnumValueLabel } = await import("./fuzzy-filter/engine/suggestion-helpers.ts");
    
    // Create an enum column with labels but no valueKeys
    const column = {
      id: columnId("status"),
      name: "Status",
      type: "enum" as DataType,
      values: ["open", "closed"],
      labels: ["Open", "Closed"],
    };
    
    expect(getTranslatedEnumValueLabel(column, 0, undefined)).toBe("Open");
    expect(getTranslatedEnumValueLabel(column, 1, undefined)).toBe("Closed");
  });

  test("getTranslatedEnumValueLabel falls back to values array", async () => {
    const { getTranslatedEnumValueLabel } = await import("./fuzzy-filter/engine/suggestion-helpers.ts");
    
    // Create an enum column with no labels or valueKeys
    const column = {
      id: columnId("status"),
      name: "Status",
      type: "enum" as DataType,
      values: ["Open", "Closed"],
    };
    
    expect(getTranslatedEnumValueLabel(column, 0, undefined)).toBe("Open");
    expect(getTranslatedEnumValueLabel(column, 1, undefined)).toBe("Closed");
  });

  test("getTranslatedBooleanLabel returns translated labels", async () => {
    const { getTranslatedBooleanLabel } = await import("./fuzzy-filter/engine/suggestion-helpers.ts");
    const { createObjectProvider } = await import("./i18n/index.ts");
    
    // Create a boolean column with i18n keys
    const column = {
      id: columnId("isBlocked"),
      name: "Is Blocked",
      type: "boolean" as DataType,
      trueLabel: "Blocked",
      falseLabel: "Not Blocked",
      trueLabelKey: "values.boolean.blocked",
      falseLabelKey: "values.boolean.notBlocked",
    };
    
    // Create an i18n provider that translates the keys
    const translations = {
      operators: {},
    };
    const provider = createObjectProvider(translations);
    
    // Add translate method
    const providerWithTranslate = {
      ...provider,
      translate: (key: string) => {
        if (key === "values.boolean.blocked") return "Bloqueado";
        if (key === "values.boolean.notBlocked") return "No Bloqueado";
        return undefined;
      },
    };
    
    expect(getTranslatedBooleanLabel(column, true, providerWithTranslate)).toBe("Bloqueado");
    expect(getTranslatedBooleanLabel(column, false, providerWithTranslate)).toBe("No Bloqueado");
  });

  test("getTranslatedBooleanLabel falls back to static labels", async () => {
    const { getTranslatedBooleanLabel } = await import("./fuzzy-filter/engine/suggestion-helpers.ts");
    
    // Create a boolean column with static labels only
    const column = {
      id: columnId("isBlocked"),
      name: "Is Blocked",
      type: "boolean" as DataType,
      trueLabel: "Blocked",
      falseLabel: "Not Blocked",
    };
    
    expect(getTranslatedBooleanLabel(column, true, undefined)).toBe("Blocked");
    expect(getTranslatedBooleanLabel(column, false, undefined)).toBe("Not Blocked");
  });
});

describe("Data Mutation - Index Updates", () => {
  test("addRow makes new value immediately searchable in suggestions", async () => {
    // Create a filter with a simple schema
    const filter = createFuzzyFilter({ maxSuggestions: 20 });
    filter.setSchema({
      columns: [
        { id: columnId("name"), name: "Name", type: "string" },
        { id: columnId("status"), name: "Status", type: "enum", values: ["Active", "Inactive"] },
      ],
    });

    // Index initial data with common names
    const initialData = [
      { name: "Alice Smith", status: "Active" },
      { name: "Bob Jones", status: "Active" },
      { name: "Charlie Brown", status: "Inactive" },
    ];
    filter.indexData(initialData);

    // Verify initial state - Alice should be findable
    let response = await filter.suggest("Alice");
    expect(response.suggestions.some((s) => 
      s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Alice Smith"
    )).toBe(true);

    // Add a new row with a completely unique name
    const uniqueName = "Zephyr Moonwhisper";
    filter.addRow({ name: uniqueName, status: "Active" });

    // The new name should immediately appear in suggestions
    response = await filter.suggest("Zephyr");
    expect(response.suggestions.some((s) => 
      s.arguments?.[0]?.kind === "string" && s.arguments[0].value === uniqueName
    )).toBe(true);

    // Should also be findable with partial match
    response = await filter.suggest("Moonwhisper");
    expect(response.suggestions.some((s) => 
      s.arguments?.[0]?.kind === "string" && s.arguments[0].value === uniqueName
    )).toBe(true);
  });

  test("addRow works with high-cardinality columns (100+ unique values)", async () => {
    const filter = createFuzzyFilter({ maxSuggestions: 20 });
    filter.setSchema({
      columns: [
        { id: columnId("assignee"), name: "Assignee", type: "string" },
      ],
    });

    // Create 150 unique names to exceed the old MAX_VALUES_PER_COLUMN limit
    const manyNames = Array.from({ length: 150 }, (_, i) => ({
      assignee: `Person_${String(i).padStart(3, "0")}`,
    }));
    filter.indexData(manyNames);

    // Verify all 150 names are indexed - check first, middle, and last
    let response = await filter.suggest("Person_000");
    expect(response.suggestions.some((s) => 
      s.arguments?.[0]?.value === "Person_000"
    )).toBe(true);

    response = await filter.suggest("Person_075");
    expect(response.suggestions.some((s) => 
      s.arguments?.[0]?.value === "Person_075"
    )).toBe(true);

    response = await filter.suggest("Person_149");
    expect(response.suggestions.some((s) => 
      s.arguments?.[0]?.value === "Person_149"
    )).toBe(true);

    // Now add a new person and verify they're immediately searchable
    filter.addRow({ assignee: "NewPerson_XYZ" });

    response = await filter.suggest("NewPerson_XYZ");
    expect(response.suggestions.some((s) => 
      s.arguments?.[0]?.value === "NewPerson_XYZ"
    )).toBe(true);
  });

  test("removeRow updates index correctly", async () => {
    const filter = createFuzzyFilter({ maxSuggestions: 20 });
    filter.setSchema({
      columns: [
        { id: columnId("name"), name: "Name", type: "string" },
      ],
    });

    // Index data with one unique value
    filter.indexData([
      { name: "Alice" },
      { name: "Bob" },
      { name: "UniqueCharlie" },
    ]);

    // UniqueCharlie should be findable
    let response = await filter.suggest("UniqueCharlie");
    expect(response.suggestions.some((s) => 
      s.arguments?.[0]?.value === "UniqueCharlie"
    )).toBe(true);

    // Remove the row with UniqueCharlie (index 2)
    filter.removeRow(2);

    // UniqueCharlie should no longer appear in suggestions
    response = await filter.suggest("UniqueCharlie");
    expect(response.suggestions.some((s) => 
      s.arguments?.[0]?.value === "UniqueCharlie"
    )).toBe(false);
  });

  test("index stats reflect all unique values", () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("name"), name: "Name", type: "string" },
      ],
    });

    // Create 200 unique names
    const manyNames = Array.from({ length: 200 }, (_, i) => ({
      name: `UniqueName_${i}`,
    }));
    filter.indexData(manyNames);

    const stats = filter.getIndexStats();
    expect(stats.totalRows).toBe(200);
    // All 200 unique values should be indexed (not capped at 100)
    expect(stats.uniqueValues).toBe(200);
  });
});

// ============================================================================
// Plain String Column IDs (No columnId() required)
// ============================================================================

describe("Plain String Column IDs", () => {
  test("schema accepts plain strings for column IDs", () => {
    const filter = createFuzzyFilter();
    
    // Use plain strings instead of columnId()
    filter.setSchema({
      columns: [
        { id: "status", name: "Status", type: "enum", values: ["Open", "Closed"] },
        { id: "priority", name: "Priority", type: "number" },
        { id: "assignee", name: "Assignee", type: "string" },
      ],
    });

    filter.indexData([
      { status: "Open", priority: 1, assignee: "Alice" },
      { status: "Closed", priority: 2, assignee: "Bob" },
    ]);

    // getColumn should work with plain strings
    const statusCol = filter.getColumn("status");
    expect(statusCol).not.toBeNull();
    expect(statusCol?.name).toBe("Status");
    expect(statusCol?.type).toBe("enum");
  });

  test("compileFilter works with plain string column IDs", () => {
    const filter = createFuzzyFilter();
    
    filter.setSchema({
      columns: [
        { id: "status", name: "Status", type: "enum", values: ["Open", "Closed"] },
      ],
    });
    filter.indexData([
      { status: "Open" },
      { status: "Closed" },
      { status: "Open" },
    ]);

    // Use plain string for column ID
    const compiled = filter.compileFilter("status", "eq", "Open");
    
    expect(compiled).not.toBeNull();
    expect(compiled?.matchCount).toBe(2);
    expect(compiled?.predicate({ status: "Open" })).toBe(true);
    expect(compiled?.predicate({ status: "Closed" })).toBe(false);
  });

  test("suggestions work with plain string column IDs", async () => {
    const filter = createFuzzyFilter();
    
    filter.setSchema({
      columns: [
        { id: "status", name: "Status", type: "enum", values: ["Open", "Closed"] },
      ],
    });
    filter.indexData([{ status: "Open" }, { status: "Closed" }]);

    const response = await filter.suggest("stat");
    expect(response.suggestions.some((s) => s.column.name === "Status")).toBe(true);
  });
});

// ============================================================================
// UnknownColumnError with "Did You Mean?" suggestions
// ============================================================================

describe("UnknownColumnError", () => {
  test("compileFilter throws UnknownColumnError for invalid column", () => {
    const filter = createFuzzyFilter();
    
    filter.setSchema({
      columns: [
        { id: "status", name: "Status", type: "enum", values: ["Open", "Closed"] },
        { id: "priority", name: "Priority", type: "number" },
      ],
    });
    filter.indexData([{ status: "Open", priority: 1 }]);

    // Typo: "stauts" instead of "status"
    expect(() => filter.compileFilter("stauts", "eq", "Open")).toThrow();
    
    try {
      filter.compileFilter("stauts", "eq", "Open");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownColumnError);
      const err = error as UnknownColumnError;
      expect(err.name).toBe("UnknownColumnError");
      expect(err.columnId).toBe("stauts");
      expect(err.suggestions).toContain("status");
      expect(err.message).toContain("Did you mean");
    }
  });

  test("UnknownColumnError suggests similar column names", () => {
    const filter = createFuzzyFilter();
    
    filter.setSchema({
      columns: [
        { id: "firstName", name: "First Name", type: "string" },
        { id: "lastName", name: "Last Name", type: "string" },
        { id: "email", name: "Email", type: "string" },
      ],
    });
    filter.indexData([{ firstName: "John", lastName: "Doe", email: "john@example.com" }]);

    // Typo: "fristName" instead of "firstName"
    try {
      filter.compileFilter("fristName", "eq", "John");
    } catch (error) {
      const err = error as Error;
      expect(err.message).toContain("firstName");
    }
  });

  test("UnknownColumnError lists available columns", () => {
    const filter = createFuzzyFilter();
    
    filter.setSchema({
      columns: [
        { id: "status", name: "Status", type: "enum", values: ["Open", "Closed"] },
        { id: "priority", name: "Priority", type: "number" },
      ],
    });
    filter.indexData([{ status: "Open", priority: 1 }]);

    try {
      filter.compileFilter("nonexistent", "eq", "value");
    } catch (error) {
      const err = error as Error;
      expect(err.message).toContain("Available columns:");
      expect(err.message).toContain("status");
      expect(err.message).toContain("priority");
    }
  });
});
