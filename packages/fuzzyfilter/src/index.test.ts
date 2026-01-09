/**
 * FuzzyFilter Tests
 *
 * Run with: bun test
 */

import { test, expect, describe } from "bun:test";
import {
  getAllOperators,
  getOperator,
  getDefaultOperatorForType,
  isOperator,
  getOperatorSearchTerms,
  type ColumnId,
} from "./index.ts";

// =============================================================================
// Core Type Tests
// =============================================================================

describe("Core Types", () => {
  test("ColumnId is a string type", () => {
    const id: ColumnId = "myColumn";
    expect(id).toBe("myColumn");
    expect(typeof id).toBe("string");
  });
});

// =============================================================================
// Operator Registry Tests
// =============================================================================

describe("Operator Registry", () => {
  test("getAllOperators returns all operators", () => {
    const operators = getAllOperators();
    expect(operators.length).toBeGreaterThan(0);
    // Check for some expected operators by id
    expect(operators.some((op) => op.id === "eq")).toBe(true);
    expect(operators.some((op) => op.id === "contains")).toBe(true);
    expect(operators.some((op) => op.id === "isEmpty")).toBe(true);
  });

  test("getOperator returns operator by id", () => {
    const eq = getOperator("eq");
    expect(eq).toBeDefined();
    expect(eq?.id).toBe("eq");
    // Patterns should define argument requirements
    expect(eq?.patterns.some(p => p.includes("{"))).toBe(true); // requires argument
  });

  test("operators are universal and work with all types", () => {
    // All operators are now available for all types
    const allOps = getAllOperators();
    expect(allOps.some((op) => op.id === "eq")).toBe(true);
    expect(allOps.some((op) => op.id === "contains")).toBe(true);
    expect(allOps.some((op) => op.id === "startsWith")).toBe(true);
    expect(allOps.some((op) => op.id === "gt")).toBe(true);
    expect(allOps.some((op) => op.id === "lt")).toBe(true);
    expect(allOps.some((op) => op.id === "isTrue")).toBe(true);
    expect(allOps.some((op) => op.id === "isFalse")).toBe(true);
  });

  test("getDefaultOperatorForType returns sensible defaults", () => {
    expect(getDefaultOperatorForType("string")).toBe("contains");
    expect(getDefaultOperatorForType("number")).toBe("eq");
    expect(getDefaultOperatorForType("boolean")).toBe("isTrue");
    expect(getDefaultOperatorForType("date")).toBe("eq");
    expect(getDefaultOperatorForType("enum")).toBe("eq");
  });

  test("isOperator type guard works correctly", () => {
    expect(isOperator("eq")).toBe(true);
    expect(isOperator("neq")).toBe(true);
    expect(isOperator("contains")).toBe(true);
    expect(isOperator("notAnOperator")).toBe(false);
    expect(isOperator("")).toBe(false);
  });

  test("operators have aliases for fuzzy matching", () => {
    // Use getOperatorSearchTerms to get all searchable terms
    const eqTerms = getOperatorSearchTerms("eq");
    expect(eqTerms).toContain("equals");
    expect(eqTerms).toContain("=");
    expect(eqTerms).toContain("==");

    const containsTerms = getOperatorSearchTerms("contains");
    expect(containsTerms).toContain("has");
    expect(containsTerms).toContain("includes");
    expect(containsTerms).toContain("like");
  });

  test("operators are universal and work with all types", () => {
    // Operators no longer have supportedTypes - they work universally
    const eq = getOperator("eq");
    expect(eq).toBeDefined();
    expect(eq?.id).toBe("eq");

    const gt = getOperator("gt");
    expect(gt).toBeDefined();
    expect(gt?.id).toBe("gt");

    const startsWith = getOperator("startsWith");
    expect(startsWith).toBeDefined();
    expect(startsWith?.id).toBe("startsWith");
  });

  test("variadic operators have variadic argument patterns", () => {
    // "in" operator has {...} variadic placeholder
    const inOp = getOperator("in");
    expect(inOp?.patterns.some(p => p.includes("{...}"))).toBe(true);

    const ninOp = getOperator("nin");
    expect(ninOp?.patterns.some(p => p.includes("{...}"))).toBe(true);

    // "between" has patterns with two args like {} and {}
    const betweenOp = getOperator("between");
    expect(betweenOp?.patterns.some(p => 
      (p.match(/\{[^}]*\}/g) || []).length >= 2
    )).toBe(true);

    // "eq" has single arg pattern (not variadic)
    const eqOp = getOperator("eq");
    expect(eqOp?.patterns.every(p => 
      (p.match(/\{[^}]*\}/g) || []).length === 1
    )).toBe(true);
    // eq should not have variadic patterns
    expect(eqOp?.patterns.some(p => p.includes("{...}"))).toBe(false);
  });

  test("nullability operators don't require arguments (no placeholders)", () => {
    const isEmpty = getOperator("isEmpty");
    // isEmpty patterns have no {arg} placeholders
    expect(isEmpty?.patterns.every(p => !p.includes("{"))).toBe(true);

    const isNotEmpty = getOperator("isNotEmpty");
    expect(isNotEmpty?.patterns.every(p => !p.includes("{"))).toBe(true);

    const isTrue = getOperator("isTrue");
    expect(isTrue?.patterns.every(p => !p.includes("{"))).toBe(true);
  });
});

// =============================================================================
// Operator Predicate Tests
// =============================================================================

describe("Operator Predicates", () => {
  test("eq predicate works correctly", () => {
    const eq = getOperator("eq");
    expect(eq?.predicate("hello", ["hello"])).toBe(true);
    expect(eq?.predicate("hello", ["world"])).toBe(false);
    expect(eq?.predicate(42, [42])).toBe(true);
    expect(eq?.predicate(42, [43])).toBe(false);
  });

  test("neq predicate works correctly", () => {
    const neq = getOperator("neq");
    expect(neq?.predicate("hello", ["world"])).toBe(true);
    expect(neq?.predicate("hello", ["hello"])).toBe(false);
  });

  test("comparison predicates work correctly", () => {
    const lt = getOperator("lt");
    expect(lt?.predicate(5, [10])).toBe(true);
    expect(lt?.predicate(10, [5])).toBe(false);

    const lte = getOperator("lte");
    expect(lte?.predicate(5, [5])).toBe(true);
    expect(lte?.predicate(5, [4])).toBe(false);

    const gt = getOperator("gt");
    expect(gt?.predicate(10, [5])).toBe(true);
    expect(gt?.predicate(5, [10])).toBe(false);

    const gte = getOperator("gte");
    expect(gte?.predicate(5, [5])).toBe(true);
    expect(gte?.predicate(4, [5])).toBe(false);
  });

  test("contains predicate works for strings", () => {
    const contains = getOperator("contains");
    expect(contains?.predicate("hello world", ["world"])).toBe(true);
    expect(contains?.predicate("hello world", ["foo"])).toBe(false);
  });

  test("contains predicate works for arrays", () => {
    const contains = getOperator("contains");
    expect(contains?.predicate(["a", "b", "c"], ["b"])).toBe(true);
    expect(contains?.predicate(["a", "b", "c"], ["d"])).toBe(false);
  });

  test("isEmpty predicate works correctly", () => {
    const isEmpty = getOperator("isEmpty");
    expect(isEmpty?.predicate(null, [])).toBe(true);
    expect(isEmpty?.predicate(undefined, [])).toBe(true);
    expect(isEmpty?.predicate("", [])).toBe(true);
    expect(isEmpty?.predicate([], [])).toBe(true);
    expect(isEmpty?.predicate("hello", [])).toBe(false);
    expect(isEmpty?.predicate(["a"], [])).toBe(false);
  });

  test("boolean predicates work correctly", () => {
    const isTrue = getOperator("isTrue");
    expect(isTrue?.predicate(true, [])).toBe(true);
    expect(isTrue?.predicate(false, [])).toBe(false);

    const isFalse = getOperator("isFalse");
    expect(isFalse?.predicate(false, [])).toBe(true);
    expect(isFalse?.predicate(true, [])).toBe(false);
  });

  test("between predicate works correctly", () => {
    const between = getOperator("between");
    expect(between?.predicate(5, [1, 10])).toBe(true);
    expect(between?.predicate(1, [1, 10])).toBe(true);
    expect(between?.predicate(10, [1, 10])).toBe(true);
    expect(between?.predicate(0, [1, 10])).toBe(false);
    expect(between?.predicate(11, [1, 10])).toBe(false);
  });

  test("in predicate works correctly", () => {
    const inOp = getOperator("in");
    expect(inOp?.predicate("a", ["a", "b", "c"])).toBe(true);
    expect(inOp?.predicate("d", ["a", "b", "c"])).toBe(false);
  });

  test("nin predicate works correctly", () => {
    const nin = getOperator("nin");
    expect(nin?.predicate("d", ["a", "b", "c"])).toBe(true);
    expect(nin?.predicate("a", ["a", "b", "c"])).toBe(false);
  });
});

// =============================================================================
// Schema Type Tests (Compile-time type checking)
// =============================================================================

describe("Schema Types", () => {
  test("column definitions are type-safe", () => {
    const stringCol = {
      id: "name",
      name: "Name",
      type: "string" as const,
      caseSensitive: false,
    };
    expect(stringCol.type).toBe("string");

    const enumCol = {
      id: "status",
      name: "Status",
      type: "enum" as const,
      values: ["Open", "Closed", "Pending"],
    };
    expect(enumCol.values).toHaveLength(3);

    const dateCol = {
      id: "createdAt",
      name: "Created At",
      type: "date" as const,
      granularity: "day" as const,
    };
    expect(dateCol.granularity).toBe("day");
  });
});
