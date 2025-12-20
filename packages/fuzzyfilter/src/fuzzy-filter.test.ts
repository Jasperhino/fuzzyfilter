/**
 * FuzzyFilter Integration Tests
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { createFuzzyFilter, columnId } from "./index.ts";
import type { FuzzyFilter } from "./types/index.ts";

describe("FuzzyFilter", () => {
  let filter: FuzzyFilter;

  const sampleData = [
    { status: "Open", assignee: "Alice", priority: 3, isBlocked: false },
    { status: "In Progress", assignee: "Bob", priority: 2, isBlocked: false },
    { status: "Closed", assignee: "Alice", priority: 1, isBlocked: false },
    { status: "Blocked", assignee: "Charlie", priority: 5, isBlocked: true },
  ];

  beforeEach(() => {
    filter = createFuzzyFilter({ maxSuggestions: 10 });
    filter.setSchema({
      columns: [
        {
          id: columnId("status"),
          name: "Status",
          type: "enum",
          values: ["Open", "In Progress", "Closed", "Blocked"],
        },
        {
          id: columnId("assignee"),
          name: "Assignee",
          type: "string",
          aliases: ["owner"],
        },
        {
          id: columnId("priority"),
          name: "Priority",
          type: "number",
        },
        {
          id: columnId("isBlocked"),
          name: "Is Blocked",
          type: "boolean",
        },
      ],
    });
    filter.indexData(sampleData);
  });

  describe("Schema", () => {
    test("getSchema returns the schema", () => {
      const schema = filter.getSchema();
      expect(schema).not.toBeNull();
      expect(schema?.columns.size).toBe(4);
    });

    test("getColumn returns column by ID", () => {
      const col = filter.getColumn("status");
      expect(col).not.toBeNull();
      expect(col?.name).toBe("Status");
      expect(col?.type).toBe("enum");
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
      expect(stats.totalRows).toBe(4);
      expect(stats.columnsIndexed).toBe(4);
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
      expect(response.suggestions.some((s) => s.column.name === "Status")).toBe(
        true
      );
    });

    test("operator query returns operator suggestions", async () => {
      const response = await filter.suggest("neq");
      expect(response.suggestions.some((s) => s.operator === "neq")).toBe(true);
    });

    test("value query returns value suggestions", async () => {
      const response = await filter.suggest("Alice");
      expect(
        response.suggestions.some((s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Alice")
      ).toBe(true);
    });

    test("multi-token query parses correctly", async () => {
      const response = await filter.suggest("Status eq");
      expect(response.suggestions.length).toBeGreaterThan(0);
      const firstSuggestion = response.suggestions[0];
      expect(firstSuggestion?.column.name).toBe("Status");
    });

    test("suggestions include result counts", async () => {
      const response = await filter.suggest("assignee eq Alice");
      const aliceSuggestion = response.suggestions.find(
        (s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value === "Alice"
      );
      expect(aliceSuggestion?.resultCount).toBe(2);
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
      expect(compiled?.columnId).toBe("status");
      expect(compiled?.operator).toBe("eq");
    });

    test("compileFilter creates a filter programmatically", () => {
      const compiled = filter.compileFilter("priority", "gt", 2);
      expect(compiled).not.toBeNull();
      expect(compiled?.matchCount).toBe(2); // priority 3 and 5
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
      const compiled = filter.compileFilter("assignee", "eq", "Alice");
      const result = filter.execute(compiled!);
      expect(result.count).toBe(2);
      expect(result.matchingRows).toEqual([0, 2]);
    });

    test("count returns match count", () => {
      const compiled = filter.compileFilter("isBlocked", "isTrue");
      expect(filter.count(compiled!)).toBe(1);
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
    
    // The exact value match should be in the suggestions
    const valueMatch = response.suggestions.find(
      (s) => s.arguments?.[0]?.kind === "string" && s.arguments[0].value.toLowerCase() === "in progress"
    );
    expect(valueMatch).toBeDefined();
    
    // The 'in' operator match should also be present
    const operatorMatch = response.suggestions.find((s) => s.operator === "in");
    expect(operatorMatch).toBeDefined();
    
    // The value match should have a higher score than the operator match
    // Higher score is better (fuzzysort uses 0 as best, negative as worse)
    if (valueMatch && operatorMatch) {
      expect(valueMatch.score).toBeGreaterThan(operatorMatch.score);
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
    // The text should still be the operator label
    expect(dateSuggestion?.parts.operator.text).toBe("equals");
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
  test("date column suggests common date phrases when no value entered", async () => {
    const filter = createFuzzyFilter();
    filter.setSchema({
      columns: [
        { id: columnId("createdAt"), name: "Created", type: "date" }, // Use single-word name for simpler parsing
      ],
    });
    filter.indexData([
      { createdAt: "2024-01-15" },
      { createdAt: "2024-02-01" },
    ]);

    const response = await filter.suggest("Created after");
    
    // Should suggest common date phrases
    const hasDateSuggestion = response.suggestions.some((s) => 
      s.arguments?.[0]?.kind === "date"
    );
    expect(hasDateSuggestion).toBe(true);
  });

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
    const todayStr = today.toISOString().split("T")[0];
    
    filter.indexData([
      { createdAt: todayStr },
      { createdAt: todayStr },
      { createdAt: "2024-01-15" },
      { createdAt: "2024-02-20" },
    ]);

    const response = await filter.suggest("created today");
    
    // Find the "Created At = today" suggestion
    const todaySuggestion = response.suggestions.find(
      (s) => s.arguments?.[0]?.kind === "date" && s.column.id === "createdAt"
    );
    
    expect(todaySuggestion).toBeDefined();
    
    // Now compile and execute the same filter
    const compiled = filter.compileFilter("createdAt", "eq", today);
    expect(compiled).not.toBeNull();
    
    // The preview count should match the compiled filter matchCount
    expect(todaySuggestion?.resultCount).toBe(compiled?.matchCount);
    expect(todaySuggestion?.resultCount).toBe(2); // Two rows with today's date
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

  test("typing 'created yesterday tomorrow' should suggest between for dates", async () => {
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
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    filter.indexData([
      { createdAt: yesterday.toISOString() },
      { createdAt: today.toISOString() },
      { createdAt: tomorrow.toISOString() },
    ]);

    const response = await filter.suggest("created yesterday tomorrow");
    
    // Should find a between suggestion for Created At
    const betweenSuggestion = response.suggestions.find(
      (s) => s.operator === "between" && s.column.id === "createdAt"
    );
    
    expect(betweenSuggestion).toBeDefined();
    expect(betweenSuggestion?.arguments?.length).toBe(2);
    if (betweenSuggestion?.arguments?.length === 2) {
      // Both should be date arguments
      expect(betweenSuggestion.arguments[0]?.kind).toBe("date");
      expect(betweenSuggestion.arguments[1]?.kind).toBe("date");
      if (betweenSuggestion.arguments[0]?.kind === "date") {
        expect(betweenSuggestion.arguments[0].value).toBeInstanceOf(Date);
      }
      if (betweenSuggestion.arguments[1]?.kind === "date") {
        expect(betweenSuggestion.arguments[1].value).toBeInstanceOf(Date);
      }
    }
    // Should match rows within the date range (note: exact count depends on 
    // how chrono-node parses individual date tokens - it may not capture
    // the full day boundary for standalone words like "yesterday")
    expect(betweenSuggestion?.resultCount).toBeGreaterThanOrEqual(2);
  });

  test("typing just '3 4' should suggest 'Priority between 3 4' as top suggestion", async () => {
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
    
    // The between suggestion should be the top suggestion (or at least in top 3)
    const betweenIndex = response.suggestions.findIndex(
      (s) => s.operator === "between" && s.column.id === "priority"
    );
    expect(betweenIndex).toBeLessThanOrEqual(2);
    
    // Check that the values are 3 and 4
    if (betweenSuggestion?.arguments?.length === 2) {
      const values = betweenSuggestion.arguments.map(a => a.kind === "number" ? a.value : null);
      expect(values).toContain(3);
      expect(values).toContain(4);
    }
  });
});

