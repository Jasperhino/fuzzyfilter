/**
 * FuzzyFilter Performance Benchmark Suite
 *
 * Uses mitata for microbenchmarking to measure performance of various operations.
 * Run with: bun run bench
 *
 * @module fuzzyfilter/benchmark
 */

import { run, bench, group } from "mitata";
import { heapStats } from "bun:jsc";
import { createFuzzyFilter } from "./fuzzy-filter.ts";
import { TASK_SCHEMA, generateLargeDataset } from "@fuzzyfilter/sample-data";

// ============================================================================
// DATA GENERATION
// ============================================================================

console.log("Generating test datasets...");
const SMALL_DATA = generateLargeDataset(100, 42);
const MEDIUM_DATA = generateLargeDataset(1000, 42);
const LARGE_DATA = generateLargeDataset(10000, 42);
const VERY_LARGE_DATA = generateLargeDataset(100000, 42);
console.log(`  Small: ${SMALL_DATA.length} rows`);
console.log(`  Medium: ${MEDIUM_DATA.length} rows`);
console.log(`  Large: ${LARGE_DATA.length} rows`);
console.log(`  Very Large: ${VERY_LARGE_DATA.length} rows`);
console.log("");

// ============================================================================
// TEST QUERIES
// ============================================================================

/**
 * Test queries covering different scenarios
 */
const QUERIES = {
  empty: "",
  singleWord: "status",
  twoWord: "status open",
  threeWord: "status is open",
  fuzzyTypo: "stauts", // typo for "status"
  operatorPhrase: "greater than",
  value: "Open",
  multiValue: "open closed",
  dateExpression: "last week",
  complexQuery: "priority between 1 and 3",
  longQuery: "status not in open closed blocked",
} as const;

// ============================================================================
// MEMORY MEASUREMENT UTILITIES
// ============================================================================

/**
 * Measures memory usage before and after running a function.
 */
function measureMemory(label: string, fn: () => void): void {
  Bun.gc(true); // Force GC before
  const before = heapStats();
  fn();
  Bun.gc(true); // Force GC after
  const after = heapStats();

  const heapDelta = after.heapSize - before.heapSize;
  const objectDelta = after.objectCount - before.objectCount;

  console.log(`${label}:`);
  console.log(
    `  Heap: ${formatBytes(before.heapSize)} → ${formatBytes(after.heapSize)} (${heapDelta >= 0 ? "+" : ""}${formatBytes(heapDelta)})`
  );
  console.log(`  Objects: ${before.objectCount} → ${after.objectCount} (${objectDelta >= 0 ? "+" : ""}${objectDelta})`);
}

/**
 * Formats bytes into human-readable string.
 */
function formatBytes(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes} B`;
  if (Math.abs(bytes) < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============================================================================
// BENCHMARK GROUPS
// ============================================================================

// Pre-create filters for benchmarks that need initialized state
const smallFilter = createFuzzyFilter();
smallFilter.setSchema(TASK_SCHEMA);
smallFilter.indexData(SMALL_DATA);

const mediumFilter = createFuzzyFilter();
mediumFilter.setSchema(TASK_SCHEMA);
mediumFilter.indexData(MEDIUM_DATA);

const largeFilter = createFuzzyFilter();
largeFilter.setSchema(TASK_SCHEMA);
largeFilter.indexData(LARGE_DATA);

const veryLargeFilter = createFuzzyFilter();
veryLargeFilter.setSchema(TASK_SCHEMA);
veryLargeFilter.indexData(VERY_LARGE_DATA);

// Create a filter context for context-aware benchmarks
const contextFilter = largeFilter.compileFilter("status", "eq", "Open");
const filterContext = contextFilter ? [contextFilter] : [];

// ----------------------------------------------------------------------------
// Initialization Benchmarks
// ----------------------------------------------------------------------------

group("Initialization", () => {
  bench("createFuzzyFilter()", () => {
    createFuzzyFilter();
  });

  bench("setSchema()", () => {
    const f = createFuzzyFilter();
    f.setSchema(TASK_SCHEMA);
  });
});

// ----------------------------------------------------------------------------
// Indexing Benchmarks
// ----------------------------------------------------------------------------

group("Indexing", () => {
  bench("100 rows", () => {
    const f = createFuzzyFilter();
    f.setSchema(TASK_SCHEMA);
    f.indexData(SMALL_DATA);
  });

  bench("1,000 rows", () => {
    const f = createFuzzyFilter();
    f.setSchema(TASK_SCHEMA);
    f.indexData(MEDIUM_DATA);
  });

  bench("10,000 rows", () => {
    const f = createFuzzyFilter();
    f.setSchema(TASK_SCHEMA);
    f.indexData(LARGE_DATA);
  });

  bench("100,000 rows", () => {
    const f = createFuzzyFilter();
    f.setSchema(TASK_SCHEMA);
    f.indexData(VERY_LARGE_DATA);
  });
});

// ----------------------------------------------------------------------------
// suggest() - Small Dataset
// ----------------------------------------------------------------------------

group("suggest() - Small Dataset (100 rows)", () => {
  bench("empty query", () => smallFilter.suggestSync(QUERIES.empty));
  bench("single word", () => smallFilter.suggestSync(QUERIES.singleWord));
  bench("two words", () => smallFilter.suggestSync(QUERIES.twoWord));
  bench("three words", () => smallFilter.suggestSync(QUERIES.threeWord));
  bench("fuzzy typo", () => smallFilter.suggestSync(QUERIES.fuzzyTypo));
  bench("operator phrase", () => smallFilter.suggestSync(QUERIES.operatorPhrase));
  bench("value", () => smallFilter.suggestSync(QUERIES.value));
  bench("multi-value", () => smallFilter.suggestSync(QUERIES.multiValue));
  bench("date expression", () => smallFilter.suggestSync(QUERIES.dateExpression));
  bench("complex query", () => smallFilter.suggestSync(QUERIES.complexQuery));
});

// ----------------------------------------------------------------------------
// suggest() - Medium Dataset
// ----------------------------------------------------------------------------

group("suggest() - Medium Dataset (1,000 rows)", () => {
  bench("empty query", () => mediumFilter.suggestSync(QUERIES.empty));
  bench("single word", () => mediumFilter.suggestSync(QUERIES.singleWord));
  bench("two words", () => mediumFilter.suggestSync(QUERIES.twoWord));
  bench("fuzzy typo", () => mediumFilter.suggestSync(QUERIES.fuzzyTypo));
  bench("multi-value", () => mediumFilter.suggestSync(QUERIES.multiValue));
  bench("date expression", () => mediumFilter.suggestSync(QUERIES.dateExpression));
  bench("complex query", () => mediumFilter.suggestSync(QUERIES.complexQuery));
});

// ----------------------------------------------------------------------------
// suggest() - Large Dataset
// ----------------------------------------------------------------------------

group("suggest() - Large Dataset (10,000 rows)", () => {
  bench("empty query", () => largeFilter.suggestSync(QUERIES.empty));
  bench("single word", () => largeFilter.suggestSync(QUERIES.singleWord));
  bench("two words", () => largeFilter.suggestSync(QUERIES.twoWord));
  bench("fuzzy typo", () => largeFilter.suggestSync(QUERIES.fuzzyTypo));
  bench("multi-value", () => largeFilter.suggestSync(QUERIES.multiValue));
  bench("date expression", () => largeFilter.suggestSync(QUERIES.dateExpression));
  bench("complex query", () => largeFilter.suggestSync(QUERIES.complexQuery));
  bench("long query", () => largeFilter.suggestSync(QUERIES.longQuery));
});

// ----------------------------------------------------------------------------
// suggest() - Very Large Dataset
// ----------------------------------------------------------------------------

group("suggest() - Very Large Dataset (100,000 rows)", () => {
  bench("empty query", () => veryLargeFilter.suggestSync(QUERIES.empty));
  bench("single word", () => veryLargeFilter.suggestSync(QUERIES.singleWord));
  bench("two words", () => veryLargeFilter.suggestSync(QUERIES.twoWord));
  bench("fuzzy typo", () => veryLargeFilter.suggestSync(QUERIES.fuzzyTypo));
  bench("multi-value", () => veryLargeFilter.suggestSync(QUERIES.multiValue));
  bench("date expression", () => veryLargeFilter.suggestSync(QUERIES.dateExpression));
  bench("complex query", () => veryLargeFilter.suggestSync(QUERIES.complexQuery));
  bench("long query", () => veryLargeFilter.suggestSync(QUERIES.longQuery));
});

// ----------------------------------------------------------------------------
// suggest() with Filter Context
// ----------------------------------------------------------------------------

group("suggest() with Filter Context (10,000 rows)", () => {
  bench("no context", () => largeFilter.suggestSync("priority"));
  bench("with 1 filter context", () =>
    largeFilter.suggestSync("priority", undefined, filterContext)
  );
});

// ----------------------------------------------------------------------------
// parse() Benchmarks
// ----------------------------------------------------------------------------

group("parse()", () => {
  bench("1 token", () => mediumFilter.parse("status"));
  bench("2 tokens", () => mediumFilter.parse("status open"));
  bench("3 tokens", () => mediumFilter.parse("status eq open"));
  bench("4 tokens", () => mediumFilter.parse("priority gt 3"));
  bench("5 tokens", () => mediumFilter.parse("priority between 1 and 3"));
  bench("6 tokens", () => mediumFilter.parse("status not in open closed"));
});

// ----------------------------------------------------------------------------
// compileFilter() + execute()
// ----------------------------------------------------------------------------

group("compileFilter() + execute() (10,000 rows)", () => {
  bench("equality filter", () => {
    const f = largeFilter.compileFilter("status", "eq", "Open");
    if (f) largeFilter.execute(f);
  });

  bench("contains filter", () => {
    const f = largeFilter.compileFilter("comments", "contains", "review");
    if (f) largeFilter.execute(f);
  });

  bench("range filter (between)", () => {
    const f = largeFilter.compileFilter("priority", "between", [1, 3]);
    if (f) largeFilter.execute(f);
  });

  bench("in filter (multi-value)", () => {
    const f = largeFilter.compileFilter("status", "in", ["Open", "Closed"]);
    if (f) largeFilter.execute(f);
  });
});

// ============================================================================
// RUN BENCHMARKS
// ============================================================================

console.log("Running benchmarks...\n");

await run({
  colors: true,
  // Uncomment for JSON output:
  // json: true,
});

// ============================================================================
// MEMORY PROFILING
// ============================================================================

console.log("\n--- Memory Profiling ---\n");

measureMemory("Create filter + setSchema", () => {
  const f = createFuzzyFilter();
  f.setSchema(TASK_SCHEMA);
});

measureMemory("Index 100 rows", () => {
  const f = createFuzzyFilter();
  f.setSchema(TASK_SCHEMA);
  f.indexData(SMALL_DATA);
});

measureMemory("Index 1,000 rows", () => {
  const f = createFuzzyFilter();
  f.setSchema(TASK_SCHEMA);
  f.indexData(MEDIUM_DATA);
});

measureMemory("Index 10,000 rows", () => {
  const f = createFuzzyFilter();
  f.setSchema(TASK_SCHEMA);
  f.indexData(LARGE_DATA);
});

measureMemory("Index 100,000 rows", () => {
  const f = createFuzzyFilter();
  f.setSchema(TASK_SCHEMA);
  f.indexData(VERY_LARGE_DATA);
});

console.log("\n--- Benchmark Complete ---\n");
