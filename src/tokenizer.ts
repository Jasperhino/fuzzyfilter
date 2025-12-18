/**
 * Tokenizer
 * Splits user input into tokens for parsing.
 */

import type { Token, TokenizeResult } from "./types/index.ts";

/**
 * Tokenize an input string into individual tokens.
 * Handles:
 * - Quoted strings ("value with spaces")
 * - Whitespace separation
 * - Operators as symbols (>=, !=, etc.)
 */
export function tokenize(input: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    // Skip whitespace
    if (/\s/.test(input[i]!)) {
      i++;
      continue;
    }

    const start = i;

    // Quoted string
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i];
      i++; // skip opening quote
      let text = "";
      while (i < len && input[i] !== quote) {
        // Handle escape sequences
        if (input[i] === "\\" && i + 1 < len) {
          i++;
          text += input[i];
        } else {
          text += input[i];
        }
        i++;
      }
      if (i < len) i++; // skip closing quote

      tokens.push({
        text,
        start,
        end: i,
        quoted: true,
        normalized: text.toLowerCase().trim(),
      });
      continue;
    }

    // Multi-char operators: >=, <=, !=, ==, <>
    const twoChar = input.slice(i, i + 2);
    if ([">=", "<=", "!=", "==", "<>"].includes(twoChar)) {
      tokens.push({
        text: twoChar,
        start,
        end: i + 2,
        quoted: false,
        normalized: twoChar,
      });
      i += 2;
      continue;
    }

    // Single-char operators: <, >, =, ~
    if (["<", ">", "=", "~"].includes(input[i]!)) {
      tokens.push({
        text: input[i]!,
        start,
        end: i + 1,
        quoted: false,
        normalized: input[i]!,
      });
      i++;
      continue;
    }

    // Regular word token
    let text = "";
    while (i < len && !/[\s"'<>=~]/.test(input[i]!)) {
      text += input[i];
      i++;
    }

    if (text) {
      tokens.push({
        text,
        start,
        end: i,
        quoted: false,
        normalized: text.toLowerCase().trim(),
      });
    }
  }

  // Determine if input is complete (ends with space or has balanced quotes)
  const trimmed = input.trimEnd();
  const isComplete = trimmed.length > 0 && input.length > trimmed.length;

  return {
    original: input,
    tokens,
    remainder: "",
    isComplete,
  };
}

