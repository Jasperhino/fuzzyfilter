/**
 * Tests for InstanceRegistry
 */

import { describe, it, expect } from "bun:test";
import { InstanceRegistry } from "./registry.ts";
import { defaultFuzzyFilterOperators } from "./operators.ts";
import type { OperatorDefinition } from "./types/core.ts";

describe("InstanceRegistry", () => {
  describe("constructor", () => {
    it("should use default operators when none provided", () => {
      const registry = new InstanceRegistry({});
      expect(registry.operatorCount).toBe(defaultFuzzyFilterOperators.length);
    });

    it("should use custom operators when provided", () => {
      const customOp: OperatorDefinition = {
        id: "customEq",
        patterns: ["t(operators.customEq) {value}"],
        predicate: (operand, { value }) => operand === value,
      };

      const registry = new InstanceRegistry({
        operators: [customOp],
      });

      expect(registry.operatorCount).toBe(1);
      expect(registry.hasOperator("customEq")).toBe(true);
      expect(registry.hasOperator("eq")).toBe(false);
    });

    it("should allow extending default operators via spread", () => {
      const customOp: OperatorDefinition = {
        id: "fuzzyMatch",
        patterns: ["t(operators.fuzzyMatch) {value}"],
        predicate: (operand, { value }) => String(operand).toLowerCase().includes(String(value).toLowerCase()),
      };

      const registry = new InstanceRegistry({
        operators: [...defaultFuzzyFilterOperators, customOp],
      });

      expect(registry.operatorCount).toBe(defaultFuzzyFilterOperators.length + 1);
      expect(registry.hasOperator("eq")).toBe(true);
      expect(registry.hasOperator("fuzzyMatch")).toBe(true);
    });

    it("should throw on duplicate operator ID", () => {
      const ops: OperatorDefinition[] = [
        {
          id: "eq",
          patterns: ["t(operators.eq) {value}"],
          predicate: (operand, { value }) => operand === value,
        },
        {
          id: "eq", // Duplicate!
          patterns: ["t(operators.eq) {value}"],
          predicate: (operand, { value }) => operand === value,
        },
      ];

      expect(() => new InstanceRegistry({ operators: ops })).toThrow(
        'Duplicate operator ID: "eq"'
      );
    });

    it("should throw on missing predicate", () => {
      const op = {
        id: "broken",
        patterns: ["t(operators.broken) {value}"],
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

  describe("getAllOperators", () => {
    it("should return all registered operators", () => {
      const registry = new InstanceRegistry({});
      const all = registry.getAllOperators();
      
      expect(all.length).toBe(defaultFuzzyFilterOperators.length);
      expect(all.some(op => op.id === "eq")).toBe(true);
    });
  });

  describe("operator predicate execution", () => {
    it("should execute custom operator predicates", () => {
      const customOp: OperatorDefinition = {
        id: "startsWithLetter",
        patterns: ["starts with letter {letter}"],
        predicate: (operand, { letter }) => {
          return String(operand).toLowerCase().startsWith(String(letter).toLowerCase());
        },
      };

      const registry = new InstanceRegistry({
        operators: [customOp],
      });

      const op = registry.getOperator("startsWithLetter");
      expect(op?.predicate("Hello", { letter: "H" })).toBe(true);
      expect(op?.predicate("Hello", { letter: "X" })).toBe(false);
    });

    it("should execute predicates with row access", () => {
      const customOp: OperatorDefinition = {
        id: "sameDept",
        patterns: ["same department"],
        predicate: (_operand, _args, row) => {
          // Check if user department matches manager department
          return row?.userDept === row?.managerDept;
        },
      };

      const registry = new InstanceRegistry({
        operators: [customOp],
      });

      const op = registry.getOperator("sameDept");
      
      expect(op?.predicate("anything", {}, { userDept: "Sales", managerDept: "Sales" })).toBe(true);
      expect(op?.predicate("anything", {}, { userDept: "Sales", managerDept: "Marketing" })).toBe(false);
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
