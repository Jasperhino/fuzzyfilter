/**
 * FuzzyFilter Type Definitions
 */

// Core types (type-only exports)
export type {
  OperatorInfoBase,
  ColumnId,
  RowId,
  Match,
} from "./core.ts";

// Core values (DataType and OperatorCategory are both a value and type with same name)
export { DataType, OperatorCategory, columnId } from "./core.ts";

// Operator types (derived from registry)
export type { Operator, OperatorInfo } from "../operators/registry.ts";

// Schema types
export type {
  ColumnDefinition,
  StringColumnDefinition,
  NumberColumnDefinition,
  DateColumnDefinition,
  EnumColumnDefinition,
  BooleanColumnDefinition,
  ArrayColumnDefinition,
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

export { DEFAULT_SCORING_WEIGHTS } from "./hypothesis.ts";

// Result types
export type {
  FilterSuggestion,
  SuggestionGroup,
  SuggestionResponse,
  CompiledFilter,
  FilterResult,
  CountStrategy,
  CountOptions,
  CountResult,
  OperatorBitmapStrategy,
  CacheKey,
  CacheEntry,
  FilterCache,
} from "./results.ts";

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

export { DEFAULT_CONFIG } from "./api.ts";
