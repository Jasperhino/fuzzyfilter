/**
 * FuzzyFilter - Intelligent Filter Suggestions for Data Tables
 *
 * A TypeScript library for building fuzzy filter interfaces with natural
 * language support. Features include:
 *
 * - **Fuzzy Matching** - Typo-tolerant search for columns, operators, and values
 * - **Instant Counts** - Real-time result counts using optimized data structures
 * - **Natural Language Dates** - "last week", "yesterday", "next month"
 * - **Smart Ranking** - Prioritizes complete matches over partial ones
 * - **Type-Safe** - Full TypeScript support with branded types
 *
 * @packageDocumentation
 * @module fuzzyfilter
 *
 * @example Quick Start
 * ```typescript
 * import { createFuzzyFilter, columnId } from "fuzzyfilter";
 *
 * // 1. Create a filter instance
 * const filter = createFuzzyFilter();
 *
 * // 2. Define your schema
 * filter.setSchema({
 *   columns: [
 *     { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
 *     { id: columnId("priority"), name: "Priority", type: "number" },
 *     { id: columnId("createdAt"), name: "Created At", type: "date" },
 *   ],
 * });
 *
 * // 3. Index your data
 * filter.indexData(myData);
 *
 * // 4. Get suggestions as the user types
 * const suggestions = await filter.suggest("stat eq");
 * console.log(suggestions);
 * // → [{ label: "Status = Open", resultCount: 5 }, ...]
 * ```
 *
 * @example Compile and Execute Filters
 * ```typescript
 * // Compile from user input
 * const compiled = filter.compile("status eq Open");
 *
 * // Use the predicate function
 * const matches = myData.filter(compiled.predicate);
 *
 * // Or compile programmatically
 * const compiled = filter.compileFilter("priority", "gte", 3);
 * ```
 *
 * @example React Integration
 * ```typescript
 * import { useFuzzyFilter } from "fuzzyfilter/react";
 *
 * function FilterBox({ data, schema }) {
 *   const { query, setQuery, suggestions, applySuggestion } = useFuzzyFilter({
 *     data,
 *     schema,
 *   });
 *
 *   return (
 *     <input value={query} onChange={(e) => setQuery(e.target.value)} />
 *   );
 * }
 * ```
 */

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Re-export all types from the types module.
 *
 * Key types include:
 * - {@link ColumnId} - Branded type for column identifiers
 * - {@link Operator} - All supported filter operators
 * - {@link DataType} - Supported column data types
 * - {@link FuzzyFilter} - Main filter interface
 * - {@link FilterSuggestion} - A single suggestion result
 * - {@link AnyColumnDefinition} - Column definition union type
 */
export * from "./types/index.ts";

// ============================================================================
// OPERATOR REGISTRY
// ============================================================================

/**
 * Operator registry exports for querying available operators.
 *
 * @example
 * ```typescript
 * import { getOperatorsForType, getOperator } from "fuzzyfilter";
 *
 * // Get all operators for a data type
 * const stringOps = getOperatorsForType("string");
 * // → ["eq", "neq", "contains", "startsWith", ...]
 *
 * // Get metadata for a specific operator
 * const eqInfo = getOperator("eq");
 * // → { id: "eq", label: "equals", symbol: "=", ... }
 * ```
 */
export {
  /** Complete operator registry with all operator metadata */
  OPERATOR_REGISTRY,
  /** Get all available operators */
  getAllOperators,
  /** Get metadata for a specific operator */
  getOperator,
  /** Get operators valid for a data type */
  getOperatorsForType,
  /** Get operators grouped by category */
  getOperatorsByCategory,
  /** Get all operator categories in display order */
  getAllCategories,
  /** Check if an operator is valid for a data type */
  isValidOperatorForType,
  /** Get the default operator for a data type */
  getDefaultOperatorForType,
  /** Get all search terms (aliases) for an operator, with optional type-specific aliases */
  getOperatorSearchTerms,
  /** Get aliases for an operator, with optional type-specific aliases */
  getOperatorAliases,
  /** Check if an alias matches an operator for a specific type */
  isAliasForOperator,
  /** Type guard to check if a string is a valid operator */
  isOperator,
} from "./operators/registry.ts";

// ============================================================================
// MAIN FACTORY
// ============================================================================

/**
 * Main factory function for creating FuzzyFilter instances.
 *
 * @example
 * ```typescript
 * import { createFuzzyFilter } from "fuzzyfilter";
 *
 * const filter = createFuzzyFilter({
 *   maxSuggestions: 15,
 *   debounceMs: 200,
 * });
 * ```
 */
export { createFuzzyFilter } from "./fuzzy-filter.ts";

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Tokenizer for parsing user input into tokens.
 *
 * @example
 * ```typescript
 * import { tokenize } from "fuzzyfilter";
 *
 * const tokens = tokenize('status eq "In Progress"');
 * // → [{ raw: "status", ... }, { raw: "eq", ... }, { raw: "In Progress", ... }]
 * ```
 */
export { tokenize } from "./tokenizer.ts";

/**
 * Trie data structure for fuzzy prefix matching.
 */
export { createTrie } from "./trie.ts";

/**
 * Schema utilities for building and querying schemas.
 */
export { buildSchema, getColumn, getColumns, getColumnIds } from "./schema-builder.ts";

// ============================================================================
// DATE PARSING
// ============================================================================

/**
 * Date parsing utilities for natural language date expressions.
 *
 * Uses chrono-node under the hood to parse expressions like:
 * - "today", "yesterday", "tomorrow"
 * - "last week", "next month", "this year"
 * - "two weeks ago", "3 days from now"
 * - "January 15, 2024", "2024-01-15"
 *
 * @example
 * ```typescript
 * import { parseDate, COMMON_DATE_SUGGESTIONS } from "fuzzyfilter";
 *
 * // Parse a natural language date
 * const result = parseDate("two weeks ago");
 * // → { date: Date, isRange: false, text: "two weeks ago", ... }
 *
 * // Parse a range expression
 * const range = parseDate("last month");
 * // → { date: Date, rangeStart: Date, rangeEnd: Date, isRange: true, ... }
 *
 * // Use common suggestions for date fields
 * COMMON_DATE_SUGGESTIONS.forEach(({ text, label }) => {
 *   console.log(`${text} → ${label}`);
 * });
 * ```
 */
export {
  /** Parse a natural language date expression */
  parseDate,
  /** Detect all date expressions in a string with positions */
  detectDateExpressions,
  /** Common date phrases for suggestions */
  COMMON_DATE_SUGGESTIONS,
  /** Format a date for display */
  formatDateForDisplay,
  /** Quick check if text might contain a date expression */
  mightBeDateExpression,
} from "./date-parser.ts";

