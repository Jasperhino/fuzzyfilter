# fuzzyfilter-react

React hook for [FuzzyFilter](https://github.com/your-username/fuzzyfilter) - build intelligent filter interfaces with fuzzy matching and type-aware suggestions.

## Installation

```bash
bun add fuzzyfilter fuzzyfilter-react
```

## Usage

```tsx
import { useFuzzyFilter } from "fuzzyfilter-react";
import { createFuzzyFilter, column  Id } from "@jasperhino/fuzzyfilter";

// Create and configure filter
const filter = createFuzzyFilter();
filter.setSchema({
  columns: [
    { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
    { id: columnId("priority"), name: "Priority", type: "number" },
    { id: columnId("assignee"), name: "Assignee", type: "string" },
  ],
});
filter.indexData(myData);

function FilterInput() {
  const {
    query,
    setQuery,
    suggestions,
    isLoading,
    selectedIndex,
    navigateSuggestions,
    applySuggestion,
  } = useFuzzyFilter(filter);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            navigateSuggestions("down");
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            navigateSuggestions("up");
          }
          if (e.key === "Enter") {
            applySuggestion();
          }
        }}
        placeholder="Filter..."
      />
      {isLoading && <span>Loading...</span>}
      <ul>
        {suggestions.map((suggestion, index) => (
          <li
            key={suggestion.id}
            className={index === selectedIndex ? "selected" : ""}
          >
            {suggestion.label} ({suggestion.resultCount} results)
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## With Stacked Filters (Filter Context)

When building filter interfaces with multiple stacked filters, pass the compiled filters as context to get accurate result counts:

```tsx
import { useState } from "react";
import { useFuzzyFilter } from "fuzzyfilter-react";
import type { CompiledFilter } from "@jasperhino/fuzzyfilter";

function MultiFilterInput() {
  const [appliedFilters, setAppliedFilters] = useState<CompiledFilter[]>([]);

  const { query, setQuery, suggestions } = useFuzzyFilter(filter, {
    filterContext: appliedFilters,
    onApply: (suggestion) => {
      // Compile and add the filter
      const compiled = filter.compileFilter(
        suggestion.column.id,
        suggestion.operator,
        suggestion.value?.value
      );
      if (compiled) {
        setAppliedFilters((prev) => [...prev, compiled]);
      }
    },
  });

  // Suggestion counts now reflect only rows matching all applied filters
  return (
    <div>
      {/* Applied filter badges */}
      {appliedFilters.map((f, i) => (
        <span key={i}>{f.expression}</span>
      ))}
      
      {/* Input and suggestions */}
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul>
        {suggestions.map((s) => (
          <li key={s.id}>{s.label} ({s.resultCount})</li>
        ))}
      </ul>
    </div>
  );
}
```

## API

### `useFuzzyFilter(filter, options?)`

#### Parameters

- `filter: FuzzyFilter` - The FuzzyFilter instance
- `options.debounceMs?: number` - Debounce delay in ms (default: 150)
- `options.initialQuery?: string` - Initial query string
- `options.onApply?: (suggestion) => void` - Callback when a suggestion is applied
- `options.filterContext?: CompiledFilter[]` - Already-applied filters for stacked counting

#### Returns

- `query: string` - Current query value
- `suggestions: FilterSuggestion[]` - Current suggestions
- `isLoading: boolean` - Loading state
- `error: Error | null` - Error state
- `selectedIndex: number` - Currently selected suggestion index
- `selectedSuggestion: FilterSuggestion | null` - Currently selected suggestion
- `setQuery(query: string)` - Set the query value
- `selectSuggestion(index: number)` - Select a suggestion by index
- `navigateSuggestions(direction: "up" | "down")` - Navigate suggestions
- `applySuggestion()` - Apply the selected suggestion
- `reset()` - Reset all state

