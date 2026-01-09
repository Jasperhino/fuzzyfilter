/**
 * Centralized scoring logic for fuzzy filter matching
 * 
 * NOTE: All scores are in fuzzysort v3 format (0-1 range):
 * - 1.0 = perfect match
 * - 0.5 = good match
 * - 0.0 = no match / threshold
 * 
 * The calculateSmartScore function can be used as a fuzzysort `scoreFn`
 * to apply density, position, and completeness adjustments during search.
 */

import { SCORING_WEIGHTS } from "../constants.ts";
import type { MatchMetadata } from "../types.ts";
import type { Token } from "../../types/index.ts";
import type { HypothesisValueType } from "../../types/index.ts";

// ============================================================================
// SCORE EXPLANATION TYPES
// ============================================================================

/**
 * Score information for a single token in the query.
 * Used for visualizing how each token contributes to the final score.
 */
export interface TokenScoreInfo {
  /** Index of this token in the query token array */
  tokenIndex: number;
  /** The text of this token */
  text: string;
  /** What component this token matched, or null if unmatched */
  matchType: "column" | "operator" | "value" | null;
  /** Fuzzy quality score for this match (0-1), 0 for unmatched */
  fuzzyQuality: number;
  /** 
   * Weighted contribution to the score.
   * For matched tokens: fuzzyQuality × componentWeight
   * For unmatched tokens: -1/totalTokens (coverage penalty)
   */
  weightedContribution: number;
}

/**
 * Complete breakdown of how a suggestion's score was calculated.
 * Enables visualization of per-token contributions and coverage penalties.
 */
export interface ScoreExplanation {
  /** Score info for each token in the query */
  tokenScores: TokenScoreInfo[];
  /** Ratio of explained tokens to total tokens (0-1) */
  coverageRatio: number;
  /** Sum of component contributions before coverage multiplier */
  componentSum: number;
  /** Final score: coverageRatio × componentSum */
  finalScore: number;
  /** Total number of tokens in the query */
  totalTokens: number;
  /** Number of tokens explained by the suggestion */
  explainedTokens: number;
}


/**
 * Calculates a "Smart Score" (0-1) by punishing sparsity and rewarding 
 * completeness and prefix matches.
 * 
 * This applies a multiplicative, density-aware scoring system that 
 * heavily penalizes scattered/sparse matches. It can be used as a 
 * fuzzysort `scoreFn` option to apply these adjustments during search.
 * 
 * Example usage with fuzzysort:
 * ```typescript
 * fuzzysort.go(query, targets, {
 *   scoreFn: r => calculateSmartScore(r.score, r.indexes, r.target)
 * })
 * ```
 * 
 * @param fuzzyScore - The fuzzysort score (0-1 range in v3, higher is better)
 * @param indexes - The matched character indexes from fuzzysort
 * @param targetText - The text we matched against (e.g., "Assignee")
 * @returns Smart score in 0-1 range (clamped)
 */
export function calculateSmartScore(
  fuzzyScore: number,
  indexes: readonly number[] | undefined,
  targetText: string
): number {
  // Safety check - no match means score of 0
  if (!indexes || indexes.length === 0) return 0;
  if (!targetText || targetText.length === 0) return 0;

  let score = fuzzyScore;

  // Density Penalty (The "Sparsity" Killer)
  // We compare the number of matched characters vs. the range they span.
  const firstIdx = indexes[0]!;
  const lastIdx = indexes[indexes.length - 1]!;
  
  const matchSpan = lastIdx - firstIdx + 1; // e.g. "a...z" = span of 4
  const matchCount = indexes.length;        // e.g. "az" = count of 2
  
  // Example: "abc" in "abc" -> 1.0 (Perfect)
  // Example: "a"....."b" in "alpha...beta" -> Low density
  const density = matchCount / matchSpan;

  // Square the density to aggressively punish gaps. 
  // A 0.5 density becomes a 0.25 multiplier.
  score *= Math.pow(density, 2);

  // Position Bias (Start of String)
  if (firstIdx === 0) {
    score *= 1.0; // Perfect start - no penalty
  } else {
    // Check for word boundary (preceded by space, dot, etc)
    const charBefore = targetText[firstIdx - 1];
    const isWordBoundary = charBefore ? /[\s_\-./\\]/.test(charBefore) : false;

    if (isWordBoundary) {
      score *= 0.95; // Slight penalty for word boundary match
    } else {
      score *= 0.6;  // Heavy penalty for mid-word match
    }
  }

  // Completeness Factor
  // Reward matches that cover a larger % of the target string
  if (targetText && targetText.length > 0) {
    const coverageOfTarget = matchCount / targetText.length;
    score *= (0.8 + (0.2 * coverageOfTarget));
  }

  return Math.max(0, Math.min(1, score));
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get tokens covered by a character range, excluding already-claimed tokens.
 * This prevents the same token from being counted by multiple components.
 * 
 * @param inputStart - Start position in the query string
 * @param inputEnd - End position in the query string
 * @param queryTokens - All tokens in the query
 * @param claimedTokens - Set of token indices already claimed by other components
 * @returns Set of newly covered token indices (not including already-claimed)
 */
function getUniqueTokensCovered(
  inputStart: number,
  inputEnd: number,
  queryTokens: Token[],
  claimedTokens: Set<number>
): Set<number> {
  const covered = new Set<number>();
  for (let i = 0; i < queryTokens.length; i++) {
    // Skip already claimed tokens - no reuse allowed
    if (claimedTokens.has(i)) continue;
    
    const token = queryTokens[i]!;
    // A token is covered if its range overlaps with the match range
    if (token.start < inputEnd && token.end > inputStart) {
      covered.add(i);
    }
  }
  return covered;
}

/**
 * Calculate fuzzy quality for a match component
 */
function calculateFuzzyQuality(
  score: number,
  matchIndexes: readonly number[] | undefined,
  matchedTarget: string
): number {
  if (matchIndexes && matchIndexes.length > 0) {
    return calculateSmartScore(score, matchIndexes, matchedTarget);
  }
  return  score
}

// ============================================================================
// QUERY EXPLANATION SCORING
// ============================================================================

/**
 * Calculate how well a suggestion "explains" the user's query.
 * 
 * NEW FORMULA: Score = coverageRatio × componentSum
 * 
 * Where:
 * - coverageRatio = explainedTokens / totalTokens (0-1)
 * - componentSum = Σ(fuzzyQuality × componentWeight) for each matched component
 * 
 * This formula penalizes unexplained tokens and prevents token reuse.
 * 
 * Example: "priority lt 3" (perfect match)
 * - Column covers "priority", Operator covers "lt", Value covers "3"
 * - Coverage: 3/3 = 1.0
 * - Components: (1.0 × 0.4) + (1.0 × 0.2) + (1.0 × 0.4) = 1.0
 * - Score = 1.0 × 1.0 = 1.0
 * 
 * Example: "priority lt 3 foo bar" (unexplained tokens)
 * - Same components, but 2 tokens unexplained
 * - Coverage: 3/5 = 0.6
 * - Components: 1.0
 * - Score = 0.6 × 1.0 = 0.6 (penalized for "foo" and "bar")
 * 
 * @param matchMetadata - What parts of the query matched column/operator/values
 * @param queryTokens - All tokens in the user's query
 * @param args - Suggestion arguments (for detecting numeric/date value coverage)
 * @returns Object with score (0-1) and detailed explanation for visualization
 */
export function calculateQueryExplanationScore(
  matchMetadata: MatchMetadata | undefined,
  queryTokens: Token[],
  args?: HypothesisValueType[]
): { score: number; explanation: ScoreExplanation } {
  const emptyExplanation: ScoreExplanation = {
    tokenScores: [],
    coverageRatio: 0,
    componentSum: 0,
    finalScore: 0,
    totalTokens: queryTokens.length,
    explainedTokens: 0,
  };

  if (!matchMetadata || queryTokens.length === 0) {
    return { score: 0, explanation: emptyExplanation };
  }

  const totalTokens = queryTokens.length;
  const claimedTokens = new Set<number>(); // Track unique tokens claimed (no reuse)
  let componentSum = 0;
  
  // Map token index to its match info
  const tokenMatchInfo = new Map<number, { matchType: "column" | "operator" | "value"; fuzzyQuality: number; weight: number }>();

  // Process column match
  if (matchMetadata.column) {
    const covered = getUniqueTokensCovered(
      matchMetadata.column.inputStart,
      matchMetadata.column.inputEnd,
      queryTokens,
      claimedTokens
    );
    
    if (covered.size > 0) {
      const fuzzyQuality = calculateFuzzyQuality(
        matchMetadata.column.score,
        matchMetadata.column.matchIndexes,
        matchMetadata.column.matchedTarget
      );
      
      componentSum += fuzzyQuality * SCORING_WEIGHTS.COLUMN;
      
      // Mark tokens as claimed and record their match info
      covered.forEach(idx => {
        claimedTokens.add(idx);
        tokenMatchInfo.set(idx, { 
          matchType: "column", 
          fuzzyQuality, 
          weight: SCORING_WEIGHTS.COLUMN 
        });
      });
    }
  }

  // Process operator match
  if (matchMetadata.operator) {
    const covered = getUniqueTokensCovered(
      matchMetadata.operator.inputStart,
      matchMetadata.operator.inputEnd,
      queryTokens,
      claimedTokens
    );
    
    if (covered.size > 0) {
      const fuzzyQuality = calculateFuzzyQuality(
        matchMetadata.operator.score,
        matchMetadata.operator.matchIndexes,
        matchMetadata.operator.matchedTarget
      );
      
      componentSum += fuzzyQuality * SCORING_WEIGHTS.OPERATOR;
      
      covered.forEach(idx => {
        claimedTokens.add(idx);
        tokenMatchInfo.set(idx, { 
          matchType: "operator", 
          fuzzyQuality, 
          weight: SCORING_WEIGHTS.OPERATOR 
        });
      });
    }
  }

  // Process value matches
  if (matchMetadata.values && matchMetadata.values.length > 0) {
    let totalValueQuality = 0;
    let valueMatchCount = 0;
    
    for (const valueMatch of matchMetadata.values) {
      const covered = getUniqueTokensCovered(
        valueMatch.inputStart,
        valueMatch.inputEnd,
        queryTokens,
        claimedTokens
      );
      
      if (covered.size > 0) {
        const fuzzyQuality = calculateFuzzyQuality(
          valueMatch.score,
          valueMatch.matchIndexes,
          valueMatch.matchedTarget
        );
        
        totalValueQuality += fuzzyQuality;
        valueMatchCount++;
        
        covered.forEach(idx => {
          claimedTokens.add(idx);
          tokenMatchInfo.set(idx, { 
            matchType: "value", 
            fuzzyQuality, 
            weight: SCORING_WEIGHTS.VALUE 
          });
        });
      }
    }
    
    if (valueMatchCount > 0) {
      const avgValueQuality = totalValueQuality / valueMatchCount;
      componentSum += avgValueQuality * SCORING_WEIGHTS.VALUE;
    }
  } else if (args && args.length > 0) {
    // For numeric/date values inferred from query (not from value index)
    let foundValue = false;
    
    for (const arg of args) {
      if (arg.kind === "number") {
        const valueStr = String(arg.value);
        for (let i = 0; i < queryTokens.length; i++) {
          if (claimedTokens.has(i)) continue;
          const token = queryTokens[i]!;
          if (token.text === valueStr) {
            claimedTokens.add(i);
            tokenMatchInfo.set(i, { 
              matchType: "value", 
              fuzzyQuality: 1.0, // Exact numeric match
              weight: SCORING_WEIGHTS.VALUE 
            });
            foundValue = true;
            break;
          }
        }
      } else if (arg.kind === "date") {
        // Date tokens are typically numeric
        for (let i = 0; i < queryTokens.length; i++) {
          if (claimedTokens.has(i)) continue;
          const token = queryTokens[i]!;
          if (!isNaN(parseFloat(token.text))) {
            claimedTokens.add(i);
            tokenMatchInfo.set(i, { 
              matchType: "value", 
              fuzzyQuality: 1.0, 
              weight: SCORING_WEIGHTS.VALUE 
            });
            foundValue = true;
          }
        }
      }
    }
    
    if (foundValue) {
      componentSum += 1.0 * SCORING_WEIGHTS.VALUE;
    }
  }

  // Calculate coverage ratio
  const explainedTokens = claimedTokens.size;
  const coverageRatio = explainedTokens / totalTokens;
  
  // Final score: coverage × component sum
  const finalScore = Math.max(0, Math.min(1, coverageRatio * componentSum));

  // Build per-token score breakdown for visualization
  const tokenScores: TokenScoreInfo[] = queryTokens.map((token, index) => {
    const matchInfo = tokenMatchInfo.get(index);
    
    if (matchInfo) {
      // Matched token: contributes positively
      return {
        tokenIndex: index,
        text: token.text,
        matchType: matchInfo.matchType,
        fuzzyQuality: matchInfo.fuzzyQuality,
        weightedContribution: matchInfo.fuzzyQuality * matchInfo.weight,
      };
    } else {
      // Unmatched token: represents coverage penalty
      // Each unmatched token costs -1/totalTokens of the potential score
      return {
        tokenIndex: index,
        text: token.text,
        matchType: null,
        fuzzyQuality: 0,
        weightedContribution: -1 / totalTokens, // Coverage penalty per token
      };
    }
  });

  const explanation: ScoreExplanation = {
    tokenScores,
    coverageRatio,
    componentSum,
    finalScore,
    totalTokens,
    explainedTokens,
  };

  return { score: finalScore, explanation };
}
