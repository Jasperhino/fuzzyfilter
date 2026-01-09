# FuzzyFilter

A powerful TypeScript library for building intelligent fuzzy filter interfaces with natural language support. Type-ahead suggestions, automatic result counting, and smart indexing and ranking powered by Roaring Bitmaps.

## Features

- 🔍 **Fuzzy Matching** - Typo-tolerant search for columns, operators, and values
- 📊 **Instant Counts** - Real-time result counts using Roaring Bitmaps
- 📅 **Natural Language Dates** - "last week", "yesterday", "next month" via chrono-node
- 🎯 **Smart Ranking** - Prioritizes complete matches over partial ones
- ⚡ **Fast Indexing** - Optimized for datasets with thousands of rows
- 🔧 **Type-Safe** - Full TypeScript support
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
import { createFuzzyFilter, createDefaultEnglishProvider } from "fuzzyfilter";

// Native TypeScript enums work automatically!
enum Status {
  OPEN = "Open",
  IN_PROGRESS = "In Progress",
  CLOSED = "Closed",
}

// 1. Create a filter instance with columns and i18n (V2 API)
const filter = createFuzzyFilter({
  columns: [
    { 
      id: "status", 
      labelKey: "columns.status", // i18n key for column label
      values: Object.values(Status), // Native enum - automatic handling!
      valuesI18nPrefix: "status", // Maps to "status.Open", "status.In Progress", etc.
    },
    { 
      id: "assignee", 
      labelKey: "columns.assignee",
      type: "string",
      aliases: ["owner", "assigned to"], // Alternative names for fuzzy matching
    },
    { 
      id: "priority", 
      labelKey: "columns.priority",
      type: "number" 
    },
    { 
      id: "createdAt", 
      labelKey: "columns.createdAt",
      type: "date" 
    },
  ],
  i18n: createDefaultEnglishProvider(), // Required in V2
});

// 2. Index your data
filter.indexData([
  { status: Status.OPEN, assignee: "Alice Chen", priority: 3, createdAt: "2024-01-15" },
  { status: Status.IN_PROGRESS, assignee: "Bob Smith", priority: 2, createdAt: "2024-02-01" },
  { status: Status.CLOSED, assignee: "Alice Chen", priority: 1, createdAt: "2024-01-20" },
]);

// 3. Get suggestions as the user types
const suggestions = await filter.suggest("alice");
console.log(suggestions);
// → [
//     { label: "Assignee = Alice Chen", resultCount: 2, score: 3501 },
//     ...
//   ]

// Equality operators work automatically with native enums!
const compiled = filter.compileFilter("status", "eq", Status.OPEN);
// → { predicate: (row) => row.status === Status.OPEN, matchCount: 1 }
```

## Core Concepts

### Schema Definition (V2 API)

Define your filterable columns with the new V2 API:

```typescript
import { createFuzzyFilter, createDefaultEnglishProvider } from "fuzzyfilter";

// Native TypeScript enums - no wrapper classes needed!
enum Status {
  OPEN = "Open",
  IN_PROGRESS = "In Progress",
  CLOSED = "Closed",
}

const filter = createFuzzyFilter({
  columns: [
    // String column
    { 
      id: "name", 
      labelKey: "columns.name", // i18n key (required)
      type: "string" 
    },
    
    // Native enum column - just provide values!
    { 
      id: "status", 
      labelKey: "columns.status",
      values: Object.values(Status), // Automatic enum handling!
      valuesI18nPrefix: "status", // Maps to "status.Open", etc.
    },
  
  // Number column with bounds
  { 
    id: "priority", 
    labelKey: "columns.priority", 
    type: "number",
    min: 1,
    max: 5,
    isInteger: true
  },
  
  // Date column
  { 
    id: "createdAt", 
    labelKey: "columns.createdAt", 
    type: "date",
    granularity: "day"
  },
  
  // Boolean column with custom labels
  { 
    id: "isBlocked", 
    labelKey: "columns.isBlocked", 
    type: "boolean",
    trueLabel: "Blocked",
    falseLabel: "Not Blocked"
  },
];

filter.setSchema({ columns });
```

### Supported Operators

FuzzyFilter supports a comprehensive set of operators:

| Category         | Operators                                           | Applicable Types |
| ---------------- | --------------------------------------------------- | ---------------- |
| Equality         | `eq`, `neq`, `eqIgnoreCase`, `neqIgnoreCase`        | All types        |
| Comparison       | `lt`, `lte`, `gt`, `gte`                            | number, date     |
| Set Membership   | `in`, `nin`                                         | All types        |
| Pattern Matching | `contains`, `notContains`, `startsWith`, `endsWith` | string           |
| Nullability      | `isEmpty`, `isNotEmpty`                             | All types        |
| Boolean          | `isTrue`, `isFalse`                                 | boolean          |
| Date             | `before`, `after`, `between`                        | date             |

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

For Vue 3 applications, use the separate [fuzzyfilter-vue](./packages/fuzzyfilter-vue) package:

```bash
bun add fuzzyfilter-vue fuzzyfilter
```

```vue
<script setup lang="ts">
import { useFuzzyFilter } from "fuzzyfilter-vue";
import { createFuzzyFilter, columnId } from "fuzzyfilter";

const filter = createFuzzyFilter();
// ... setup schema and data

const { query, suggestions, applySuggestion } = useFuzzyFilter(filter);
</script>

<template>
  <input v-model="query" @keydown.enter="applySuggestion" />
</template>
```

See the [fuzzyfilter-vue README](./packages/fuzzyfilter-vue/README.md) for full documentation.

## Advanced Usage

### Configuration

Customize behavior with configuration options:

```typescript
const filter = createFuzzyFilter({
  maxSuggestions: 15,        // Max suggestions to return
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

### Incremental Updates (V2 API)

Update the index without re-indexing everything:

```typescript
// Upsert (insert or update) rows
filter.upsertRows([
  { rowId: 5, data: { status: "Closed" } }, // Update existing row
  { rowId: 10, data: { status: "New" } }, // Insert new row
]);

// Delete rows
filter.deleteRows([3, 7]); // Delete rows with IDs 3 and 7

// Get index statistics
const stats = filter.getIndexStats();
console.log(stats);
// → { totalRows: 1000, columnsIndexed: 6, uniqueValues: 234, indexSizeBytes: 45678 }
```

## API Reference

### `createFuzzyFilter<TCustom>(config)` (V2 API)

Creates a new FuzzyFilter instance. In V2, `columns` and `i18n` are required.

```typescript
// With native enums (no generic needed)
const filter = createFuzzyFilter({
  columns: [
    { id: "status", labelKey: "columns.status", values: ["Open", "Closed"] },
  ],
  i18n: createDefaultEnglishProvider(), // Required
  maxSuggestions?: number,     // Default: 10
  minScore?: number,           // Default: -10000
  debounceMs?: number,         // Default: 150
  enableCache?: boolean,       // Default: true
  debug?: boolean,             // Default: false
});

// With custom FuzzyFilterable types
class Amount implements FuzzyFilterable<Amount> { ... }

const filter = createFuzzyFilter<{ amount: Amount }>({
  columns: [
    { id: "weight", labelKey: "columns.weight", type: "amount" },
  ],
  i18n: createDefaultEnglishProvider(),
});
```

### `filter.setSchema(schema)` (Optional in V2)

In V2, columns are defined in the config when creating the filter. You can still use `setSchema()` to update the schema after creation:

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

# Deploy
bun run deploy
```

## License

MIT
