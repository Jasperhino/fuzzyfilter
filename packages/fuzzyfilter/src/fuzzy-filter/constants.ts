/**
 * Scoring configuration constants
 * 
 * Centralizes all magic numbers used in scoring calculations to make tuning
 * the "feel" of the search easier without hunting through code.
 * 
 * NOTE: All scores are in the 0-1 range (fuzzysort v3 format).
 * - 1.0 = perfect match
 * - 0.5 = good match
 * - 0.0 = no match / threshold
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
  /** Minimum score threshold to filter noise (0-1 range) */
  THRESHOLD: 0.1,
} as const;

/**
 * Scoring configuration for fuzzy filter matching.
 * All values are in 0-1 range (fuzzysort v3 format).
 */
export const SCORING_CONFIG = {
  /**
   * Thresholds for filtering poor matches (0-1 range)
   */
  THRESHOLD: {
    /**
     * Threshold below which a match is considered "poor" (0-1 range).
     * Matches below this threshold get reduced bonuses.
     */
    POOR_MATCH: 0.2,
    
    /**
     * Minimum threshold for considering a match valid (0-1 range).
     * Used for target coverage filtering.
     */
    MIN_VALID: 0.3,
    
    /**
     * Minimum score for applying full query bonus (0-1 range)
     */
    FULL_QUERY_MIN: 0.5,
    
    /**
     * Score multiplier threshold for operator overlap filtering.
     * If one operator uses more tokens and scores >= this ratio of another, prefer it.
     */
    OPERATOR_OVERLAP_RATIO: 0.8,
  },
  
  /**
   * Bonuses applied to increase scores for good matches (0-1 range)
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
     * Multiplier bonus for full query coverage (matching all tokens).
     * Applied as: score * (1 + FULL_COVERAGE_MULT) when all tokens are covered.
     */
    FULL_COVERAGE_MULT: 0.3,
    
    /**
     * Multiplier bonus for matching more of the target.
     * Applied as: score * (1 + coverage * COMPLETENESS_MULT).
     */
    COMPLETENESS_MULT: 0.1,
    
    /**
     * Multiplier bonus for matching the full query with good quality.
     */
    FULL_QUERY_MULT: 0.05,
    
    /**
     * Score boost for exact matches (case-insensitive).
     * Sets score directly to this value for perfect matches.
     */
    EXACT_MATCH: 1.0,
  },
} as const;
