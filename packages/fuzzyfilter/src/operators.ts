/**
 * Operator Registry
 * 
 * Defines all supported operators with their metadata,
 * aliases for fuzzy matching, and type compatibility.
 * 
 * The Operator type is derived from this registry's keys.
 */

import type { OperatorInfoBase } from "./types/index.ts";
import { DataType, OperatorCategory } from "./types/index.ts";

/**
 * Complete registry of all operators.
 * This is the single source of truth - the Operator type is derived from its keys.
 */
export const OPERATOR_REGISTRY = {
  // ---------------------------------------------------------------------------
  // Equality Operators
  // ---------------------------------------------------------------------------
  eq: {
    id: "eq",
    category: OperatorCategory.EQUALITY,
    label: "equals",
    aliases: ["equal", "equals", "is", "=", "==", "==="],
    typeSpecificAliases: {
      [DataType.DATE]: ["at", "on"],
    },
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.BOOLEAN, DataType.DATE, DataType.ENUM],
    requiresArgument: true,
  },
  neq: {
    id: "neq",
    category: OperatorCategory.EQUALITY,
    label: "not equals",
    aliases: ["notEquals", "not equal", "isNot", "is not", "!=", "!==", "<>", "≠"],
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.BOOLEAN, DataType.DATE, DataType.ENUM],
    requiresArgument: true,
  },
  eqIgnoreCase: {
    id: "eqIgnoreCase",
    category: OperatorCategory.EQUALITY,
    label: "equals (ignore case)",
    aliases: ["equalsIgnoreCase", "eqic", "equals ignore case", "~=", "≈"],
    supportedTypes: [DataType.STRING],
    requiresArgument: true,
  },
  neqIgnoreCase: {
    id: "neqIgnoreCase",
    category: OperatorCategory.EQUALITY,
    label: "not equals (ignore case)",
    aliases: ["notEqualsIgnoreCase", "neqic", "not equals ignore case", "≉"],
    supportedTypes: [DataType.STRING],
    requiresArgument: true,
  },

  // ---------------------------------------------------------------------------
  // Comparison Operators (Numeric/Date)
  // ---------------------------------------------------------------------------
  lt: {
    id: "lt",
    category: OperatorCategory.COMPARISON,
    label: "less than",
    aliases: ["lessThan", "less", "<", "before", "under"],
    supportedTypes: [DataType.NUMBER, DataType.DATE],
    requiresArgument: true,
  },
  lte: {
    id: "lte",
    category: OperatorCategory.COMPARISON,
    label: "less than or equal",
    aliases: ["lessThanOrEqual", "lessOrEqual", "<=", "max", "at most", "≤"],
    supportedTypes: [DataType.NUMBER, DataType.DATE],
    requiresArgument: true,
  },
  gt: {
    id: "gt",
    category: OperatorCategory.COMPARISON,
    label: "greater than",
    aliases: ["greaterThan", "greater", ">", "after", "over", "above"],
    supportedTypes: [DataType.NUMBER, DataType.DATE],
    requiresArgument: true,
  },
  gte: {
    id: "gte",
    category: OperatorCategory.COMPARISON,
    label: "greater than or equal",
    aliases: ["greaterThanOrEqual", "greaterOrEqual", ">=", "min", "at least", "≥"],
    supportedTypes: [DataType.NUMBER, DataType.DATE],
    requiresArgument: true,
  },

  // ---------------------------------------------------------------------------
  // Set Membership Operators
  // ---------------------------------------------------------------------------
  in: {
    id: "in",
    category: OperatorCategory.SET_MEMBERSHIP,
    label: "in",
    aliases: ["oneOf", "one of", "any of", "anyOf", "includes", "∈"],
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.ENUM],
    requiresArgument: true,
    isVariadic: true,
    minArguments: 1,
  },
  nin: {
    id: "nin",
    category: OperatorCategory.SET_MEMBERSHIP,
    label: "not in",
    aliases: ["notIn", "not one of", "none of", "noneOf", "excludes", "∉"],
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.ENUM],
    requiresArgument: true,
    isVariadic: true,
    minArguments: 1,
  },

  // ---------------------------------------------------------------------------
  // Pattern Matching Operators (String)
  // ---------------------------------------------------------------------------
  contains: {
    id: "contains",
    category: OperatorCategory.PATTERN_MATCHING,
    label: "contains",
    aliases: ["has", "includes", "like", "~", "⊃"],
    supportedTypes: [DataType.STRING, DataType.ARRAY],
    requiresArgument: true,
  },
  notContains: {
    id: "notContains",
    category: OperatorCategory.PATTERN_MATCHING,
    label: "does not contain",
    aliases: ["doesNotContain", "notIncludes", "excludes", "!~", "⊅"],
    supportedTypes: [DataType.STRING, DataType.ARRAY],
    requiresArgument: true,
  },
  startsWith: {
    id: "startsWith",
    category: OperatorCategory.PATTERN_MATCHING,
    label: "starts with",
    aliases: ["beginsWith", "prefix", "^", "^…"],
    supportedTypes: [DataType.STRING],
    requiresArgument: true,
  },
  endsWith: {
    id: "endsWith",
    category: OperatorCategory.PATTERN_MATCHING,
    label: "ends with",
    aliases: ["suffix", "$", "…$"],
    supportedTypes: [DataType.STRING],
    requiresArgument: true,
  },

  // ---------------------------------------------------------------------------
  // Nullability Operators
  // ---------------------------------------------------------------------------
  isEmpty: {
    id: "isEmpty",
    category: OperatorCategory.NULLABILITY,
    label: "is empty",
    aliases: ["isNull", "null", "empty", "blank", "missing", "∅"],
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.BOOLEAN, DataType.DATE, DataType.ENUM, DataType.ARRAY],
    requiresArgument: false,
  },
  isNotEmpty: {
    id: "isNotEmpty",
    category: OperatorCategory.NULLABILITY,
    label: "is not empty",
    aliases: ["isNotNull", "notNull", "hasValue", "exists", "present", "≠∅"],
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.BOOLEAN, DataType.DATE, DataType.ENUM, DataType.ARRAY],
    requiresArgument: false,
  },

  // ---------------------------------------------------------------------------
  // Boolean Operators
  // ---------------------------------------------------------------------------
  isTrue: {
    id: "isTrue",
    category: OperatorCategory.BOOLEAN,
    label: "is true",
    aliases: ["true", "yes", "on", "enabled", "active", "✓"],
    supportedTypes: [DataType.BOOLEAN],
    requiresArgument: false,
  },
  isFalse: {
    id: "isFalse",
    category: OperatorCategory.BOOLEAN,
    label: "is false",
    aliases: ["false", "no", "off", "disabled", "inactive", "✗"],
    supportedTypes: [DataType.BOOLEAN],
    requiresArgument: false,
  },

  // ---------------------------------------------------------------------------
  // Date-Specific Operators
  // ---------------------------------------------------------------------------
  before: {
    id: "before",
    category: OperatorCategory.DATE,
    label: "before",
    aliases: ["earlier", "prior to", "priorTo", "earlier than", "preceding", "until", "up to", "←"],
    supportedTypes: [DataType.DATE],
    requiresArgument: true,
  },
  after: {
    id: "after",
    category: OperatorCategory.DATE,
    label: "after",
    aliases: ["later", "since", "later than", "following", "from", "starting", "→"],
    supportedTypes: [DataType.DATE],
    requiresArgument: true,
  },
  between: {
    id: "between",
    category: OperatorCategory.DATE,
    label: "between",
    aliases: ["range", "from to", "within", "↔"],
    supportedTypes: [DataType.NUMBER, DataType.DATE],
    requiresArgument: true,
    isVariadic: true,
    minArguments: 2,
  },
} as const satisfies Record<string, OperatorInfoBase & { id: string; category: OperatorCategory }>;

/**
 * All supported filter operators.
 * Derived from OPERATOR_REGISTRY keys - single source of truth.
 */
export type Operator = keyof typeof OPERATOR_REGISTRY;

/**
 * Full operator info including the id field.
 * The id matches the registry key.
 */
export interface OperatorInfo extends OperatorInfoBase {
  /** The operator identifier (matches the registry key) */
  readonly id: Operator;
}

/**
 * Get all operators
 */
export function getAllOperators(): OperatorInfo[] {
  return Object.values(OPERATOR_REGISTRY) as OperatorInfo[];
}

/**
 * Get operator by ID
 */
export function getOperator(id: Operator): OperatorInfo {
  return OPERATOR_REGISTRY[id] as OperatorInfo;
}

/**
 * Get operators valid for a data type
 */
export function getOperatorsForType(type: DataType): OperatorInfo[] {
  return getAllOperators().filter(op => op.supportedTypes.includes(type));
}

/**
 * Get operators grouped by category.
 * Returns an object with category names as keys and arrays of operators as values.
 * Categories are returned in their natural definition order.
 */
export function getOperatorsByCategory(): Record<OperatorCategory, OperatorInfo[]> {
  const groups: Record<OperatorCategory, OperatorInfo[]> = {
    [OperatorCategory.EQUALITY]: [],
    [OperatorCategory.COMPARISON]: [],
    [OperatorCategory.SET_MEMBERSHIP]: [],
    [OperatorCategory.PATTERN_MATCHING]: [],
    [OperatorCategory.NULLABILITY]: [],
    [OperatorCategory.BOOLEAN]: [],
    [OperatorCategory.DATE]: [],
  };

  getAllOperators().forEach(op => {
    groups[op.category].push(op);
  });

  return groups;
}

/**
 * Get all operator categories in display order.
 */
export function getAllCategories(): OperatorCategory[] {
  return Object.values(OperatorCategory) as OperatorCategory[];
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
    case DataType.STRING:
      return "contains";
    case DataType.NUMBER:
      return "eq";
    case DataType.BOOLEAN:
      return "isTrue";
    case DataType.DATE:
      return "eq";
    case DataType.ENUM:
      return "eq";
    case DataType.ARRAY:
      return "contains";
    default:
      return "eq";
  }
}

/**
 * Get all searchable terms for an operator (for fuzzy matching)
 * 
 * @param operator - The operator to get search terms for
 * @param forType - Optional: include type-specific aliases for this data type
 */
export function getOperatorSearchTerms(operator: Operator, forType?: DataType): string[] {
  const info = getOperator(operator);
  
  const terms: string[] = [
    info.id,
    info.label,
    ...info.aliases,
  ];

  // Add type-specific aliases if a type is specified
  if (forType && info.typeSpecificAliases?.[forType]) {
    terms.push(...info.typeSpecificAliases[forType]!);
  }

  return terms;
}

/**
 * Get all aliases for an operator, optionally filtered by type
 * 
 * @param operator - The operator to get aliases for
 * @param forType - Optional: include type-specific aliases for this data type
 */
export function getOperatorAliases(operator: Operator, forType?: DataType): string[] {
  const info = getOperator(operator);
  
  const aliases = [...info.aliases];

  // Add type-specific aliases if a type is specified
  if (forType && info.typeSpecificAliases?.[forType]) {
    aliases.push(...info.typeSpecificAliases[forType]!);
  }

  return aliases;
}

/**
 * Check if a given alias matches an operator for a specific type
 * Returns true if the alias is a general alias OR a type-specific alias for the given type
 */
export function isAliasForOperator(alias: string, operator: Operator, forType?: DataType): boolean {
  const info = getOperator(operator);
  
  const normalizedAlias = alias.toLowerCase();
  
  // Check general aliases
  if (info.aliases.some(a => a.toLowerCase() === normalizedAlias)) {
    return true;
  }
  
  // Check type-specific aliases
  if (forType && info.typeSpecificAliases?.[forType]) {
    if (info.typeSpecificAliases[forType]!.some(a => a.toLowerCase() === normalizedAlias)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Type guard to check if a string is a valid operator
 */
export function isOperator(value: string): value is Operator {
  return value in OPERATOR_REGISTRY;
}



