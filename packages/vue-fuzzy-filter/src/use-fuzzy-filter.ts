/**
 * Vue Composable for FuzzyFilter
 *
 * Provides reactive state management for FuzzyFilter in Vue 3 applications
 * using the Composition API.
 *
 * @module vue-fuzzy-filter
 */

import { ref, computed, watch, onUnmounted, type Ref, type ComputedRef } from "vue";
import type { FuzzyFilter, FilterSuggestion, CompiledFilter, WideEvent, IndexProgress } from "fuzzyfilter";

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
  /** Loading state for suggestions */
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

  // -------------------------------------------------------------------------
  // New: Indexing state
  // -------------------------------------------------------------------------

  /** True while async indexing is in progress */
  isIndexing: Ref<boolean>;
  /** Progress of current indexing operation */
  indexProgress: Ref<IndexProgress | null>;
  /** Telemetry wide events (only when benchmark: true on FuzzyFilter) */
  telemetryEvents: Ref<WideEvent[]>;

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
 *
 * @example With async indexing and data mutations
 * ```typescript
 * const { isIndexing, indexProgress, addRow, deleteRow } = useFuzzyFilter(filter);
 *
 * // Show indexing indicator
 * if (isIndexing.value) {
 *   console.log(`Indexing... ${indexProgress.value?.percentage}%`);
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
  const { debounceMs = 150, initialQuery = "", onApply, filterContext } = options;

  // Reactive state
  const query = ref(initialQuery);
  const suggestionsQuery = ref(initialQuery);
  const suggestions = ref<FilterSuggestion[]>([]);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);
  const selectedIndex = ref(0);

  // New: Indexing state
  const isIndexing = ref(false);
  const indexProgress = ref<IndexProgress | null>(null);
  const telemetryEvents = ref<WideEvent[]>([]);

  // Computed
  const selectedSuggestion = computed(() => {
    return suggestions.value[selectedIndex.value] ?? null;
  });

  // Internal refs for cleanup
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;

  /**
   * Update telemetry events from the filter
   */
  function updateTelemetryEvents() {
    const telemetry = filter.getTelemetry();
    if (telemetry) {
      telemetryEvents.value = telemetry.getEvents();
    }
  }

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
      updateTelemetryEvents();
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

  /**
   * Add a row to the data
   */
  function addRow(row: Record<string, unknown>) {
    filter.addRow(row);
    updateTelemetryEvents();
    // Refetch suggestions to update counts
    fetchSuggestions(query.value);
  }

  /**
   * Delete a row by index
   */
  function deleteRow(index: number) {
    filter.removeRow(index);
    updateTelemetryEvents();
    // Refetch suggestions to update counts
    fetchSuggestions(query.value);
  }

  /**
   * Trigger async re-indexing
   */
  async function reindex(): Promise<void> {
    const data = filter.getData();
    isIndexing.value = true;
    indexProgress.value = null;

    try {
      await filter.indexDataAsync(data, {
        onProgress: (progress) => {
          indexProgress.value = progress;
        },
      });
      updateTelemetryEvents();
      // Refetch suggestions after reindex
      fetchSuggestions(query.value);
    } finally {
      isIndexing.value = false;
      indexProgress.value = null;
    }
  }

  /**
   * Get current data
   */
  function getData(): Array<Record<string, unknown>> {
    return filter.getData();
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
