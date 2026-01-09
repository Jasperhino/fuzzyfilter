/**
 * FuzzyFilter Type Definitions
 */

// Core types (type-only exports)
export type {
  OperatorDefinition,
  ColumnId,
  RowId,
  Match,
  FuzzyFilterable,
  FuzzyFilterableStatic,
  FuzzyFilterableConstructor,
  TypeHandler,
} from "./core.ts";

// Core values (DataType and OperatorCategory are both a value and type with same name)
export { DataType, OperatorCategory } from "./core.ts";

// Operator types (derived from registry)
export type { OperatorKey as Operator } from "../operators.ts";
export { OPERATORS, defaultFuzzyFilterOperators } from "../operators.ts";

// Pattern types for type-safe operator creation
export type {
  TypeRegistry,
  OperatorArgs,
  Prettify,
  PatternError,
} from "./pattern-types.ts";

// Schema types
export type {
  ColumnDefinition,
  AnyColumnDefinition,
  Schema,
  SchemaInput,
  OperatorMapping,
  ColumnMatch,
} from "./schema.ts";

// Index layer types
export type {
  RoaringBitmap,
  RoaringBitmapStatic,
  InvertedIndexEntry,
  InvertedIndex,
  Trie,
  RangeQueryResult,
  RangeIndex,
  DataIndex,
} from "./index-layer.ts";

// Parsing types
export type {
  Token,
  TokenizeResult,
  TokenType,
  TokenClassification,
  ColumnClassificationMatch,
  OperatorClassificationMatch,
  ValueClassificationMatch,
  ParsedInput,
  ParsedDate,
  DateParseOptions,
  Parser,
} from "./parsing.ts";

// Hypothesis types
export type {
  HypothesisValueType,
  Hypothesis,
  ScoringWeights,
  ScoredHypothesis,
  GenerationStrategy,
  HypothesisGenerationOptions,
  HypothesisGenerationResult,
  HypothesisGenerator,
  BeamState,
  BeamSearchOptions,
} from "./hypothesis.ts";

// Result types
export type {
  QueryMatch,
  FilterSuggestion,
  SuggestionGroup,
  SuggestionResponse,
  CompiledFilter,
  FilterResult,
  CountStrategy,
  CountResult,
  OperatorBitmapStrategy,
  CacheKey,
  CacheEntry,
  FilterCache,
} from "./results.ts";

// Score explanation types (for visualization)
export type {
  TokenScoreInfo,
  ScoreExplanation,
} from "../fuzzy-filter/engine/scorer.ts";

// API types
export type {
  FuzzyFilterConfig,
  FuzzyFilter,
  CreateFuzzyFilter,
  UseFuzzyFilterState,
  UseFuzzyFilterActions,
  UseFuzzyFilterReturn,
  FuzzyFilterEvent,
  FuzzyFilterEventListener,
  FuzzyFilterEventEmitter,
} from "./api.ts";

// Telemetry types (Wide Events)
export type {
  EventOutcome,
  WideEvent,
  WideEventBase,
  WideEventBuilder,
  WideEventCallback,
  TelemetryConfig,
  TelemetryCollector,
  IndexProgress,
  IndexDataAsyncOptions,
  // Specific event types
  SetSchemaEvent,
  IndexDataEvent,
  SuggestEvent,
  CompileEvent,
  DataMutationEvent,
  // Context types
  SchemaContext,
  DataContext,
  QueryContext,
  SuggestionResultContext,
  IndexingContext,
  ProgressContext,
} from "../telemetry/index.ts";

export { DEFAULT_TELEMETRY_CONFIG } from "../telemetry/index.ts";
