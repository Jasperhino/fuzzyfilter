/**
 * Scoring configuration constants
 * 
 * Centralizes all magic numbers used in scoring calculations to make tuning
 * the "feel" of the search easier without hunting through code.
 */

/**
 * Component weights for query explanation scoring.
 * 
 * These weights determine how much each component (column, operator, value)
 * contributes to the final score. The weights should sum to 1.0 for intuitive scoring
 * where a perfect match that explains the entire query scores 1.0.
 * 
 * Score = Σ (tokenCoverage × fuzzyQuality × componentWeight)
 */
export const SCORING_WEIGHTS = {
  /** Column match importance */
  COLUMN: 0.35,
  /** Operator match importance */
  OPERATOR: 0.2,
  /** Value match importance */
  VALUE: 0.45,
  /** Minimum score threshold to filter noise */
  THRESHOLD: 0.1,
} as const;

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
     * Base score for value-only suggestions (0-1 range)
     */
    VALUE_ONLY_BASE: 0.5,
    
    /**
     * Base score for date filter suggestions (0-1 range)
     */
    DATE_FILTER_BASE: 0.6,
    
    /**
     * Base score for complete date filter (above incomplete operator matches) (0-1 range)
     */
    DATE_FILTER_COMPLETE: 0.9,
    
    /**
     * Base score for spread pattern matches (e.g., "from X to Y") (0-1 range)
     */
    SPREAD_PATTERN_BASE: 0.95,
    
    /**
     * Maximum bonus for full query coverage (matching all tokens)
     */
    FULL_COVERAGE: 3000,
    
    /**
     * Maximum bonus for matching more of the target
     */
    COMPLETENESS: 1000,
    
    /**
     * Bonus for matching the full query with good quality
     */
    FULL_QUERY: 500,
    
    /**
     * Maximum bonus for exact match (case-insensitive)
     */
    EXACT_MATCH: 3000,
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
