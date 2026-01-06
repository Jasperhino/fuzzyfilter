# fuzzyfilter-vue

Vue 3 composable for [FuzzyFilter](https://github.com/your-username/fuzzyfilter) - build intelligent filter interfaces with fuzzy matching and natural language support.

## Installation

```bash
bun add fuzzyfilter-vue fuzzyfilter
# or
npm install fuzzyfilter-vue fuzzyfilter
```

## Usage

```vue
<script setup lang="ts">
import { useFuzzyFilter } from "fuzzyfilter-vue";
import { createFuzzyFilter, columnId } from "@jasperhino/fuzzyfilter";
import { onMounted } from "vue";

// Create and configure the filter
const filter = createFuzzyFilter();

onMounted(() => {
  filter.setSchema({
    columns: [
      { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "In Progress", "Closed"] },
      { id: columnId("assignee"), name: "Assignee", type: "string" },
      { id: columnId("priority"), name: "Priority", type: "number" },
    ],
  });
  filter.indexData(myData);
});

// Use the composable
const {
  query,
  suggestions,
  isLoading,
  selectedIndex,
  navigateSuggestions,
  applySuggestion,
  reset,
} = useFuzzyFilter(filter, {
  debounceMs: 200,
  onApply: (suggestion) => {
    console.log("Filter applied:", suggestion.label);
  },
});
</script>

<template>
  <div class="filter-box">
    <input
      v-model="query"
      placeholder="Filter..."
      @keydown.down.prevent="navigateSuggestions('down')"
      @keydown.up.prevent="navigateSuggestions('up')"
      @keydown.enter.prevent="applySuggestion"
      @keydown.escape="reset"
    />

    <div v-if="isLoading">Loading...</div>

    <ul v-else-if="suggestions.length">
      <li
        v-for="(suggestion, index) in suggestions"
        :key="suggestion.id"
        :class="{ selected: index === selectedIndex }"
        @click="() => { selectSuggestion(index); applySuggestion(); }"
      >
        {{ suggestion.label }}
        <span class="count">{{ suggestion.resultCount }} results</span>
      </li>
    </ul>
  </div>
</template>
```

## API

### `useFuzzyFilter(filter, options?)`

#### Parameters

- `filter: FuzzyFilter` - A configured FuzzyFilter instance
- `options?: UseFuzzyFilterOptions`
  - `debounceMs?: number` - Debounce delay in ms (default: 150)
  - `initialQuery?: string` - Initial query value
  - `onApply?: (suggestion) => void` - Callback when a suggestion is applied

#### Returns

| Property              | Type                                    | Description                        |
| --------------------- | --------------------------------------- | ---------------------------------- |
| `query`               | `Ref<string>`                           | Current query (v-model compatible) |
| `suggestions`         | `Ref<FilterSuggestion[]>`               | Current suggestions                |
| `isLoading`           | `Ref<boolean>`                          | Loading state                      |
| `error`               | `Ref<Error \| null>`                    | Error state                        |
| `selectedIndex`       | `Ref<number>`                           | Selected suggestion index          |
| `selectedSuggestion`  | `ComputedRef<FilterSuggestion \| null>` | Currently selected suggestion      |
| `setQuery`            | `(query: string) => void`               | Set the query value                |
| `selectSuggestion`    | `(index: number) => void`               | Select a suggestion by index       |
| `navigateSuggestions` | `(direction: "up" \| "down") => void`   | Navigate suggestions               |
| `applySuggestion`     | `() => void`                            | Apply the selected suggestion      |
| `reset`               | `() => void`                            | Reset all state                    |

## License

MIT


