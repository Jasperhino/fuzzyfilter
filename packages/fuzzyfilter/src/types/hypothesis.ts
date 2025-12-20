/**
 * Hypothesis Layer Types
 * Generating and ranking possible filter interpretations.
 */

import type { Operator } from "../operators.ts";
import type { AnyColumnDefinition } from "./schema.ts";
import type { Token, ParsedDate } from "./parsing.ts";
import type { RoaringBitmap } from "./index-layer.ts";

// ============================================================================
// HYPOTHESIS
// ============================================================================

/**
 * The type of a single argument value in a hypothesis.
 * For variadic operators (between, in), multiple values are stored as separate items in the arguments array.
 */
export type HypothesisValueType =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; value: Date; parsed: ParsedDate }
  | { kind: "null" }
  | { kind: "empty" }; // No value yet (for suggestions)

/**
 * A hypothesis represents a possible interpretation of user input
 * as a complete or partial filter expression.
 */
export interface Hypothesis {
  /** Unique ID for this hypothesis */
  id: string;

  /** The column this filter applies to */
  column: AnyColumnDefinition;

  /** The operator to apply */
  operator: Operator;

  /** The argument values (array to support variadic operators like between, in) */
  arguments?: HypothesisValueType[];

  /** Match scores for each component (from fuzzysort, higher = better) */
  scores: {
    column: number;
    operator: number;
    arguments: number;
  };

  /** Which tokens contributed to each component */
  sourceTokens: {
    column?: Token;
    operator?: Token;
    arguments?: Token[];
  };

  /** Is this hypothesis complete (has all required parts)? */
  isComplete: boolean;

  /** What's missing to complete this hypothesis? */
  missing: Array<"column" | "operator" | "arguments">;

  /** Did components appear in natural order (col → op → val)? */
  inOrder: boolean;

  /** Was operator inferred rather than explicitly matched? */
  operatorInferred: boolean;
}

// ============================================================================
// HYPOTHESIS SCORING
// ============================================================================

/**
 * Weights for scoring hypothesis components
 */
export interface ScoringWeights {
  /** Weight for column match score */
  column: number;
  /** Weight for operator match score */
  operator: number;
  /** Weight for arguments match score */
  arguments: number;
  /** Bonus for natural order (col → op → val) */
  orderBonus: number;
  /** Penalty for inferred operator */
  inferredPenalty: number;
  /** Bonus for complete hypothesis */
  completenessBonus: number;
}

/**
 * Default scoring weights
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  column: 0.4,
  operator: 0.35,
  arguments: 0.25,
  orderBonus: 0.1,
  inferredPenalty: 0.15,
  completenessBonus: 0.2,
} as const;

/**
 * A scored hypothesis ready for ranking
 */
export interface ScoredHypothesis {
  /** The hypothesis */
  hypothesis: Hypothesis;
  /** Final composite score */
  score: number;
  /** Result count (if computed) */
  resultCount?: number;
  /** The matching bitmap (for further operations) */
  bitmap?: RoaringBitmap;
}

// ============================================================================
// HYPOTHESIS GENERATION
// ============================================================================

/**
 * Strategy for generating hypotheses
 */
export type GenerationStrategy =
  | "columnDominant" // Input closely matches a column name
  | "operatorDominant" // Input closely matches an operator
  | "valueDominant" // Input matches a value in the index
  | "fullParse" // Input contains multiple components
  | "exploratory"; // Input is ambiguous, generate many hypotheses

/**
 * Options for hypothesis generation
 */
export interface HypothesisGenerationOptions {
  /** Maximum number of hypotheses to generate */
  maxHypotheses: number;
  /** Minimum score threshold to include */
  minScore: number;
  /** Which strategies to use */
  strategies: GenerationStrategy[];
  /** Include hypotheses for columns not in the index? */
  includeEmptyColumns: boolean;
  /** Maximum edit distance for fuzzy matching */
  maxEditDistance: number;
}

/**
 * Result of hypothesis generation
 */
export interface HypothesisGenerationResult {
  /** Generated hypotheses */
  hypotheses: Hypothesis[];
  /** Which strategy was dominant */
  dominantStrategy: GenerationStrategy;
  /** Time taken for generation (ms) */
  generationTimeMs: number;
}

// ============================================================================
// HYPOTHESIS GENERATOR INTERFACE
// ============================================================================

/**
 * Interface for the hypothesis generator
 */
export interface HypothesisGenerator {
  /** Generate hypotheses from parsed input */
  generate(
    input: string,
    options?: Partial<HypothesisGenerationOptions>
  ): HypothesisGenerationResult;

  /** Score hypotheses */
  score(
    hypotheses: Hypothesis[],
    weights?: Partial<ScoringWeights>
  ): ScoredHypothesis[];

  /** Filter out invalid hypotheses */
  validate(hypotheses: Hypothesis[]): Hypothesis[];

  /** Deduplicate hypotheses */
  deduplicate(hypotheses: Hypothesis[]): Hypothesis[];
}

// ============================================================================
// BEAM SEARCH STATE
// ============================================================================

/**
 * State in the beam search for parsing
 */
export interface BeamState {
  /** Current partial hypothesis */
  partial: Partial<Hypothesis>;
  /** Tokens consumed so far */
  consumedTokens: Token[];
  /** Remaining tokens */
  remainingTokens: Token[];
  /** Cumulative score */
  score: number;
  /** Path taken (for debugging) */
  path: Array<{
    action: "matchColumn" | "matchOperator" | "matchValue" | "infer";
    token?: Token;
    match?: string;
    score: number;
  }>;
}

/**
 * Options for beam search
 */
export interface BeamSearchOptions {
  /** Beam width (number of hypotheses to keep at each step) */
  beamWidth: number;
  /** Maximum depth (tokens to process) */
  maxDepth: number;
  /** Pruning threshold (discard below this score) */
  pruneThreshold: number;
}
