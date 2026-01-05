/**
 * Index Layer Types
 * Data structures for fast lookups and counting.
 * 
 * Uses roaring-node for bitmap operations:
 * https://github.com/SalvatorePreviti/roaring-node
 */

import type { ColumnId, RowId } from "./core.ts";

// ============================================================================
// BITMAP TYPES (roaring-node)
// ============================================================================

/**
 * Re-export of RoaringBitmap32 from roaring-node.
 * The actual implementation comes from the `roaring` package.
 * 
 * Key operations (all O(1) or O(n) where n is much smaller than naive):
 * - add/remove: O(1) amortized
 * - has: O(1)
 * - and/or/andNot/xor: O(n) where n = min(size(a), size(b))
 * - cardinality: O(1) cached
 */
export interface RoaringBitmap {
  /** Number of set bits (cardinality) */
  readonly size: number;

  /** Check if a row is in this bitmap */
  has(rowId: RowId): boolean;

  /** Add a row to the bitmap */
  add(rowId: RowId): this;

  /** Add multiple rows */
  addMany(rowIds: RowId[] | Uint32Array): this;

  /** Remove a row from the bitmap */
  remove(rowId: RowId): this;

  /** Create a copy of this bitmap */
  clone(): RoaringBitmap;

  /** Iterate over all set bits */
  [Symbol.iterator](): Iterator<RowId>;

  /** Convert to array of row IDs */
  toArray(): RowId[];

  // Set operations (mutating)
  andInPlace(other: RoaringBitmap): this;
  orInPlace(other: RoaringBitmap): this;
  andNotInPlace(other: RoaringBitmap): this;
  xorInPlace(other: RoaringBitmap): this;

  // Set operations (new bitmap)
  and(other: RoaringBitmap): RoaringBitmap;
  or(other: RoaringBitmap): RoaringBitmap;
  andNot(other: RoaringBitmap): RoaringBitmap;
  xor(other: RoaringBitmap): RoaringBitmap;

  // Fast cardinality without materializing
  andCardinality(other: RoaringBitmap): number;
  orCardinality(other: RoaringBitmap): number;
  andNotCardinality(other: RoaringBitmap): number;
  xorCardinality(other: RoaringBitmap): number;

  // Serialization
  serialize(): Buffer;
  toUint32Array(): Uint32Array;
}

/**
 * Static operations on RoaringBitmap32
 */
export interface RoaringBitmapStatic {
  new (): RoaringBitmap;
  new (values: RowId[] | Uint32Array): RoaringBitmap;

  /** Deserialize from buffer */
  deserialize(buffer: Buffer): RoaringBitmap;

  /** Create from array */
  from(values: RowId[] | Uint32Array): RoaringBitmap;

  /** Union of multiple bitmaps */
  or(...bitmaps: RoaringBitmap[]): RoaringBitmap;

  /** Intersection of multiple bitmaps */
  and(...bitmaps: RoaringBitmap[]): RoaringBitmap;
}

// ============================================================================
// INVERTED INDEX
// ============================================================================

/**
 * Entry in the inverted index
 */
export interface InvertedIndexEntry {
  /** The original value (for display) */
  value: string;
  /** The column this value belongs to */
  columnId: ColumnId;
  /** Bitmap of row IDs containing this value */
  bitmap: RoaringBitmap;
  /** Normalized/lowercase version for matching */
  normalizedValue: string;
}

/**
 * Inverted index for fast value lookups
 * Maps tokens/n-grams to the rows containing them
 */
export interface InvertedIndex {
  /** Look up entries matching a token exactly */
  lookupExact(token: string): InvertedIndexEntry[];

  /** Look up entries matching a prefix */
  lookupPrefix(prefix: string): InvertedIndexEntry[];

  /** Look up entries containing a substring */
  lookupContains(substring: string): InvertedIndexEntry[];

  /** Fuzzy lookup with fuzzysort */
  lookupFuzzy(query: string, limit?: number): Array<{
    entry: InvertedIndexEntry;
    score: number;
  }>;

  /** Get all entries for a specific column */
  getEntriesForColumn(columnId: ColumnId): InvertedIndexEntry[];

  /** Get unique values for a column with their counts */
  getValueCounts(columnId: ColumnId): Map<string, number>;

  /** Add a value to the index */
  add(columnId: ColumnId, value: string, rowId: RowId): void;

  /** Remove a value from the index */
  remove(columnId: ColumnId, value: string, rowId: RowId): void;

  /** Clear all entries */
  clear(): void;
}

// ============================================================================
// TRIE FOR COLUMNS & OPERATORS
// ============================================================================

/**
 * Trie for fast prefix and fuzzy matching of column/operator names
 */
export interface Trie<T> {
  /** Insert a key-value pair */
  insert(key: string, value: T): void;

  /** Exact lookup */
  lookup(key: string): T | undefined;

  /** Get all entries matching a prefix */
  prefixSearch(prefix: string): Array<{ key: string; value: T }>;

  /** Fuzzy search with fuzzysort */
  fuzzySearch(query: string, limit?: number): Array<{
    key: string;
    value: T;
    score: number;
    /** Character indexes in the key that matched (for highlighting) */
    indexes?: readonly number[];
  }>;

  /** Get all entries */
  entries(): Array<{ key: string; value: T }>;

  /** Clear all entries from the trie */
  clear(): void;

  /** Number of entries */
  readonly size: number;
}

// ============================================================================
// RANGE INDEX (FOR NUMERIC/DATE COLUMNS)
// ============================================================================

/**
 * Range query result
 */
export interface RangeQueryResult {
  /** Combined bitmap of all matching rows */
  bitmap: RoaringBitmap;
  /** Number of matching rows */
  count: number;
}

/**
 * Range index for efficient gt/lt/gte/lte/between queries
 */
export interface RangeIndex {
  /** Get rows with values less than the given value */
  lessThan(value: number | Date): RangeQueryResult;

  /** Get rows with values less than or equal */
  lessThanOrEqual(value: number | Date): RangeQueryResult;

  /** Get rows with values greater than */
  greaterThan(value: number | Date): RangeQueryResult;

  /** Get rows with values greater than or equal */
  greaterThanOrEqual(value: number | Date): RangeQueryResult;

  /** Get rows with values in range [min, max] */
  between(min: number | Date, max: number | Date): RangeQueryResult;

  /** Add a value to the index */
  add(value: number | Date, rowId: RowId): void;

  /** Remove a value from the index */
  remove(value: number | Date, rowId: RowId): void;

  /** Get min/max values in the index */
  getRange(): { min: number | Date; max: number | Date } | null;
}

// ============================================================================
// COMPOSITE INDEX
// ============================================================================

/**
 * The complete index structure for a dataset
 */
export interface DataIndex {
  /** Inverted index for value lookups */
  invertedIndex: InvertedIndex;

  /** Trie for column name matching */
  columnTrie: Trie<ColumnId>;

  /** Range indices per column */
  rangeIndices: Map<ColumnId, RangeIndex>;

  /** Total number of rows in the dataset */
  totalRows: number;

  /** Bitmap of all rows (universe) */
  allRowsBitmap: RoaringBitmap;

  /** Per-column non-null row bitmaps */
  nonNullBitmaps: Map<ColumnId, RoaringBitmap>;

  /** Rebuild the entire index from data */
  rebuild(data: Array<Record<string, unknown>>): void;

  /** Update index for a single row */
  updateRow(
    rowId: RowId,
    oldData: Record<string, unknown> | null,
    newData: Record<string, unknown> | null
  ): void;
}
