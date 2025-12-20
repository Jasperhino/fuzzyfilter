/**
 * Result Layer Types
 * Final output types for the suggestion system.
 */

import type { ColumnId, RowId } from "./core.ts";
import type { Operator } from "../operators/registry.ts";
import type { AnyColumnDefinition } from "./schema.ts";
import type { HypothesisValueType } from "./hypothesis.ts";
import type { RoaringBitmap } from "./index-layer.ts";

// ============================================================================
// SUGGESTION RESULT
// ============================================================================

/**
 * A single filter suggestion to display to the user
 */
export interface FilterSuggestion {
  /** Unique identifier for this suggestion */
  id: string;

  /** Human-readable label (e.g., "Status eq Open") */
  label: string;

  /** Structured parts for rich display */
  parts: {
    column: { text: string; highlight?: boolean };
    operator: { 
      text: string; 
      symbol?: string; 
      /** The alias that was matched (e.g., "at" when user typed "at") */
      matchedAlias?: string;
      highlight?: boolean;
    };
    arguments?: { text: string; highlight?: boolean }[];
  };

  /** The column this filter applies to */
  column: AnyColumnDefinition;

  /** The operator */
  operator: Operator;

  /** The argument values (array to support variadic operators) */
  arguments?: HypothesisValueType[];

  /** Number of rows matching this filter */
  resultCount: number;

  /** Score for ranking (higher = better) */
  score: number;

  /** Detailed score breakdown for debugging/display */
  scoreBreakdown?: {
    /** Raw fuzzy match score from fuzzysort */
    rawScore: number;
    /** Bonus for query coverage (using more of the input) */
    coverageBonus: number;
    /** Bonus for matching more of the target */
    completenessBonus: number;
    /** Bonus for full query match */
    fullQueryBonus: number;
    /** Number of tokens in the matching n-gram */
    tokenCount: number;
    /** Total tokens in the query */
    totalTokens: number;
  };

  /** Is this a complete filter or a suggestion template? */
  isComplete: boolean;

  /** What to insert if the user selects this suggestion */
  completionText: string;

  /** Cursor position after insertion */
  cursorPositionAfter: number;

  /** Description/explanation text */
  description?: string;

  /** Category for grouping suggestions */
  category?: "recent" | "popular" | "exact" | "fuzzy" | "inferred";
}

/**
 * Group of suggestions (for UI organization)
 */
export interface SuggestionGroup {
  /** Group label */
  label: string;
  /** Suggestions in this group */
  suggestions: FilterSuggestion[];
  /** Is this group collapsed by default? */
  collapsed?: boolean;
}

// ============================================================================
// SUGGESTION RESPONSE
// ============================================================================

/**
 * Complete response from the suggestion engine
 */
export interface SuggestionResponse {
  /** Original query */
  query: string;

  /** Cursor position in query */
  cursorPosition: number;

  /** Top suggestions (ranked) */
  suggestions: FilterSuggestion[];

  /** Grouped suggestions (optional) */
  groups?: SuggestionGroup[];

  /** Total number of suggestions (before limit) */
  totalCount: number;

  /** Time taken to generate suggestions (ms) */
  responseTimeMs: number;

  /** Parse information for debugging */
  parseInfo?: {
    tokens: string[];
    dominantStrategy: string;
  };
}

// ============================================================================
// FILTER RESULT
// ============================================================================

/**
 * A compiled filter ready for execution
 */
export interface CompiledFilter {
  /** The column ID */
  columnId: ColumnId;

  /** The operator */
  operator: Operator;

  /** The argument values (array to support variadic operators) */
  arguments: unknown[];

  /** Predicate function to test a row */
  predicate: (row: Record<string, unknown>) => boolean;

  /** Pre-computed bitmap (if available) */
  bitmap?: RoaringBitmap;

  /** Number of matching rows */
  matchCount: number;

  /** Human-readable representation */
  toString(): string;
}

/**
 * Result of applying a filter
 */
export interface FilterResult {
  /** The filter that was applied */
  filter: CompiledFilter;

  /** Matching row IDs */
  matchingRows: RowId[];

  /** Total matches */
  count: number;

  /** Execution time (ms) */
  executionTimeMs: number;
}

// ============================================================================
// COUNT CALCULATION
// ============================================================================

/**
 * Strategy for calculating counts
 */
export type CountStrategy =
  | "bitmap" // Use precomputed bitmaps
  | "scan" // Full table scan (fallback)
  | "estimate" // Statistical estimation
  | "cached"; // Use cached result

/**
 * Options for count calculation
 */
export interface CountOptions {
  /** Maximum time to spend calculating (ms) */
  timeout: number;
  /** Preferred strategy */
  preferredStrategy: CountStrategy;
  /** Use cached counts if available? */
  useCache: boolean;
  /** Cache TTL in seconds */
  cacheTtl: number;
}

/**
 * Count result with metadata
 */
export interface CountResult {
  /** The count */
  count: number;
  /** Is this exact or estimated? */
  isExact: boolean;
  /** Strategy used */
  strategy: CountStrategy;
  /** Time taken (ms) */
  calculationTimeMs: number;
  /** Was this from cache? */
  fromCache: boolean;
}

// ============================================================================
// BITMAP OPERATIONS FOR OPERATORS
// ============================================================================

/**
 * Maps operators to bitmap operations
 */
export interface OperatorBitmapStrategy {
  /** Direct lookup: eq, eqIgnoreCase */
  directLookup(value: string, columnId: ColumnId): RoaringBitmap | null;

  /** Inversion: neq, neqIgnoreCase */
  inversion(value: string, columnId: ColumnId): RoaringBitmap | null;

  /** Set membership: in */
  setMembership(values: string[], columnId: ColumnId): RoaringBitmap | null;

  /** Exclusion: nin */
  exclusion(values: string[], columnId: ColumnId): RoaringBitmap | null;

  /** Range: lt, lte, gt, gte */
  range(
    operator: "lt" | "lte" | "gt" | "gte",
    value: number | Date,
    columnId: ColumnId
  ): RoaringBitmap | null;

  /** Between: inclusive range */
  between(
    min: number | Date,
    max: number | Date,
    columnId: ColumnId
  ): RoaringBitmap | null;

  /** Prefix: startsWith */
  prefix(prefix: string, columnId: ColumnId): RoaringBitmap | null;

  /** Contains: requires n-gram or suffix tree */
  contains(substring: string, columnId: ColumnId): RoaringBitmap | null;

  /** Ends with: endsWith */
  endsWith(suffix: string, columnId: ColumnId): RoaringBitmap | null;

  /** Empty check: isEmpty */
  isEmpty(columnId: ColumnId): RoaringBitmap | null;

  /** Non-empty check: isNotEmpty */
  isNotEmpty(columnId: ColumnId): RoaringBitmap | null;
}

// ============================================================================
// CACHING
// ============================================================================

/**
 * Cache key for filter results
 */
export interface CacheKey {
  columnId: ColumnId;
  operator: Operator;
  arguments: Array<string | number | boolean | Date | null>;
}

/**
 * Cache entry
 */
export interface CacheEntry {
  key: CacheKey;
  bitmap: RoaringBitmap;
  count: number;
  createdAt: Date;
  accessCount: number;
  lastAccessedAt: Date;
}

/**
 * Filter result cache
 */
export interface FilterCache {
  /** Get cached result */
  get(key: CacheKey): CacheEntry | null;

  /** Store result in cache */
  set(key: CacheKey, bitmap: RoaringBitmap, count: number): void;

  /** Invalidate entries for a column */
  invalidateColumn(columnId: ColumnId): void;

  /** Invalidate all entries */
  invalidateAll(): void;

  /** Get cache statistics */
  stats(): {
    size: number;
    hitRate: number;
    evictionCount: number;
  };
}
