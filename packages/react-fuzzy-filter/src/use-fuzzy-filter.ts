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
  /** Current suggestions */
  suggestions: FilterSuggestion[];
  /** Loading state */
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
  const [suggestions, setSuggestions] = useState<FilterSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Refs for cleanup
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();

  // Computed selected suggestion
  const selectedSuggestion = useMemo(() => {
    return suggestions[selectedIndex] ?? null;
  }, [suggestions, selectedIndex]);

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
        setSelectedIndex(0);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [filter, filterContext]
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
    setSuggestions([]);
    setSelectedIndex(0);
    setError(null);
    setIsLoading(false);
  }, []);

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
  };
}

