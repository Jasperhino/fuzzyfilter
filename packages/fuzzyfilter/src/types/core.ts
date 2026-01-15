/**
 * Core types for the FuzzyFilter library.
 *
 * @module fuzzyfilter/types/core
 */

/**
 * Unique identifier for a row in the dataset.
 * Row IDs are zero-based indices into the data array.
 */
export type RowId = number;

/**
 * A match result from fuzzy search
 */
export interface Match<T> {
  /** The matched item */
  item: T;
  /** Score from fuzzysort (higher = better match) */
  score: number;
  /** Which characters matched (for highlighting) */
  indexes?: number[];
}
