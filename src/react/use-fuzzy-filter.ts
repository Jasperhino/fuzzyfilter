/**
 * React Hook for FuzzyFilter
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type {
  FuzzyFilter,
  FilterSuggestion,
  UseFuzzyFilterState,
  UseFuzzyFilterActions,
  UseFuzzyFilterReturn,
} from "../types/index.ts";

export interface UseFuzzyFilterOptions {
  /** Debounce delay in ms */
  debounceMs?: number;
  /** Initial query */
  initialQuery?: string;
  /** Callback when a suggestion is applied */
  onApply?: (suggestion: FilterSuggestion) => void;
}

/**
 * React hook for using FuzzyFilter with automatic state management
 */
export function useFuzzyFilter(
  filter: FuzzyFilter,
  options: UseFuzzyFilterOptions = {}
): UseFuzzyFilterReturn {
  const { debounceMs = 150, initialQuery = "", onApply } = options;

  const [query, setQueryState] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<FilterSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();

  // Fetch suggestions with debounce
  const fetchSuggestions = useCallback(
    async (q: string) => {
      // Cancel previous request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      if (!q.trim()) {
        setSuggestions([]);
        setSelectedIndex(0);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await filter.suggest(q);
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
    [filter]
  );

  // Debounced query setter
  const setQuery = useCallback(
    (newQuery: string) => {
      setQueryState(newQuery);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        fetchSuggestions(newQuery);
      }, debounceMs);
    },
    [debounceMs, fetchSuggestions]
  );

  // Select a suggestion by index
  const selectSuggestion = useCallback(
    (index: number) => {
      setSelectedIndex(Math.max(0, Math.min(index, suggestions.length - 1)));
    },
    [suggestions.length]
  );

  // Navigate suggestions
  const navigateSuggestions = useCallback(
    (direction: "up" | "down") => {
      setSelectedIndex((prev) => {
        if (direction === "down") {
          return (prev + 1) % suggestions.length;
        } else {
          return (prev - 1 + suggestions.length) % suggestions.length;
        }
      });
    },
    [suggestions.length]
  );

  // Apply selected suggestion
  const applySuggestion = useCallback(() => {
    const selected = suggestions[selectedIndex];
    if (selected) {
      setQueryState(selected.completionText);
      setSuggestions([]);
      onApply?.(selected);
    }
  }, [suggestions, selectedIndex, onApply]);

  // Reset everything
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
    setQuery,
    selectSuggestion,
    navigateSuggestions,
    applySuggestion,
    reset,
  };
}

