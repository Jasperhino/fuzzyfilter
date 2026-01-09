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
 * - **Type-Safe** - Full TypeScript support
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
 *     { id: "status", name: "Status", type: "enum", values: ["Open", "Closed"] },
 *     { id: "priority", name: "Priority", type: "number" },
 *     { id: "createdAt", name: "Created At", type: "date" },
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
 * - {@link ColumnId} - Type alias for column identifiers (string)
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
 * import { getAllOperators, getOperator } from "fuzzyfilter";
 *
 * // Get all operators (operators are now universal)
 * const allOps = getAllOperators();
 * // → [{ id: "eq", ... }, { id: "neq", ... }, ...]
 *
 * // Get metadata for a specific operator
 * const eqInfo = getOperator("eq");
 * // → { id: "eq", patterns: [...], predicate: ... }
 * ```
 */
export {
  /** Complete operator registry with all operator metadata */
  OPERATORS,
  /** Get all available operators */
  getAllOperators,
  /** Get metadata for a specific operator */
  getOperator,
  /** Get operators grouped by category */
  getOperatorsByCategory,
  /** Get all operator categories in display order */
  getAllCategories,
  /** Get the default operator for a data type */
  getDefaultOperatorForType,
  /** Get all search terms (aliases) for an operator */
  getOperatorSearchTerms,
  /** Check if an alias matches an operator */
  isAliasForOperator,
  /** Type guard to check if a string is a valid operator */
  isOperator,
  /** Array of all built-in operators for spreading into config */
  defaultFuzzyFilterOperators,

} from "./operators.ts";

/**
 * Instance registry for custom operators and types.
 */
export { InstanceRegistry } from "./registry.ts";

// ============================================================================
// TYPE-SAFE OPERATOR CREATION
// ============================================================================

/**
 * Create type-safe operators with pattern-based argument extraction.
 *
 * @example Single-type operator
 * ```typescript
 * import { createOperator } from "fuzzyfilter";
 *
 * const betweenOp = createOperator({
 *   id: 'between',
 *   patterns: ['{min} to {max}'],
 *   predicate: (operand: number, { min, max }) => operand >= min && operand <= max,
 * });
 * ```
 *
 * @example Multi-type operator with custom type
 * ```typescript
 * import { createOperator } from "fuzzyfilter";
 *
 * const greaterOp = createOperator<{ amount: Amount }>()({
 *   id: 'greater',
 *   patterns: ['t(operators.greater) {:amount}'],
 *   predicates: {
 *     amount: (operand, { amount }) => operand.toKg() > amount.toKg(),
 *   },
 * });
 * ```
 */
export { createOperator } from "./create-operator.ts";

/**
 * TypeRegistry for extending with custom types via module augmentation.
 *
 * @example
 * ```typescript
 * declare module 'fuzzyfilter' {
 *   interface TypeRegistry {
 *     amount: Amount;
 *     date: Date;
 *   }
 * }
 * ```
 */
export type { TypeRegistry } from "./create-operator.ts";

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
export { createFuzzyFilter } from "./fuzzy-filter/index.ts";

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
export { 
  buildSchema, 
  getColumn, 
  getColumns, 
  getColumnIds,
  getColumnOrThrow,
  findSimilarColumns,
  UnknownColumnError,
} from "./schema-builder.ts";

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
  /** Common date phrases for suggestions (English) */
  COMMON_DATE_SUGGESTIONS,
  /** Get date suggestions for a specific locale */
  getDateSuggestionsForLocale,
  /** Format a date for display */
  formatDateForDisplay,
  /** Quick check if text might contain a date expression */
  mightBeDateExpression,
} from "./date-parser.ts";
export type { DateLocale } from "./date-parser.ts";

// ============================================================================
// I18N EXPORTS
// ============================================================================

/**
 * Internationalization (i18n) utilities and types.
 *
 * @example Custom i18n provider
 * ```typescript
 * import { createFuzzyFilter, createObjectProvider } from "fuzzyfilter";
 *
 * const spanishTranslations = {
 *   operators: {
 *     eq: { label: "es igual a", aliases: ["igual", "="] },
 *     contains: { label: "contiene", aliases: ["tiene"] },
 *   },
 * };
 *
 * const spanishProvider = createObjectProvider(spanishTranslations);
 * const filter = createFuzzyFilter({ i18nProvider: spanishProvider });
 * ```
 */
export {
  /** Interface for custom i18n providers */
  type I18nProvider,
  /** Type for FuzzyFilter translation objects */
  type FuzzyFilterTranslations,
  /** Type for operator-specific translations */
  type OperatorTranslations,
  /** Create a default English i18n provider */
  createDefaultEnglishProvider,
  /** Create an i18n provider from a simple object */
  createObjectProvider,
} from "./i18n/index.ts";

/**
 * I18n adapters for popular i18n libraries.
 *
 * @example Using with i18next
 * ```typescript
 * import i18n from "i18next";
 * import { createI18nextProvider } from "fuzzyfilter/i18n/adapters/i18next";
 * import { createFuzzyFilter } from "fuzzyfilter";
 *
 * const provider = createI18nextProvider(i18n);
 * const filter = createFuzzyFilter({ i18nProvider: provider });
 * ```
 *
 * @example Using with vue-i18n
 * ```typescript
 * import { createI18n } from "vue-i18n";
 * import { createVueI18nProvider } from "fuzzyfilter/i18n/adapters/vue-i18n";
 * import { createFuzzyFilter } from "fuzzyfilter";
 *
 * const i18n = createI18n({ ... });
 * const provider = createVueI18nProvider(i18n);
 * const filter = createFuzzyFilter({ i18nProvider: provider });
 * ```
 */
export {
  /** Create an i18n provider from an i18next instance */
  createI18nextProvider,
  /** Create an i18n provider from a vue-i18n instance */
  createVueI18nProvider,
} from "./i18n/adapters/index.ts";// NOTE: Locale translations are available in the @fuzzyfilter/i18n-locales package.
// The core package uses English by default via createDefaultEnglishProvider().
// 
// @example Using locales from @fuzzyfilter/i18n-locales
// ```typescript
// import { createFuzzyFilter, createObjectProvider } from "fuzzyfilter";
// import { en, es, fr, de } from "@fuzzyfilter/i18n-locales";
//
// const provider = createObjectProvider(es);
// const filter = createFuzzyFilter({ i18nProvider: provider });
// ```

// ============================================================================
// TELEMETRY EXPORTS
// ============================================================================

/**
 * Telemetry/benchmarking utilities.
 *
 * Enable telemetry by setting `benchmark: true` in the FuzzyFilter config.
 *
 * @example
 * ```typescript
 * import { createFuzzyFilter } from "fuzzyfilter";
 *
 * const filter = createFuzzyFilter({ benchmark: true });
 * filter.setSchema(mySchema);
 * filter.indexData(myData);
 *
 * // Get telemetry spans
 * const telemetry = filter.getTelemetry();
 * console.log(telemetry?.getSpans());
 * ```
 */
export {
  /** Create a standalone telemetry collector */
  createTelemetryCollector,
  /** A no-op telemetry collector for when benchmarking is disabled */
  NULL_TELEMETRY_COLLECTOR,
} from "./telemetry/index.ts";
