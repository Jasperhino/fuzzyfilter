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
    // Note: This returns operator ID and literal patterns, not i18n-expanded aliases
    const eqTerms = getOperatorSearchTerms("eq");
    expect(eqTerms).toContain("eq"); // At minimum includes operator ID

    const containsTerms = getOperatorSearchTerms("contains");
    expect(containsTerms).toContain("contains"); // At minimum includes operator ID
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
    // "in" operator has {values...} variadic placeholder
    const inOp = getOperator("in");
    expect(inOp?.patterns.some(p => p.includes("{...}") || p.includes("{values...}"))).toBe(true);

    const ninOp = getOperator("nin");
    expect(ninOp?.patterns.some(p => p.includes("{...}") || p.includes("{values...}"))).toBe(true);

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
    expect(eq?.predicate("hello", { value: "hello" })).toBe(true);
    expect(eq?.predicate("hello", { value: "world" })).toBe(false);
    expect(eq?.predicate(42, { value: 42 })).toBe(true);
    expect(eq?.predicate(42, { value: 43 })).toBe(false);
  });

  test("neq predicate works correctly", () => {
    const neq = getOperator("neq");
    expect(neq?.predicate("hello", { value: "world" })).toBe(true);
    expect(neq?.predicate("hello", { value: "hello" })).toBe(false);
  });

  test("comparison predicates work correctly", () => {
    const lt = getOperator("lt");
    expect(lt?.predicate(5, { value: 10 })).toBe(true);
    expect(lt?.predicate(10, { value: 5 })).toBe(false);

    const lte = getOperator("lte");
    expect(lte?.predicate(5, { value: 5 })).toBe(true);
    expect(lte?.predicate(5, { value: 4 })).toBe(false);

    const gt = getOperator("gt");
    expect(gt?.predicate(10, { value: 5 })).toBe(true);
    expect(gt?.predicate(5, { value: 10 })).toBe(false);

    const gte = getOperator("gte");
    expect(gte?.predicate(5, { value: 5 })).toBe(true);
    expect(gte?.predicate(4, { value: 5 })).toBe(false);
  });

  test("contains predicate works for strings", () => {
    const contains = getOperator("contains");
    expect(contains?.predicate("hello world", { value: "world" })).toBe(true);
    expect(contains?.predicate("hello world", { value: "foo" })).toBe(false);
  });

  test("contains predicate works for arrays", () => {
    const contains = getOperator("contains");
    expect(contains?.predicate(["a", "b", "c"], { value: "b" })).toBe(true);
    expect(contains?.predicate(["a", "b", "c"], { value: "d" })).toBe(false);
  });

  test("isEmpty predicate works correctly", () => {
    const isEmpty = getOperator("isEmpty");
    expect(isEmpty?.predicate(null, {})).toBe(true);
    expect(isEmpty?.predicate(undefined, {})).toBe(true);
    expect(isEmpty?.predicate("", {})).toBe(true);
    expect(isEmpty?.predicate([], {})).toBe(true);
    expect(isEmpty?.predicate("hello", {})).toBe(false);
    expect(isEmpty?.predicate(["a"], {})).toBe(false);
  });

  test("boolean predicates work correctly", () => {
    const isTrue = getOperator("isTrue");
    expect(isTrue?.predicate(true, {})).toBe(true);
    expect(isTrue?.predicate(false, {})).toBe(false);

    const isFalse = getOperator("isFalse");
    expect(isFalse?.predicate(false, {})).toBe(true);
    expect(isFalse?.predicate(true, {})).toBe(false);
  });

  test("between predicate works correctly", () => {
    const between = getOperator("between");
    expect(between?.predicate(5, { min: 1, max: 10 })).toBe(true);
    expect(between?.predicate(1, { min: 1, max: 10 })).toBe(true);
    expect(between?.predicate(10, { min: 1, max: 10 })).toBe(true);
    expect(between?.predicate(0, { min: 1, max: 10 })).toBe(false);
    expect(between?.predicate(11, { min: 1, max: 10 })).toBe(false);
  });

  test("in predicate works correctly", () => {
    const inOp = getOperator("in");
    expect(inOp?.predicate("a", { values: ["a", "b", "c"] })).toBe(true);
    expect(inOp?.predicate("d", { values: ["a", "b", "c"] })).toBe(false);
  });

  test("nin predicate works correctly", () => {
    const nin = getOperator("nin");
    expect(nin?.predicate("d", { values: ["a", "b", "c"] })).toBe(true);
    expect(nin?.predicate("a", { values: ["a", "b", "c"] })).toBe(false);
  });
});

// =============================================================================
// i18n Adapter Tests
// =============================================================================

describe("i18n Adapter - Nested Structure Handling", () => {
  test("i18next adapter extracts label and aliases from { label, aliases } structure", () => {
    const { createI18nextAdapter } = require("./i18n/adapters.ts");
    
    // Mock i18next instance with nested operator translations
    const mockI18n = {
      language: "de",
      t: (key: string, options?: { returnObjects?: boolean }) => {
        if (key === "operators.lt" && options?.returnObjects) {
          return {
            label: "kleiner",
            aliases: ["<", "vor", "weniger", "unter", "kleiner als"],
          };
        }
        if (key === "operators.gt" && options?.returnObjects) {
          return {
            label: "größer",
            aliases: [">", "nach", "mehr", "über", "größer als"],
          };
        }
        return key;
      },
      on: () => {},
      off: () => {},
    };
    
    const adapter = createI18nextAdapter(mockI18n);
    
    // Should include both label and aliases
    const ltAliases = adapter.getAliases("operators.lt");
    expect(ltAliases).toContain("kleiner");  // label
    expect(ltAliases).toContain("<");         // alias
    expect(ltAliases).toContain("kleiner als"); // alias
    
    const gtAliases = adapter.getAliases("operators.gt");
    expect(gtAliases).toContain("größer");  // label
    expect(gtAliases).toContain(">");       // alias
    expect(gtAliases).toContain("größer als"); // alias
  });
  
  test("i18next adapter handles array-only aliases (backwards compatible)", () => {
    const { createI18nextAdapter } = require("./i18n/adapters.ts");
    
    // Mock i18next with array-only aliases (old format)
    const mockI18n = {
      language: "en",
      t: (key: string, options?: { returnObjects?: boolean }) => {
        if (key === "operators.eq" && options?.returnObjects) {
          return ["=", "equals", "is"];
        }
        return key;
      },
      on: () => {},
      off: () => {},
    };
    
    const adapter = createI18nextAdapter(mockI18n);
    
    const eqAliases = adapter.getAliases("operators.eq");
    expect(eqAliases).toContain("=");
    expect(eqAliases).toContain("equals");
    expect(eqAliases).toContain("is");
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
