/**
 * Strategy interface for suggestion generation
 * 
 * Each strategy handles a specific pattern of user input and generates
 * appropriate filter suggestions.
 */

import type { FilterSuggestion } from "../../types/index.ts";
import type { SuggestionContext } from "../types.ts";

/**
 * Context for strategy execution
 */
export interface StrategyContext extends SuggestionContext {
  /** Column scores from n-gram matching */
  columnScores: Map<string, ColumnScoreEntry>;
  /** Operator scores from n-gram matching */
  operatorScores: Map<string, OpScoreEntry>;
  /** Value scores from n-gram matching */
  valueScores: Map<string, ValScoreEntry>;
}

/**
 * Column score entry
 */
export interface ColumnScoreEntry {
  breakdown: import("../types.ts").ScoreBreakdown;
  ngram: import("../types.ts").NgramWithMeta;
  matchedTarget: string;
  matchIndexes?: readonly number[];
}

/**
 * Operator score entry
 */
export interface OpScoreEntry {
  breakdown: import("../types.ts").ScoreBreakdown;
  operator: import("../../types/index.ts").Operator;
  forType?: import("../../types/index.ts").DataType;
  matchedAlias?: string;
  ngram: import("../types.ts").NgramWithMeta;
  matchedTarget: string;
  matchIndexes?: readonly number[];
}

/**
 * Value score entry
 */
export interface ValScoreEntry {
  breakdown: import("../types.ts").ScoreBreakdown;
  match: {
    value: {
      value: string;
      columnId: import("../../types/index.ts").ColumnId;
      rowCount: number;
    };
    score: number;
    indexes?: readonly number[];
  };
  sourceTokenText: string;
  ngram: import("../types.ts").NgramWithMeta;
  matchedTarget: string;
  matchIndexes?: readonly number[];
}

/**
 * Strategy interface for generating filter suggestions
 */
export interface SuggestionStrategy {
  /**
   * Determines if this strategy can handle the given context
   *
   * @param context - The suggestion context
   * @returns True if this strategy should be executed
   */
  canHandle(context: StrategyContext): boolean;

  /**
   * Generates filter suggestions for the given context
   *
   * @param context - The suggestion context
   * @returns Array of filter suggestions
   */
  generate(context: StrategyContext): FilterSuggestion[];
}
