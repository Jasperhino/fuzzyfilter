/**
 * Operator Registry
 * 
 * Defines all supported operators with their metadata,
 * pattern-based aliases for fuzzy matching, type compatibility, and predicate logic.
 * 
 * The Operator type is derived from this registry's keys.
 */

import type { OperatorDefinition } from "./types/index.ts";
import { DataType, OperatorCategory } from "./types/index.ts";
import type { I18nProvider } from "./types/i18n.ts";

// ============================================================================
// OPERATORS REGISTRY (NEW PATTERN-BASED FORMAT)
// ============================================================================

/**
 * Complete registry of all operators using the pattern-based syntax.
 * This is the single source of truth - the Operator type is derived from its keys.
 * 
 * Pattern syntax:
 * - `{}` or `{name}` - Argument placeholder
 * - `@keyword` - Local alias reference (resolved from `aliases` field)
 * - `t(key)` - i18n translation key (resolved via i18nProvider.translate(), can return array)
 * - `literal` - Matches text literally
 */
export const OPERATORS: Record<string, OperatorDefinition> = {
  // ---------------------------------------------------------------------------
  // Equality Operators
  // ---------------------------------------------------------------------------
  eq: {
    id: "eq",
    category: OperatorCategory.EQUALITY,
    patterns: ["@eq {}"],
    aliases: {
      "@eq": ["=", "==", "===", "is", "equal", "equals", "t(operators.eq)"],
    },
    typeSpecificPatterns: {
      [DataType.DATE]: ["at {}", "on {}"],
    },
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.BOOLEAN, DataType.DATE, DataType.ENUM],
    predicate: (cell, [arg]) => cell === arg,
  },
  
  neq: {
    id: "neq",
    category: OperatorCategory.EQUALITY,
    patterns: ["@neq {}"],
    aliases: {
      "@neq": ["!=", "!==", "<>", "≠", "not_equals", "not_equal", "is_not", "isnt", "t(operators.neq)"],
    },
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.BOOLEAN, DataType.DATE, DataType.ENUM],
    predicate: (cell, [arg]) => cell !== arg,
  },
  
  eqIgnoreCase: {
    id: "eqIgnoreCase",
    category: OperatorCategory.EQUALITY,
    patterns: ["@eqic {}"],
    aliases: {
      "@eqic": ["~=", "≈", "eqic", "equals_ignore_case", "t(operators.eqIgnoreCase)"],
    },
    supportedTypes: [DataType.STRING],
    predicate: (cell, [arg]) => String(cell).toLowerCase() === String(arg).toLowerCase(),
  },
  
  neqIgnoreCase: {
    id: "neqIgnoreCase",
    category: OperatorCategory.EQUALITY,
    patterns: ["@neqic {}"],
    aliases: {
      "@neqic": ["≉", "neqic", "not_equals_ignore_case", "t(operators.neqIgnoreCase)"],
    },
    supportedTypes: [DataType.STRING],
    predicate: (cell, [arg]) => String(cell).toLowerCase() !== String(arg).toLowerCase(),
  },

  // ---------------------------------------------------------------------------
  // Comparison Operators (Numeric/Date)
  // ---------------------------------------------------------------------------
  lt: {
    id: "lt",
    category: OperatorCategory.COMPARISON,
    patterns: ["@lt {}"],
    aliases: {
      "@lt": ["<", "less", "smaller", "lower", "under", "before", "less_than", "t(operators.lt)"],
    },
    supportedTypes: [DataType.NUMBER, DataType.DATE],
    predicate: (cell, [arg]) => (cell as number) < (arg as number),
  },
  
  lte: {
    id: "lte",
    category: OperatorCategory.COMPARISON,
    patterns: ["@lte {}"],
    aliases: {
      "@lte": ["<=", "≤", "at_most", "max", "less_or_equal", "t(operators.lte)"],
    },
    supportedTypes: [DataType.NUMBER, DataType.DATE],
    predicate: (cell, [arg]) => (cell as number) <= (arg as number),
  },
  
  gt: {
    id: "gt",
    category: OperatorCategory.COMPARISON,
    patterns: ["@gt {}"],
    aliases: {
      "@gt": [">", "greater", "bigger", "larger", "more", "over", "above", "after", "greater_than", "t(operators.gt)"],
    },
    supportedTypes: [DataType.NUMBER, DataType.DATE],
    predicate: (cell, [arg]) => (cell as number) > (arg as number),
  },
  
  gte: {
    id: "gte",
    category: OperatorCategory.COMPARISON,
    patterns: ["@gte {}"],
    aliases: {
      "@gte": [">=", "≥", "at_least", "min", "greater_or_equal", "t(operators.gte)"],
    },
    supportedTypes: [DataType.NUMBER, DataType.DATE],
    predicate: (cell, [arg]) => (cell as number) >= (arg as number),
  },

  // ---------------------------------------------------------------------------
  // Set Membership Operators
  // ---------------------------------------------------------------------------
  in: {
    id: "in",
    category: OperatorCategory.SET_MEMBERSHIP,
    patterns: ["@in {...}"],
    aliases: {
      "@in": ["in", "∈", "one_of", "any_of", "includes", "t(operators.in)"],
    },
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.ENUM],
    predicate: (cell, args) => args.includes(cell),
  },
  
  nin: {
    id: "nin",
    category: OperatorCategory.SET_MEMBERSHIP,
    patterns: ["@nin {...}"],
    aliases: {
      "@nin": ["nin", "∉", "not_in", "none_of", "excludes", "t(operators.nin)"],
    },
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.ENUM],
    predicate: (cell, args) => !args.includes(cell),
  },

  // ---------------------------------------------------------------------------
  // Pattern Matching Operators (String)
  // ---------------------------------------------------------------------------
  contains: {
    id: "contains",
    category: OperatorCategory.PATTERN_MATCHING,
    patterns: ["@contains {}"],
    aliases: {
      "@contains": ["~", "⊃", "contains", "has", "includes", "like", "t(operators.contains)"],
    },
    supportedTypes: [DataType.STRING, DataType.ARRAY],
    predicate: (cell, [arg]) => {
      if (Array.isArray(cell)) {
        return cell.includes(arg);
      }
      return String(cell).includes(String(arg));
    },
  },
  
  notContains: {
    id: "notContains",
    category: OperatorCategory.PATTERN_MATCHING,
    patterns: ["@notContains {}"],
    aliases: {
      "@notContains": ["!~", "⊅", "not_contains", "excludes", "t(operators.notContains)"],
    },
    supportedTypes: [DataType.STRING, DataType.ARRAY],
    predicate: (cell, [arg]) => {
      if (Array.isArray(cell)) {
        return !cell.includes(arg);
      }
      return !String(cell).includes(String(arg));
    },
  },
  
  startsWith: {
    id: "startsWith",
    category: OperatorCategory.PATTERN_MATCHING,
    patterns: ["@startsWith {}"],
    aliases: {
      "@startsWith": ["^", "prefix", "starts_with", "begins_with", "t(operators.startsWith)"],
    },
    supportedTypes: [DataType.STRING],
    predicate: (cell, [arg]) => String(cell).startsWith(String(arg)),
  },
  
  endsWith: {
    id: "endsWith",
    category: OperatorCategory.PATTERN_MATCHING,
    patterns: ["@endsWith {}"],
    aliases: {
      "@endsWith": ["$", "suffix", "ends_with", "t(operators.endsWith)"],
    },
    supportedTypes: [DataType.STRING],
    predicate: (cell, [arg]) => String(cell).endsWith(String(arg)),
  },

  // ---------------------------------------------------------------------------
  // Nullability Operators
  // ---------------------------------------------------------------------------
  isEmpty: {
    id: "isEmpty",
    category: OperatorCategory.NULLABILITY,
    patterns: ["empty", "null", "blank", "missing", "is_empty", "t(operators.isEmpty)"],
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.BOOLEAN, DataType.DATE, DataType.ENUM, DataType.ARRAY],
    predicate: (cell) => cell == null || cell === "" || (Array.isArray(cell) && cell.length === 0),
  },
  
  isNotEmpty: {
    id: "isNotEmpty",
    category: OperatorCategory.NULLABILITY,
    patterns: ["not_empty", "is_not_empty", "exists", "present", "t(operators.isNotEmpty)"],
    supportedTypes: [DataType.STRING, DataType.NUMBER, DataType.BOOLEAN, DataType.DATE, DataType.ENUM, DataType.ARRAY],
    predicate: (cell) => cell != null && cell !== "" && !(Array.isArray(cell) && cell.length === 0),
  },

  // ---------------------------------------------------------------------------
  // Boolean Operators
  // ---------------------------------------------------------------------------
  isTrue: {
    id: "isTrue",
    category: OperatorCategory.BOOLEAN,
    patterns: ["true", "yes", "on", "enabled", "active", "✓", "t(operators.isTrue)"],
    supportedTypes: [DataType.BOOLEAN],
    predicate: (cell) => cell === true,
  },
  
  isFalse: {
    id: "isFalse",
    category: OperatorCategory.BOOLEAN,
    patterns: ["false", "no", "off", "disabled", "inactive", "✗", "t(operators.isFalse)"],
    supportedTypes: [DataType.BOOLEAN],
    predicate: (cell) => cell === false,
  },

  // ---------------------------------------------------------------------------
  // Date-Specific Operators
  // ---------------------------------------------------------------------------
  before: {
    id: "before",
    category: OperatorCategory.DATE,
    patterns: ["@before {}"],
    aliases: {
      "@before": ["←", "before", "earlier", "prior_to", "until", "up_to", "t(operators.before)"],
    },
    supportedTypes: [DataType.DATE],
    predicate: (cell, [arg]) => {
      const cellDate = cell instanceof Date ? cell : new Date(cell as string);
      const argDate = arg instanceof Date ? arg : new Date(arg as string);
      return cellDate.getTime() < argDate.getTime();
    },
  },
  
  after: {
    id: "after",
    category: OperatorCategory.DATE,
    patterns: ["@after {}"],
    aliases: {
      "@after": ["→", "after", "later", "since", "from", "starting", "t(operators.after)"],
    },
    supportedTypes: [DataType.DATE],
    predicate: (cell, [arg]) => {
      const cellDate = cell instanceof Date ? cell : new Date(cell as string);
      const argDate = arg instanceof Date ? arg : new Date(arg as string);
      return cellDate.getTime() > argDate.getTime();
    },
  },
  
  between: {
    id: "between",
    category: OperatorCategory.COMPARISON,
    patterns: [
      "t(between) {} @and {}",
      "t(from) {} @to {}",
      "range {} - {}",
    ],
    aliases: {
      "@and": ["and", "&", "t(and)"],
      "@to": ["to", "till", "until", "t(to)"],
    },
    supportedTypes: [DataType.NUMBER, DataType.DATE],
    predicate: (cell, args) => {
      if (args.length < 2) return false;
      const [min, max] = args;
      // Handle both numbers and dates
      if (cell instanceof Date || min instanceof Date) {
        const cellTime = (cell instanceof Date ? cell : new Date(cell as string)).getTime();
        const minTime = (min instanceof Date ? min : new Date(min as string)).getTime();
        const maxTime = (max instanceof Date ? max : new Date(max as string)).getTime();
        return cellTime >= minTime && cellTime <= maxTime;
      }
      const numCell = cell as number;
      return numCell >= (min as number) && numCell <= (max as number);
    },
  },
};

/**
 * Array of all built-in operators for spreading into config.
 * 
 * @example
 * ```typescript
 * // Extend built-in operators with custom ones
 * operators: [...OPERATORS_ARRAY, myCustomOperator]
 * ```
 */
export const OPERATORS_ARRAY: OperatorDefinition[] = Object.values(OPERATORS);

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
 * Get operators valid for a data type
 * 
 * @param type - The data type
 */
export function getOperatorsForType(type: DataType): OperatorDefinition[] {
  return getAllOperators().filter(op => 
    (op.supportedTypes as readonly string[]).includes(type)
  );
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
export function isValidOperatorForType(operator: OperatorKey | string, type: DataType): boolean {
  const info = getOperator(operator);
  return info ? (info.supportedTypes as readonly string[]).includes(type) : false;
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
    const cleaned = pattern.replace(/\{[^}]*\}/g, "").replace(/@\w+/g, "").replace(/t\([^)]+\)/g, "").trim();
    if (cleaned) terms.push(cleaned);
  }
  
  // Add all alias values (flatten the alias map)
  if (info.aliases) {
    for (const values of Object.values(info.aliases)) {
      for (const val of values) {
        // Skip i18n refs (t(key))
        if (!val.startsWith("t(")) {
          // Convert underscores to spaces for display
          terms.push(val.replace(/_/g, " "));
        }
      }
    }
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

