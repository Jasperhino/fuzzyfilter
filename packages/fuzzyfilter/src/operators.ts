/**
 * Operator Registry
 * 
 * Defines all supported operators with their metadata,
 * pattern-based patterns for fuzzy matching, and predicate logic.
 * 
 * The Operator type is derived from this registry's keys.
 * 
 * All operator aliases (including symbols like `=`, `!=`, `<`) are defined
 * in i18n translations via `t(operators.xxx)` references.
 */

import type { OperatorDefinition } from "./types/index.ts";
import { DataType, OperatorCategory } from "./types/index.ts";

// ============================================================================
// OPERATORS REGISTRY (NEW PATTERN-BASED FORMAT)
// ============================================================================

/**
 * Complete registry of all operators using the pattern-based syntax.
 * This is the single source of truth - the Operator type is derived from its keys.
 * 
 * Pattern syntax:
 * - `{}` or `{name}` - Argument placeholder
 * - `t(key)` - i18n translation key (resolved via i18nProvider.getAliases(), returns array)
 * - `literal` - Matches text literally
 */
export const OPERATORS: Record<string, OperatorDefinition> = {
  // ---------------------------------------------------------------------------
  // Equality Operators
  // ---------------------------------------------------------------------------
  eq: {
    id: "eq",
    patterns: ["t(operators.eq) {value}"],
    predicate: (operand, { value }) => operand === value,
  },
  
  neq: {
    id: "neq",
    patterns: ["t(operators.neq) {value}"],
    predicate: (operand, { value }) => operand !== value,
  },
  
  eqIgnoreCase: {
    id: "eqIgnoreCase",
    patterns: ["t(operators.eqIgnoreCase) {value}"],
    predicate: (operand, { value }) => String(operand).toLowerCase() === String(value).toLowerCase(),
  },
  
  neqIgnoreCase: {
    id: "neqIgnoreCase",
    patterns: ["t(operators.neqIgnoreCase) {value}"],
    predicate: (operand, { value }) => String(operand).toLowerCase() !== String(value).toLowerCase(),
  },

  // ---------------------------------------------------------------------------
  // Comparison Operators (Numeric/Date)
  // ---------------------------------------------------------------------------
  lt: {
    id: "lt",
    patterns: ["t(operators.lt) {value}"],
    predicate: (operand, { value }) => (operand as number) < (value as number),
  },
  
  lte: {
    id: "lte",
    patterns: ["t(operators.lte) {value}"],
    predicate: (operand, { value }) => (operand as number) <= (value as number),
  },
  
  gt: {
    id: "gt",
    patterns: ["t(operators.gt) {value}"],
    predicate: (operand, { value }) => (operand as number) > (value as number),
  },
  
  gte: {
    id: "gte",
    patterns: ["t(operators.gte) {value}"],
    predicate: (operand, { value }) => (operand as number) >= (value as number),
  },

  // ---------------------------------------------------------------------------
  // Set Membership Operators
  // ---------------------------------------------------------------------------
  in: {
    id: "in",
    patterns: ["t(operators.in) {values...}"],
    predicate: (operand, { values }) => {
      const valuesArray = Array.isArray(values) ? values : [values];
      return valuesArray.includes(operand);
    },
  },
  
  nin: {
    id: "nin",
    patterns: ["t(operators.nin) {values...}"],
    predicate: (operand, { values }) => {
      const valuesArray = Array.isArray(values) ? values : [values];
      return !valuesArray.includes(operand);
    },
  },

  // ---------------------------------------------------------------------------
  // Pattern Matching Operators (String)
  // ---------------------------------------------------------------------------
  contains: {
    id: "contains",
    patterns: ["t(operators.contains) {value}"],
    predicate: (operand, { value }) => {
      if (Array.isArray(operand)) {
        return operand.includes(value);
      }
      return String(operand).includes(String(value));
    },
  },
  
  notContains: {
    id: "notContains",
    patterns: ["t(operators.notContains) {value}"],
    predicate: (operand, { value }) => {
      if (Array.isArray(operand)) {
        return !operand.includes(value);
      }
      return !String(operand).includes(String(value));
    },
  },
  
  startsWith: {
    id: "startsWith",
    patterns: ["t(operators.startsWith) {value}"],
    predicate: (operand, { value }) => String(operand).startsWith(String(value)),
  },
  
  endsWith: {
    id: "endsWith",
    patterns: ["t(operators.endsWith) {value}"],
    predicate: (operand, { value }) => String(operand).endsWith(String(value)),
  },

  // ---------------------------------------------------------------------------
  // Nullability Operators
  // ---------------------------------------------------------------------------
  isEmpty: {
    id: "isEmpty",
    patterns: ["t(operators.isEmpty)"],
    predicate: (operand) => operand == null || operand === "" || (Array.isArray(operand) && operand.length === 0),
  },
  
  isNotEmpty: {
    id: "isNotEmpty",
    patterns: ["t(operators.isNotEmpty)"],
    predicate: (operand) => operand != null && operand !== "" && !(Array.isArray(operand) && operand.length === 0),
  },

  // ---------------------------------------------------------------------------
  // Boolean Operators
  // ---------------------------------------------------------------------------
  isTrue: {
    id: "isTrue",
    patterns: ["t(operators.isTrue)"],
    predicate: (operand) => operand === true,
  },
  
  isFalse: {
    id: "isFalse",
    patterns: ["t(operators.isFalse)"],
    predicate: (operand) => operand === false,
  },

  // ---------------------------------------------------------------------------
  // Date-Specific Operators
  // ---------------------------------------------------------------------------
  before: {
    id: "before",
    patterns: ["t(operators.before) {value}"],
    predicate: (operand, { value }) => {
      const operandDate = operand instanceof Date ? operand : new Date(operand as string);
      const valueDate = value instanceof Date ? value : new Date(value as string);
      return operandDate.getTime() < valueDate.getTime();
    },
  },
  
  after: {
    id: "after",
    patterns: ["t(operators.after) {value}"],
    predicate: (operand, { value }) => {
      const operandDate = operand instanceof Date ? operand : new Date(operand as string);
      const valueDate = value instanceof Date ? value : new Date(value as string);
      return operandDate.getTime() > valueDate.getTime();
    },
  },
  
  between: {
    id: "between",
    patterns: [
      "t(operators.between) {min} t(operators.and) {max}",
      "t(operators.from) {min} t(operators.to) {max}",
    ],
    predicate: (operand, { min, max }) => {
      if (min === undefined || max === undefined) return false;
      // Handle both numbers and dates
      if (operand instanceof Date || min instanceof Date) {
        const operandTime = (operand instanceof Date ? operand : new Date(operand as string)).getTime();
        const minTime = (min instanceof Date ? min : new Date(min as string)).getTime();
        const maxTime = (max instanceof Date ? max : new Date(max as string)).getTime();
        return operandTime >= minTime && operandTime <= maxTime;
      }
      const numOperand = operand as number;
      return numOperand >= (min as number) && numOperand <= (max as number);
    },
  },
};

/**
 * Array of all built-in operators for spreading into config.
 * 
 * @example
 * ```typescript
 * // Extend built-in operators with custom ones
 * operators: [...defaultFuzzyFilterOperators, myCustomOperator]
 * ```
 */
export const defaultFuzzyFilterOperators: OperatorDefinition[] = Object.values(OPERATORS);

/**
 * @deprecated Use `defaultFuzzyFilterOperators` instead. This alias will be removed in the next major version.
 */
export const OPERATORS_ARRAY = defaultFuzzyFilterOperators;

/**
 * All supported filter operators.
 * Derived from OPERATORS keys - single source of truth.
 */
export type OperatorKey = keyof typeof OPERATORS;


/**
 * Get all operators
 * 
 * @returns Array of all operators
 */
export function getAllOperators(): OperatorDefinition[] {
  return Object.values(OPERATORS);
}

/**
 * Get operator by ID (registry key)
 * 
 * @param id - The operator ID (registry key, e.g., "eq", "lt", "between")
 * @returns Operator definition
 */
export function getOperator(id: OperatorKey | string): OperatorDefinition | undefined {
  return OPERATORS[id];
}

/**
 * Get operators grouped by category.
 * Returns an object with category names as keys and arrays of operators as values.
 * Categories are returned in their natural definition order.
 */
export function getOperatorsByCategory(): Record<OperatorCategory, OperatorDefinition[]> {
  const groups: Record<OperatorCategory, OperatorDefinition[]> = {
    [OperatorCategory.EQUALITY]: [],
    [OperatorCategory.COMPARISON]: [],
    [OperatorCategory.SET_MEMBERSHIP]: [],
    [OperatorCategory.PATTERN_MATCHING]: [],
    [OperatorCategory.NULLABILITY]: [],
    [OperatorCategory.BOOLEAN]: [],
    [OperatorCategory.DATE]: [],
  };

  getAllOperators().forEach(op => {
    // Note: category is no longer part of OperatorDefinition, so we'll need to infer or remove this
    // For now, we'll just put all operators in EQUALITY as a placeholder
    // This function may need to be removed or redesigned
    groups[OperatorCategory.EQUALITY].push(op);
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
 * Get default operator for a type
 */
export function getDefaultOperatorForType(type: DataType): OperatorKey {
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
 */
export function getOperatorSearchTerms(operator: OperatorKey | string): string[] {
  const info = getOperator(operator);
  if (!info) return [];
  
  const terms: string[] = [info.id];
  
  // Add all literal patterns (no placeholders, no refs)
  for (const pattern of info.patterns) {
    const cleaned = pattern.replace(/\{[^}]*\}/g, "").replace(/t\([^)]+\)/g, "").trim();
    if (cleaned) terms.push(cleaned);
  }

  return terms;
}


/**
 * Check if a given alias matches an operator for a specific type
 * Returns true if the alias is found in the operator's patterns or aliases
 */
export function isAliasForOperator(alias: string, operator: OperatorKey | string): boolean {
  const terms = getOperatorSearchTerms(operator);
  const normalizedAlias = alias.toLowerCase().replace(/_/g, " ");
  return terms.some(t => t.toLowerCase().replace(/_/g, " ") === normalizedAlias);
}

/**
 * Type guard to check if a string is a valid operator
 */
export function isOperator(value: string): value is OperatorKey {
  return value in OPERATORS;
}

