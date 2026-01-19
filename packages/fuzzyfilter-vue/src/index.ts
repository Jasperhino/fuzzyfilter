/**
 * Vue FuzzyFilter Composable
 *
 * A Vue 3 composable for building filter interfaces with FuzzyFilter.
 * Provides reactive state management using the Composition API.
 *
 * @module fuzzyfilter-vue
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useFuzzyFilter } from "fuzzyfilter-vue";
 * import { createFuzzyFilter, columnId } from "@jasperhino/fuzzyfilter";
 *
 * const filter = createFuzzyFilter();
 * filter.setSchema({
 *   columns: [
 *     { id: "status", name: "Status", type: "enum", values: ["Open", "Closed"] },
 *   ],
 * });
 * filter.indexData(myData);
 *
 * const { query, suggestions, applySuggestion } = useFuzzyFilter(filter);
 * </script>
 *
 * <template>
 *   <input v-model="query" @keydown.enter="applySuggestion" />
 *   <ul>
 *     <li v-for="s in suggestions" :key="s.id">{{ s.label }}</li>
 *   </ul>
 * </template>
 * ```
 */

export {
  useFuzzyFilter,
  type UseFuzzyFilterOptions,
  type UseFuzzyFilterReturn,
} from "./use-fuzzy-filter.ts";

// Re-export commonly used types from fuzzyfilter for convenience
export type {
  FuzzyFilter,
  FilterSuggestion,
} from "@jasperhino/fuzzyfilter";


