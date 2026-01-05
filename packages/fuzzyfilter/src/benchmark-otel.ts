/**
 * FuzzyFilter OTel Benchmark Suite
 *
 * Runs comprehensive benchmarks and exports telemetry data to Axiom.
 * Uses the internal telemetry collector to capture phase-level timings.
 *
 * Usage:
 *   AXIOM_TOKEN=xxx bun run src/benchmark-otel.ts
 *
 * Environment Variables:
 *   AXIOM_TOKEN   - Required: Axiom API token with Ingest permission
 *   AXIOM_DATASET - Optional: Dataset name (default: fuzzyfilter-benchmarks)
 *   BENCHMARK_ENV - Optional: Environment tag (default: local)
 *   GIT_COMMIT    - Optional: Git SHA for regression tracking
 *
 * @module fuzzyfilter/benchmark-otel
 */

import { createFuzzyFilter } from "./fuzzy-filter/index.ts";
import { createAxiomExporter } from "@fuzzyfilter/axiom-exporter";
import { TASK_SCHEMA, generateLargeDataset } from "@fuzzyfilter/sample-data";
import type { TelemetryCollector, WideEvent } from "./telemetry/index.ts";

// ============================================================================
// TYPES
// ============================================================================

interface BenchmarkSession {
  session_id: string;
  git_commit?: string;
  machine_info: MachineInfo;
  started_at: string;
  completed_at?: string;
  scenario_count: number;
}

interface MachineInfo {
  os: string;
  arch: string;
  cpus: number;
  memory_gb: number;
  bun_version: string;
}

interface IndexingScenario {
  name: string;
  rows: number;
}

interface MutationScenario {
  name: string;
  action: "addRow" | "removeRow" | "removeRows";
  count: number;
}

interface QueryScenario {
  name: string;
  query: string;
  iterations: number;
  filterContext?: boolean;
}

interface CacheScenario {
  name: string;
  warmup: boolean;
  triggerInvalidation?: boolean;
}

// ============================================================================
// SCENARIOS
// ============================================================================

const INDEXING_SCENARIOS: IndexingScenario[] = [
  { name: "index_100", rows: 100 },
  { name: "index_1k", rows: 1_000 },
  { name: "index_10k", rows: 10_000 },
  { name: "index_100k", rows: 100_000 },
];

const MUTATION_SCENARIOS: MutationScenario[] = [
  { name: "add_single", action: "addRow", count: 1 },
  { name: "add_batch_10", action: "addRow", count: 10 },
  { name: "add_batch_100", action: "addRow", count: 100 },
  { name: "remove_single", action: "removeRow", count: 1 },
  { name: "remove_batch_50", action: "removeRows", count: 50 },
];

const QUERY_SCENARIOS: QueryScenario[] = [
  { name: "empty", query: "", iterations: 100 },
  { name: "single_token", query: "status", iterations: 100 },
  { name: "two_tokens", query: "status open", iterations: 100 },
  { name: "three_tokens", query: "status eq open", iterations: 100 },
  { name: "fuzzy_typo", query: "stauts", iterations: 100 },
  { name: "operator_phrase", query: "greater than", iterations: 100 },
  { name: "date_expression", query: "last week", iterations: 100 },
  { name: "complex", query: "priority between 1 and 3", iterations: 100 },
  { name: "with_context", query: "priority", filterContext: true, iterations: 100 },
  { name: "long_query", query: "status not in open closed blocked", iterations: 50 },
];

const CACHE_SCENARIOS: CacheScenario[] = [
  { name: "cold_cache", warmup: false },
  { name: "warm_cache", warmup: true },
  { name: "cache_invalidation", warmup: true, triggerInvalidation: true },
];

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get machine information for the benchmark session.
 */
function getMachineInfo(): MachineInfo {
  const os = require("os");
  return {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus().length,
    memory_gb: Math.round(os.totalmem() / (1024 ** 3) * 10) / 10,
    bun_version: Bun.version,
  };
}

/**
 * Try to get the current git commit hash.
 */
function getGitCommit(): string | undefined {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]);
    if (result.exitCode === 0) {
      return result.stdout.toString().trim();
    }
  } catch {
    // Ignore errors
  }
  return process.env.GIT_COMMIT;
}

/**
 * Emit a custom session event to the telemetry collector.
 */
function emitSessionEvent(
  telemetry: TelemetryCollector,
  eventType: "session_start" | "session_end",
  data: Record<string, unknown>
): void {
  const builder = telemetry.startEvent(eventType as WideEvent["operation"], data);
  builder.success();
}

// ============================================================================
// SCENARIO RUNNERS
// ============================================================================

/**
 * Run indexing scenarios to benchmark index building at different scales.
 */
async function runIndexingScenarios(
  scenarios: IndexingScenario[]
): Promise<void> {
  console.log("\n📊 Running Indexing Scenarios...");
  
  for (const { name, rows } of scenarios) {
    console.log(`  → ${name}: ${rows.toLocaleString()} rows`);
    
    // Create a fresh filter for each scenario
    const filter = createFuzzyFilter({ benchmark: true });
    filter.setSchema(TASK_SCHEMA);
    
    // Generate data and index
    const data = generateLargeDataset(rows, Date.now());
    filter.indexData(data);
    
    // Get telemetry for this run
    const summary = filter.getTelemetry()?.getSummary();
    const indexPhases = summary?.avgPhasesByOperation?.indexData;
    
    if (indexPhases) {
      console.log(`    ├─ counting: ${indexPhases.value_counting_ms}ms`);
      console.log(`    ├─ sorting:  ${indexPhases.value_sorting_ms}ms`);
      console.log(`    ├─ trie:     ${indexPhases.trie_building_ms}ms`);
      console.log(`    └─ i18n:     ${indexPhases.translation_insert_ms}ms`);
    }
    
    filter.destroy();
  }
}

/**
 * Run mutation scenarios to benchmark row add/remove with reindexing.
 */
async function runMutationScenarios(
  scenarios: MutationScenario[]
): Promise<void> {
  console.log("\n🔄 Running Mutation Scenarios...");
  
  // Create a filter with initial data
  const filter = createFuzzyFilter({ benchmark: true });
  filter.setSchema(TASK_SCHEMA);
  filter.indexData(generateLargeDataset(1_000, 42));
  
  for (const { name, action, count } of scenarios) {
    console.log(`  → ${name}: ${action} x${count}`);
    
    filter.getTelemetry()?.clear(); // Clear previous events
    
    if (action === "addRow") {
      const newRows = generateLargeDataset(count, Date.now());
      for (const row of newRows) {
        filter.addRow(row);
      }
    } else if (action === "removeRow") {
      for (let i = 0; i < count; i++) {
        filter.removeRow(0);
      }
    } else if (action === "removeRows") {
      let removed = 0;
      filter.removeRows(() => {
        if (removed < count) {
          removed++;
          return true;
        }
        return false;
      });
    }
    
    // Get mutation events
    const events = filter.getTelemetry()?.getEventsByOperation(action);
    if (events && events.length > 0) {
      const avgReindex = events.reduce((sum, e) => {
        const evt = e as { reindex_duration_ms?: number };
        return sum + (evt.reindex_duration_ms ?? 0);
      }, 0) / events.length;
      console.log(`    └─ avg reindex: ${avgReindex.toFixed(2)}ms`);
    }
    
    // Re-add data for next scenario
    filter.indexData(generateLargeDataset(1_000, 42));
  }
  
  filter.destroy();
}

/**
 * Run query scenarios to benchmark suggestion generation.
 */
async function runQueryScenarios(
  scenarios: QueryScenario[]
): Promise<void> {
  console.log("\n🔍 Running Query Scenarios...");
  
  // Create filter with medium dataset
  const filter = createFuzzyFilter({ benchmark: true });
  filter.setSchema(TASK_SCHEMA);
  filter.indexData(generateLargeDataset(10_000, 42));
  
  // Create a filter context for scenarios that need it
  const contextFilter = filter.compileFilter("status", "eq", "Open");
  const filterContext = contextFilter ? [contextFilter] : [];
  
  for (const { name, query, iterations, filterContext: useContext } of scenarios) {
    console.log(`  → ${name}: "${query}" x${iterations}`);
    
    filter.getTelemetry()?.clear(); // Clear previous events
    
    const context = useContext ? filterContext : undefined;
    
    for (let i = 0; i < iterations; i++) {
      filter.suggestSync(query, undefined, context);
    }
    
    // Get summary
    const summary = filter.getTelemetry()?.getSummary();
    const suggestPercentiles = summary?.percentilesByOperation?.suggest;
    const suggestPhases = summary?.avgPhasesByOperation?.suggest;
    
    if (suggestPercentiles) {
      console.log(`    ├─ p50: ${suggestPercentiles.p50}ms, p95: ${suggestPercentiles.p95}ms, p99: ${suggestPercentiles.p99}ms`);
    }
    if (suggestPhases) {
      const phases = [
        `tok=${suggestPhases.tokenize_ms?.toFixed(2)}`,
        `ctx=${suggestPhases.filter_context_ms?.toFixed(2)}`,
        `trie=${suggestPhases.trie_search_ms?.toFixed(2)}`,
        `strat=${suggestPhases.strategy_execution_ms?.toFixed(2)}`,
        `cnt=${suggestPhases.count_calculation_ms?.toFixed(2)}`,
      ].join(" ");
      console.log(`    └─ phases: ${phases}`);
    }
  }
  
  filter.destroy();
}

/**
 * Run cache scenarios to measure cache effectiveness.
 */
async function runCacheScenarios(
  scenarios: CacheScenario[]
): Promise<void> {
  console.log("\n💾 Running Cache Scenarios...");
  
  const filter = createFuzzyFilter({ benchmark: true });
  filter.setSchema(TASK_SCHEMA);
  filter.indexData(generateLargeDataset(10_000, 42));
  
  const contextFilter = filter.compileFilter("status", "eq", "Open");
  const filterContext = contextFilter ? [contextFilter] : [];
  
  for (const { name, warmup, triggerInvalidation } of scenarios) {
    console.log(`  → ${name}`);
    
    filter.getTelemetry()?.clear();
    
    if (warmup) {
      // Warm up the cache
      for (let i = 0; i < 10; i++) {
        filter.suggestSync("priority", undefined, filterContext);
      }
      filter.getTelemetry()?.clear(); // Clear warmup events
    }
    
    if (triggerInvalidation) {
      // Add a row to invalidate cache
      filter.addRow({ status: "Test", priority: 1, comments: "test", created: new Date() });
    }
    
    // Run the actual queries
    for (let i = 0; i < 50; i++) {
      filter.suggestSync("priority", undefined, filterContext);
    }
    
    // Count cache hits
    const events = filter.getTelemetry()?.getEventsByOperation("suggest");
    const cacheHits = events?.filter((e) => {
      const evt = e as { cache?: { context_cache_hit: boolean } };
      return evt.cache?.context_cache_hit === true;
    }).length ?? 0;
    
    const total = events?.length ?? 0;
    const hitRate = total > 0 ? (cacheHits / total * 100).toFixed(1) : 0;
    
    console.log(`    └─ cache hit rate: ${hitRate}% (${cacheHits}/${total})`);
  }
  
  filter.destroy();
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const sessionId = `bench_${Date.now()}`;
  const gitCommit = getGitCommit();
  const machineInfo = getMachineInfo();
  
  console.log("╔════════════════════════════════════════════╗");
  console.log("║     FuzzyFilter OTel Benchmark Suite      ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log(`\nSession: ${sessionId}`);
  console.log(`Git Commit: ${gitCommit ?? "unknown"}`);
  console.log(`Machine: ${machineInfo.os} (${machineInfo.cpus} CPUs, ${machineInfo.memory_gb}GB RAM)`);
  console.log(`Bun: v${machineInfo.bun_version}`);
  
  // Check for Axiom token
  const axiomToken = process.env.AXIOM_TOKEN;
  const axiomDataset = process.env.AXIOM_DATASET ?? "fuzzyfilter-bench";
  const benchmarkEnv = process.env.BENCHMARK_ENV ?? "local";
  
  if (!axiomToken) {
    console.log("\n⚠️  AXIOM_TOKEN not set - results will only be printed locally");
    console.log("   Set AXIOM_TOKEN=xxx to export results to Axiom\n");
  } else {
    console.log(`\n📤 Exporting to Axiom dataset: ${axiomDataset}`);
    console.log(`   Environment: ${benchmarkEnv}\n`);
  }
  
  // Create master filter for session-level telemetry
  const masterFilter = createFuzzyFilter({ benchmark: true });
  const telemetry = masterFilter.getTelemetry()!;
  
  // Attach Axiom exporter if token is available
  let exporter: ReturnType<typeof createAxiomExporter> | null = null;
  if (axiomToken) {
    exporter = createAxiomExporter({
      apiToken: axiomToken,
      dataset: axiomDataset,
      serviceName: "fuzzyfilter-benchmark",
      environment: benchmarkEnv,
    });
    exporter.attach(telemetry);
  }
  
  // Emit session start
  const session: BenchmarkSession = {
    session_id: sessionId,
    git_commit: gitCommit,
    machine_info: machineInfo,
    started_at: new Date().toISOString(),
    scenario_count: INDEXING_SCENARIOS.length + MUTATION_SCENARIOS.length + 
                    QUERY_SCENARIOS.length + CACHE_SCENARIOS.length,
  };
  emitSessionEvent(telemetry, "session_start", session);
  
  // Run all scenarios
  await runIndexingScenarios(INDEXING_SCENARIOS);
  await runMutationScenarios(MUTATION_SCENARIOS);
  await runQueryScenarios(QUERY_SCENARIOS);
  await runCacheScenarios(CACHE_SCENARIOS);
  
  // Emit session end
  emitSessionEvent(telemetry, "session_end", {
    session_id: sessionId,
    completed_at: new Date().toISOString(),
  });
  
  // Print summary
  const summary = telemetry.getSummary();
  console.log("\n════════════════════════════════════════════");
  console.log("                  SUMMARY                    ");
  console.log("════════════════════════════════════════════");
  console.log(`Total Events: ${summary.totalEvents}`);
  console.log(`Operations: ${JSON.stringify(summary.eventsByOperation, null, 2)}`);
  console.log(`Error Rate: ${summary.errorRate}%`);
  console.log("\nAverage Durations by Operation:");
  for (const [op, avg] of Object.entries(summary.avgDurationByOperation)) {
    console.log(`  ${op}: ${avg.toFixed(2)}ms`);
  }
  
  if (Object.keys(summary.percentilesByOperation).length > 0) {
    console.log("\nPercentiles:");
    for (const [op, stats] of Object.entries(summary.percentilesByOperation)) {
      console.log(`  ${op}: p50=${stats.p50}ms, p95=${stats.p95}ms, p99=${stats.p99}ms (n=${stats.count})`);
    }
  }
  
  // Flush to Axiom
  if (exporter) {
    console.log("\n📤 Flushing to Axiom...");
    await exporter.flush();
    exporter.detach();
    console.log("✅ Done!");
  }
  
  masterFilter.destroy();
  console.log("\n");
}

// Run the benchmark
main().catch(console.error);
