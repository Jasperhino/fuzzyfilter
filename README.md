# FuzzyFilter

A powerful TypeScript library for building intelligent fuzzy filter interfaces with natural language support. Type-ahead suggestions, automatic result counting, and smart ranking powered by Roaring Bitmaps.

## Features

- 🔍 **Fuzzy Matching** - Typo-tolerant search for columns, operators, and values
- 📊 **Instant Counts** - Real-time result counts using Roaring Bitmaps
- 📅 **Natural Language Dates** - "last week", "yesterday", "next month" via chrono-node
- 🎯 **Smart Ranking** - Prioritizes complete matches over partial ones
- ⚡ **Fast Indexing** - Optimized for datasets with thousands of rows
- 🔧 **Type-Safe** - Full TypeScript support with branded types
- ⚛️ **React Ready** - Optional React hook for easy integration

## Installation

```bash
bun add fuzzyfilter
# or
npm install fuzzyfilter
# or
pnpm add fuzzyfilter
```

## Quick Start

```typescript
import { createFuzzyFilter, columnId } from "fuzzyfilter";

// 1. Create a filter instance
const filter = createFuzzyFilter();

// 2. Define your schema
filter.setSchema({
  columns: [
    { 
      id: columnId("status"), 
      name: "Status", 
      type: "enum", 
      values: ["Open", "In Progress", "Closed"] 
    },
    { 
      id: columnId("assignee"), 
      name: "Assignee", 
      type: "string",
      aliases: ["owner", "assigned to"] // Alternative names for fuzzy matching
    },
    { 
      id: columnId("priority"), 
      name: "Priority", 
      type: "number" 
    },
    { 
      id: columnId("createdAt"), 
      name: "Created At", 
      type: "date" 
    },
  ],
});

// 3. Index your data
filter.indexData([
  { status: "Open", assignee: "Alice Chen", priority: 3, createdAt: "2024-01-15" },
  { status: "In Progress", assignee: "Bob Smith", priority: 2, createdAt: "2024-02-01" },
  { status: "Closed", assignee: "Alice Chen", priority: 1, createdAt: "2024-01-20" },
]);

// 4. Get suggestions as the user types
const suggestions = await filter.suggest("alice");
console.log(suggestions);
// → [
//     { label: "Assignee = Alice Chen", resultCount: 2, score: 3501 },
//     ...
//   ]
```

## Core Concepts

### Schema Definition

Define your filterable columns with type information:

```typescript
import { columnId, type AnyColumnDefinition } from "fuzzyfilter";

const columns: AnyColumnDefinition[] = [
  // String column
  { 
    id: columnId("name"), 
    name: "Name", 
    type: "string" 
  },
  
  // Enum column with predefined values
  { 
    id: columnId("status"), 
    name: "Status", 
    type: "enum", 
    values: ["Open", "In Progress", "Closed", "Blocked"] 
  },
  
  // Number column with bounds
  { 
    id: columnId("priority"), 
    name: "Priority", 
    type: "number",
    min: 1,
    max: 5,
    isInteger: true
  },
  
  // Date column
  { 
    id: columnId("createdAt"), 
    name: "Created At", 
    type: "date",
    granularity: "day"
  },
  
  // Boolean column with custom labels
  { 
    id: columnId("isBlocked"), 
    name: "Is Blocked", 
    type: "boolean",
    trueLabel: "Blocked",
    falseLabel: "Not Blocked"
  },
];

filter.setSchema({ columns });
```

### Supported Operators

FuzzyFilter supports a comprehensive set of operators:

| Category | Operators | Applicable Types |
|----------|-----------|------------------|
| Equality | `eq`, `neq`, `eqIgnoreCase`, `neqIgnoreCase` | All types |
| Comparison | `lt`, `lte`, `gt`, `gte` | number, date |
| Set Membership | `in`, `nin` | All types |
| Pattern Matching | `contains`, `notContains`, `startsWith`, `endsWith` | string |
| Nullability | `isEmpty`, `isNotEmpty` | All types |
| Boolean | `isTrue`, `isFalse` | boolean |
| Date | `before`, `after`, `between` | date |

### Suggestions

Get intelligent suggestions as the user types:

```typescript
// Basic suggestion
const results = await filter.suggest("stat");
// → Status =, Status !=, Status contains...

// Operator-first query
const results = await filter.suggest("neq");
// → Status !=, Assignee !=, Priority !=...

// Value-first query  
const results = await filter.suggest("alice");
// → Assignee = Alice Chen

// Multi-word matching
const results = await filter.suggest("in progress");
// → Status = In Progress (ranked first!)

// Natural language dates
const results = await filter.suggest("created last week");
// → Created At > 2024-01-08
```

Each suggestion includes:

```typescript
interface FilterSuggestion {
  id: string;                    // Unique identifier
  label: string;                 // Display text: "Status = Open"
  parts: {                       // Structured parts for rich rendering
    column: { text: string };
    operator: { text: string; symbol?: string };
    argument?: { text: string };
  };
  column: AnyColumnDefinition;   // Column metadata
  operator: Operator;            // The operator
  value?: HypothesisValueType;   // The value (if any)
  resultCount: number;           // How many rows match
  score: number;                 // Ranking score (higher = better)
  isComplete: boolean;           // Is this a complete filter?
  completionText: string;        // Text to insert on selection
}
```

### Parsing & Compilation

Parse and compile filter expressions:

```typescript
// Parse user input
const parsed = filter.parse("status eq Open");
console.log(parsed);
// → { column: { match: {...} }, operator: { match: {...} }, value: {...} }

// Validate before execution
const validation = filter.validate("status eq");
console.log(validation);
// → { valid: false, errors: ["Operator 'equals' requires a value"] }

// Compile to executable filter
const compiled = filter.compile("status eq Open");
if (compiled) {
  // Use the predicate function
  const matches = myData.filter(compiled.predicate);
  
  // Or get matching row IDs
  const result = filter.execute(compiled);
  console.log(result.matchingRows); // [0, 3, 7]
}

// Compile from structured components
const programmatic = filter.compileFilter("status", "eq", "Open");
```

### React Integration

Use the optional React hook for easy integration:

```typescript
import { useFuzzyFilter } from "fuzzyfilter/react";

function FilterCombobox({ data, schema }) {
  const { 
    query, 
    setQuery, 
    suggestions, 
    isLoading,
    applySuggestion,
    selectedIndex,
    navigateSuggestions,
  } = useFuzzyFilter({ data, schema });

  return (
    <div>
      <input 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") navigateSuggestions("down");
          if (e.key === "ArrowUp") navigateSuggestions("up");
          if (e.key === "Enter") applySuggestion();
        }}
      />
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <ul>
          {suggestions.map((suggestion, i) => (
            <li 
              key={suggestion.id}
              data-selected={i === selectedIndex}
            >
              {suggestion.label} ({suggestion.resultCount} results)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Vue Integration

Use the optional Vue composable for Vue 3 applications:

```vue
<script setup lang="ts">
import { useFuzzyFilter } from "fuzzyfilter/vue";
import { createFuzzyFilter, columnId } from "fuzzyfilter";
import { onMounted } from "vue";

const props = defineProps<{ data: Array<Record<string, unknown>> }>();
const emit = defineEmits<{ "filter-applied": [FilterSuggestion] }>();

const filter = createFuzzyFilter();

onMounted(() => {
  filter.setSchema({
    columns: [
      { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
      { id: columnId("assignee"), name: "Assignee", type: "string" },
    ],
  });
  filter.indexData(props.data);
});

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
  onApply: (suggestion) => emit("filter-applied", suggestion),
});
</script>

<template>
  <div class="filter-combobox">
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
        {{ suggestion.label }} ({{ suggestion.resultCount }} results)
      </li>
    </ul>
  </div>
</template>
```

The Vue composable returns reactive refs that work seamlessly with `v-model` and Vue's reactivity system.

## Advanced Usage

### Configuration

Customize behavior with configuration options:

```typescript
const filter = createFuzzyFilter({
  maxSuggestions: 15,        // Max suggestions to return
  minScore: -5000,           // Minimum fuzzy match score
  debounceMs: 200,           // Debounce suggestion requests
  enableCache: true,         // Enable result caching
  maxCacheSize: 1000,        // Max cache entries
  debug: false,              // Enable debug logging
});

// Update configuration later
filter.configure({ maxSuggestions: 20 });
```

### Column Aliases

Add aliases for alternative names users might type:

```typescript
{
  id: columnId("createdAt"),
  name: "Created At",
  type: "date",
  aliases: ["created", "date", "when", "timestamp"]
}
```

### Incremental Updates

Update the index without re-indexing everything:

```typescript
// Update specific rows
filter.updateRows([
  { rowId: 5, oldData: { status: "Open" }, newData: { status: "Closed" } },
  { rowId: 10, newData: { status: "New" } }, // Insert
  { rowId: 3, oldData: { status: "Open" } }, // Delete
]);

// Get index statistics
const stats = filter.getIndexStats();
console.log(stats);
// → { totalRows: 1000, columnsIndexed: 6, uniqueValues: 234, indexSizeBytes: 45678 }
```

### Scoring System

FuzzyFilter uses a sophisticated scoring system that prioritizes:

1. **Coverage Bonus** - Matches using more of the input score higher
2. **Completeness Bonus** - Matches covering more of the target score higher
3. **Full Query Bonus** - Exact matches of the full query get a boost

```typescript
// "in progress" query results:
// 1. "Status = In Progress" → score: 3501 (uses both tokens)
// 2. "Status ∈" (in operator) → score: 2001 (only uses "in" token)
```

## API Reference

### `createFuzzyFilter(config?)`

Creates a new FuzzyFilter instance.

```typescript
const filter = createFuzzyFilter({
  maxSuggestions?: number,     // Default: 10
  minScore?: number,           // Default: -10000
  debounceMs?: number,         // Default: 150
  enableCache?: boolean,       // Default: true
  debug?: boolean,             // Default: false
});
```

### `filter.setSchema(schema)`

Sets the schema definition.

```typescript
filter.setSchema({
  columns: AnyColumnDefinition[],
  defaultColumns?: string[],  // Column IDs to show by default
});
```

### `filter.indexData(data)`

Indexes a dataset for searching and counting.

```typescript
filter.indexData(Array<Record<string, unknown>>);
```

### `filter.suggest(query, cursorPosition?)`

Gets filter suggestions for user input.

```typescript
const response = await filter.suggest("stat eq");
// response: {
//   query: string,
//   cursorPosition: number,
//   suggestions: FilterSuggestion[],
//   totalCount: number,
//   responseTimeMs: number,
// }
```

### `filter.compile(input)`

Compiles a filter expression string.

```typescript
const compiled = filter.compile("status eq Open");
// compiled: {
//   columnId: ColumnId,
//   operator: Operator,
//   argument: unknown,
//   predicate: (row) => boolean,
//   matchCount: number,
// }
```

### `filter.execute(compiled)`

Executes a compiled filter.

```typescript
const result = filter.execute(compiled);
// result: {
//   filter: CompiledFilter,
//   matchingRows: RowId[],
//   count: number,
//   executionTimeMs: number,
// }
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run example
cd example/shadcn-vite && bun dev
```

## License

MIT
