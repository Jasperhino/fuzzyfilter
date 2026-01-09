/**
 * Parsing Layer Types
 * Tokenization and classification of user input.
 */

import type { ColumnId } from "./core.ts";
import type { OperatorKey } from "../operators.ts";
import type { AnyColumnDefinition } from "./schema.ts";

// ============================================================================
// TOKENS
// ============================================================================

/**
 * A token extracted from user input
 */
export interface Token {
  /** The raw text of the token */
  text: string;
  /** Start position in the original input */
  start: number;
  /** End position in the original input */
  end: number;
  /** Was this token quoted? */
  quoted: boolean;
  /** Normalized form (lowercase, trimmed) */
  normalized: string;
}

/**
 * Result of tokenizing user input
 */
export interface TokenizeResult {
  /** The original input string */
  original: string;
  /** Extracted tokens */
  tokens: Token[];
  /** Any remaining unparsed text */
  remainder: string;
  /** Was the input complete or partial? */
  isComplete: boolean;
}

// ============================================================================
// TOKEN CLASSIFICATION
// ============================================================================

/**
 * What type of filter component this token might be
 */
export type TokenType = "column" | "operator" | "value" | "unknown";

/**
 * A column match during classification
 */
export interface ColumnClassificationMatch {
  column: AnyColumnDefinition;
  score: number;
}

/**
 * An operator match during classification
 */
export interface OperatorClassificationMatch {
  operator: OperatorKey;
  score: number;
}

/**
 * A value match during classification
 */
export interface ValueClassificationMatch {
  value: string;
  columnId: ColumnId;
  score: number;
  rowCount: number;
}

/**
 * Classification scores for a token
 */
export interface TokenClassification {
  /** The token being classified */
  token: Token;
  /** Best column matches */
  columnMatches: ColumnClassificationMatch[];
  /** Best operator matches */
  operatorMatches: OperatorClassificationMatch[];
  /** Best value matches */
  valueMatches: ValueClassificationMatch[];
  /** Most likely classification based on scores */
  bestGuess: TokenType;
}

// ============================================================================
// PARSED INPUT
// ============================================================================

/**
 * The parsed structure of user input (may be partial)
 */
export interface ParsedInput {
  /** Original input string */
  raw: string;
  /** All tokens */
  tokens: Token[];
  /** Token classifications */
  classifications: TokenClassification[];
  /** Detected column (if any) */
  column?: {
    token: Token;
    match: ColumnClassificationMatch;
  };
  /** Detected operator (if any) */
  operator?: {
    token: Token;
    match: OperatorClassificationMatch;
  };
  /** Detected value/argument (if any) */
  value?: {
    token: Token;
    match: ValueClassificationMatch;
  };
  /** Cursor position in the input (for autocomplete) */
  cursorPosition?: number;
  /** What components are missing for a complete filter */
  missing?: Array<"column" | "operator" | "value">;
}

// ============================================================================
// DATE PARSING
// ============================================================================

/**
 * Result of parsing a date expression using chrono-node
 */
export interface ParsedDate {
  /** The parsed date value */
  date: Date;
  /** Start of range (for expressions like "last week") */
  rangeStart?: Date;
  /** End of range */
  rangeEnd?: Date;
  /** Is this a range expression? */
  isRange: boolean;
  /** The original text that was parsed */
  text: string;
  /** What part of the input was consumed */
  consumedText: string;
}

/**
 * Options for date parsing
 */
export interface DateParseOptions {
  /** Reference date for relative expressions */
  referenceDate?: Date;
  /** Timezone for parsing */
  timezone?: string;
  /** Prefer future dates? */
  forwardDate?: boolean;
  /** Locale for date parsing (e.g., "de", "fr", "es"). Defaults to "en". */
  locale?: string;
}

export interface Parser {
  /** Tokenize raw input */
  tokenize(input: string): TokenizeResult;

  /** Classify tokens */
  classifyTokens(tokens: Token[]): TokenClassification[];

  /** Full parse of input */
  parse(input: string, cursorPosition?: number): ParsedInput;

  /** Parse a date expression */
  parseDate(input: string, options?: DateParseOptions): ParsedDate | null;
}
