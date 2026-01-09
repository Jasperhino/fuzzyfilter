/**
 * React FuzzyFilter Hook
 *
 * A React hook for building filter interfaces with FuzzyFilter.
 * Provides state management and actions for fuzzy filter suggestions.
 *
 * @module fuzzyfilter-react
 *
 * @example
 * ```tsx
 * import { useFuzzyFilter } from "fuzzyfilter-react";
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
 * function App() {
 *   const { query, setQuery, suggestions, applySuggestion } = useFuzzyFilter(filter);
 *
 *   return (
 *     <div>
 *       <input value={query} onChange={(e) => setQuery(e.target.value)} />
 *       <ul>
 *         {suggestions.map((s) => (
 *           <li key={s.id}>{s.label}</li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
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
  CompiledFilter,
  OperatorDefinition,
} from "@jasperhino/fuzzyfilter";

// Re-export default collections for extending
export {
  OPERATORS,
  OPERATORS_ARRAY,
  DataType,
  InstanceRegistry,
} from "@jasperhino/fuzzyfilter";

