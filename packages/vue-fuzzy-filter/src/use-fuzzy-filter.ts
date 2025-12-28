/**
 * Vue Composable for FuzzyFilter
 *
 * Provides reactive state management for FuzzyFilter in Vue 3 applications
 * using the Composition API.
 *
 * @module vue-fuzzy-filter
 */

import { ref, computed, watch, onUnmounted, type Ref, type ComputedRef } from "vue";
import type { FuzzyFilter, FilterSuggestion, CompiledFilter } from "fuzzyfilter";

/**
 * Options for the useFuzzyFilter composable
 */
export interface UseFuzzyFilterOptions {
  /** Debounce delay in ms (default: 150) */
  debounceMs?: number;
  /** Initial query string */
  initialQuery?: string;
  /** Callback when a suggestion is applied */
  onApply?: (suggestion: FilterSuggestion) => void;
  /** Reactive filter context (already-applied filters for stacked counts) */
  filterContext?: Ref<CompiledFilter[]>;
}

/**
 * Return type for the useFuzzyFilter composable
 */
export interface UseFuzzyFilterReturn {
  /** Current query (v-model compatible) */
  query: Ref<string>;
  /** The query that the current suggestions were generated for (after debounce) */
  suggestionsQuery: Ref<string>;
  /** Current suggestions */
  suggestions: Ref<FilterSuggestion[]>;
  /** Loading state */
  isLoading: Ref<boolean>;
  /** Error state */
  error: Ref<Error | null>;
  /** Currently selected suggestion index */
  selectedIndex: Ref<number>;
  /** Currently selected suggestion (computed) */
  selectedSuggestion: ComputedRef<FilterSuggestion | null>;
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
 * Vue composable for using FuzzyFilter with automatic state management.
 *
 * Provides reactive state and actions for building filter interfaces
 * with Vue 3's Composition API.
 *
 * @param filter - The FuzzyFilter instance
 * @param options - Configuration options
 * @returns Reactive state and actions
 *
 * @example Basic usage
 * ```vue
 * <script setup lang="ts">
 * import { useFuzzyFilter } from "vue-fuzzy-filter";
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
 * const {
 *   query,
 *   suggestions,
 *   isLoading,
 *   selectedIndex,
 *   navigateSuggestions,
 *   applySuggestion,
 * } = useFuzzyFilter(filter);
 * </script>
 *
 * <template>
 *   <input
 *     v-model="query"
 *     @keydown.down.prevent="navigateSuggestions('down')"
 *     @keydown.up.prevent="navigateSuggestions('up')"
 *     @keydown.enter="applySuggestion"
 *   />
 *   <ul v-if="suggestions.length">
 *     <li
 *       v-for="(suggestion, i) in suggestions"
 *       :key="suggestion.id"
 *       :class="{ selected: i === selectedIndex }"
 *     >
 *       {{ suggestion.label }} ({{ suggestion.resultCount }} results)
 *     </li>
 *   </ul>
 * </template>
 * ```
 *
 * @example With options
 * ```typescript
 * const { query, suggestions, applySuggestion } = useFuzzyFilter(filter, {
 *   debounceMs: 200,
 *   initialQuery: "status",
 *   onApply: (suggestion) => {
 *     console.log("Applied:", suggestion.label);
 *   },
 * });
 * ```
 */
export function useFuzzyFilter(
  filter: FuzzyFilter,
  options: UseFuzzyFilterOptions = {}
): UseFuzzyFilterReturn {
  const { debounceMs = 150, initialQuery = "", onApply, filterContext } = options;

  // Reactive state
  const query = ref(initialQuery);
  const suggestionsQuery = ref(initialQuery);
  const suggestions = ref<FilterSuggestion[]>([]);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);
  const selectedIndex = ref(0);

  // Computed
  const selectedSuggestion = computed(() => {
    return suggestions.value[selectedIndex.value] ?? null;
  });

  // Internal refs for cleanup
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;

  /**
   * Fetch suggestions from the filter
   */
  async function fetchSuggestions(q: string) {
    // Cancel previous request
    abortController?.abort();
    abortController = new AbortController();

    isLoading.value = true;
    error.value = null;

    try {
      // Pass filter context for stacked filter counts
      const context = filterContext?.value ?? undefined;
      const response = await filter.suggest(q, undefined, context);
      suggestions.value = response.suggestions;
      suggestionsQuery.value = q;
      selectedIndex.value = 0;
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        error.value = err;
      }
    } finally {
      isLoading.value = false;
    }
  }

  // Watch query and filterContext changes with debounce
  watch(
    [query, filterContext ?? ref([])],
    ([newQuery]) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        fetchSuggestions(newQuery as string);
      }, debounceMs);
    },
    { immediate: true, deep: true }
  );

  /**
   * Set the query value
   */
  function setQuery(newQuery: string) {
    query.value = newQuery;
  }

  /**
   * Select a suggestion by index
   */
  function selectSuggestion(index: number) {
    const maxIndex = suggestions.value.length - 1;
    selectedIndex.value = Math.max(0, Math.min(index, maxIndex));
  }

  /**
   * Navigate suggestions up or down
   */
  function navigateSuggestions(direction: "up" | "down") {
    const length = suggestions.value.length;
    if (length === 0) return;

    if (direction === "down") {
      selectedIndex.value = (selectedIndex.value + 1) % length;
    } else {
      selectedIndex.value = (selectedIndex.value - 1 + length) % length;
    }
  }

  /**
   * Apply the currently selected suggestion
   */
  function applySuggestion() {
    const selected = suggestions.value[selectedIndex.value];
    if (selected) {
      query.value = selected.completionText;
      suggestions.value = [];
      onApply?.(selected);
    }
  }

  /**
   * Reset all state to initial values
   */
  function reset() {
    query.value = "";
    suggestionsQuery.value = "";
    suggestions.value = [];
    selectedIndex.value = 0;
    error.value = null;
    isLoading.value = false;
  }

  // Cleanup on unmount
  onUnmounted(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    abortController?.abort();
  });

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
  };
}

