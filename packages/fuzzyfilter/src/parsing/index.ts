/**
 * Parsing Module
 *
 * Provides beam search-based parsing for fuzzy filter queries.
 *
 * @module fuzzyfilter/parsing
 */

// Types
export type {
  Chunk,
  ChunkType,
  Chunking,
  ChunkingStrategy,
  ParsedValue,
  ValueSuggestion,
  MatchRole,
  ParseMatch,
  ScoreBreakdown,
  ParseState,
  ParseBeam,
  BeamSearchConfig,
  ParseContext,
} from "./types";

// Chunker
export { generateChunkings, chunkInput } from "./chunker";

// Value Parser
export type { ValueParser, ValueParserRegistry } from "./value-parser";
export {
  createValueParserRegistry,
  createParsedValue,
  extractNumbers,
  extractUnitTextAfterNumber,
  multiplyScores,
} from "./value-parser";

// Beam Search
export type { BeamSuggestion, BeamSearchDependencies, BeamSearchEngine } from "./beam-search";
export { createBeamSearchEngine } from "./beam-search";

// Number With Unit Parser
export type { NumberWithUnit, NumberWithUnitParserConfig } from "./number-with-unit-parser";
export {
  createNumberWithUnitParser,
  createPercentageParser,
  createMassParser,
  createUniversalNumberParser,
} from "./number-with-unit-parser";

// Flexible Beam Search
export type {
  ValueTrieEntry,
  FlexibleBeamSearchDependencies,
  FlexibleBeamSuggestion,
  FlexibleBeamSearchEngine,
} from "./flexible-beam-search";
export { createFlexibleBeamSearchEngine } from "./flexible-beam-search";

// Candidate Engine (candidate-first approach)
export type {
  Candidate,
  ArgumentFilling,
  CandidateSuggestion,
  CandidateEngineDependencies,
  CandidateEngineConfig,
  CandidateEngine,
} from "./candidate-engine";
export { createCandidateEngine } from "./candidate-engine";

// Trigrams
export type { TrigramBag, PreparedCandidate } from "./trigrams";
export {
  padText,
  extractTrigrams,
  buildTrigramBag,
  trigramSimilarity,
  trigramSimilarityString,
  createTrigramScorer,
  prepareCandidate,
  batchMatch,
} from "./trigrams";
