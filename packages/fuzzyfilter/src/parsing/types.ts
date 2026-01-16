/**
 * Parsing Types
 *
 * Types for the beam search parsing pipeline.
 *
 * @module fuzzyfilter/parsing/types
 */

import type { Match } from "../types/core";
import type { FieldSchema, OperatorOverload } from "../types/field-centric";
import type { UnitDefinition } from "../units/types";

// =============================================================================
// CHUNKING TYPES
// =============================================================================

/**
 * Type of chunk based on content analysis.
 */
export type ChunkType =
  | "word" // Alphabetic text
  | "number" // Numeric text
  | "operator" // Operator symbols like >, <, =, >=
  | "mixed" // Mixed alphanumeric
  | "unknown"; // Unclassified

/**
 * A single chunk from tokenization.
 */
export interface Chunk {
  /** The raw text of this chunk */
  text: string;
  /** Start position in original input */
  start: number;
  /** End position in original input (exclusive) */
  end: number;
  /** Detected type of content */
  type: ChunkType;
}

/**
 * A complete chunking of the input with plausibility score.
 */
export interface Chunking {
  /** The chunks produced */
  chunks: Chunk[];
  /** Plausibility score [0,1] - how likely this is the intended chunking */
  plausibility: number;
  /** Which strategy produced this chunking */
  strategy: ChunkingStrategy;
}

/**
 * Strategy name for chunking.
 */
export type ChunkingStrategy =
  | "whitespace" // Split on whitespace only
  | "class-transition" // Split on character class changes
  | "none"; // No chunking (entire input as one chunk)

// =============================================================================
// PARSED VALUE TYPES
// =============================================================================

/**
 * A parsed value that may include a unit.
 */
export interface ParsedValue<T = unknown> {
  /** The parsed value */
  value: T;
  /** Unit match if applicable */
  unit?: Match<UnitDefinition>;
  /** Raw text that was parsed */
  rawText: string;
  /** Start position in original query */
  start: number;
  /** End position in original query */
  end: number;
  /** Parse quality score [0,1] */
  score: number;
}

/**
 * Suggestion for value autocompletion.
 */
export interface ValueSuggestion {
  /** Text to complete to */
  completion: string;
  /** Display label */
  label: string;
  /** Category of suggestion */
  category: "unit" | "value" | "example";
  /** Score for ranking [0,1] */
  score: number;
}

// =============================================================================
// BEAM SEARCH TYPES
// =============================================================================

/**
 * Role of a match in the filter expression.
 */
export type MatchRole = "field" | "operator" | "value" | "unit";

/**
 * Extended match with position and role information.
 * Used for autocompletion extraction.
 */
export interface ParseMatch {
  /** Original text from query */
  text: string;
  /** What it resolved to */
  resolvedTo: string;
  /** Match quality [0,1] */
  score: number;
  /** Character indexes for highlighting */
  indexes?: number[];
  /** Role in the filter expression */
  role: MatchRole;
  /** Start position in original query */
  start: number;
  /** End position in original query */
  end: number;
}

/**
 * Breakdown of score factors for debugging/explanation.
 */
export interface ScoreBreakdown {
  /** Chunking plausibility [0,1] */
  chunking: number;
  /** Field match score [0,1] */
  field: number;
  /** Operator match score [0,1] */
  operator: number;
  /** Value parse score [0,1] */
  valueParse: number;
  /** Unit match score [0,1] */
  unitMatch: number;
  /** Completeness penalty [0,1] - 0.95^(remaining chars) */
  completeness: number;
}

/**
 * Parse state during beam search.
 */
export type ParseState =
  | "chunking" // Initial state
  | "field" // Looking for field
  | "operator" // Looking for operator
  | "value" // Parsing values
  | "complete"; // Fully parsed

/**
 * A single interpretation beam during parsing.
 */
export interface ParseBeam {
  /** Unique beam ID for debugging */
  id: number;
  /** Original input string */
  input: string;
  /** Remaining unparsed text */
  remaining: string;
  /** Accumulated matches */
  matches: ParseMatch[];
  /** Current parse state */
  state: ParseState;
  /**
   * Composite score - ALWAYS multiplicative, stays in (0,1]
   *
   * score = chunkingPlausibility
   *       × fieldMatchScore
   *       × operatorMatchScore
   *       × valueParseScore
   *       × unitMatchScore
   *       × completeness
   */
  score: number;
  /** Score breakdown for debugging/explanation */
  scoreFactors: ScoreBreakdown;
  /** Resolved field if matched */
  field?: {
    key: string;
    schema: FieldSchema<unknown>;
  };
  /** Resolved operator if matched */
  operator?: {
    id: string;
    overloads: OperatorOverload<unknown, Record<string, unknown>>[];
  };
  /** Parsed values with optional units */
  parsedValues: ParsedValue[];
  /** The chunking used for this beam */
  chunking?: Chunking;
  /** Which chunk index we're currently processing */
  chunkIndex: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Configuration for the beam search engine.
 */
export interface BeamSearchConfig {
  /** Max parallel interpretations (default: 20) */
  maxBeams: number;
  /** Min score to keep beam (default: 0.1) */
  pruneThreshold: number;
  /** Prune beams scoring < best * ratio (default: 0.3) */
  earlyPruneRatio: number;
}

/**
 * Context passed to value parsers.
 */
export interface ParseContext {
  /** Current beam state */
  beam: ParseBeam;
  /** Field being parsed for (if known) */
  field?: FieldSchema<unknown>;
  /** Operator being used (if known) */
  operator?: OperatorOverload<unknown, Record<string, unknown>>;
}
