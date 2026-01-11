/**
 * Type Tests for createOperator using tstyche
 *
 * This file contains type-level tests that verify:
 * 1. Valid operators have correct types
 * 2. Invalid operators produce expected TypeScript errors
 *
 * Run with: bun run tstyche
 */

import { expect, test, describe } from "tstyche";
import { createOperator } from "./create-operator.ts";
import type { OperatorArgs } from "./types/pattern-types.ts";

// =============================================================================
// TEST CUSTOM TYPE
// =============================================================================

/**
 * Example custom FuzzyFilterable type for testing.
 */
interface Amount {
  value: number;
  unit: string;
  toKg(): number;
}

// Module augmentation for TypeRegistry
declare module "./types/pattern-types.ts" {
  interface TypeRegistry {
    amount: Amount;
  }
}

// ============================================================================
// VALID OPERATORS - Should compile without error
// ============================================================================

describe("Valid Operators", () => {
  test("simple valid operator", () => {
    expect(
      createOperator({
        id: "test",
        patterns: ["{value}"],
        predicate: (operand: number, { value }) => operand === value,
      })
    ).type.not.toRaiseError();
  });

  test("between - two args", () => {
    expect(
      createOperator({
        id: "between",
        patterns: ["{min} to {max}"],
        predicate: (operand: number, { min, max }) => operand >= min && operand <= max,
      })
    ).type.not.toRaiseError();
  });

  test("explicit type annotation - {value:number}", () => {
    expect(
      createOperator({
        id: "typed",
        patterns: ["{value:number}"],
        predicate: (operand: string, { value }) => operand.length === value,
      })
    ).type.not.toRaiseError();
  });

  test("variadic args - {...values}", () => {
    expect(
      createOperator({
        id: "one_of",
        patterns: ["one of {...values}"],
        predicate: (operand: number, { values }) => values.includes(operand),
      })
    ).type.not.toRaiseError();
  });

  test("progressive patterns - smaller pattern is subset of larger", () => {
    expect(
      createOperator({
        id: "progressive",
        patterns: ["is {value}", "is {value} or {value2}"],
        predicate: (operand: number, { value, value2 }) =>
          operand === value || (value2 !== undefined && operand === value2),
      })
    ).type.not.toRaiseError();
  });

  test("custom type mapping via generic - {:amount}", () => {
    expect(
      createOperator<{ amount: Amount }>()({
        id: "custom_type",
        patterns: ["op {:amount}"],
        predicate: (operand: number, { amount }) => amount.value > 0,
      })
    ).type.not.toRaiseError();
  });

  test("multiple patterns with same structure", () => {
    expect(
      createOperator({
        id: "same_structure",
        patterns: ["is {value}", "equals {value}", "matches {value}"],
        predicate: (operand: number, { value }) => operand === value,
      })
    ).type.not.toRaiseError();
  });
});

// ============================================================================
// INVALID OPERATORS - Should produce TypeScript errors
// ============================================================================

describe("Invalid Operators - Arg Errors", () => {
  test("extra arg in predicate that doesn't exist in pattern", () => {
    expect(
      createOperator({
        id: "invalid_extra",
        patterns: ["is {val}"],
        predicate: (operand: number, { val, extra }) => true,
      })
    ).type.toRaiseError();
  });

  test("typo in arg name", () => {
    expect(
      createOperator({
        id: "invalid_typo",
        patterns: ["threshold {limit}"],
        predicate: (operand: number, { limt }) => operand > limt,
      })
    ).type.toRaiseError();
  });
});

describe("Invalid Operators - Pattern Consistency Errors", () => {
  test("duplicate arg in single pattern", () => {
    expect(
      createOperator({
        id: "duplicate_arg",
        patterns: ["op {arg} op {arg}"],
        predicate: (operand: number, { arg }) => operand === arg,
      })
    ).type.toRaiseError();
  });

  test("inconsistent args - same count but different names", () => {
    expect(
      createOperator({
        id: "inconsistent",
        patterns: ["is {value}", "is {value2}"],
        predicate: (operand: number, { value, value2 }) =>
          operand === value || operand === value2,
      })
    ).type.toRaiseError();
  });

  test("non-progressive args - disjoint arg sets", () => {
    expect(
      createOperator({
        id: "non_progressive",
        patterns: ["{min} to {max}", "{value} only"],
        predicate: (operand: number, { min, max, value }) => true,
      })
    ).type.toRaiseError();
  });
});

describe("Invalid Operators - Syntax Errors", () => {
  test("unclosed brace", () => {
    expect(
      createOperator({
        id: "unclosed_brace",
        patterns: ["op {arg"],
        predicate: (operand: number, { arg }) => operand === arg,
      })
    ).type.toRaiseError();
  });
});

// ============================================================================
// TYPE INFERENCE TESTS
// ============================================================================

describe("Type Inference", () => {
  test("number type inference from operand", () => {
    createOperator({
      id: "number",
      patterns: ["{value}"],
      predicate: (operand: number, { value }) => {
        expect(value).type.toBe<number>();
        return operand === value;
      },
    });
  });

  test("string type inference from operand", () => {
    createOperator({
      id: "string",
      patterns: ["{value}"],
      predicate: (operand: string, { value }) => {
        expect(value).type.toBe<string>();
        return operand === value;
      },
    });
  });

  test("explicit number type via pattern overrides operand type", () => {
    createOperator({
      id: "typed",
      patterns: ["{value:number}"],
      predicate: (operand: string, { value }) => {
        expect(value).type.toBe<number>();
        return operand.length === value;
      },
    });
  });

  test("variadic type is non-empty array", () => {
    createOperator({
      id: "variadic_typed",
      patterns: ["{...values}"],
      predicate: (operand: number, { values }) => {
        expect(values).type.toBe<[number, ...number[]]>();
        return values.includes(operand);
      },
    });
  });

  test("optional args from progressive patterns", () => {
    createOperator({
      id: "optional",
      patterns: ["{value}", "{value} or {value2}"],
      predicate: (operand: number, { value, value2 }) => {
        expect(value).type.toBe<number>();
        expect(value2).type.toBe<number | undefined>();
        return operand === value || (value2 !== undefined && operand === value2);
      },
    });
  });

  test("Amount type inference from TypeRegistry", () => {
    createOperator({
      id: "amount_registry",
      patterns: ["{:amount}"],
      predicates: {
        amount: (operand, { amount }) => {
          expect(amount).type.toBe<Amount>();
          return operand.toKg() > amount.toKg();
        },
      },
    });
  });
});

// ============================================================================
// MULTI-TYPE PREDICATES
// ============================================================================

describe("Multi-Type Predicates", () => {
  test("predicates map with TypeRegistry types", () => {
    expect(
      createOperator({
        id: "multi_type",
        patterns: ["{:amount}", "{:number}"],
        predicates: {
          amount: (operand, { amount }) => operand.toKg() > amount.toKg(),
          number: (operand, { number }) => operand > number,
        },
      })
    ).type.not.toRaiseError();
  });

  test("missing predicate for typed pattern produces error", () => {
    expect(
      createOperator({
        id: "missing_predicate",
        patterns: ["{:amount}", "{:number}"],
        predicates: {
          // Missing 'amount' predicate - should error
          number: (operand, { number }) => operand > number,
        },
      })
    ).type.toRaiseError();
  });
});

// ============================================================================
// UNION TYPE SYNTAX TESTS - {value:type1|type2}
// ============================================================================

describe("Union Type Syntax", () => {
  test("valid union syntax - {value:string|number}", () => {
    expect(
      createOperator({
        id: "union_basic",
        patterns: ["contains {value:string|number}"],
        predicates: {
          string: (operand, { value }) => operand.includes(String(value)),
          number: (operand, { value }) => operand === value,
        },
      })
    ).type.not.toRaiseError();
  });

  test("valid union syntax with custom type - {value:string|amount}", () => {
    expect(
      createOperator({
        id: "union_custom",
        patterns: ["compare {value:string|amount}"],
        predicates: {
          string: (operand, { value }) => operand === value,
          amount: (operand, { value }) => operand.value === value.value,
        },
      })
    ).type.not.toRaiseError();
  });

  test("union syntax with three types", () => {
    expect(
      createOperator({
        id: "union_three",
        patterns: ["match {value:string|number|amount}"],
        predicates: {
          string: (operand, { value }) => operand === value,
          number: (operand, { value }) => operand === value,
          amount: (operand, { value }) => operand.value === value.value,
        },
      })
    ).type.not.toRaiseError();
  });

  test("missing predicate for union type produces error", () => {
    expect(
      createOperator({
        id: "union_missing",
        patterns: ["match {value:string|amount}"],
        predicates: {
          // Missing 'amount' predicate - should error
          string: (operand, { value }) => operand === value,
        },
      })
    ).type.toRaiseError();
  });

  test("union shorthand syntax - {:string|amount}", () => {
    expect(
      createOperator({
        id: "union_shorthand",
        patterns: ["op {:string|amount}"],
        predicates: {
          string: (operand, { string }) => operand.length > 0,
          amount: (operand, { amount }) => operand.value > amount.value,
        },
      })
    ).type.not.toRaiseError();
  });
});

describe("Union Type Inference", () => {
  test("union param inherits operand type for string predicate", () => {
    createOperator({
      id: "union_infer_string",
      patterns: ["match {value:string|number}"],
      predicates: {
        string: (operand, { value }) => {
          // value should be string (inherits from operand)
          expect(value).type.toBe<string>();
          return operand === value;
        },
        number: (operand, { value }) => operand === value,
      },
    });
  });

  test("union param inherits operand type for number predicate", () => {
    createOperator({
      id: "union_infer_number",
      patterns: ["match {value:string|number}"],
      predicates: {
        string: (operand, { value }) => operand === value,
        number: (operand, { value }) => {
          // value should be number (inherits from operand)
          expect(value).type.toBe<number>();
          return operand === value;
        },
      },
    });
  });

  test("union param inherits operand type for custom type predicate", () => {
    createOperator({
      id: "union_infer_custom",
      patterns: ["match {value:string|amount}"],
      predicates: {
        string: (operand, { value }) => {
          expect(value).type.toBe<string>();
          return operand === value;
        },
        amount: (operand, { value }) => {
          // value should be Amount (inherits from operand)
          expect(value).type.toBe<Amount>();
          return operand.value === value.value;
        },
      },
    });
  });

  test("mixed union and explicit types in same pattern", () => {
    createOperator({
      id: "union_mixed",
      patterns: ["between {min:string|number} and {max:number}"],
      predicates: {
        string: (operand, { min, max }) => {
          // min inherits from operand (string), max is explicit number
          expect(min).type.toBe<string>();
          expect(max).type.toBe<number>();
          return operand.length >= max;
        },
        number: (operand, { min, max }) => {
          // min inherits from operand (number), max is explicit number
          expect(min).type.toBe<number>();
          expect(max).type.toBe<number>();
          return operand >= min && operand <= max;
        },
      },
    });
  });
});
