/**
 * Non-Greedy Chunker
 *
 * Generates multiple tokenizations of input with plausibility scores.
 * Uses beam search principle: don't commit early, generate all plausible
 * interpretations and rank at the end.
 *
 * @module fuzzyfilter/parsing/chunker
 */

import type { Chunk, ChunkType, Chunking, ChunkingStrategy } from "./types";

// =============================================================================
// OPERATOR DETECTION
// =============================================================================

/**
 * Multi-character operators (must be checked before single-char).
 */
const MULTI_CHAR_OPERATORS = [">=", "<=", "!=", "==", "<>", ".."];

/**
 * Single-character operators.
 */
const SINGLE_CHAR_OPERATORS = new Set(["<", ">", "=", "~", ":", "!"]);

/**
 * Check if a string is an operator.
 */
function isOperator(text: string): boolean {
  return (
    MULTI_CHAR_OPERATORS.includes(text) || SINGLE_CHAR_OPERATORS.has(text)
  );
}

// =============================================================================
// CHARACTER CLASSIFICATION
// =============================================================================

type CharClass = "letter" | "digit" | "operator" | "whitespace" | "other";

function classifyChar(char: string): CharClass {
  if (/\s/.test(char)) return "whitespace";
  if (/[a-zA-Z]/.test(char)) return "letter";
  if (/\d/.test(char)) return "digit";
  if (SINGLE_CHAR_OPERATORS.has(char)) return "operator";
  return "other";
}

function detectChunkType(text: string): ChunkType {
  if (isOperator(text)) return "operator";
  if (/^\d+(?:\.\d+)?$/.test(text)) return "number";
  if (/^[a-zA-Z]+$/.test(text)) return "word";
  if (/^[a-zA-Z0-9]+$/.test(text)) return "mixed";
  return "unknown";
}

// =============================================================================
// CHUNKING STRATEGIES
// =============================================================================

/**
 * Strategy 1: Split on whitespace only.
 * Highest confidence when input has clear spaces.
 */
function whitespaceChunking(input: string): Chunking {
  const chunks: Chunk[] = [];
  const regex = /\S+/g;
  let match;

  while ((match = regex.exec(input)) !== null) {
    chunks.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      type: detectChunkType(match[0]),
    });
  }

  return {
    chunks,
    plausibility: 0.95, // High confidence for whitespace-separated
    strategy: "whitespace",
  };
}

/**
 * Strategy 2: Split on character class transitions.
 * Handles "weight>50kg" -> ["weight", ">", "50", "kg"]
 */
function classTransitionChunking(input: string): Chunking {
  const chunks: Chunk[] = [];

  if (input.length === 0) {
    return { chunks: [], plausibility: 0.9, strategy: "class-transition" };
  }

  let currentStart = 0;
  let currentText = "";
  let prevClass: CharClass | null = null;

  // First, handle multi-char operators
  let i = 0;
  while (i < input.length) {
    // Check for multi-char operators
    let foundMultiOp = false;
    for (const op of MULTI_CHAR_OPERATORS) {
      if (input.slice(i, i + op.length) === op) {
        // Flush current chunk if any
        if (currentText.length > 0) {
          chunks.push({
            text: currentText,
            start: currentStart,
            end: i,
            type: detectChunkType(currentText),
          });
          currentText = "";
        }

        // Add operator chunk
        chunks.push({
          text: op,
          start: i,
          end: i + op.length,
          type: "operator",
        });

        i += op.length;
        currentStart = i;
        prevClass = null;
        foundMultiOp = true;
        break;
      }
    }
    if (foundMultiOp) continue;

    const char = input[i];
    const charClass = classifyChar(char);

    // Skip whitespace
    if (charClass === "whitespace") {
      if (currentText.length > 0) {
        chunks.push({
          text: currentText,
          start: currentStart,
          end: i,
          type: detectChunkType(currentText),
        });
        currentText = "";
      }
      currentStart = i + 1;
      prevClass = null;
      i++;
      continue;
    }

    // Check for class transition
    const shouldSplit =
      prevClass !== null &&
      prevClass !== charClass &&
      // Don't split letter+digit (e.g., "50kg" shouldn't split to "50", "k", "g")
      // Actually, we DO want "50kg" -> "50", "kg"
      !(prevClass === "letter" && charClass === "letter") &&
      !(prevClass === "digit" && charClass === "digit");

    if (shouldSplit && currentText.length > 0) {
      chunks.push({
        text: currentText,
        start: currentStart,
        end: i,
        type: detectChunkType(currentText),
      });
      currentText = "";
      currentStart = i;
    }

    currentText += char;
    prevClass = charClass;
    i++;
  }

  // Flush remaining
  if (currentText.length > 0) {
    chunks.push({
      text: currentText,
      start: currentStart,
      end: input.length,
      type: detectChunkType(currentText),
    });
  }

  return {
    chunks,
    plausibility: 0.9,
    strategy: "class-transition",
  };
}

/**
 * Strategy 3: No chunking - treat entire input as one chunk.
 * Lowest confidence but handles edge cases.
 */
function noChunking(input: string): Chunking {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { chunks: [], plausibility: 0.3, strategy: "none" };
  }

  return {
    chunks: [
      {
        text: trimmed,
        start: input.indexOf(trimmed),
        end: input.indexOf(trimmed) + trimmed.length,
        type: detectChunkType(trimmed),
      },
    ],
    plausibility: 0.3,
    strategy: "none",
  };
}

// =============================================================================
// PLAUSIBILITY HEURISTICS
// =============================================================================

/**
 * Apply plausibility heuristics to adjust chunking score.
 * All penalties/bonuses are MULTIPLICATIVE to stay in (0,1].
 */
function applyPlausibilityHeuristics(chunking: Chunking): Chunking {
  let plausibility = chunking.plausibility;
  const { chunks } = chunking;

  // Penalty: Too many chunks (complexity penalty)
  if (chunks.length > 6) {
    plausibility *= Math.pow(0.95, chunks.length - 6);
  }

  // Penalty: Single-char non-operator chunks
  const singleCharNonOps = chunks.filter(
    (c) => c.text.length === 1 && c.type !== "operator"
  );
  if (singleCharNonOps.length > 0) {
    plausibility *= Math.pow(0.85, singleCharNonOps.length);
  }

  // Penalty: Starts with operator
  if (chunks.length > 0 && chunks[0].type === "operator") {
    plausibility *= 0.8;
  }

  // Penalty: Consecutive operators
  let consecutiveOps = 0;
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].type === "operator" && chunks[i - 1].type === "operator") {
      consecutiveOps++;
    }
  }
  if (consecutiveOps > 0) {
    plausibility *= Math.pow(0.75, consecutiveOps);
  }

  // Bonus: Looks like field-operator-args pattern
  if (
    chunks.length >= 3 &&
    chunks[0].type === "word" &&
    chunks[1].type === "operator"
  ) {
    plausibility *= 1.05;
  }

  // Bonus: Has clear number-unit pair
  for (let i = 0; i < chunks.length - 1; i++) {
    if (chunks[i].type === "number" && chunks[i + 1].type === "word") {
      plausibility *= 1.02;
      break;
    }
  }

  // Clamp to [0, 1]
  plausibility = Math.min(1, Math.max(0, plausibility));

  return { ...chunking, plausibility };
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Generate all plausible chunkings of input.
 *
 * Returns multiple tokenizations with plausibility scores, sorted by
 * plausibility (highest first). This enables beam search to consider
 * multiple interpretations without committing early.
 *
 * @example
 * ```typescript
 * const chunkings = generateChunkings("weight>50kg");
 * // Returns:
 * // [
 * //   { chunks: ["weight", ">", "50", "kg"], plausibility: 0.95, strategy: "class-transition" },
 * //   { chunks: ["weight>50kg"], plausibility: 0.3, strategy: "none" },
 * // ]
 * ```
 */
export function generateChunkings(input: string): Chunking[] {
  if (!input || input.trim().length === 0) {
    return [{ chunks: [], plausibility: 1, strategy: "whitespace" }];
  }

  const strategies: Array<(input: string) => Chunking> = [
    whitespaceChunking,
    classTransitionChunking,
    noChunking,
  ];

  const results: Chunking[] = [];
  const seen = new Set<string>();

  for (const strategy of strategies) {
    const chunking = strategy(input);
    const adjusted = applyPlausibilityHeuristics(chunking);

    // Deduplicate based on chunk texts
    const key = adjusted.chunks.map((c) => c.text).join("|");
    if (!seen.has(key)) {
      seen.add(key);
      results.push(adjusted);
    }
  }

  // Sort by plausibility (highest first)
  return results.sort((a, b) => b.plausibility - a.plausibility);
}

/**
 * Get the most plausible chunking for input.
 * Convenience method when only the best chunking is needed.
 */
export function chunkInput(input: string): Chunking {
  const chunkings = generateChunkings(input);
  return chunkings[0];
}
