/**
 * Shared types for fuzzy filter implementation
 */

import type {
  ColumnId,
  Operator,
  Trie,
  AnyColumnDefinition,
  Schema,
  Token,
  ParsedInput,
} from "../types/index.ts";
import type { I18nProvider } from "../types/i18n.ts";
import { DataType } from "../types/index.ts";

/**
 * Operator alias entry with optional type restriction
 */
export interface OperatorAliasEntry {
  /** The operator this alias maps to */
  operator: Operator;
  /** If set, this alias only applies for this data type */
  forType?: DataType;
}

/**
 * Cached filter context result
 */
export interface CachedContextResult {
  rowIndices: Set<number>;
  availableValues: ContextAvailableValues;
  dataVersion: number; // Incremented when data changes
}

/**
 * Internal state for FuzzyFilter
 */
export interface FuzzyFilterState {
  schema: Schema | null;
  columnTrie: Trie<AnyColumnDefinition>;
  operatorTrie: Trie<OperatorAliasEntry>;
  valueTrie: Trie<{ value: string; columnId: ColumnId | string; rowCount: number }>;
  data: Array<Record<string, unknown>>;
  /** Version counter incremented when data changes, used for cache invalidation */
  dataVersion: number;
  /** LRU cache for filter context results */
  contextCache: Map<string, CachedContextResult>;
  /** i18n provider for translations */
  i18nProvider: I18nProvider;
}

/**
 * N-gram with metadata for scoring
 */
export interface NgramWithMeta {
  text: string;
  tokenCount: number;      // How many tokens this ngram spans
  totalTokens: number;     // Total tokens in the input
  isFullQuery: boolean;    // Is this the full query?
  /** Start position in original query string */
  inputStart: number;
  /** End position in original query string */
  inputEnd: number;
  /** The tokens that make up this ngram */
  tokens: Token[];
}

/**
 * Map of available values per column for context-aware suggestions.
 * When a filter context is provided, this map contains only the values
 * that exist in rows matching the context filters.
 */
export type ContextAvailableValues = Map<ColumnId, {
  strings: Set<string>;
  numbers: Set<number>;
  dates: Set<number>; // timestamps for comparison
}>;

/**
 * Score breakdown for debugging/display
 */
export interface ScoreBreakdown {
  rawScore: number;
  coverageBonus: number;
  completenessBonus: number;
  fullQueryBonus: number;
  exactMatchBonus?: number;
  targetCoveragePenalty?: number;
  tokenCount: number;
  totalTokens: number;
  adjustedScore: number;
}

/**
 * Match metadata for highlighting - tracks how query matched filter components
 */
export interface MatchMetadata {
  /** Column match info if available */
  column?: {
    inputStart: number;
    inputEnd: number;
    inputText: string;
    matchedTarget: string;
    matchIndexes?: readonly number[];
    score: number;
  };
  /** Operator match info if available */
  operator?: {
    inputStart: number;
    inputEnd: number;
    inputText: string;
    matchedTarget: string;
    matchIndexes?: readonly number[];
    score: number;
  };
  /** Value match info if available (can have multiple for variadic operators) */
  values?: Array<{
    inputStart: number;
    inputEnd: number;
    inputText: string;
    matchedTarget: string;
    matchIndexes?: readonly number[];
    score: number;
  }>;
}

/**
 * Detected value tokens from user input
 */
export interface DetectedValues {
  numbers: { token: Token; value: number; index: number }[];
  dates: { token: Token; value: Date; index: number; parsed?: import("../date-parser.ts").ParsedDate }[];
}

/**
 * Represents a value match with its input position information.
 * Used for non-overlapping assignment of ngrams to values.
 */
export interface PositionedValueMatch {
  /** The original value (used for filtering) */
  value: string;
  /** The display value (matched key, e.g., translated value like "Technik") */
  displayValue: string;
  score: number;
  ngram: NgramWithMeta;
  matchIndexes?: readonly number[];
}

/**
 * Result of detecting a template pattern in tokens
 */
export interface TemplatePatternMatch {
  /** The operator that this template pattern represents */
  operator: string;
  /** Tokens between the start and separator keywords (first argument) */
  arg1Tokens: Token[];
  /** Tokens after the separator keyword (second argument) */
  arg2Tokens: Token[];
  /** The start keyword that was matched (e.g., "from") */
  startKeyword: string;
  /** The separator keyword that was matched (e.g., "to", "till") */
  separatorKeyword: string;
  /** Index of the start keyword token */
  startIndex: number;
  /** Index of the separator keyword token */
  separatorIndex: number;
}


/**
 * Context for suggestion generation
 */
export interface SuggestionContext {
  query: string;
  parsed: ParsedInput;
  tokens: Token[];
  ngrams: NgramWithMeta[];
  contextRowIndices: Set<number> | null;
  contextAvailableValues: ContextAvailableValues | null;
  i18nProvider: I18nProvider;
}

/**
 * Column score entry from n-gram matching
 */
export interface ColumnScoreEntry {
  breakdown: ScoreBreakdown;
  ngram: NgramWithMeta;
  matchedTarget: string;
  matchIndexes?: readonly number[];
}

/**
 * Operator score entry from n-gram matching
 */
export interface OpScoreEntry {
  breakdown: ScoreBreakdown;
  operator: Operator;
  forType?: DataType;
  matchedAlias?: string;
  ngram: NgramWithMeta;
  matchedTarget: string;
  matchIndexes?: readonly number[];
}

/**
 * Value score entry from n-gram matching
 */
export interface ValScoreEntry {
  breakdown: ScoreBreakdown;
  match: {
    value: {
      value: string;
      columnId: ColumnId;
      rowCount: number;
    };
    score: number;
    indexes?: readonly number[];
  };
  sourceTokenText: string;
  ngram: NgramWithMeta;
  matchedTarget: string;
  matchIndexes?: readonly number[];
}
