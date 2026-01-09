/**
 * Tests for InstanceRegistry
 */

import { describe, it, expect } from "bun:test";
import { InstanceRegistry } from "./registry.ts";
import { OPERATORS_ARRAY } from "./operators.ts";
import { DATA_TYPES } from "./types/core.ts";
import type { OperatorDefinition, TypeDefinition } from "./types/core.ts";
import { DataType, OperatorCategory } from "./types/core.ts";

describe("InstanceRegistry", () => {
  describe("constructor", () => {
    it("should use default operators when none provided", () => {
      const registry = new InstanceRegistry({});
      expect(registry.operatorCount).toBe(OPERATORS_ARRAY.length);
    });

    it("should use default types when none provided", () => {
      const registry = new InstanceRegistry({});
      expect(registry.typeCount).toBe(DATA_TYPES.length);
    });

    it("should use custom operators when provided", () => {
      const customOp: OperatorDefinition = {
        id: "customEq",
        category: OperatorCategory.EQUALITY,
        patterns: ["@eq {value}"],
        aliases: {
          "@eq": ["ceq", "custom equals"],
        },
        supportedTypes: [DataType.STRING],
        predicate: (cell, [arg]) => cell === arg,
      };

      const registry = new InstanceRegistry({
        operators: [customOp],
      });

      expect(registry.operatorCount).toBe(1);
      expect(registry.hasOperator("customEq")).toBe(true);
      expect(registry.hasOperator("eq")).toBe(false);
    });

    it("should use custom types when provided", () => {
      const customType: TypeDefinition = {
        id: "amount",
        label: "Amount",
        compatibilityType: DataType.NUMBER,
      };

      const registry = new InstanceRegistry({
        types: [customType],
      });

      expect(registry.typeCount).toBe(1);
      expect(registry.hasType("amount")).toBe(true);
      expect(registry.hasType("string")).toBe(false);
    });

    it("should allow extending default operators via spread", () => {
      const customOp: OperatorDefinition = {
        id: "fuzzyMatch",
        category: OperatorCategory.PATTERN_MATCHING,
        patterns: ["@fuzz {value}"],
        aliases: {
          "@fuzz": ["fuzz", "~?", "fuzzy match"],
        },
        supportedTypes: [DataType.STRING],
        predicate: (cell, [arg]) => String(cell).toLowerCase().includes(String(arg).toLowerCase()),
      };

      const registry = new InstanceRegistry({
        operators: [...OPERATORS_ARRAY, customOp],
      });

      expect(registry.operatorCount).toBe(OPERATORS_ARRAY.length + 1);
      expect(registry.hasOperator("eq")).toBe(true);
      expect(registry.hasOperator("fuzzyMatch")).toBe(true);
    });

    it("should throw on duplicate operator ID", () => {
      const ops: OperatorDefinition[] = [
        {
          id: "eq",
          category: OperatorCategory.EQUALITY,
          patterns: ["= {value}"],
          supportedTypes: [DataType.STRING],
          predicate: (cell, [arg]) => cell === arg,
        },
        {
          id: "eq", // Duplicate!
          category: OperatorCategory.EQUALITY,
          patterns: ["== {value}"],
          supportedTypes: [DataType.STRING],
          predicate: (cell, [arg]) => cell === arg,
        },
      ];

      expect(() => new InstanceRegistry({ operators: ops })).toThrow(
        'Duplicate operator ID: "eq"'
      );
    });

    it("should throw on duplicate type ID", () => {
      const types: TypeDefinition[] = [
        { id: "custom", label: "Custom", compatibilityType: DataType.STRING },
        { id: "custom", label: "Custom 2", compatibilityType: DataType.STRING }, // Duplicate!
      ];

      expect(() => new InstanceRegistry({ types })).toThrow(
        'Duplicate type ID: "custom"'
      );
    });

    it("should throw on missing predicate", () => {
      const op = {
        id: "broken",
        category: OperatorCategory.EQUALITY,
        patterns: ["= {value}"],
        supportedTypes: [DataType.STRING],
        // Missing predicate!
      } as unknown as OperatorDefinition;

      expect(() => new InstanceRegistry({ operators: [op] })).toThrow(
        'Operator "broken" is missing a predicate implementation'
      );
    });
  });

  describe("getOperator", () => {
    it("should return operator by ID", () => {
      const registry = new InstanceRegistry({});
      const eq = registry.getOperator("eq");
      expect(eq).toBeDefined();
      expect(eq?.id).toBe("eq");
    });

    it("should return undefined for unknown operator", () => {
      const registry = new InstanceRegistry({});
      expect(registry.getOperator("unknown")).toBeUndefined();
    });
  });

  describe("getOperatorsForType", () => {
    it("should return operators that support the given type", () => {
      const registry = new InstanceRegistry({});
      const stringOps = registry.getOperatorsForType(DataType.STRING);
      
      expect(stringOps.length).toBeGreaterThan(0);
      expect(stringOps.some(op => op.id === "eq")).toBe(true);
      expect(stringOps.some(op => op.id === "contains")).toBe(true);
      // gt doesn't support strings
      expect(stringOps.some(op => op.id === "gt")).toBe(false);
    });

    it("should work with custom types using compatibilityType", () => {
      const customType: TypeDefinition = {
        id: "amount",
        label: "Amount",
        compatibilityType: DataType.NUMBER,
      };

      const registry = new InstanceRegistry({
        types: [...DATA_TYPES, customType],
      });

      const amountOps = registry.getOperatorsForType("amount");
      
      // Should get operators that support DataType.NUMBER
      expect(amountOps.some(op => op.id === "gt")).toBe(true);
      expect(amountOps.some(op => op.id === "lt")).toBe(true);
      expect(amountOps.some(op => op.id === "eq")).toBe(true);
    });
  });

  describe("getAllOperators", () => {
    it("should return all registered operators", () => {
      const registry = new InstanceRegistry({});
      const all = registry.getAllOperators();
      
      expect(all.length).toBe(OPERATORS_ARRAY.length);
      expect(all.some(op => op.id === "eq")).toBe(true);
    });
  });

  describe("getType", () => {
    it("should return type by ID", () => {
      const registry = new InstanceRegistry({});
      const stringType = registry.getType("string");
      expect(stringType).toBeDefined();
      expect(stringType?.id).toBe("string");
    });

    it("should return undefined for unknown type", () => {
      const registry = new InstanceRegistry({});
      expect(registry.getType("unknown")).toBeUndefined();
    });
  });

  describe("operator predicate execution", () => {
    it("should execute custom operator predicates", () => {
      const customOp: OperatorDefinition = {
        id: "startsWithLetter",
        category: OperatorCategory.PATTERN_MATCHING,
        patterns: ["starts with letter {letter}"],
        supportedTypes: [DataType.STRING],
        predicate: (cell, [letter]) => {
          return String(cell).toLowerCase().startsWith(String(letter).toLowerCase());
        },
      };

      const registry = new InstanceRegistry({
        operators: [customOp],
      });

      const op = registry.getOperator("startsWithLetter");
      expect(op?.predicate("Hello", ["H"])).toBe(true);
      expect(op?.predicate("Hello", ["X"])).toBe(false);
    });

    it("should execute predicates with row access", () => {
      const customOp: OperatorDefinition = {
        id: "sameDept",
        category: OperatorCategory.EQUALITY,
        patterns: ["same department"],
        supportedTypes: [DataType.STRING],
        predicate: (_cell, _args, row) => {
          // Check if user department matches manager department
          return row?.userDept === row?.managerDept;
        },
      };

      const registry = new InstanceRegistry({
        operators: [customOp],
      });

      const op = registry.getOperator("sameDept");
      
      expect(op?.predicate("anything", [], { userDept: "Sales", managerDept: "Sales" })).toBe(true);
      expect(op?.predicate("anything", [], { userDept: "Sales", managerDept: "Marketing" })).toBe(false);
    });
  });

  describe("compiled operators", () => {
    it("should compile patterns and derive metadata", () => {
      const registry = new InstanceRegistry({});
      
      // eq requires 1 argument
      expect(registry.operatorRequiresArgument("eq")).toBe(true);
      expect(registry.operatorIsVariadic("eq")).toBe(false);
      
      // isEmpty doesn't require arguments
      expect(registry.operatorRequiresArgument("isEmpty")).toBe(false);
      
      // between is variadic (requires 2 args)
      expect(registry.operatorIsVariadic("between")).toBe(true);
      expect(registry.getOperatorMinArguments("between")).toBe(2);
    });

    it("should get all trie keywords from compiled operators", () => {
      const registry = new InstanceRegistry({});
      const keywords = registry.getAllTrieKeywords();
      
      // Should include operator ids
      expect(keywords.has("eq")).toBe(true);
      expect(keywords.has("contains")).toBe(true);
      
      // Should include aliases
      expect(keywords.has("=")).toBe(true);
      expect(keywords.has("==")).toBe(true);
    });
  });
});
