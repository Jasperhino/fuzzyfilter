# @fuzzyfilter/axiom-exporter

Export FuzzyFilter telemetry events to [Axiom](https://axiom.co) for benchmarking and performance analysis.

## Installation

```bash
bun add @fuzzyfilter/axiom-exporter
# or
npm install @fuzzyfilter/axiom-exporter
```

## Setup

1. Create an Axiom account at [axiom.co](https://axiom.co)
2. Create a dataset for your telemetry (e.g., `fuzzyfilter-benchmarks`)
3. Generate an API token with `Ingest` permission

## Usage

```typescript
import { createFuzzyFilter } from 'fuzzyfilter';
import { createAxiomExporter } from '@fuzzyfilter/axiom-exporter';

// Create exporter
const exporter = createAxiomExporter({
  apiToken: process.env.AXIOM_TOKEN!,
  dataset: 'fuzzyfilter-benchmarks',
  serviceName: 'my-app',
  environment: 'production',
});

// Create filter with benchmarking enabled
const filter = createFuzzyFilter({ benchmark: true });

// Attach exporter to telemetry collector
const telemetry = filter.getTelemetry();
if (telemetry) {
  exporter.attach(telemetry);
}

// Use filter normally - events are automatically sent to Axiom
filter.setSchema({ columns: [...] });
filter.indexData([...]);
await filter.suggest('status eq');

// Flush before app exit (in browsers, this happens automatically on beforeunload)
await exporter.flush();
```

## Configuration

```typescript
interface AxiomExporterConfig {
  /** Axiom API token (required) */
  apiToken: string;
  
  /** Axiom dataset name (required) */
  dataset: string;
  
  /** Optional service name for event enrichment */
  serviceName?: string;
  
  /** Optional environment tag (e.g., 'development', 'production') */
  environment?: string;
  
  /** Error callback for failed ingestion attempts */
  onError?: (error: Error) => void;
}
```

## Example APL Queries

Once data flows into Axiom, run powerful aggregate queries:

```apl
// P99 latency for suggest operations by token count
['fuzzyfilter-benchmarks']
| where operation == 'suggest'
| summarize p99_ms = percentile(duration_ms, 99) by ['query.token_count']
| order by ['query.token_count'] asc

// Average duration when query length exceeds 10 chars
['fuzzyfilter-benchmarks']
| where operation == 'suggest' and ['query.length'] > 10
| summarize avg_ms = avg(duration_ms), count = count()

// Error rate by operation type
['fuzzyfilter-benchmarks']
| summarize 
    total = count(),
    errors = countif(outcome == 'error')
  by operation
| extend error_rate = round(errors * 100.0 / total, 2)

// Top 10 slowest queries
['fuzzyfilter-benchmarks']
| where operation == 'suggest'
| top 10 by duration_ms desc
| project _time, ['query.text'], duration_ms, ['result.suggestion_count']
```

## License

MIT
