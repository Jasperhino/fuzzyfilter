/**
 * Scoring configuration constants
 * 
 * Centralizes all magic numbers used in scoring calculations to make tuning
 * the "feel" of the search easier without hunting through code.
 */

/**
 * Scoring configuration for fuzzy filter matching
 */
export const SCORING_CONFIG = {
  /**
   * Penalties applied to reduce scores for poor matches
   */
  PENALTY: {
    /**
     * Threshold below which a match is considered "poor"
     * Used to scale down bonuses for low-quality fuzzy matches
     */
    POOR_MATCH_THRESHOLD: -10000,
    
    /**
     * Maximum penalty for low target coverage
     * Applied when query only covers a small portion of a long target
     */
    TARGET_COVERAGE: -3000,
  },
  
  /**
   * Bonuses applied to increase scores for good matches
   */
  BONUS: {
    /**
     * Maximum bonus for high coverage (using more of the input)
     * This is the PRIMARY ranking factor - matching more tokens is more valuable
     */
    FULL_COVERAGE: 3000,
    
    /**
     * Maximum bonus for exact match (case-insensitive)
     * Scaled by coverage ratio
     */
    EXACT_MATCH: 3000,
    
    /**
     * Maximum bonus for match completeness (how well query covers target)
     */
    COMPLETENESS: 1000,
    
    /**
     * Bonus for matching the full query (when it's a good match)
     */
    FULL_QUERY: 500,
    
    /**
     * Bonus per value matched for variadic operators
     * Used when multiple values are matched for operators like "between"
     */
    MULTI_VALUE_PER_ITEM: 1500,
    
    /**
     * Base score for value-only suggestions
     */
    VALUE_ONLY_BASE: 1500,
    
    /**
     * Base score for date filter suggestions
     */
    DATE_FILTER_BASE: 4000,
    
    /**
     * Base score for complete date filter (above incomplete operator matches)
     */
    DATE_FILTER_COMPLETE: 5000,
    
    /**
     * Base score for spread pattern matches (e.g., "from X to Y")
     */
    SPREAD_PATTERN_BASE: 5500,
    
    /**
     * Base score for combined column + operator + value matches
     */
    COMBINED_MATCH_BASE: 8000,
    
    /**
     * Bonus for value coverage (how many values matched vs total tokens)
     */
    VALUE_COVERAGE: 1000,
    
    /**
     * Bonus for token coverage in value inference
     */
    TOKEN_COVERAGE: 2500,
    
    /**
     * Bonus for argument coverage (variadic operators)
     */
    ARGUMENT_COVERAGE: 1500,
    
    /**
     * Bonus for matching additional components beyond just value
     */
    ADDITIONAL_COMPONENT: 1500,
  },
  
  /**
   * Thresholds for score comparisons
   */
  THRESHOLD: {
    /**
     * Minimum score for full query bonus
     */
    FULL_QUERY_MIN_SCORE: -1000,
    
    /**
     * Score multiplier threshold for operator overlap filtering
     * If one operator uses more tokens and scores >= this ratio of another, prefer it
     */
    OPERATOR_OVERLAP_RATIO: 0.8,
  },
} as const;
