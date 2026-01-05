/**
 * N-gram generation for multi-word phrase matching
 */

import type { Token } from "../../types/index.ts";
import type { NgramWithMeta } from "../types.ts";

/**
 * Generate n-grams from tokens for matching multi-word phrases
 * 
 * For tokens ["is", "not", "empty"], generates:
 * - Individual: ["is", "not", "empty"]
 * - Bigrams: ["is not", "not empty"]
 * - Full: ["is not empty"]
 * 
 * Returns with metadata for scoring adjustments and highlighting
 *
 * @param tokens - The tokens to generate n-grams from
 * @returns Array of n-grams with metadata
 */
export function generateNgrams(tokens: Token[]): NgramWithMeta[] {
  const ngrams: NgramWithMeta[] = [];
  const totalTokens = tokens.length;

  // Individual tokens
  for (const t of tokens) {
    ngrams.push({
      text: t.normalized,
      tokenCount: 1,
      totalTokens,
      isFullQuery: totalTokens === 1,
      inputStart: t.start,
      inputEnd: t.end,
      tokens: [t],
    });
  }

  // N-grams (size 2 to min(4, all tokens))
  // Limit to 4 tokens max since operators rarely exceed 3-4 words
  // This reduces O(n^2) complexity for longer queries
  const maxNgramSize = Math.min(4, tokens.length);
  for (let n = 2; n <= maxNgramSize; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const slicedTokens = tokens.slice(i, i + n);
      const ngram = slicedTokens.map((t) => t.normalized).join(" ");
      ngrams.push({
        text: ngram,
        tokenCount: n,
        totalTokens,
        isFullQuery: n === totalTokens,
        inputStart: slicedTokens[0]!.start,
        inputEnd: slicedTokens[slicedTokens.length - 1]!.end,
        tokens: slicedTokens,
      });
    }
  }

  return ngrams;
}
