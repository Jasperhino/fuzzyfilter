/**
 * FuzzyFilter Type Definitions
 */

// Core types
export type {
  RowId,
  Match,
} from "./core.ts";

// Trie
export type { Trie } from "../trie.ts";

// Parsing types
export type {
  Token,
  TokenizeResult,
  TokenType,
  ParsedInput,
  ParsedDate,
  DateParseOptions,
} from "./parsing.ts";

// Result types
export type {
  FilterSuggestion,
  SuggestionResponse,
  CompiledFilter,
  FilterResult,
} from "./results.ts";

// Result formatting utilities
export { formatSuggestion, formatResponse } from "./results.ts";

// API types
export type {
  FuzzyFilterConfig,
  FuzzyFilter,
  CreateFuzzyFilter,
  ScoringWeights,
  UseFuzzyFilterState,
  UseFuzzyFilterActions,
  UseFuzzyFilterReturn,
  FuzzyFilterEvent,
  FuzzyFilterEventListener,
  FuzzyFilterEventEmitter,
} from "./api.ts";

// Field-centric types
export type {
  PredicateFn,
  OperatorOverload,
  FieldOperatorConfig,
  FieldSchema,
  ArgumentParseResult,
  ArgumentParser,
  ParserRegistry,
  FieldRegistry,
  ResolvedOverload,
  FieldCentricTranslations,
} from "./field-centric.ts";

// Telemetry types
export type {
  EventOutcome,
  WideEvent,
  WideEventBuilder,
  TelemetryConfig,
  TelemetryCollector,
  IndexProgress,
  IndexDataAsyncOptions,
} from "../telemetry/index.ts";

export { DEFAULT_TELEMETRY_CONFIG } from "../telemetry/index.ts";

// Unit types
export type {
  UnitDefinition,
  UnitRegistry,
  UnitRegistryConfig,
} from "../units/types.ts";

// Beam search / parsing types (re-exported for convenience)
export type {
  Chunking,
  Chunk,
  ChunkType,
  ChunkingStrategy,
  ParseMatch,
  MatchRole,
  ParsedValue,
  ScoreBreakdown,
} from "../parsing/types.ts";
