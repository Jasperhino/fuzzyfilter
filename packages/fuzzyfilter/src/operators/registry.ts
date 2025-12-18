/**
 * Operator Registry
 * 
 * Defines all supported operators with their metadata,
 * aliases for fuzzy matching, and type compatibility.
 */

import type { Operator, OperatorInfo, DataType } from "../types/index.ts";

/**
 * Complete registry of all operators
 */
export const OPERATOR_REGISTRY: Record<Operator, OperatorInfo> = {
  // ---------------------------------------------------------------------------
  // Equality Operators
  // ---------------------------------------------------------------------------
  eq: {
    id: "eq",
    label: "equals",
    aliases: ["equal", "equals", "is", "=", "==", "==="],
    supportedTypes: ["string", "number", "boolean", "date", "enum"],
    requiresArgument: true,
    symbol: "=",
  },
  neq: {
    id: "neq",
    label: "not equals",
    aliases: ["notEquals", "not equal", "isNot", "is not", "!=", "!==", "<>"],
    supportedTypes: ["string", "number", "boolean", "date", "enum"],
    requiresArgument: true,
    symbol: "≠",
  },
  eqIgnoreCase: {
    id: "eqIgnoreCase",
    label: "equals (ignore case)",
    aliases: ["equalsIgnoreCase", "eqic", "equals ignore case", "~="],
    supportedTypes: ["string"],
    requiresArgument: true,
    symbol: "≈",
  },
  neqIgnoreCase: {
    id: "neqIgnoreCase",
    label: "not equals (ignore case)",
    aliases: ["notEqualsIgnoreCase", "neqic", "not equals ignore case"],
    supportedTypes: ["string"],
    requiresArgument: true,
    symbol: "≉",
  },

  // ---------------------------------------------------------------------------
  // Comparison Operators (Numeric/Date)
  // ---------------------------------------------------------------------------
  lt: {
    id: "lt",
    label: "less than",
    aliases: ["lessThan", "less", "<", "before", "under"],
    supportedTypes: ["number", "date"],
    requiresArgument: true,
    symbol: "<",
  },
  lte: {
    id: "lte",
    label: "less than or equal",
    aliases: ["lessThanOrEqual", "lessOrEqual", "<=", "max", "at most"],
    supportedTypes: ["number", "date"],
    requiresArgument: true,
    symbol: "≤",
  },
  gt: {
    id: "gt",
    label: "greater than",
    aliases: ["greaterThan", "greater", ">", "after", "over", "above"],
    supportedTypes: ["number", "date"],
    requiresArgument: true,
    symbol: ">",
  },
  gte: {
    id: "gte",
    label: "greater than or equal",
    aliases: ["greaterThanOrEqual", "greaterOrEqual", ">=", "min", "at least"],
    supportedTypes: ["number", "date"],
    requiresArgument: true,
    symbol: "≥",
  },

  // ---------------------------------------------------------------------------
  // Set Membership Operators
  // ---------------------------------------------------------------------------
  in: {
    id: "in",
    label: "in",
    aliases: ["oneOf", "one of", "any of", "anyOf", "includes"],
    supportedTypes: ["string", "number", "enum"],
    requiresArgument: true,
    isVariadic: true,
    symbol: "∈",
  },
  nin: {
    id: "nin",
    label: "not in",
    aliases: ["notIn", "not one of", "none of", "noneOf", "excludes"],
    supportedTypes: ["string", "number", "enum"],
    requiresArgument: true,
    isVariadic: true,
    symbol: "∉",
  },

  // ---------------------------------------------------------------------------
  // Pattern Matching Operators (String)
  // ---------------------------------------------------------------------------
  contains: {
    id: "contains",
    label: "contains",
    aliases: ["has", "includes", "like", "~"],
    supportedTypes: ["string", "array"],
    requiresArgument: true,
    symbol: "⊃",
  },
  notContains: {
    id: "notContains",
    label: "does not contain",
    aliases: ["doesNotContain", "notIncludes", "excludes", "!~"],
    supportedTypes: ["string", "array"],
    requiresArgument: true,
    symbol: "⊅",
  },
  startsWith: {
    id: "startsWith",
    label: "starts with",
    aliases: ["beginsWith", "prefix", "^"],
    supportedTypes: ["string"],
    requiresArgument: true,
    symbol: "^…",
  },
  endsWith: {
    id: "endsWith",
    label: "ends with",
    aliases: ["suffix", "$"],
    supportedTypes: ["string"],
    requiresArgument: true,
    symbol: "…$",
  },

  // ---------------------------------------------------------------------------
  // Nullability Operators
  // ---------------------------------------------------------------------------
  isEmpty: {
    id: "isEmpty",
    label: "is empty",
    aliases: ["isNull", "null", "empty", "blank", "missing"],
    supportedTypes: ["string", "number", "boolean", "date", "enum", "array"],
    requiresArgument: false,
    symbol: "∅",
  },
  isNotEmpty: {
    id: "isNotEmpty",
    label: "is not empty",
    aliases: ["isNotNull", "notNull", "hasValue", "exists", "present"],
    supportedTypes: ["string", "number", "boolean", "date", "enum", "array"],
    requiresArgument: false,
    symbol: "≠∅",
  },

  // ---------------------------------------------------------------------------
  // Boolean Operators
  // ---------------------------------------------------------------------------
  isTrue: {
    id: "isTrue",
    label: "is true",
    aliases: ["true", "yes", "on", "enabled", "active"],
    supportedTypes: ["boolean"],
    requiresArgument: false,
    symbol: "✓",
  },
  isFalse: {
    id: "isFalse",
    label: "is false",
    aliases: ["false", "no", "off", "disabled", "inactive"],
    supportedTypes: ["boolean"],
    requiresArgument: false,
    symbol: "✗",
  },

  // ---------------------------------------------------------------------------
  // Date-Specific Operators
  // ---------------------------------------------------------------------------
  before: {
    id: "before",
    label: "before",
    aliases: ["earlier", "prior to", "priorTo"],
    supportedTypes: ["date"],
    requiresArgument: true,
    symbol: "←",
  },
  after: {
    id: "after",
    label: "after",
    aliases: ["later", "since"],
    supportedTypes: ["date"],
    requiresArgument: true,
    symbol: "→",
  },
  between: {
    id: "between",
    label: "between",
    aliases: ["range", "from to", "within"],
    supportedTypes: ["number", "date"],
    requiresArgument: true,
    isVariadic: true,
    symbol: "↔",
  },
};

/**
 * Get all operators
 */
export function getAllOperators(): OperatorInfo[] {
  return Object.values(OPERATOR_REGISTRY);
}

/**
 * Get operator by ID
 */
export function getOperator(id: Operator): OperatorInfo | undefined {
  return OPERATOR_REGISTRY[id];
}

/**
 * Get operators valid for a data type
 */
export function getOperatorsForType(type: DataType): OperatorInfo[] {
  return getAllOperators().filter(op => op.supportedTypes.includes(type));
}

/**
 * Check if operator is valid for type
 */
export function isValidOperatorForType(operator: Operator, type: DataType): boolean {
  const info = getOperator(operator);
  return info?.supportedTypes.includes(type) ?? false;
}

/**
 * Get default operator for a type
 */
export function getDefaultOperatorForType(type: DataType): Operator {
  switch (type) {
    case "string":
      return "contains";
    case "number":
      return "eq";
    case "boolean":
      return "isTrue";
    case "date":
      return "eq";
    case "enum":
      return "eq";
    case "array":
      return "contains";
    default:
      return "eq";
  }
}

/**
 * Get all searchable terms for an operator (for fuzzy matching)
 */
export function getOperatorSearchTerms(operator: Operator): string[] {
  const info = getOperator(operator);
  if (!info) return [];
  
  return [
    info.id,
    info.label,
    ...info.aliases,
    ...(info.symbol ? [info.symbol] : []),
  ];
}

/**
 * Type guard to check if a string is a valid operator
 */
export function isOperator(value: string): value is Operator {
  return value in OPERATOR_REGISTRY;
}

