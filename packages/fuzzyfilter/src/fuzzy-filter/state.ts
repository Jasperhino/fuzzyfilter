/**
 * State management for FuzzyFilter
 * 
 * Handles caching, data versioning, and context computation.
 */

import type {
  FuzzyFilterState,
  ContextAvailableValues,
  CachedContextResult,
} from "./types.ts";
import type { Schema, CompiledFilter, ColumnId } from "../types/index.ts";
import { DataType } from "../types/index.ts";
import { getColumns } from "../schema-builder.ts";
import { createTrie } from "../trie.ts";
import type { AnyColumnDefinition } from "../types/index.ts";
import type { OperatorAliasEntry } from "./types.ts";

/**
 * Creates a new FuzzyFilterState instance
 */
export function createFuzzyFilterState(): FuzzyFilterState {
  return {
    schema: null,
    columnTrie: createTrie<AnyColumnDefinition>(),
    operatorTrie: createTrie<OperatorAliasEntry>(),
    valueTrie: createTrie<{ value: string; columnId: ColumnId; rowCount: number }>(),
    data: [],
    dataVersion: 0,
    contextCache: new Map(),
  };
}

/**
 * Builds a map of available values per column from the given row indices.
 * This is used to constrain suggestions to only values that exist in the
 * filtered subset of data.
 *
 * @param contextRowIndices - Set of row indices matching the filter context
 * @param data - The full dataset
 * @param schema - The schema definition
 * @returns Map of column IDs to sets of available values by type
 */
export function buildContextAvailableValues(
  contextRowIndices: Set<number>,
  data: Array<Record<string, unknown>>,
  schema: Schema
): ContextAvailableValues {
  const map: ContextAvailableValues = new Map();
  
  for (const col of getColumns(schema)) {
    map.set(col.id, { strings: new Set(), numbers: new Set(), dates: new Set() });
  }
  
  for (const rowIdx of contextRowIndices) {
    const row = data[rowIdx];
    if (!row) continue;
    
    for (const col of getColumns(schema)) {
      const value = row[col.id as string];
      if (value == null) continue;
      
      const entry = map.get(col.id)!;
      if (col.type === DataType.STRING || col.type === DataType.ENUM) {
        entry.strings.add(String(value));
      } else if (col.type === DataType.NUMBER) {
        entry.numbers.add(Number(value));
      } else if (col.type === DataType.DATE) {
        entry.dates.add(new Date(value as string | number | Date).getTime());
      }
    }
  }
  
  return map;
}

/**
 * Computes the set of row indices that match all context filters.
 * Uses caching to avoid recomputing for the same filter context.
 *
 * @param state - The filter state
 * @param filterContext - Array of compiled filters to apply
 * @returns Tuple of [rowIndices, availableValues]
 */
export function computeFilterContext(
  state: FuzzyFilterState,
  filterContext?: CompiledFilter[]
): [Set<number> | null, ContextAvailableValues | null] {
  if (!filterContext || filterContext.length === 0) {
    return [null, null];
  }

  if (!state.schema) {
    return [null, null];
  }

  // Generate cache key from filter context
  // Sort by column ID to ensure order independence
  const cacheKey = filterContext
    .map((f) => `${f.columnId}:${f.operator}:${JSON.stringify(f.arguments)}`)
    .sort()
    .join("|");

  const cached = state.contextCache.get(cacheKey);
  if (cached && cached.dataVersion === state.dataVersion) {
    // Cache hit
    return [cached.rowIndices, cached.availableValues];
  }

  // Cache miss - compute and cache
  const contextRowIndices = new Set<number>();
  for (let i = 0; i < state.data.length; i++) {
    const row = state.data[i]!;
    let matchesAll = true;
    for (const filter of filterContext) {
      if (!filter.predicate(row)) {
        matchesAll = false;
        break;
      }
    }
    if (matchesAll) {
      contextRowIndices.add(i);
    }
  }

  const contextAvailableValues = buildContextAvailableValues(
    contextRowIndices,
    state.data,
    state.schema
  );

  // Store in cache (limit cache size to prevent memory bloat)
  if (state.contextCache.size >= 20) {
    // Remove oldest entry (first in map)
    const firstKey = state.contextCache.keys().next().value;
    if (firstKey) state.contextCache.delete(firstKey);
  }
  
  const cacheEntry: CachedContextResult = {
    rowIndices: contextRowIndices,
    availableValues: contextAvailableValues,
    dataVersion: state.dataVersion,
  };
  
  state.contextCache.set(cacheKey, cacheEntry);

  return [contextRowIndices, contextAvailableValues];
}
