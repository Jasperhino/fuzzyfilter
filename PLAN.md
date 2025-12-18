# FuzzyFilter Implementation Plan

A TypeScript library for intelligent, fuzzy filter query parsing with bitmap-based counting and natural language date support.

## 📁 Project Structure

```
fuzzyfilter/
├── src/
│   ├── types/                    # ✅ Type definitions (DONE)
│   │   ├── core.ts              # Core types: DataType, Operator, ColumnId, Confidence
│   │   ├── schema.ts            # Schema & column definitions
│   │   ├── index-layer.ts       # Bitmap, InvertedIndex, Trie, RangeIndex
│   │   ├── parsing.ts           # Tokenization, classification, ParsedInput
│   │   ├── hypothesis.ts        # Hypothesis generation & scoring
│   │   ├── results.ts           # Suggestions, compiled filters, caching
│   │   ├── api.ts               # Public FuzzyFilter interface
│   │   └── index.ts             # Barrel export
│   │
│   ├── operators/               # ✅ Operator registry (DONE)
│   │   └── registry.ts          # All operators with metadata & aliases
│   │
│   ├── schema/                  # 🔲 Schema management
│   │   ├── builder.ts           # Schema builder API
│   │   └── validator.ts         # Schema validation
│   │
│   ├── index/                   # 🔲 Index layer implementation
│   │   ├── bitmap.ts            # Bitmap wrapper (roaring-wasm or native)
│   │   ├── inverted-index.ts    # Inverted index for value lookups
│   │   ├── trie.ts              # Trie for column/operator fuzzy matching
│   │   ├── range-index.ts       # B-tree/sorted index for numeric/date ranges
│   │   └── data-index.ts        # Composite index manager
│   │
│   ├── parser/                  # 🔲 Parsing layer
│   │   ├── tokenizer.ts         # Input tokenization
│   │   ├── classifier.ts        # Token classification (P(Col), P(Op), P(Val))
│   │   ├── date-parser.ts       # chrono-node integration
│   │   └── parser.ts            # Main parser combining all components
│   │
│   ├── hypothesis/              # 🔲 Hypothesis layer
│   │   ├── generator.ts         # Hypothesis generation (beam search)
│   │   ├── scorer.ts            # Scoring & ranking
│   │   ├── validator.ts         # Type-based validation
│   │   └── deduplicator.ts      # Deduplication logic
│   │
│   ├── execution/               # 🔲 Execution layer
│   │   ├── compiler.ts          # Compile hypothesis → filter
│   │   ├── bitmap-ops.ts        # Bitmap operations per operator
│   │   ├── counter.ts           # Count calculation
│   │   └── cache.ts             # LRU cache for filter results
│   │
│   ├── fuzzy-filter.ts          # 🔲 Main FuzzyFilter class
│   ├── index.ts                 # ✅ Library entry point
│   └── index.test.ts            # ✅ Test file (DONE)
│
├── package.json                 # ✅ Dependencies configured
├── tsconfig.json                # ✅ TypeScript config
├── CLAUDE.md                    # ✅ Bun conventions
├── PLAN.md                      # This file
└── README.md                    # Usage documentation
```

## 🏗️ Architecture Overview

### Layer 1: Index Layer
Fast data structures for lookups and counting.

| Component | Purpose | Key Methods |
|-----------|---------|-------------|
| **Bitmap** | Compressed row ID sets | `and`, `or`, `andNot`, `cardinality` |
| **InvertedIndex** | Token → Row mappings | `lookupExact`, `lookupFuzzy`, `lookupPrefix` |
| **Trie** | Column/Operator prefix matching | `insert`, `prefixSearch`, `fuzzySearch` |
| **RangeIndex** | Numeric/date range queries | `lessThan`, `greaterThan`, `between` |

### Layer 2: Parsing Layer
Tokenize input and classify tokens.

| Component | Purpose | Output |
|-----------|---------|--------|
| **Tokenizer** | Split input into tokens | `Token[]` |
| **Classifier** | Assign probabilities | `P(Col)`, `P(Op)`, `P(Val)` |
| **DateParser** | Parse natural language dates | `ParsedDate` |

### Layer 3: Hypothesis Layer
Generate and rank possible interpretations.

| Strategy | Trigger | Example |
|----------|---------|---------|
| **Column Dominant** | Input matches column name | "Stat" → Status eq/contains/... |
| **Operator Dominant** | Input matches operator | "neq" → [all columns] neq |
| **Value Dominant** | Input matches indexed value | "admin" → Role eq admin |
| **Full Parse** | Multi-token input | "Status eq Open" |

### Layer 4: Execution Layer
Compile filters and compute counts.

| Operator | Bitmap Strategy |
|----------|-----------------|
| `eq` | Direct lookup |
| `neq` | `universe AND NOT value` |
| `in` | `OR(value1, value2, ...)` |
| `lt/gt` | Range union |
| `contains` | N-gram index lookup |
| `isEmpty` | `universe AND NOT nonNull` |

---

## 📋 Implementation Order

### Phase 1: Core Infrastructure (Week 1)

#### 1.1 Bitmap Implementation
```typescript
// src/index/bitmap.ts
export function createBitmap(): Bitmap { ... }
export function bitmapAnd(a: Bitmap, b: Bitmap): Bitmap { ... }
// etc.
```

**Decision Point:** Use `roaring-wasm` for production, native `Set<number>` for small datasets.

#### 1.2 Trie Implementation
```typescript
// src/index/trie.ts
export class TrieImpl<T> implements Trie<T> {
  insert(key: string, value: T): void { ... }
  fuzzySearch(query: string, maxDistance: number): FuzzyMatch<T>[] { ... }
}
```

**Algorithm:** Use fuzzysort for Levenshtein-based fuzzy matching.

#### 1.3 Schema Builder
```typescript
// src/schema/builder.ts
export function createSchema(input: SchemaInput): Schema { ... }
export function validateSchema(schema: Schema): ValidationResult { ... }
```

### Phase 2: Indexing (Week 1-2)

#### 2.1 Inverted Index
```typescript
// src/index/inverted-index.ts
export class InvertedIndexImpl implements InvertedIndex {
  add(columnId: ColumnId, value: string, rowId: RowId): void { ... }
  lookupFuzzy(query: string): InvertedIndexEntry[] { ... }
}
```

**Optimization:** Store normalized (lowercase) versions for case-insensitive matching.

#### 2.2 Range Index
```typescript
// src/index/range-index.ts
export class RangeIndexImpl implements RangeIndex {
  // B-tree or sorted array + binary search
  lessThan(value: number): Bitmap { ... }
}
```

#### 2.3 Data Index Coordinator
```typescript
// src/index/data-index.ts
export class DataIndexImpl implements DataIndex {
  rebuild(data: Record<string, unknown>[]): void { ... }
  updateRow(rowId: RowId, oldData: object | null, newData: object | null): void { ... }
}
```

### Phase 3: Parsing (Week 2)

#### 3.1 Tokenizer
```typescript
// src/parser/tokenizer.ts
export function tokenize(input: string): TokenizeResult {
  // Handle quoted strings, whitespace, special chars
}
```

**Edge Cases:**
- Quoted strings: `"New York"` → single token
- Operators as symbols: `>=`, `!=` 
- Partial input: `Status eq ` (trailing space)

#### 3.2 Token Classifier
```typescript
// src/parser/classifier.ts
export function classifyToken(
  token: Token,
  schema: Schema,
  index: DataIndex
): TokenClassification { ... }
```

**Scoring:**
- Exact match: 1.0
- Case-insensitive: 0.95
- Prefix match: 0.8
- Fuzzy (edit distance 1): 0.7
- Fuzzy (edit distance 2): 0.5

#### 3.3 Date Parser (chrono-node)
```typescript
// src/parser/date-parser.ts
import * as chrono from "chrono-node";

export function parseDate(input: string, options?: DateParseOptions): ParsedDate | null {
  const results = chrono.parse(input, options?.referenceDate);
  // Convert to ParsedDate
}
```

**Supported Expressions:**
- Absolute: "2024-01-15", "January 15, 2024"
- Relative: "yesterday", "last week", "3 days ago"
- Ranges: "last month", "this quarter"

### Phase 4: Hypothesis Generation (Week 2-3)

#### 4.1 Generator
```typescript
// src/hypothesis/generator.ts
export class HypothesisGeneratorImpl implements HypothesisGenerator {
  generate(input: string): HypothesisGenerationResult {
    // 1. Tokenize & classify
    // 2. Identify dominant strategy
    // 3. Generate hypotheses based on strategy
    // 4. Validate & deduplicate
  }
}
```

**Beam Search Parameters:**
- Beam width: 10
- Pruning threshold: 0.3
- Max depth: 5 tokens

#### 4.2 Scorer
```typescript
// src/hypothesis/scorer.ts
export function scoreHypothesis(h: Hypothesis, weights: ScoringWeights): number {
  return (
    weights.column * h.matchConfidence.column +
    weights.operator * h.matchConfidence.operator +
    weights.argument * h.matchConfidence.argument +
    (h.orderBonus ? weights.orderBonus : 0) -
    (h.fragmentPenalty ? weights.fragmentPenalty : 0) +
    (h.isComplete ? weights.completenessBonus : 0)
  );
}
```

### Phase 5: Execution (Week 3)

#### 5.1 Filter Compiler
```typescript
// src/execution/compiler.ts
export function compileFilter(hypothesis: Hypothesis): CompiledFilter {
  return {
    columnId: hypothesis.column.id,
    operator: hypothesis.operator,
    argument: hypothesis.argument,
    predicate: createPredicate(hypothesis),
    bitmap: computeBitmap(hypothesis),
  };
}
```

#### 5.2 Bitmap Operations
```typescript
// src/execution/bitmap-ops.ts
export function computeBitmapForOperator(
  operator: Operator,
  columnId: ColumnId,
  value: unknown,
  index: DataIndex
): Bitmap | null {
  switch (operator) {
    case "eq": return index.invertedIndex.lookupExact(value);
    case "neq": return bitmapAndNot(index.allRowsBitmap, lookupExact(value));
    case "in": return bitmapOrMany(values.map(lookupExact));
    // etc.
  }
}
```

#### 5.3 Caching
```typescript
// src/execution/cache.ts
export class FilterCacheImpl implements FilterCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  
  get(key: CacheKey): CacheEntry | null { ... }
  set(key: CacheKey, bitmap: Bitmap, count: number): void { ... }
}
```

### Phase 6: Main API (Week 3-4)

#### 6.1 FuzzyFilter Class
```typescript
// src/fuzzy-filter.ts
export class FuzzyFilterImpl implements FuzzyFilter {
  private schema: Schema | null = null;
  private index: DataIndex;
  private parser: Parser;
  private generator: HypothesisGenerator;
  private cache: FilterCache;

  async suggest(query: string): Promise<SuggestionResponse> {
    // 1. Parse input
    // 2. Generate hypotheses
    // 3. Score & rank
    // 4. Calculate counts (lazy, top N only)
    // 5. Format as suggestions
  }
}

export function createFuzzyFilter(config?: Partial<FuzzyFilterConfig>): FuzzyFilter {
  return new FuzzyFilterImpl(config);
}
```

---

## 🧪 Testing Strategy

### Unit Tests
```typescript
// Each module gets its own test file
// src/index/bitmap.test.ts
// src/parser/tokenizer.test.ts
// etc.
```

### Integration Tests
```typescript
// src/integration.test.ts
test("suggest() returns ranked suggestions", async () => {
  const filter = createFuzzyFilter();
  filter.setSchema({ columns: [...] });
  filter.indexData(testData);
  
  const result = await filter.suggest("stat eq");
  expect(result.suggestions[0].label).toBe("Status eq ...");
});
```

### Edge Case Tests
- Empty input
- Partial operators: "eq" → all columns with eq
- Typos: "Stauts" → Status (fuzzy match)
- Date expressions: "last week", "2024-01"
- Quoted values: `name eq "John Doe"`
- Special characters
- Case sensitivity

---

## 🎯 Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Suggest (cold) | < 50ms | First suggestion on new input |
| Suggest (warm) | < 10ms | Cached schema/index |
| Count (bitmap) | < 1ms | Precomputed bitmaps |
| Index build | < 100ms | For 10k rows |

### Optimizations
1. **Lazy Count Calculation:** Only compute counts for top N hypotheses
2. **Bitmap Caching:** Cache frequently-used filter results
3. **Debouncing:** Client-side debounce (150ms default)
4. **Early Pruning:** Discard hypotheses below threshold before scoring

---

## 📦 Dependencies

| Package | Purpose | Status |
|---------|---------|--------|
| `fuzzysort` | Fuzzy string matching | ✅ Added |
| `chrono-node` | Natural language date parsing | ✅ Added |
| `roaring` | Native roaring bitmaps ([roaring-node](https://github.com/SalvatorePreviti/roaring-node)) | ✅ Added |

---

## 🔮 Future Enhancements

1. **Compound Filters:** AND/OR logic between multiple conditions
2. **Saved Filters:** Serialize/deserialize filter expressions
3. **React Hooks:** `useFuzzyFilter()` for easy integration
4. **Worker Thread:** Offload indexing to background thread
5. **Streaming Index:** Incremental indexing for large datasets

---

## 📚 References

- [Roaring Bitmaps Paper](https://arxiv.org/abs/1603.06549)
- [fuzzysort Algorithm](https://github.com/farzher/fuzzysort)
- [chrono-node Docs](https://github.com/wanasit/chrono)
- [Beam Search Algorithm](https://en.wikipedia.org/wiki/Beam_search)

