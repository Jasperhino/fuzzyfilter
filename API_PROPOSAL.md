# FuzzyFilter API Proposal

## Executive Summary

This document proposes the API design for the FuzzyFilter library. The design prioritizes developer experience through **automatic enum handling** and a **clean type system** that minimizes boilerplate while maintaining full type safety.

---

## Type System

### Built-in Types

The library provides first-class support for common data types:

| Type     | Description    | Parsing      | Formatting             |
| -------- | -------------- | ------------ | ---------------------- |
| `string` | Text values    | Pass-through | Pass-through           |
| `number` | Numeric values | `parseFloat` | `String()`             |
| `date`   | Date values    | `new Date()` | `toLocaleDateString()` |

### Enum Types (Automatic)

Native TypeScript enums and plain arrays work automatically when `values` is provided in the column definition. The library handles:

- **Parsing**: Matches user input against i18n aliases
- **Formatting**: Returns i18n keys for display
- **Comparison**: Uses array index order
- **Operators**: Equality operators (`eq`, `neq`, `in`, `notIn`) work automatically

```typescript
enum TrackingState {
  INCOMPLETE = 'incomplete',
  COMPLETE = 'complete',
  LOCKED = 'locked',
}

// Column definition - no wrapper class needed
{
  id: 'status',
  labelKey: 'columns.status',
  values: Object.values(TrackingState),
  valuesI18nPrefix: 'trackingState',
}
```

### Custom Types

For complex types requiring custom parsing/formatting logic, implement the `FuzzyFilterable` interface:

```typescript
interface FuzzyFilterable<T> {
  /** Format this value for display in suggestions */
  format(): string;
  
  /** Compare this value to another (-1, 0, 1) for range operators */
  compare(other: T): number;
}

interface FuzzyFilterableStatic<T extends FuzzyFilterable<T>> {
  /** Parse user input string into an instance */
  parse(input: string): T | null;
}
```

**Example: Amount type**

```typescript
class Amount implements FuzzyFilterable<Amount> {
  constructor(
    public readonly value: number,
    public readonly unit: string
  ) {}
  
  static parse(input: string): Amount | null {
    const match = input.match(/^([\d.]+)\s*(\w+)?$/);
    if (!match) return null;
    return new Amount(parseFloat(match[1]), match[2] ?? 'kg');
  }
  
  format(): string {
    return `${this.value} ${this.unit}`;
  }
  
  compare(other: Amount): number {
    return this.value - other.value;
  }
}
```

---

## Configuration

### FuzzyFilterConfig

```typescript
interface FuzzyFilterConfig<TCustom extends Record<string, FuzzyFilterable<any>>> {
  /** Column definitions */
  columns: ColumnDefinition<TypeMap<TCustom>>[];
  
  /** Custom operators (optional, defaults provided) */
  operators?: OperatorDefinition[];
  
  /** i18n provider for translations */
  i18n: I18nProvider;
  
  /** Maximum suggestions to return (default: 10) */
  maxSuggestions?: number;
}
```

### ColumnDefinition

```typescript
interface ColumnDefinition<TTypes> {
  /** Unique column identifier */
  id: string;
  
  /** i18n key for column label */
  labelKey: string;
  
  /** 
   * Data type - required for built-in types or custom FuzzyFilterable types.
   * Optional when `values` is provided (type inferred automatically).
   */
  type?: keyof TTypes;
  
  /** 
   * Predefined values for enum-like columns.
   * When provided, equality operators work automatically.
   */
  values?: unknown[];
  
  /** 
   * i18n key prefix for value labels.
   * Defaults to column id (e.g., 'status' → 'status.incomplete').
   */
  valuesI18nPrefix?: string;
}
```

---

## Internationalization

### I18nProvider Interface

```typescript
interface I18nProvider {
  /** Get all aliases for matching user input */
  getAliases(key: string): string[];
  
  /** Get primary display label for suggestions */
  getLabel(key: string): string;
  
  /** Current locale */
  locale: string;
}
```

### Translation Structure

```json
{
  "operators": {
    "eq": ["is", "equals"],
    "neq": ["is not", "not equals"],
    "gt": ["greater than", "more than", "above"],
    "gte": ["at least", "greater or equal"],
    "lt": ["less than", "below", "under"],
    "lte": ["at most", "less or equal"],
    "contains": ["contains", "includes", "has"],
    "in": ["in", "one of", "any of"],
    "notIn": ["not in", "none of"],
    "isEmpty": ["is empty", "empty", "blank"],
    "isNotEmpty": ["is not empty", "not empty", "exists"]
  },
  "columns": {
    "trackingState": "Tracking State",
    "weight": "Weight"
  },
  "trackingState": {
    "incomplete": "Incomplete",
    "complete": "Complete",
    "locked": "Locked"
  }
}
```

---

## Operators

### Default Operators

The library provides default operators for common operations:

| Operator  | Pattern                                             | Description       |
| --------- | --------------------------------------------------- | ----------------- |
| `eq`      | `t(operators.eq) {value}`                           | Equality          |
| `neq`     | `t(operators.neq) {value}`                          | Not equal         |
| `gt`      | `t(operators.gt) {value}`                           | Greater than      |
| `gte`     | `t(operators.gte) {value}`                          | Greater or equal  |
| `lt`      | `t(operators.lt) {value}`                           | Less than         |
| `lte`     | `t(operators.lte) {value}`                          | Less or equal     |
| `in`      | `t(operators.in) {values...}`                       | Value in list     |
| `notIn`   | `t(operators.notIn) {values...}`                    | Value not in list |
| `between` | `t(operators.between) {min} t(operators.and) {max}` | Range             |

### Custom Operators

```typescript
{
  id: 'overlaps',
  patterns: ['t(operators.overlaps) {start} t(operators.to) {end}'],
  predicates: {
    culaDate: (operand, { start, end }) => {
      return operand >= start && operand <= end;
    },
  },
}
```

---

## Data Management

### Indexing Data

```typescript
filter.indexData(records);
```

### Incremental Updates

```typescript
// Upsert rows (insert or update) - supports partial updates
filter.upsertRows([
  { rowId: 5, data: { status: TrackingState.COMPLETE } },
  { rowId: 10, data: { status: TrackingState.INCOMPLETE, weight: new Amount(100, 'kg') } },
]);

// Delete rows by ID
filter.deleteRows([3, 7, 12]);
```

---

## Complete Example

```typescript
import { createFuzzyFilter, DEFAULT_FUZZYFILTER_OPERATORS } from 'fuzzyfilter';

// Custom type
class Amount implements FuzzyFilterable<Amount> {
  constructor(public readonly value: number, public readonly unit: string) {}
  
  static parse(input: string): Amount | null {
    const match = input.match(/^([\d.]+)\s*(\w+)?$/);
    if (!match) return null;
    return new Amount(parseFloat(match[1]), match[2] ?? 'kg');
  }
  
  format(): string { return `${this.value} ${this.unit}`; }
  compare(other: Amount): number { return this.value - other.value; }
}

// Enum
enum TrackingState {
  INCOMPLETE = 'incomplete',
  COMPLETE = 'complete',
  LOCKED = 'locked',
}

// Create filter
const filter = createFuzzyFilter<{ amount: Amount }>({
  columns: [
    // Custom type
    { id: 'weight', labelKey: 'columns.weight', type: 'amount' },
    
    // Enum (automatic handling)
    {
      id: 'status',
      labelKey: 'columns.status',
      values: Object.values(TrackingState),
      valuesI18nPrefix: 'trackingState',
    },
    
    // Built-in types
    { id: 'name', labelKey: 'columns.name', type: 'string' },
    { id: 'quantity', labelKey: 'columns.quantity', type: 'number' },
    { id: 'createdAt', labelKey: 'columns.createdAt', type: 'date' },
  ],
  
  operators: [
    ...DEFAULT_FUZZYFILTER_OPERATORS,
    {
      id: 'overlaps',
      patterns: ['t(operators.overlaps) {start} t(operators.to) {end}'],
      predicates: {
        date: (operand, { start, end }) => operand >= start && operand <= end,
      },
    },
  ],
  
  i18n: i18nProvider,
  maxSuggestions: 12,
});

// Index data
filter.indexData(materialContainers);

// Query
await filter.suggest('status is incomplete');
// → [{ label: "Tracking State is Incomplete", ... }]

await filter.suggest('weight greater than 500kg');
// → [{ label: "Weight greater than 500 kg", ... }]

await filter.suggest('status in incomplete complete');
// → Matches items with INCOMPLETE or COMPLETE status

// Incremental updates
filter.upsertRows([
  { rowId: 5, data: { status: TrackingState.COMPLETE } },
]);

filter.deleteRows([3]);
```

---

## Design Decisions

### When to Use Each Type Approach

| Scenario                               | Approach                                    |
| -------------------------------------- | ------------------------------------------- |
| Simple text/number/date values         | Built-in types (`string`, `number`, `date`) |
| Fixed set of values (status, priority) | `values` array (automatic enum handling)    |
| Complex parsing logic (units, ranges)  | `FuzzyFilterable` implementation            |

### Type Safety

- TypeScript enforces `FuzzyFilterable` constraint for custom types at compile time
- Enum types are inferred from the `values` array
- Built-in types provide default parsing/formatting

