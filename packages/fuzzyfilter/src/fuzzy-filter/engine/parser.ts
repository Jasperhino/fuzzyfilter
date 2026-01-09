/**
 * Parser Engine
 * 
 * Handles parsing of user input into structured filter components.
 */

import type {
  ParsedInput,
  Token,
  TokenClassification,
} from "../../types/index.ts";
import type { FuzzyFilterState } from "../types.ts";
import { tokenize } from "../../tokenizer.ts";
import { getOperator } from "../../operators.ts";

/**
 * Classify tokens by matching against tries
 *
 * @param tokens - The tokens to classify
 * @param state - The filter state with tries
 * @returns Array of token classifications
 */
export function classifyTokens(
  tokens: Token[],
  state: FuzzyFilterState
): TokenClassification[] {
  return tokens.map((token) => {
    const columnMatches = state.columnTrie
      .fuzzySearch(token.normalized, 5)
      .map((m) => ({
        column: m.value,
        score: m.score,
        matchedOn: "name" as const,
      }));

    const operatorMatches = state.operatorTrie
      .fuzzySearch(token.normalized, 5)
      .map((m) => ({
        operator: m.value.operator,
        score: m.score,
        matchedOn: "id" as const,
        forType: m.value.forType, // Type restriction if any
      }));

    const valueMatches = state.valueTrie
      .fuzzySearch(token.normalized, 5)
      .map((m) => ({
        value: m.value.value,
        columnId: m.value.columnId,
        score: m.score,
        rowCount: m.value.rowCount,
      }));

    // Determine best guess (scores are 0-1 range in fuzzysort v3)
    let bestGuess: "column" | "operator" | "value" | "unknown" = "unknown";
    const bestCol = columnMatches[0]?.score ?? 0;
    const bestOp = operatorMatches[0]?.score ?? 0;
    const bestVal = valueMatches[0]?.score ?? 0;

    if (bestCol >= bestOp && bestCol >= bestVal && bestCol > 0) {
      bestGuess = "column";
    } else if (bestOp >= bestCol && bestOp >= bestVal && bestOp > 0) {
      bestGuess = "operator";
    } else if (bestVal > 0) {
      bestGuess = "value";
    }

    return {
      token,
      columnMatches,
      operatorMatches,
      valueMatches,
      bestGuess,
    };
  });
}

/**
 * Parse input string into structured filter components
 *
 * @param input - The input string to parse
 * @param state - The filter state with tries
 * @returns Parsed input structure
 */
export function parseInput(input: string, state: FuzzyFilterState): ParsedInput {
  const { tokens } = tokenize(input);
  const classifications = classifyTokens(tokens, state);

  // Use optimal slot assignment to find the best global assignment of tokens to slots.
  // This avoids the greedy problem where a token with weak matches to multiple slots
  // could "steal" a slot from a later token that has a much better match.

  type SlotType = "column" | "operator" | "value";
  const slots: SlotType[] = ["column", "operator", "value"];

  // Helper to get the best score for a token in a specific slot
  const getSlotMatch = (tokenIdx: number, slot: SlotType) => {
    const c = classifications[tokenIdx];
    if (!c) return null;
    switch (slot) {
      case "column":
        return c.columnMatches[0] ?? null;
      case "operator":
        return c.operatorMatches[0] ?? null;
      case "value":
        return c.valueMatches[0] ?? null;
    }
  };

  // Get score for a token-slot combination (0-1 range, fuzzysort v3)
  const getScore = (tokenIdx: number, slot: SlotType): number => {
    const match = getSlotMatch(tokenIdx, slot);
    return match?.score ?? 0;
  };

  // Use greedy assignment with exhaustive fallback for optimal performance.
  // Greedy is O(n*m) where n=tokens, m=slots. Exhaustive is O(n!).
  // For most inputs, greedy gives optimal or near-optimal results.

  const tokenIndices = classifications.map((_, i) => i);

  // Greedy assignment: for each slot, pick the best available token
  // Scores are 0-1 range (fuzzysort v3)
  function greedyAssignment(): {
    assignment: Map<SlotType, number>;
    score: number;
  } {
    const assignment = new Map<SlotType, number>();
    const usedTokens = new Set<number>();
    let totalScore = 0;

    for (const slot of slots) {
      let bestTokenIdx = -1;
      let bestScore = 0;

      for (const tokenIdx of tokenIndices) {
        if (usedTokens.has(tokenIdx)) continue;
        const score = getScore(tokenIdx, slot);
        if (score > bestScore) {
          bestScore = score;
          bestTokenIdx = tokenIdx;
        }
      }

      if (bestTokenIdx >= 0 && bestScore > 0) {
        assignment.set(slot, bestTokenIdx);
        usedTokens.add(bestTokenIdx);
        totalScore += bestScore;
      }
    }

    return { assignment, score: totalScore };
  }

  // Exhaustive assignment (fallback for edge cases)
  // Scores are 0-1 range (fuzzysort v3)
  function exhaustiveAssignment(): {
    assignment: Map<SlotType, number>;
    score: number;
  } {
    let bestAssignment = new Map<SlotType, number>();
    let bestTotalScore = 0;

    function findBest(
      slotIndex: number,
      usedTokens: Set<number>,
      currentAssignment: Map<SlotType, number>,
      currentScore: number
    ): void {
      if (slotIndex >= slots.length) {
        if (currentScore > bestTotalScore) {
          bestTotalScore = currentScore;
          bestAssignment = new Map(currentAssignment);
        }
        return;
      }

      const slot = slots[slotIndex]!;

      // Option 1: Don't assign any token to this slot
      findBest(slotIndex + 1, usedTokens, currentAssignment, currentScore);

      // Option 2: Try assigning each unused token to this slot
      for (const tokenIdx of tokenIndices) {
        if (usedTokens.has(tokenIdx)) continue;

        const score = getScore(tokenIdx, slot);
        if (score === 0) continue;

        // Early pruning: if current + max possible remaining < best - margin, skip
        // In 0-1 range, use 0.3 margin for pruning (each slot max score = 1.0)
        if (currentScore + score <= bestTotalScore - 0.3) continue;

        currentAssignment.set(slot, tokenIdx);
        usedTokens.add(tokenIdx);
        findBest(slotIndex + 1, usedTokens, currentAssignment, currentScore + score);
        usedTokens.delete(tokenIdx);
        currentAssignment.delete(slot);
      }
    }

    findBest(0, new Set(), new Map(), 0);
    return { assignment: bestAssignment, score: bestTotalScore };
  }

  // Strategy: Try greedy first, use exhaustive only if greedy score is poor
  // or if we have many tokens (where greedy might miss optimal assignment)
  const greedy = greedyAssignment();

  // Use greedy result if it has good scores or if input is simple (≤2 tokens)
  // For complex inputs with poor greedy scores, fall back to exhaustive
  // Scores are 0-1 range: 0.5 is considered a "good match" threshold
  const useGreedy =
    tokens.length <= 2 || // Simple inputs: greedy is fine
    greedy.score > 0.5 || // Good match (0-1 range): greedy is fine
    tokens.length > 5; // Too many tokens: exhaustive is too slow

  const bestAssignment = useGreedy
    ? greedy.assignment
    : exhaustiveAssignment().assignment;

  // Build result from best assignment
  let column: ParsedInput["column"];
  let operator: ParsedInput["operator"];
  let value: ParsedInput["value"];

  const colIdx = bestAssignment.get("column");
  if (colIdx !== undefined) {
    const c = classifications[colIdx]!;
    column = { token: c.token, match: c.columnMatches[0]! };
  }

  const opIdx = bestAssignment.get("operator");
  if (opIdx !== undefined) {
    const c = classifications[opIdx]!;
    operator = { token: c.token, match: c.operatorMatches[0]! };
  }

  const valIdx = bestAssignment.get("value");
  if (valIdx !== undefined) {
    const c = classifications[valIdx]!;
    value = { token: c.token, match: c.valueMatches[0]! };
  }

  const missing: Array<"column" | "operator" | "value"> = [];
  if (!column) missing.push("column");
  if (!operator) missing.push("operator");
  // Value is optional for some operators

  return {
    raw: input,
    tokens,
    classifications,
    column,
    operator,
    value,
    missing,
  };
}

/**
 * Validate a filter input string
 *
 * @param input - The input string to validate
 * @param state - The filter state
 * @returns Validation result with errors if any
 */
export function validateInput(
  input: string,
  state: FuzzyFilterState
): {
  valid: boolean;
  errors: string[];
  parsed?: ParsedInput;
} {
  const parsed = parseInput(input, state);
  const errors: string[] = [];

  if (!parsed.column) {
    errors.push("No column specified");
  }

  if (!parsed.operator) {
    errors.push("No operator specified");
  } else {
    const opInfo = getOperator(parsed.operator.match.operator);
    if (opInfo && opInfo.patterns.some(p => /\{[^}]*\}/.test(p)) && !parsed.value) {
      errors.push(`Operator '${opInfo.id}' requires a value`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed,
  };
}
