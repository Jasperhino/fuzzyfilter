/**
 * React Hook for FuzzyFilter
 *
 * Provides state management for FuzzyFilter in React applications.
 *
 * @module react-fuzzy-filter
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
  FuzzyFilter,
  FilterSuggestion,
  CompiledFilter,
  WideEvent,
  IndexProgress,
} from "fuzzyfilter";

/**
 * Options for the useFuzzyFilter hook
 */
export interface UseFuzzyFilterOptions {
  /** Debounce delay in ms (default: 150) */
  debounceMs?: number;
  /** Initial query string */
  initialQuery?: string;
  /** Callback when a suggestion is applied */
  onApply?: (suggestion: FilterSuggestion) => void;
  /** Filter context (already-applied filters for stacked counts) */
  filterContext?: CompiledFilter[];
}

/**
 * Return type for the useFuzzyFilter hook
 */
export interface UseFuzzyFilterReturn {
  /** Current query */
  query: string;
  /** The query that the current suggestions were generated for (after debounce) */
  suggestionsQuery: string;
  /** Current suggestions */
  suggestions: FilterSuggestion[];
  /** Loading state for suggestions */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Currently selected suggestion index */
  selectedIndex: number;
  /** Currently selected suggestion */
  selectedSuggestion: FilterSuggestion | null;
  /** Set the query (triggers suggestion fetch) */
  setQuery: (query: string) => void;
  /** Select a suggestion by index */
  selectSuggestion: (index: number) => void;
  /** Navigate suggestions up/down */
  navigateSuggestions: (direction: "up" | "down") => void;
  /** Apply the selected suggestion */
  applySuggestion: () => void;
  /** Reset all state */
  reset: () => void;

  // -------------------------------------------------------------------------
  // New: Indexing state
  // -------------------------------------------------------------------------

  /** True while async indexing is in progress */
  isIndexing: boolean;
  /** Progress of current indexing operation */
  indexProgress: IndexProgress | null;
  /** Telemetry wide events (only when benchmark: true on FuzzyFilter) */
  telemetryEvents: WideEvent[];

  // -------------------------------------------------------------------------
  // New: Data mutation methods
  // -------------------------------------------------------------------------

  /** Add a new row and re-index */
  addRow: (row: Record<string, unknown>) => void;
  /** Delete a row by index and re-index */
  deleteRow: (index: number) => void;
  /** Trigger async re-indexing of current data */
  reindex: () => Promise<void>;
  /** Get current data array */
  getData: () => Array<Record<string, unknown>>;
}

/**
 * React hook for using FuzzyFilter with automatic state management.
 *
 * Provides state and actions for building filter interfaces in React.
 *
 * @param filter - The FuzzyFilter instance
 * @param options - Configuration options
 * @returns State and actions
 *
 * @example Basic usage
 * ```tsx
 * import { useFuzzyFilter } from "react-fuzzy-filter";
 * import { createFuzzyFilter, columnId } from "fuzzyfilter";
 *
 * const filter = createFuzzyFilter();
 * filter.setSchema({
 *   columns: [
 *     { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
 *   ],
 * });
 * filter.indexData(myData);
 *
 * function FilterInput() {
 *   const {
 *     query,
 *     setQuery,
 *     suggestions,
 *     isLoading,
 *     selectedIndex,
 *     navigateSuggestions,
 *     applySuggestion,
 *   } = useFuzzyFilter(filter);
 *
 *   return (
 *     <div>
 *       <input
 *         value={query}
 *         onChange={(e) => setQuery(e.target.value)}
 *         onKeyDown={(e) => {
 *           if (e.key === "ArrowDown") navigateSuggestions("down");
 *           if (e.key === "ArrowUp") navigateSuggestions("up");
 *           if (e.key === "Enter") applySuggestion();
 *         }}
 *       />
 *       <ul>
 *         {suggestions.map((s, i) => (
 *           <li key={s.id} className={i === selectedIndex ? "selected" : ""}>
 *             {s.label} ({s.resultCount} results)
 *           </li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example With filter context for stacked counts
 * ```tsx
 * const [appliedFilters, setAppliedFilters] = useState<CompiledFilter[]>([]);
 *
 * const { query, suggestions, applySuggestion } = useFuzzyFilter(filter, {
 *   filterContext: appliedFilters,
 *   onApply: (suggestion) => {
 *     const compiled = filter.compileFilter(suggestion.column.id, suggestion.operator, suggestion.value?.value);
 *     if (compiled) setAppliedFilters(prev => [...prev, compiled]);
 *   },
 * });
 * // Suggestion counts now reflect the subset of data matching appliedFilters
 * ```
 *
 * @example With async indexing and data mutations
 * ```tsx
 * const { isIndexing, indexProgress, addRow, deleteRow } = useFuzzyFilter(filter);
 *
 * // Show indexing indicator
 * if (isIndexing) {
 *   return <div>Indexing... {indexProgress?.percentage}%</div>;
 * }
 *
 * // Add a new row
 * addRow({ status: "Open", assignee: "New Person" });
 *
 * // Delete row at index 5
 * deleteRow(5);
 * ```
 */
export function useFuzzyFilter(
  filter: FuzzyFilter,
  options: UseFuzzyFilterOptions = {}
): UseFuzzyFilterReturn {
  const {
    debounceMs = 150,
    initialQuery = "",
    onApply,
    filterContext,
  } = options;

  // State
  const [query, setQueryState] = useState(initialQuery);
  const [suggestionsQuery, setSuggestionsQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<FilterSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // New: Indexing state
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);
  const [telemetryEvents, setTelemetryEvents] = useState<WideEvent[]>([]);

  // Refs for cleanup
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);

  // Computed selected suggestion
  const selectedSuggestion = useMemo(() => {
    return suggestions[selectedIndex] ?? null;
  }, [suggestions, selectedIndex]);

  /**
   * Update telemetry events from the filter
   */
  const updateTelemetryEvents = useCallback(() => {
    const telemetry = filter.getTelemetry();
    if (telemetry) {
      setTelemetryEvents(telemetry.getEvents());
    }
  }, [filter]);

  /**
   * Fetch suggestions from the filter
   */
  const fetchSuggestions = useCallback(
    async (q: string) => {
      // Cancel previous request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setIsLoading(true);
      setError(null);

      try {
        // Pass filter context for stacked filter counts
        const response = await filter.suggest(q, undefined, filterContext);
        setSuggestions(response.suggestions);
        setSuggestionsQuery(q);
        setSelectedIndex(0);
        updateTelemetryEvents();
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [filter, filterContext, updateTelemetryEvents]
  );

  // Fetch suggestions when query or filterContext changes (with debounce)
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(query);
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, filterContext, debounceMs, fetchSuggestions]);

  /**
   * Set the query value
   */
  const setQuery = useCallback((newQuery: string) => {
    setQueryState(newQuery);
  }, []);

  /**
   * Select a suggestion by index
   */
  const selectSuggestion = useCallback(
    (index: number) => {
      const maxIndex = suggestions.length - 1;
      setSelectedIndex(Math.max(0, Math.min(index, maxIndex)));
    },
    [suggestions.length]
  );

  /**
   * Navigate suggestions up or down
   */
  const navigateSuggestions = useCallback(
    (direction: "up" | "down") => {
      const length = suggestions.length;
      if (length === 0) return;

      setSelectedIndex((prev) => {
        if (direction === "down") {
          return (prev + 1) % length;
        } else {
          return (prev - 1 + length) % length;
        }
      });
    },
    [suggestions.length]
  );

  /**
   * Apply the currently selected suggestion
   */
  const applySuggestion = useCallback(() => {
    const selected = suggestions[selectedIndex];
    if (selected) {
      setQueryState(selected.completionText);
      setSuggestions([]);
      onApply?.(selected);
    }
  }, [suggestions, selectedIndex, onApply]);

  /**
   * Reset all state to initial values
   */
  const reset = useCallback(() => {
    setQueryState("");
    setSuggestionsQuery("");
    setSuggestions([]);
    setSelectedIndex(0);
    setError(null);
    setIsLoading(false);
  }, []);

  /**
   * Add a row to the data
   */
  const addRow = useCallback(
    (row: Record<string, unknown>) => {
      filter.addRow(row);
      updateTelemetryEvents();
      // Refetch suggestions to update counts
      fetchSuggestions(query);
    },
    [filter, query, fetchSuggestions, updateTelemetryEvents]
  );

  /**
   * Delete a row by index
   */
  const deleteRow = useCallback(
    (index: number) => {
      filter.removeRow(index);
      updateTelemetryEvents();
      // Refetch suggestions to update counts
      fetchSuggestions(query);
    },
    [filter, query, fetchSuggestions, updateTelemetryEvents]
  );

  /**
   * Trigger async re-indexing
   */
  const reindex = useCallback(async () => {
    const data = filter.getData();
    setIsIndexing(true);
    setIndexProgress(null);

    try {
      await filter.indexDataAsync(data, {
        onProgress: (progress) => {
          setIndexProgress(progress);
        },
      });
      updateTelemetryEvents();
      // Refetch suggestions after reindex
      fetchSuggestions(query);
    } finally {
      setIsIndexing(false);
      setIndexProgress(null);
    }
  }, [filter, query, fetchSuggestions, updateTelemetryEvents]);

  /**
   * Get current data
   */
  const getData = useCallback(() => {
    return filter.getData();
  }, [filter]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      abortRef.current?.abort();
    };
  }, []);

  return {
    query,
    suggestionsQuery,
    suggestions,
    isLoading,
    error,
    selectedIndex,
    selectedSuggestion,
    setQuery,
    selectSuggestion,
    navigateSuggestions,
    applySuggestion,
    reset,
    // New
    isIndexing,
    indexProgress,
    telemetryEvents,
    addRow,
    deleteRow,
    reindex,
    getData,
  };
}
