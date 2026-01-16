/**
 * Trigram Similarity
 *
 * Sophisticated trigram-based fuzzy matching with boundary anchoring.
 *
 * Padding scheme:
 * - Start pad: `ΔΔ` (strong anchor - double delta)
 * - End pad: `Ξ` (lighter anchor - xi)
 * - Word boundaries: `ΞΔΔ` (space replacement)
 *
 * Example: "Alice King" → "ΔΔaliceΞΔΔkingΞ"
 *
 * Rules:
 * - Discard trigrams containing `ΔΔ` at end (incomplete start anchors)
 * - Use comm(x,y) / max(ngrams(x), ngrams(y)) instead of Jaccard
 *
 * @module fuzzyfilter/parsing/trigrams
 */

/** Start padding marker (strong anchor) */
export const START_PAD = "ΔΔ";
/** End padding marker (lighter anchor) */
export const END_PAD = "Ξ";
/** Word boundary marker */
export const WORD_BOUNDARY = END_PAD + START_PAD;

/**
 * A bag of trigrams with counts.
 */
export interface TrigramBag {
  /** Map of trigram → count */
  trigrams: Map<string, number>;
  /** Total number of trigrams (sum of counts) */
  totalCount: number;
  /** Original padded string */
  padded: string;
}

/**
 * Apply padding scheme to text for trigram extraction.
 *
 * - Adds `ΔΔ` at start (strong anchor)
 * - Adds `Ξ` at end (lighter anchor)
 * - Replaces whitespace with `ΞΔΔ` (end of word + start of next)
 *
 * @example
 * padText("Alice King") → "ΔΔaliceΞΔΔkingΞ"
 * padText("hello") → "ΔΔhelloΞ"
 */
export function padText(text: string): string {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return START_PAD + END_PAD;

  // Replace whitespace sequences with word boundary
  const withBoundaries = normalized.replace(/\s+/g, WORD_BOUNDARY);

  return START_PAD + withBoundaries + END_PAD;
}

/**
 * Extract trigrams from padded text.
 *
 * - Discards trigrams that end with start of START_PAD (incomplete anchors)
 * - Returns trigrams with their counts
 */
export function extractTrigrams(padded: string): Map<string, number> {
  const trigrams = new Map<string, number>();

  for (let i = 0; i <= padded.length - 3; i++) {
    const tri = padded.slice(i, i + 3);

    // Discard trigrams ending with Δ (start of START_PAD = incomplete anchor)
    if (tri.endsWith("Δ")) continue;

    trigrams.set(tri, (trigrams.get(tri) ?? 0) + 1);
  }

  return trigrams;
}

/**
 * Build a trigram bag from text.
 *
 * @example
 * const bag = buildTrigramBag("hello");
 * // bag.trigrams: Map { '$he' => 1, 'hel' => 1, 'ell' => 1, 'llo' => 1, 'lo!' => 1 }
 * // bag.totalCount: 5
 */
export function buildTrigramBag(text: string): TrigramBag {
  const padded = padText(text);
  const trigrams = extractTrigrams(padded);

  let totalCount = 0;
  for (const count of trigrams.values()) {
    totalCount += count;
  }

  return { trigrams, totalCount, padded };
}

/**
 * Calculate trigram similarity between two bags.
 *
 * Uses comm(x,y) / max(ngrams(x), ngrams(y)) formula:
 * - comm(x,y) = sum of min(count_x[tri], count_y[tri]) for all trigrams
 * - This is more forgiving for prefix matches than Jaccard
 *
 * @returns Similarity score in [0, 1] where 1 is identical
 */
export function trigramSimilarity(query: TrigramBag, candidate: TrigramBag): number {
  if (query.totalCount === 0 || candidate.totalCount === 0) {
    return 0;
  }

  let commonCount = 0;

  // Iterate over smaller bag for efficiency
  const [smaller, larger] =
    query.trigrams.size <= candidate.trigrams.size
      ? [query.trigrams, candidate.trigrams]
      : [candidate.trigrams, query.trigrams];

  for (const [trigram, count] of smaller) {
    const otherCount = larger.get(trigram) ?? 0;
    commonCount += Math.min(count, otherCount);
  }

  // comm(x,y) / max(ngrams(x), ngrams(y))
  return commonCount / Math.max(query.totalCount, candidate.totalCount);
}

/**
 * Calculate trigram similarity between two strings.
 * Convenience wrapper around buildTrigramBag and trigramSimilarity.
 *
 * @example
 * trigramSimilarityString("hello", "helo") // ~0.6
 * trigramSimilarityString("hello", "hello") // 1.0
 */
export function trigramSimilarityString(query: string, candidate: string): number {
  return trigramSimilarity(buildTrigramBag(query), buildTrigramBag(candidate));
}

/**
 * Create a custom scorer function for use with Trie.fuzzySearch.
 *
 * Blends fuzzysort's score with trigram similarity.
 * This can improve matching for transposition typos that fuzzysort handles poorly.
 *
 * @param queryText - The query string to compare against
 * @param blend - Weight for trigram score (0-1). Default 0.4.
 *                Final score = fuzzysort * (1 - blend) + trigram * blend
 *
 * @example
 * ```typescript
 * const trie = createTrie<MyType>();
 * // ... insert entries ...
 *
 * const scorer = createTrigramScorer("kilgoram");
 * const results = trie.fuzzySearch("kilgoram", 10, scorer);
 * // Results will include better matches for transpositions
 * ```
 */
export function createTrigramScorer(
  queryText: string,
  blend = 0.4
): (result: {
  score: number;
  indexes: readonly number[];
  target: string;
  obj: unknown;
}) => number {
  const queryBag = buildTrigramBag(queryText);

  return (result) => {
    const candidateBag = buildTrigramBag(result.target);
    const trigramScore = trigramSimilarity(queryBag, candidateBag);

    // Blend scores: fuzzysort * (1 - blend) + trigram * blend
    // Both scores are in [0, 1]
    const blendedScore = result.score * (1 - blend) + trigramScore * blend;

    return blendedScore;
  };
}

/**
 * Pre-compute trigram bag for a candidate, for use in batch matching.
 * Useful when matching one query against many candidates.
 */
export interface PreparedCandidate<T> {
  /** Original value */
  value: T;
  /** Text used for matching */
  text: string;
  /** Pre-computed trigram bag */
  bag: TrigramBag;
}

/**
 * Prepare a candidate for efficient batch matching.
 */
export function prepareCandidate<T>(value: T, text: string): PreparedCandidate<T> {
  return {
    value,
    text,
    bag: buildTrigramBag(text),
  };
}

/**
 * Batch match a query against prepared candidates.
 * More efficient than individual trigramSimilarityString calls.
 *
 * @param query - Query string
 * @param candidates - Pre-prepared candidates
 * @param minScore - Minimum score to include (default: 0)
 * @returns Candidates with scores, sorted by score descending
 */
export function batchMatch<T>(
  query: string,
  candidates: PreparedCandidate<T>[],
  minScore = 0
): Array<{ candidate: PreparedCandidate<T>; score: number }> {
  const queryBag = buildTrigramBag(query);

  const results: Array<{ candidate: PreparedCandidate<T>; score: number }> = [];

  for (const candidate of candidates) {
    const score = trigramSimilarity(queryBag, candidate.bag);
    if (score >= minScore) {
      results.push({ candidate, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
