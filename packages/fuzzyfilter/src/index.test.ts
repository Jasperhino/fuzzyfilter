/**
 * FuzzyFilter Tests
 *
 * Run with: bun test
 */

import { test, expect, describe } from "bun:test";
import {
  columnId,
  OPERATOR_REGISTRY,
  getAllOperators,
  getOperator,
  getOperatorsForType,
  isValidOperatorForType,
  getDefaultOperatorForType,
  isOperator,
} from "./index.ts";

// =============================================================================
// Core Type Tests
// =============================================================================

describe("Core Types", () => {
  test("columnId creates branded type", () => {
    const id = columnId("myColumn");
    expect(id).toBe("myColumn");
  });
});

// =============================================================================
// Operator Registry Tests
// =============================================================================

describe("Operator Registry", () => {
  test("getAllOperators returns all operators", () => {
    const operators = getAllOperators();
    expect(operators.length).toBeGreaterThan(0);
    expect(operators.some((op) => op.id === "eq")).toBe(true);
    expect(operators.some((op) => op.id === "contains")).toBe(true);
    expect(operators.some((op) => op.id === "isEmpty")).toBe(true);
  });

  test("getOperator returns operator by id", () => {
    const eq = getOperator("eq");
    expect(eq).toBeDefined();
    expect(eq?.label).toBe("equals");
    expect(eq?.requiresArgument).toBe(true);
  });

  test("getOperatorsForType returns type-compatible operators", () => {
    const stringOps = getOperatorsForType("string");
    expect(stringOps.some((op) => op.id === "eq")).toBe(true);
    expect(stringOps.some((op) => op.id === "contains")).toBe(true);
    expect(stringOps.some((op) => op.id === "startsWith")).toBe(true);

    const numberOps = getOperatorsForType("number");
    expect(numberOps.some((op) => op.id === "gt")).toBe(true);
    expect(numberOps.some((op) => op.id === "lt")).toBe(true);
    // 'contains' is NOT valid for numbers
    expect(numberOps.some((op) => op.id === "contains")).toBe(false);

    const boolOps = getOperatorsForType("boolean");
    expect(boolOps.some((op) => op.id === "isTrue")).toBe(true);
    expect(boolOps.some((op) => op.id === "isFalse")).toBe(true);
  });

  test("isValidOperatorForType checks compatibility", () => {
    expect(isValidOperatorForType("eq", "string")).toBe(true);
    expect(isValidOperatorForType("gt", "number")).toBe(true);
    expect(isValidOperatorForType("contains", "number")).toBe(false);
    expect(isValidOperatorForType("isTrue", "string")).toBe(false);
    expect(isValidOperatorForType("isTrue", "boolean")).toBe(true);
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
    const eq = getOperator("eq");
    expect(eq?.aliases).toContain("equals");
    expect(eq?.aliases).toContain("is");
    expect(eq?.aliases).toContain("=");

    const contains = getOperator("contains");
    expect(contains?.aliases).toContain("has");
    expect(contains?.aliases).toContain("includes");
    expect(contains?.aliases).toContain("like");
  });

  test("operators specify which types they support", () => {
    const eq = getOperator("eq");
    expect(eq?.supportedTypes).toContain("string");
    expect(eq?.supportedTypes).toContain("number");
    expect(eq?.supportedTypes).toContain("date");

    const gt = getOperator("gt");
    expect(gt?.supportedTypes).toContain("number");
    expect(gt?.supportedTypes).toContain("date");
    expect(gt?.supportedTypes).not.toContain("string");

    const startsWith = getOperator("startsWith");
    expect(startsWith?.supportedTypes).toContain("string");
    expect(startsWith?.supportedTypes).not.toContain("number");
  });

  test("variadic operators are marked correctly", () => {
    const inOp = getOperator("in");
    expect(inOp?.isVariadic).toBe(true);

    const ninOp = getOperator("nin");
    expect(ninOp?.isVariadic).toBe(true);

    const betweenOp = getOperator("between");
    expect(betweenOp?.isVariadic).toBe(true);

    const eqOp = getOperator("eq");
    expect(eqOp?.isVariadic).toBeUndefined();
  });

  test("nullability operators don't require arguments", () => {
    const isEmpty = getOperator("isEmpty");
    expect(isEmpty?.requiresArgument).toBe(false);

    const isNotEmpty = getOperator("isNotEmpty");
    expect(isNotEmpty?.requiresArgument).toBe(false);

    const isTrue = getOperator("isTrue");
    expect(isTrue?.requiresArgument).toBe(false);
  });
});

// =============================================================================
// Schema Type Tests (Compile-time type checking)
// =============================================================================

describe("Schema Types", () => {
  test("column definitions are type-safe", () => {
    const stringCol = {
      id: columnId("name"),
      name: "Name",
      type: "string" as const,
      caseSensitive: false,
    };
    expect(stringCol.type).toBe("string");

    const enumCol = {
      id: columnId("status"),
      name: "Status",
      type: "enum" as const,
      values: ["Open", "Closed", "Pending"],
    };
    expect(enumCol.values).toHaveLength(3);

    const dateCol = {
      id: columnId("createdAt"),
      name: "Created At",
      type: "date" as const,
      granularity: "day" as const,
    };
    expect(dateCol.granularity).toBe("day");
  });
});
