/**
 * FuzzyFilter - Intelligent Filter Suggestions for Data Tables
 *
 * A TypeScript library for building fuzzy filter interfaces with
 * field-centric configuration and operator overloads.
 *
 * @packageDocumentation
 * @module fuzzyfilter
 *
 * @example Quick Start
 * ```typescript
 * import { FuzzyFilter } from "@jasperhino/fuzzyfilter";
 * import z from "zod";
 *
 * const filter = new FuzzyFilter({
 *   fields: {
 *     status: {
 *       labelKey: 'columns.status',
 *       operandSchema: z.enum(['open', 'closed']),
 *       operators: [{
 *         operatorId: 'eq',
 *         overloads: [{
 *           id: 'status:eq:status',
 *           i18nKey: 'operators.eq',
 *           argumentSchema: z.object({ value: z.enum(['open', 'closed']) }),
 *           predicate: (operand, { value }) => operand === value,
 *         }],
 *       }],
 *     },
 *   },
 *   parsers: {},
 *   translations: {
 *     en: {
 *       columns: { status: ['Status'] },
 *       operators: { eq: ['equals', 'is', '='] },
 *     },
 *   },
 * });
 *
 * filter.indexData(myData);
 * const suggestions = await filter.suggest("stat");
 * ```
 */

// Type exports
export * from "./types/index.ts";

// Main factory and class
export { createFuzzyFilter, FuzzyFilterImpl as FuzzyFilter } from "./lib/index.ts";

// Field registry
export { FieldRegistry, createFieldRegistry } from "./field-registry.ts";

// Utilities
export { tokenize } from "./tokenizer.ts";
export { createTrie } from "./trie.ts";
export type { Trie } from "./trie.ts";

// Telemetry
export {
  createTelemetryCollector,
  NULL_TELEMETRY_COLLECTOR,
} from "./telemetry/index.ts";

// Units
export { createUnitRegistry } from "./units/index.ts";
export type { UnitDefinition, UnitRegistry, UnitRegistryConfig } from "./units/index.ts";

// Parsing (beam search)
export {
  generateChunkings,
  chunkInput,
  createValueParserRegistry,
  createParsedValue,
  extractNumbers,
  multiplyScores,
  createBeamSearchEngine,
} from "./parsing/index.ts";
export type {
  Chunk,
  Chunking,
  ParsedValue,
  ValueSuggestion,
  ParseMatch,
  ParseBeam,
  BeamSearchConfig,
  ValueParser,
  BeamSuggestion,
  BeamSearchDependencies,
  BeamSearchEngine,
  TrigramBag,
  PreparedCandidate,
} from "./parsing/index.ts";

// Trigrams
export {
  padText,
  buildTrigramBag,
  trigramSimilarity,
  trigramSimilarityString,
  createTrigramScorer,
  prepareCandidate,
  batchMatch,
} from "./parsing/index.ts";
