/**
 * Centralized scoring logic for fuzzy filter matching
 * 
 * All scoring calculations use constants from SCORING_CONFIG to make
 * tuning the "feel" of the search easier.
 */

import { SCORING_CONFIG } from "../constants.ts";
import type { NgramWithMeta, ScoreBreakdown } from "../types.ts";

/**
 * Adjust score based on how much of the query was matched
 * 
 * Fuzzysort scores: 0 = exact match, negative = worse match
 * We boost scores for longer n-gram matches to prefer "in progress" over "in"
 * 
 * Key principle: Matches that explain MORE of the query should score higher.
 * For example, "les eq" should prefer "lte" (via "less eq" alias) over "eq",
 * because "lte" explains both tokens while "eq" only explains one.
 *
 * @param baseScore - The raw fuzzysort score
 * @param ngram - The n-gram metadata
 * @param targetLength - Length of the target string being matched
 * @param matchedKey - Optional matched key for exact match detection
 * @returns Score breakdown with all components
 */
export function adjustScoreForCoverage(
  baseScore: number,
  ngram: NgramWithMeta,
  targetLength: number,
  matchedKey?: string
): ScoreBreakdown {
  const { PENALTY, BONUS, THRESHOLD } = SCORING_CONFIG;
  
  // Calculate coverage ratio (how much of the query this ngram represents)
  const coverageRatio = ngram.tokenCount / ngram.totalTokens;
  
  // Calculate match completeness (how well does query cover the target)
  const queryLength = ngram.text.length;
  const completenessRatio = Math.min(1, queryLength / targetLength);
  
  // POOR MATCH PENALTY: When the raw fuzzy score is very negative (poor match),
  // reduce the bonuses proportionally. This prevents fuzzy matches against long
  // strings (like comment text) from scoring too high due to bonuses alone.
  // A match with score -5000 is a poor match and should not compete with exact matches.
  // 
  // Quality factor: 1.0 for exact matches (score 0), scales down for worse matches
  // Score of -1000 gives 0.9 quality, -5000 gives 0.5, -10000 gives 0
  const qualityFactor = Math.max(0, 1 + (baseScore / PENALTY.POOR_MATCH_THRESHOLD));
  
  // Bonus for high coverage (using more of the input)
  // Max bonus of 3000 points for full coverage - this is the PRIMARY ranking factor
  // Matching more tokens is more valuable than a perfect match on fewer tokens
  // Scale by quality factor so poor matches don't get full bonuses
  const coverageBonus = Math.round(coverageRatio * BONUS.FULL_COVERAGE * qualityFactor);
  
  // Bonus for matching more of the target
  // Max bonus of 1000 points for complete match
  // Scale by quality factor
  const completenessBonus = Math.round(completenessRatio * BONUS.COMPLETENESS * qualityFactor);
  
  // TARGET COVERAGE PENALTY: When the query only covers a small portion of a long target,
  // apply a penalty. This ensures that matching "open" against "Open" (4/4 = 100%) scores
  // much higher than matching "open" against a 100-char comment (4/100 = 4%).
  // 
  // Penalty scales with how much of the target is NOT covered:
  // - 100% coverage (query covers full target) → no penalty
  // - 50% coverage → -1500 penalty
  // - 10% coverage → -2700 penalty
  // - 4% coverage (e.g., 4 chars in 100 char string) → -2880 penalty
  // 
  // Only apply penalty when target is significantly longer than query (> 2x)
  // to avoid penalizing normal fuzzy matches against similar-length strings.
  const targetCoveragePenalty = targetLength > queryLength * 2
    ? Math.round((1 - completenessRatio) * PENALTY.TARGET_COVERAGE)
    : 0;
  
  // Additional bonus if this is the full query AND it's a good match
  const fullQueryBonus = ngram.isFullQuery && baseScore >= THRESHOLD.FULL_QUERY_MIN_SCORE 
    ? BONUS.FULL_QUERY 
    : 0;
  
  // EXACT MATCH BONUS: When the n-gram text exactly matches the target (case-insensitive),
  // give a bonus scaled by coverage. An exact match on the full query gets the full bonus,
  // but an exact match on only part of the query gets a proportional bonus.
  // This ensures:
  // - "in" exactly matching "in" (full query) beats "in open" fuzzy matching "not in"
  // - "les eq" fuzzy matching "less eq" (2 tokens) beats "eq" exactly matching "eq" (1 token)
  const isExactMatch = matchedKey !== undefined && 
    ngram.text.toLowerCase() === matchedKey.toLowerCase();
  // Scale exact match bonus by coverage: exact match on 1 of 2 tokens = 1500, on 2 of 2 = 3000
  const exactMatchBonus = isExactMatch ? Math.round(BONUS.EXACT_MATCH * coverageRatio) : 0;
  
  const adjustedScore = baseScore + coverageBonus + completenessBonus + fullQueryBonus + exactMatchBonus + targetCoveragePenalty;
  
  return {
    rawScore: baseScore,
    coverageBonus,
    completenessBonus,
    fullQueryBonus,
    exactMatchBonus,
    targetCoveragePenalty,
    tokenCount: ngram.tokenCount,
    totalTokens: ngram.totalTokens,
    adjustedScore,
  };
}
