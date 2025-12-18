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
        response.suggestions.some((s) => s.value?.kind === "string" && s.value.value === "Alice")
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
        (s) => s.value?.kind === "string" && s.value.value === "Alice"
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
      s.value?.kind === "string" && s.value.value === "Eve Foster"
    )).toBe(true);

    // Multi-word should also match
    const response2 = await filter.suggest("eve foster");
    expect(response2.suggestions.some((s) => 
      s.value?.kind === "string" && s.value.value === "Eve Foster"
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
      (s) => s.value?.kind === "string" && s.value.value.toLowerCase() === "in progress"
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
      (s) => s.value?.kind === "string" && s.value.value.toLowerCase() === "equal priority"
    );
    const eqOperatorMatch = response.suggestions.find((s) => s.operator === "eq" && !s.value);
    
    expect(valueMatch).toBeDefined();
    if (valueMatch && eqOperatorMatch) {
      expect(valueMatch.score).toBeGreaterThan(eqOperatorMatch.score);
    }
  });
});

