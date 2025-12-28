/**
 * FuzzyFilter - Main Implementation
 *
 * A library for parsing fuzzy filter queries with intelligent suggestions.
 * Uses fuzzysort for typo-tolerant matching and chrono-node for natural language dates.
 *
 * @module fuzzyfilter
 */

import fuzzysort from "fuzzysort";
import type {
  FuzzyFilter,
  FuzzyFilterConfig,
  Schema,
  SchemaInput,
  AnyColumnDefinition,
  ColumnId,
  Operator,
  Trie,
  FilterSuggestion,
  SuggestionResponse,
  ParsedInput,
  CompiledFilter,
  FilterResult,
  Token,
  HypothesisValueType,
  ParsedDate,
  QueryMatch,
} from "./types/index.ts";
import { DataType, DEFAULT_CONFIG } from "./types/index.ts";
import {
  getAllOperators,
  getOperatorsForType,
  getOperator,
} from "./operators.ts";
import { buildSchema, getColumn, getColumns } from "./schema-builder.ts";
import { createTrie } from "./trie.ts";
import { tokenize } from "./tokenizer.ts";
import {
  parseDate,
  COMMON_DATE_SUGGESTIONS,
  formatDateForDisplay,
  mightBeDateExpression,
} from "./date-parser.ts";
import {
  expandAliasPatterns,
  getSpreadStartKeywords,
  getSpreadSeparatorKeywords,
} from "./alias-generator.ts";

/**
 * Operator alias entry with optional type restriction
 */
interface OperatorAliasEntry {
  /** The operator this alias maps to */
  operator: Operator;
  /** If set, this alias only applies for this data type */
  forType?: DataType;
}

/**
 * Internal state for FuzzyFilter
 */
/**
 * Cached filter context result
 */
interface CachedContextResult {
  rowIndices: Set<number>;
  availableValues: ContextAvailableValues;
  dataVersion: number; // Incremented when data changes
}

/**
 * Internal state for FuzzyFilter
 */
interface FuzzyFilterState {
  schema: Schema | null;
  columnTrie: Trie<AnyColumnDefinition>;
  operatorTrie: Trie<OperatorAliasEntry>;
  valueTrie: Trie<{ value: string; columnId: ColumnId; rowCount: number }>;
  data: Array<Record<string, unknown>>;
  /** Version counter incremented when data changes, used for cache invalidation */
  dataVersion: number;
  /** LRU cache for filter context results */
  contextCache: Map<string, CachedContextResult>;
}

/**
 * N-gram with metadata for scoring
 */
interface NgramWithMeta {
  text: string;
  tokenCount: number;      // How many tokens this ngram spans
  totalTokens: number;     // Total tokens in the input
  isFullQuery: boolean;    // Is this the full query?
  /** Start position in original query string */
  inputStart: number;
  /** End position in original query string */
  inputEnd: number;
  /** The tokens that make up this ngram */
  tokens: Token[];
}

/**
 * Generate n-grams from tokens for matching multi-word phrases
 * For tokens ["is", "not", "empty"], generates:
 * - Individual: ["is", "not", "empty"]
 * - Bigrams: ["is not", "not empty"]
 * - Full: ["is not empty"]
 * 
 * Returns with metadata for scoring adjustments and highlighting
 */
function generateNgrams(tokens: Token[]): NgramWithMeta[] {
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

/**
 * Detected value tokens from user input
 */
interface DetectedValues {
  numbers: { token: Token; value: number; index: number }[];
  dates: { token: Token; value: Date; index: number }[];
}

/**
 * Detect tokens that are potential argument values (numbers or dates).
 * Excludes tokens that are already used for column/operator matching.
 */
function detectValueTokens(
  tokens: Token[],
  usedTokenIndices: Set<number>
): DetectedValues {
  const result: DetectedValues = {
    numbers: [],
    dates: [],
  };

  for (let i = 0; i < tokens.length; i++) {
    if (usedTokenIndices.has(i)) continue;

    const token = tokens[i]!;

    // Check if it's a numeric literal
    const num = parseFloat(token.text);
    if (isFinite(num)) {
      result.numbers.push({ token, value: num, index: i });
      continue;
    }

    // Check if it's a date expression
    const parsedDate = parseDate(token.text);
    if (parsedDate) {
      result.dates.push({ token, value: parsedDate.date, index: i });
    }
  }

  return result;
}

/**
 * Represents a value match with its input position information.
 * Used for non-overlapping assignment of ngrams to values.
 */
interface PositionedValueMatch {
  value: string;
  score: number;
  ngram: NgramWithMeta;
}

/**
 * Select a non-overlapping subset of value matches.
 * Uses a greedy algorithm: sort by score descending, pick highest scoring
 * match that doesn't overlap with already selected matches.
 *
 * This solves the weighted interval scheduling problem approximately,
 * ensuring each character position in the input is only "spent" once.
 *
 * @param matches - All candidate matches for a column
 * @param excludedPositions - Optional array of already-used position ranges to exclude
 * @returns Non-overlapping subset of matches
 */
function selectNonOverlappingMatches(
  matches: PositionedValueMatch[],
  excludedPositions?: Array<{ start: number; end: number }>
): PositionedValueMatch[] {
  if (matches.length === 0) return [];

  // Sort by score descending (greedy: pick highest first)
  const sorted = [...matches].sort((a, b) => b.score - a.score);

  const selected: PositionedValueMatch[] = [];
  const usedPositions: Array<{ start: number; end: number }> = excludedPositions
    ? [...excludedPositions]
    : [];

  for (const match of sorted) {
    const { inputStart, inputEnd } = match.ngram;

    // Check if this match overlaps with any already selected
    const overlaps = usedPositions.some(
      (pos) => !(inputEnd <= pos.start || inputStart >= pos.end)
    );

    if (!overlaps) {
      selected.push(match);
      usedPositions.push({ start: inputStart, end: inputEnd });
    }
  }

  return selected;
}

/**
 * Map of available values per column for context-aware suggestions.
 * When a filter context is provided, this map contains only the values
 * that exist in rows matching the context filters.
 */
type ContextAvailableValues = Map<ColumnId, {
  strings: Set<string>;
  numbers: Set<number>;
  dates: Set<number>; // timestamps for comparison
}>;

/**
 * Builds a map of available values per column from the given row indices.
 * This is used to constrain suggestions to only values that exist in the
 * filtered subset of data.
 *
 * @param contextRowIndices - Set of row indices matching the filter context
 * @param data - The full dataset
 * @param schema - The schema definition
 * @returns Map of column IDs to sets of available values by type
 */
function buildContextAvailableValues(
  contextRowIndices: Set<number>,
  data: Array<Record<string, unknown>>,
  schema: Schema
): ContextAvailableValues {
  const map: ContextAvailableValues = new Map();
  
  for (const col of getColumns(schema)) {
    map.set(col.id, { strings: new Set(), numbers: new Set(), dates: new Set() });
  }
  
  for (const rowIdx of contextRowIndices) {
    const row = data[rowIdx];
    if (!row) continue;
    
    for (const col of getColumns(schema)) {
      const value = row[col.id as string];
      if (value == null) continue;
      
      const entry = map.get(col.id)!;
      if (col.type === DataType.STRING || col.type === DataType.ENUM) {
        entry.strings.add(String(value));
      } else if (col.type === DataType.NUMBER) {
        entry.numbers.add(Number(value));
      } else if (col.type === DataType.DATE) {
        entry.dates.add(new Date(value as string | number | Date).getTime());
      }
    }
  }
  
  return map;
}

/**
 * Score breakdown for debugging/display
 */
interface ScoreBreakdown {
  rawScore: number;
  coverageBonus: number;
  completenessBonus: number;
  fullQueryBonus: number;
  exactMatchBonus?: number;
  targetCoveragePenalty?: number;
  tokenCount: number;
  totalTokens: number;
  adjustedScore: number;
}

/**
 * Match metadata for highlighting - tracks how query matched filter components
 */
interface MatchMetadata {
  /** Column match info if available */
  column?: {
    inputStart: number;
    inputEnd: number;
    inputText: string;
    matchedTarget: string;
    matchIndexes?: readonly number[];
    score: number;
  };
  /** Operator match info if available */
  operator?: {
    inputStart: number;
    inputEnd: number;
    inputText: string;
    matchedTarget: string;
    matchIndexes?: readonly number[];
    score: number;
  };
  /** Value match info if available (can have multiple for variadic operators) */
  values?: Array<{
    inputStart: number;
    inputEnd: number;
    inputText: string;
    matchedTarget: string;
    matchIndexes?: readonly number[];
    score: number;
  }>;
}

// ============================================================================
// SHARED HELPER FUNCTIONS
// ============================================================================

/**
 * Converts a primitive value to a HypothesisValueType.
 * Unified helper to avoid repeated inline definitions.
 *
 * @param val - The value to convert (string, number, Date, or boolean)
 * @returns A HypothesisValueType representing the value
 */
function toHypothesisValue(val: unknown): HypothesisValueType {
  if (typeof val === "number") {
    return { kind: "number", value: val };
  }
  if (val instanceof Date) {
    const dateText = val.toISOString();
    return {
      kind: "date",
      value: val,
      parsed: {
        text: dateText,
        date: val,
        isRange: false,
        consumedText: dateText,
      },
    };
  }
  if (typeof val === "boolean") {
    return { kind: "boolean", value: val };
  }
  return { kind: "string", value: String(val) };
}



// ============================================================================
// SCORING FUNCTIONS
// ============================================================================

/**
 * Adjust score based on how much of the query was matched
 * Fuzzysort scores: 0 = exact match, negative = worse match
 * We boost scores for longer n-gram matches to prefer "in progress" over "in"
 * 
 * Key principle: Matches that explain MORE of the query should score higher.
 * For example, "les eq" should prefer "lte" (via "less eq" alias) over "eq",
 * because "lte" explains both tokens while "eq" only explains one.
 */
function adjustScoreForCoverage(
  baseScore: number,
  ngram: NgramWithMeta,
  targetLength: number,
  matchedKey?: string
): ScoreBreakdown {
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
  const POOR_MATCH_THRESHOLD = -10000;
  const qualityFactor = Math.max(0, 1 + (baseScore / POOR_MATCH_THRESHOLD));
  
  // Bonus for high coverage (using more of the input)
  // Max bonus of 3000 points for full coverage - this is the PRIMARY ranking factor
  // Matching more tokens is more valuable than a perfect match on fewer tokens
  // Scale by quality factor so poor matches don't get full bonuses
  const coverageBonus = Math.round(coverageRatio * 3000 * qualityFactor);
  
  // Bonus for matching more of the target
  // Max bonus of 1000 points for complete match
  // Scale by quality factor
  const completenessBonus = Math.round(completenessRatio * 1000 * qualityFactor);
  
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
    ? Math.round((1 - completenessRatio) * -3000)
    : 0;
  
  // Additional bonus if this is the full query AND it's a good match
  const fullQueryBonus = ngram.isFullQuery && baseScore >= -1000 ? 500 : 0;
  
  // EXACT MATCH BONUS: When the n-gram text exactly matches the target (case-insensitive),
  // give a bonus scaled by coverage. An exact match on the full query gets the full bonus,
  // but an exact match on only part of the query gets a proportional bonus.
  // This ensures:
  // - "in" exactly matching "in" (full query) beats "in open" fuzzy matching "not in"
  // - "les eq" fuzzy matching "less eq" (2 tokens) beats "eq" exactly matching "eq" (1 token)
  const isExactMatch = matchedKey !== undefined && 
    ngram.text.toLowerCase() === matchedKey.toLowerCase();
  // Scale exact match bonus by coverage: exact match on 1 of 2 tokens = 1500, on 2 of 2 = 3000
  const exactMatchBonus = isExactMatch ? Math.round(3000 * coverageRatio) : 0;
  
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

/**
 * Result of detecting a spread pattern in tokens
 */
interface SpreadPatternMatch {
  /** The operator that this spread pattern represents */
  operator: Operator;
  /** Tokens between the start and separator keywords (first argument) */
  arg1Tokens: Token[];
  /** Tokens after the separator keyword (second argument) */
  arg2Tokens: Token[];
  /** The start keyword that was matched (e.g., "from") */
  startKeyword: string;
  /** The separator keyword that was matched (e.g., "to", "till") */
  separatorKeyword: string;
  /** Index of the start keyword token */
  startIndex: number;
  /** Index of the separator keyword token */
  separatorIndex: number;
}

/**
 * Detects spread patterns in tokens.
 * 
 * Spread patterns are operator expressions where keywords surround arguments:
 * - "from yesterday to today" → between(yesterday, today)
 * - "between 10 and 20" → between(10, 20)
 * 
 * @param tokens - The tokens to search
 * @param operators - Array of operators that have spread patterns defined
 * @returns Array of detected spread pattern matches
 */
function detectSpreadPatterns(
  tokens: Token[],
  operators: Array<{ id: Operator; spreadPatterns?: readonly import("./types/index.ts").SpreadPattern[] }>
): SpreadPatternMatch[] {
  const matches: SpreadPatternMatch[] = [];
  
  for (const op of operators) {
    if (!op.spreadPatterns) continue;
    
    const startKeywords = getSpreadStartKeywords(op.spreadPatterns);
    const separatorKeywords = getSpreadSeparatorKeywords(op.spreadPatterns);
    
    // Look for start keywords in tokens
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!startKeywords.has(token.normalized)) continue;
      
      // Found a start keyword, now look for a separator keyword after it
      for (let j = i + 1; j < tokens.length; j++) {
        const sepToken = tokens[j]!;
        if (!separatorKeywords.has(sepToken.normalized)) continue;
        
        // Found a separator, extract argument tokens
        const arg1Tokens = tokens.slice(i + 1, j);
        const arg2Tokens = tokens.slice(j + 1);
        
        // Only valid if we have at least some argument tokens
        if (arg1Tokens.length > 0 || arg2Tokens.length > 0) {
          matches.push({
            operator: op.id,
            arg1Tokens,
            arg2Tokens,
            startKeyword: token.normalized,
            separatorKeyword: sepToken.normalized,
            startIndex: i,
            separatorIndex: j,
          });
        }
        
        // Only match the first separator for each start keyword
        break;
      }
    }
  }
  
  return matches;
}

/**
 * Creates a new FuzzyFilter instance for intelligent filter suggestions.
 *
 * The FuzzyFilter provides:
 * - Fuzzy matching for columns, operators, and values
 * - Real-time result counting using optimized data structures
 * - Smart ranking that prioritizes complete matches
 * - Natural language date parsing via chrono-node
 *
 * @param userConfig - Optional configuration overrides
 * @returns A configured FuzzyFilter instance
 *
 * @example Basic usage
 * ```typescript
 * import { createFuzzyFilter, columnId } from "fuzzyfilter";
 *
 * const filter = createFuzzyFilter();
 *
 * filter.setSchema({
 *   columns: [
 *     { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
 *     { id: columnId("name"), name: "Name", type: "string" },
 *   ],
 * });
 *
 * filter.indexData(myData);
 *
 * const suggestions = await filter.suggest("stat");
 * // → [{ label: "Status =", resultCount: 100 }, ...]
 * ```
 *
 * @example With custom configuration
 * ```typescript
 * const filter = createFuzzyFilter({
 *   maxSuggestions: 20,
 *   debounceMs: 200,
 *   enableCache: true,
 * });
 * ```
 */
export function createFuzzyFilter(
  userConfig?: Partial<FuzzyFilterConfig>
): FuzzyFilter {
  // Merge config with defaults
  let config: FuzzyFilterConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    scoringWeights: {
      ...DEFAULT_CONFIG.scoringWeights,
      ...userConfig?.scoringWeights,
    },
    hypothesisOptions: {
      ...DEFAULT_CONFIG.hypothesisOptions,
      ...userConfig?.hypothesisOptions,
    },
    countOptions: {
      ...DEFAULT_CONFIG.countOptions,
      ...userConfig?.countOptions,
    },
  };

  // Initialize state
  const state: FuzzyFilterState = {
    schema: null,
    columnTrie: createTrie<AnyColumnDefinition>(),
    operatorTrie: createTrie<OperatorAliasEntry>(),
    valueTrie: createTrie<{ value: string; columnId: ColumnId; rowCount: number }>(),
    data: [],
    dataVersion: 0,
    contextCache: new Map(),
  };

  // Initialize operator trie with all operators and their aliases
  for (const op of getAllOperators()) {
    // Insert operator id and label as general (no type restriction)
    state.operatorTrie.insert(op.id, { operator: op.id });
    state.operatorTrie.insert(op.label, { operator: op.id });
    
    // Insert explicit aliases (no type restriction)
    for (const alias of op.aliases) {
      state.operatorTrie.insert(alias, { operator: op.id });
    }
    
    // Insert expanded aliases from patterns (no type restriction)
    if (op.aliasPatterns) {
      const expandedAliases = expandAliasPatterns(op.aliasPatterns);
      for (const alias of expandedAliases) {
        state.operatorTrie.insert(alias, { operator: op.id });
      }
    }
    
    // Insert type-specific aliases with their type restriction
    if (op.typeSpecificAliases) {
      for (const [dataType, aliases] of Object.entries(op.typeSpecificAliases)) {
        for (const alias of aliases) {
          state.operatorTrie.insert(alias, { 
            operator: op.id, 
            forType: dataType as DataType 
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Schema Management
  // -------------------------------------------------------------------------

  function setSchema(input: SchemaInput): void {
    state.schema = buildSchema(input);

    // Rebuild column trie
    state.columnTrie = createTrie<AnyColumnDefinition>();
    for (const col of getColumns(state.schema)) {
      state.columnTrie.insert(col.name, col);
      if (col.aliases) {
        for (const alias of col.aliases) {
          state.columnTrie.insert(alias, col);
        }
      }
    }

    // Re-index data if we have it
    if (state.data.length > 0) {
      indexData(state.data);
    }
  }

  function getSchema(): Schema | null {
    return state.schema;
  }

  function getColumnById(id: ColumnId | string): AnyColumnDefinition | null {
    if (!state.schema) return null;
    return getColumn(state.schema, id);
  }

  function getOperatorsForColumn(colId: ColumnId | string): Operator[] {
    const col = getColumnById(colId);
    if (!col) return [];
    return getOperatorsForType(col.type).map((op) => op.id);
  }

  // -------------------------------------------------------------------------
  // Data Indexing
  // -------------------------------------------------------------------------

  function indexData(data: Array<Record<string, unknown>>): void {
    state.data = data;
    state.valueTrie = createTrie<{ value: string; columnId: ColumnId; rowCount: number }>();
    // Increment version and clear cache on data change
    state.dataVersion++;
    state.contextCache.clear();

    if (!state.schema) return;

    // Count values per column
    const valueCounts = new Map<string, Map<string, number>>();

    for (const col of getColumns(state.schema)) {
      valueCounts.set(col.id as string, new Map());
    }

    for (const row of data) {
      for (const col of getColumns(state.schema!)) {
        const value = row[col.id as string];
        if (value == null) continue;

        const strValue = String(value);
        const counts = valueCounts.get(col.id as string)!;
        counts.set(strValue, (counts.get(strValue) ?? 0) + 1);
      }
    }

    // Build value trie
    // Limit indexed values per column to top 100 most frequent for performance
    // High-cardinality columns would otherwise explode the trie size
    const MAX_VALUES_PER_COLUMN = 100;

    for (const col of getColumns(state.schema)) {
      const counts = valueCounts.get(col.id as string)!;

      // Sort values by frequency and take top N
      const sortedValues = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_VALUES_PER_COLUMN);

      for (const [value, count] of sortedValues) {
        // Insert value with metadata into trie
        state.valueTrie.insert(value, {
          value,
          columnId: col.id,
          rowCount: count,
        });
      }
    }
  }

  function updateRows(
    changes: Array<{
      rowId: number;
      oldData?: Record<string, unknown>;
      newData?: Record<string, unknown>;
    }>
  ): void {
    // Simple implementation: just re-index
    for (const change of changes) {
      if (change.oldData && change.newData) {
        state.data[change.rowId] = change.newData;
      } else if (change.newData) {
        state.data.push(change.newData);
      }
    }
    indexData(state.data);
  }

  function clearIndex(): void {
    state.data = [];
    state.valueTrie = createTrie();
  }

  function getIndexStats(): {
    totalRows: number;
    columnsIndexed: number;
    uniqueValues: number;
    indexSizeBytes: number;
  } {
    return {
      totalRows: state.data.length,
      columnsIndexed: state.schema?.columns.size ?? 0,
      uniqueValues: state.valueTrie.size,
      indexSizeBytes: 0, // Not tracking this for now
    };
  }

  // -------------------------------------------------------------------------
  // Parsing
  // -------------------------------------------------------------------------

  function parse(input: string): ParsedInput {
    const { tokens } = tokenize(input);
    const classifications = classifyTokens(tokens);

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
        case "column": return c.columnMatches[0] ?? null;
        case "operator": return c.operatorMatches[0] ?? null;
        case "value": return c.valueMatches[0] ?? null;
      }
    };
    
    const getScore = (tokenIdx: number, slot: SlotType): number => {
      const match = getSlotMatch(tokenIdx, slot);
      return match?.score ?? -Infinity;
    };

    // Use greedy assignment with exhaustive fallback for optimal performance.
    // Greedy is O(n*m) where n=tokens, m=slots. Exhaustive is O(n!).
    // For most inputs, greedy gives optimal or near-optimal results.
    
    const tokenIndices = classifications.map((_, i) => i);
    
    // Greedy assignment: for each slot, pick the best available token
    function greedyAssignment(): { assignment: Map<SlotType, number>; score: number } {
      const assignment = new Map<SlotType, number>();
      const usedTokens = new Set<number>();
      let totalScore = 0;
      
      for (const slot of slots) {
        let bestTokenIdx = -1;
        let bestScore = -Infinity;
        
        for (const tokenIdx of tokenIndices) {
          if (usedTokens.has(tokenIdx)) continue;
          const score = getScore(tokenIdx, slot);
          if (score > bestScore) {
            bestScore = score;
            bestTokenIdx = tokenIdx;
          }
        }
        
        if (bestTokenIdx >= 0 && bestScore > -Infinity) {
          assignment.set(slot, bestTokenIdx);
          usedTokens.add(bestTokenIdx);
          totalScore += bestScore;
        }
      }
      
      return { assignment, score: totalScore };
    }
    
    // Exhaustive assignment (fallback for edge cases)
    function exhaustiveAssignment(): { assignment: Map<SlotType, number>; score: number } {
      let bestAssignment = new Map<SlotType, number>();
      let bestTotalScore = -Infinity;
      
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
          if (score === -Infinity) continue;
          
          // Early pruning: if current + max possible remaining < best, skip
          // Max possible remaining = sum of best scores for remaining slots
          // (simplified: just check if this branch can beat best)
          if (currentScore + score <= bestTotalScore - 3000) continue;
          
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
    const useGreedy = 
      tokens.length <= 2 || // Simple inputs: greedy is fine
      greedy.score > -500 || // Good match: greedy is fine
      tokens.length > 5; // Too many tokens: exhaustive is too slow
    
    const bestAssignment = useGreedy ? greedy.assignment : exhaustiveAssignment().assignment;

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

  function classifyTokens(tokens: Token[]) {
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

      // Determine best guess
      let bestGuess: "column" | "operator" | "value" | "unknown" = "unknown";
      const bestCol = columnMatches[0]?.score ?? -Infinity;
      const bestOp = operatorMatches[0]?.score ?? -Infinity;
      const bestVal = valueMatches[0]?.score ?? -Infinity;

      if (bestCol >= bestOp && bestCol >= bestVal && bestCol > -Infinity) {
        bestGuess = "column";
      } else if (bestOp >= bestCol && bestOp >= bestVal && bestOp > -Infinity) {
        bestGuess = "operator";
      } else if (bestVal > -Infinity) {
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

  function validate(input: string): {
    valid: boolean;
    errors: string[];
    parsed?: ParsedInput;
  } {
    const parsed = parse(input);
    const errors: string[] = [];

    if (!parsed.column) {
      errors.push("No column specified");
    }

    if (!parsed.operator) {
      errors.push("No operator specified");
    } else {
      const opInfo = getOperator(parsed.operator.match.operator);
      if (opInfo.requiresArgument && !parsed.value) {
        errors.push(`Operator '${opInfo.label}' requires a value`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      parsed,
    };
  }

  // -------------------------------------------------------------------------
  // Suggestions
  // -------------------------------------------------------------------------

  async function suggest(
    query: string,
    cursorPosition?: number,
    filterContext?: CompiledFilter[]
  ): Promise<SuggestionResponse> {
    return suggestSync(query, cursorPosition, filterContext);
  }

  function suggestSync(
    query: string,
    cursorPosition?: number,
    filterContext?: CompiledFilter[]
  ): SuggestionResponse {
    const startTime = performance.now();
    const suggestions: FilterSuggestion[] = [];

    if (!state.schema) {
      return {
        query,
        cursorPosition: cursorPosition ?? query.length,
        suggestions: [],
        totalCount: 0,
        responseTimeMs: performance.now() - startTime,
      };
    }

    // Compute the set of row indices that match all context filters
    // null means no filter context (use all rows)
    // Uses caching to avoid recomputing for the same filter context
    let contextRowIndices: Set<number> | null = null;
    let contextAvailableValues: ContextAvailableValues | null = null;

    if (filterContext && filterContext.length > 0) {
      // Generate cache key from filter context
      const cacheKey = filterContext
        .map((f) => `${f.columnId}:${f.operator}:${JSON.stringify(f.arguments)}`)
        .sort()
        .join("|");

      const cached = state.contextCache.get(cacheKey);
      if (cached && cached.dataVersion === state.dataVersion) {
        // Cache hit
        contextRowIndices = cached.rowIndices;
        contextAvailableValues = cached.availableValues;
      } else {
        // Cache miss - compute and cache
        contextRowIndices = new Set<number>();
        for (let i = 0; i < state.data.length; i++) {
          const row = state.data[i]!;
          let matchesAll = true;
          for (const filter of filterContext) {
            if (!filter.predicate(row)) {
              matchesAll = false;
              break;
            }
          }
          if (matchesAll) {
            contextRowIndices.add(i);
          }
        }

        contextAvailableValues = buildContextAvailableValues(
          contextRowIndices,
          state.data,
          state.schema
        );

        // Store in cache (limit cache size to prevent memory bloat)
        if (state.contextCache.size >= 20) {
          // Remove oldest entry (first in map)
          const firstKey = state.contextCache.keys().next().value;
          if (firstKey) state.contextCache.delete(firstKey);
        }
        state.contextCache.set(cacheKey, {
          rowIndices: contextRowIndices,
          availableValues: contextAvailableValues,
          dataVersion: state.dataVersion,
        });
      }
    }

    const parsed = parse(query);
    const { tokens } = parsed;

    // Generate n-grams for multi-word matching
    const ngrams = generateNgrams(tokens);

    // Strategy 1: Empty query - show all columns with default operators
    if (tokens.length === 0) {
      for (const col of getColumns(state.schema)) {
        const defaultOp = getOperatorsForType(col.type)[0];
        if (defaultOp) {
          suggestions.push(createSuggestion(col, defaultOp.id, undefined, 0, undefined, undefined, contextRowIndices));
        }
      }
    }
    // Strategy 2: Has tokens - search with n-grams
    else {
      // Track best matches to avoid duplicates (keep best score)
      // Each entry includes the ngram for position info and match indexes for highlighting
      type ColScoreEntry = { 
        breakdown: ScoreBreakdown; 
        ngram: NgramWithMeta; 
        matchedTarget: string; 
        matchIndexes?: readonly number[]; 
      };
      const columnScores = new Map<string, ColScoreEntry>();
      type OpScoreEntry = { 
        breakdown: ScoreBreakdown; 
        operator: Operator; 
        forType?: DataType; 
        matchedAlias?: string;
        ngram: NgramWithMeta;
        matchedTarget: string;
        matchIndexes?: readonly number[];
      };
      const operatorScores = new Map<string, OpScoreEntry>();
      type ValMatch = { value: { value: string; columnId: ColumnId; rowCount: number }; score: number; indexes?: readonly number[] };
      // Track which source token text matched each value - this prevents token reuse for variadic operators
      type ValScoreEntry = { 
        breakdown: ScoreBreakdown; 
        match: ValMatch; 
        sourceTokenText: string;
        ngram: NgramWithMeta;
        matchedTarget: string;
        matchIndexes?: readonly number[];
      };
      const valueScores = new Map<string, ValScoreEntry>();
      const seenValues = new Set<string>(); // For the second pass

      // Search each n-gram against all tries
      for (const ngram of ngrams) {
        // Column matches
        const colMatches = state.columnTrie.fuzzySearch(ngram.text, 5);
        for (const match of colMatches) {
          const key = match.value.id as string;
          const breakdown = adjustScoreForCoverage(
            match.score,
            ngram,
            match.value.name.length,
            match.key // Pass matched key for exact match detection
          );
          const existing = columnScores.get(key);
          if (!existing || breakdown.adjustedScore > existing.breakdown.adjustedScore) {
            columnScores.set(key, { 
              breakdown, 
              ngram, 
              matchedTarget: match.value.name,
              matchIndexes: match.indexes,
            });
          }
        }

        // Operator matches
        const opMatches = state.operatorTrie.fuzzySearch(ngram.text, 5);
        for (const match of opMatches) {
          const opEntry = match.value;
          const opInfo = getOperator(opEntry.operator);
          
          // Use the longer of id or label for target length
          const targetLength = Math.max(opInfo.id.length, opInfo.label.length);
          const breakdown = adjustScoreForCoverage(
            match.score,
            ngram,
            targetLength,
            match.key // Pass matched key for exact match detection
          );
          
          // Store with type restriction info and matched alias
          const key = opEntry.forType 
            ? `${opEntry.operator}:${opEntry.forType}` 
            : opEntry.operator;
          const existing = operatorScores.get(key);
          if (!existing || breakdown.adjustedScore > existing.breakdown.adjustedScore) {
            operatorScores.set(key, { 
              breakdown, 
              operator: opEntry.operator,
              matchedAlias: match.key, // Track the actual alias that was matched
              forType: opEntry.forType,
              ngram,
              matchedTarget: match.key,
              matchIndexes: match.indexes,
            });
          }
        }

        // Value matches - filter to only values available in the context
        const valMatchesRaw = state.valueTrie.fuzzySearch(ngram.text, 10);
        const valMatches = contextAvailableValues
          ? valMatchesRaw.filter(match => {
              const available = contextAvailableValues.get(match.value.columnId);
              return available?.strings.has(match.value.value) ?? false;
            })
          : valMatchesRaw;
        for (const match of valMatches) {
          const key = `${match.value.columnId}:${match.value.value}`;
          const breakdown = adjustScoreForCoverage(
            match.score,
            ngram,
            match.value.value.length,
            match.key // Pass matched key for exact match detection
          );
          const existing = valueScores.get(key);
          if (!existing || breakdown.adjustedScore > existing.breakdown.adjustedScore) {
            // Store the source token text to track which token matched this value
            valueScores.set(key, { 
              breakdown, 
              match: { ...match, indexes: match.indexes }, 
              sourceTokenText: ngram.text,
              ngram,
              matchedTarget: match.value.value,
              matchIndexes: match.indexes,
            });
          }
        }
      }

      // Filter out operator matches when a higher-scoring operator match overlaps with their tokens.
      // This handles cases like "not equal" where:
      // - "equal" matches "eq" operator
      // - "not equal" matches "neq" operator (better match, more tokens)
      // We should prefer "neq" and remove "eq" from consideration.
      const operatorsToRemove = new Set<string>();
      for (const [keyA, entryA] of operatorScores) {
        for (const [keyB, entryB] of operatorScores) {
          if (keyA === keyB) continue;
          
          // Check if ngrams overlap
          const ngramA = entryA.ngram;
          const ngramB = entryB.ngram;
          const overlaps = !(ngramA.inputEnd <= ngramB.inputStart || ngramB.inputEnd <= ngramA.inputStart);
          
          if (overlaps) {
            // If one is a proper superset of the other in terms of token coverage,
            // prefer the one with more tokens (more complete interpretation)
            if (ngramA.tokenCount > ngramB.tokenCount && entryA.breakdown.adjustedScore >= entryB.breakdown.adjustedScore * 0.8) {
              // A uses more tokens and has a reasonable score - remove B
              operatorsToRemove.add(keyB);
            } else if (ngramB.tokenCount > ngramA.tokenCount && entryB.breakdown.adjustedScore >= entryA.breakdown.adjustedScore * 0.8) {
              // B uses more tokens and has a reasonable score - remove A
              operatorsToRemove.add(keyA);
            } else if (ngramA.tokenCount === ngramB.tokenCount) {
              // Same token count - prefer higher score
              if (entryA.breakdown.adjustedScore > entryB.breakdown.adjustedScore) {
                operatorsToRemove.add(keyB);
              } else if (entryB.breakdown.adjustedScore > entryA.breakdown.adjustedScore) {
                operatorsToRemove.add(keyA);
              }
            }
          }
        }
      }
      
      // Remove the filtered operators
      for (const key of operatorsToRemove) {
        operatorScores.delete(key);
      }

      // Check if the full query might be a date expression
      const fullQuery = tokens.map((t) => t.text).join(" ");
      if (mightBeDateExpression(fullQuery)) {
        const parsedDate = parseDate(fullQuery);
        if (parsedDate) {
          // Create match metadata for the value (covers full query as a date expression)
          const queryStart = tokens[0]?.start ?? 0;
          const queryEnd = tokens[tokens.length - 1]?.end ?? fullQuery.length;
          const isRangeDate = parsedDate.rangeStart && parsedDate.rangeEnd;
          
          // For range dates, create two value matches for start and end
          // For single dates, create one value match
          const dateMatchMetadata: MatchMetadata = isRangeDate
            ? {
                values: [
                  {
                    inputStart: queryStart,
                    inputEnd: queryEnd,
                    inputText: fullQuery,
                    matchedTarget: formatDateForDisplay(parsedDate.rangeStart!),
                    score: 0,
                  },
                  {
                    inputStart: queryStart,
                    inputEnd: queryEnd,
                    inputText: fullQuery,
                    matchedTarget: formatDateForDisplay(parsedDate.rangeEnd!),
                    score: 0,
                  },
                ],
              }
            : {
                values: [
                  {
                    inputStart: queryStart,
                    inputEnd: queryEnd,
                    inputText: fullQuery,
                    matchedTarget: formatDateForDisplay(parsedDate.date),
                    score: 0,
                  },
                ],
              };
          
          // Add suggestions for all date columns
          for (const col of getColumns(state.schema!)) {
            if (col.type === DataType.DATE) {
              // Check if this is a date range (has both start and end)
              if (parsedDate.rangeStart && parsedDate.rangeEnd) {
                // Find operators that accept date ranges (variadic + supports date)
                const rangeOperators = getAllOperators().filter(
                  op => op.isVariadic && op.supportedTypes.includes(DataType.DATE)
                );
                
                for (const op of rangeOperators) {
                  const key = `${col.id}:${op.id}:date:${parsedDate.rangeStart.toISOString()}-${parsedDate.rangeEnd.toISOString()}`;
                  if (!seenValues.has(key)) {
                    seenValues.add(key);
                    suggestions.push(
                      createDateSuggestion(
                        col,
                        op.id,
                        parsedDate,
                        5000, // Highest score - both arguments provided naturally
                        countForDateFilter(col.id, op.id, parsedDate, contextRowIndices),
                        undefined,
                        contextRowIndices,
                        dateMatchMetadata
                      )
                    );
                  }
                }
              }
              
              // Also add single-date operators
              const dateOps = getOperatorsForType(DataType.DATE);
              for (const op of dateOps.slice(0, 3)) {
                const key = `${col.id}:${op.id}:date:${parsedDate.date.toISOString()}`;
                if (!seenValues.has(key)) {
                  seenValues.add(key);
                  suggestions.push(
                    createDateSuggestion(
                      col,
                      op.id,
                      parsedDate,
                      4000, // High score for complete date filter (above incomplete operator matches)
                      countForDateFilter(col.id, op.id, parsedDate, contextRowIndices),
                      undefined,
                      contextRowIndices,
                      dateMatchMetadata
                    )
                  );
                }
              }
            }
          }
        }
      }

      // Detect spread patterns like "from X to Y" or "between X and Y"
      const spreadOperators = getAllOperators().filter(op => op.spreadPatterns);
      const spreadMatches = detectSpreadPatterns(tokens, spreadOperators);
      
      for (const spreadMatch of spreadMatches) {
        const arg1Text = spreadMatch.arg1Tokens.map(t => t.text).join(" ");
        const arg2Text = spreadMatch.arg2Tokens.map(t => t.text).join(" ");
        
        // Try to parse each argument
        // For dates
        const arg1Date = arg1Text ? parseDate(arg1Text) : null;
        const arg2Date = arg2Text ? parseDate(arg2Text) : null;
        
        // For numbers  
        const arg1Num = arg1Text ? parseFloat(arg1Text) : NaN;
        const arg2Num = arg2Text ? parseFloat(arg2Text) : NaN;
        
        // Check what columns this could apply to
        for (const col of getColumns(state.schema!)) {
          const opInfo = getOperator(spreadMatch.operator);
          if (!opInfo.supportedTypes.includes(col.type)) continue;
          
          // Date columns
          if (col.type === DataType.DATE && arg1Date && arg2Date) {
            const key = `${col.id}:${spreadMatch.operator}:spread:${arg1Date.date.toISOString()}-${arg2Date.date.toISOString()}`;
            if (!seenValues.has(key)) {
              seenValues.add(key);
              
              // Create a combined ParsedDate for the range
              const combinedParsedDate: ParsedDate = {
                text: `${arg1Text} ${spreadMatch.separatorKeyword} ${arg2Text}`,
                date: arg1Date.date,
                isRange: true,
                rangeStart: arg1Date.date,
                rangeEnd: arg2Date.date,
                consumedText: `${arg1Text} ${spreadMatch.separatorKeyword} ${arg2Text}`,
              };
              
              // Build match metadata for the spread pattern values
              const arg1Start = spreadMatch.arg1Tokens[0]?.start ?? 0;
              const arg1End = spreadMatch.arg1Tokens[spreadMatch.arg1Tokens.length - 1]?.end ?? arg1Text.length;
              const arg2Start = spreadMatch.arg2Tokens[0]?.start ?? 0;
              const arg2End = spreadMatch.arg2Tokens[spreadMatch.arg2Tokens.length - 1]?.end ?? arg2Text.length;
              
              const spreadMatchMeta: MatchMetadata = {
                values: [
                  {
                    inputStart: arg1Start,
                    inputEnd: arg1End,
                    inputText: arg1Text,
                    matchedTarget: formatDateForDisplay(arg1Date.date),
                    score: 0,
                  },
                  {
                    inputStart: arg2Start,
                    inputEnd: arg2End,
                    inputText: arg2Text,
                    matchedTarget: formatDateForDisplay(arg2Date.date),
                    score: 0,
                  },
                ],
              };
              
              suggestions.push(
                createDateSuggestion(
                  col,
                  spreadMatch.operator,
                  combinedParsedDate,
                  5500, // Very high score - explicit spread pattern
                  countForDateFilter(col.id, spreadMatch.operator, combinedParsedDate, contextRowIndices),
                  undefined,
                  contextRowIndices,
                  spreadMatchMeta
                )
              );
            }
          }
          
          // Number columns
          if (col.type === DataType.NUMBER && isFinite(arg1Num) && isFinite(arg2Num)) {
            const key = `${col.id}:${spreadMatch.operator}:spread:${arg1Num}-${arg2Num}`;
            if (!seenValues.has(key)) {
              seenValues.add(key);
              
              // Sort to ensure correct order
              const sorted = [arg1Num, arg2Num].sort((a, b) => a - b);
              const args: HypothesisValueType[] = sorted.map(v => ({ kind: "number" as const, value: v }));
              
              // Build match metadata for the spread pattern
              // Include the operator token, argument tokens, and separator token
              const startToken = tokens[spreadMatch.startIndex]!;
              const sepToken = tokens[spreadMatch.separatorIndex]!;
              const numArg1Start = spreadMatch.arg1Tokens[0]?.start ?? 0;
              const numArg1End = spreadMatch.arg1Tokens[spreadMatch.arg1Tokens.length - 1]?.end ?? arg1Text.length;
              const numArg2Start = spreadMatch.arg2Tokens[0]?.start ?? 0;
              const numArg2End = spreadMatch.arg2Tokens[spreadMatch.arg2Tokens.length - 1]?.end ?? arg2Text.length;
              
              const numSpreadMatchMeta: MatchMetadata = {
                operator: {
                  inputStart: startToken.start,
                  inputEnd: startToken.end,
                  inputText: startToken.text,
                  matchedTarget: spreadMatch.operator,
                  score: 0,
                },
                values: [
                  {
                    inputStart: numArg1Start,
                    inputEnd: numArg1End,
                    inputText: arg1Text,
                    matchedTarget: String(sorted[0]),
                    score: 0,
                  },
                  // Include separator token range in a value entry so it gets marked as covered
                  {
                    inputStart: sepToken.start,
                    inputEnd: sepToken.end,
                    inputText: sepToken.text,
                    matchedTarget: spreadMatch.separatorKeyword,
                    score: 0,
                  },
                  {
                    inputStart: numArg2Start,
                    inputEnd: numArg2End,
                    inputText: arg2Text,
                    matchedTarget: String(sorted[1]),
                    score: 0,
                  },
                ],
              };
              
              suggestions.push(
                createSuggestion(
                  col,
                  spreadMatch.operator,
                  args,
                  5500, // Very high score - explicit spread pattern
                  undefined,
                  undefined,
                  contextRowIndices,
                  numSpreadMatchMeta,
                  tokens
                )
              );
            }
          }
        }
      }

      // Now create suggestions from the best scores
      
      // Detect value tokens for argument-aware scoring
      // First, find which tokens are likely used for column matching
      const usedForColumn = new Set<number>();
      for (const [colId, _breakdown] of columnScores) {
        const col = getColumnById(colId);
        if (!col) continue;
        
        // Find token(s) that best match this column
        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i]!;
          const colMatch = fuzzysort.single(token.normalized, col.name.toLowerCase());
          if (colMatch && colMatch.score > -500) {
            usedForColumn.add(i);
          }
          // Also check aliases
          if (col.aliases) {
            for (const alias of col.aliases) {
              const aliasMatch = fuzzysort.single(token.normalized, alias.toLowerCase());
              if (aliasMatch && aliasMatch.score > -500) {
                usedForColumn.add(i);
              }
            }
          }
        }
      }
      
      // Detect numeric and date values from remaining tokens
      const detectedValues = detectValueTokens(tokens, usedForColumn);
      
      // Column suggestions with argument-aware scoring
      for (const [colId, colScoreEntry] of columnScores) {
        const col = getColumnById(colId);
        if (!col) continue;
        
        const { breakdown: colBreakdown, ngram: colNgram, matchedTarget: colMatchedTarget, matchIndexes: colMatchIndexes } = colScoreEntry;
        const ops = getOperatorsForType(col.type);
        
        // Get compatible values for this column type, filtered by context availability
        const compatibleValues: (number | Date)[] = col.type === DataType.NUMBER 
          ? detectedValues.numbers
              .map(n => n.value)
              .filter(val => {
                if (!contextAvailableValues) return true;
                return contextAvailableValues.get(col.id)?.numbers.has(val) ?? false;
              })
          : col.type === DataType.DATE
            ? detectedValues.dates
                .map(d => d.value)
                .filter(val => {
                  if (!contextAvailableValues) return true;
                  return contextAvailableValues.get(col.id)?.dates.has(val.getTime()) ?? false;
                })
            : [];

        // If we have 2+ compatible values, prioritize variadic operators
        if (compatibleValues.length >= 2) {
          // Generate suggestions for operators that can use multiple values
          for (const op of ops) {
            const opInfo = getOperator(op.id);
            
            let valuesUsed = 0;
            let suggestionArgs: HypothesisValueType[] | undefined;
            
            if (opInfo.isVariadic) {
              const minArgs = opInfo.minArguments ?? 1;
              
              if (minArgs === 2) {
                // Operators like "between" that need exactly 2 values
                valuesUsed = 2;
                // Sort values to ensure start < end
                const sorted = [...compatibleValues].slice(0, 2).sort((a, b) => {
                  if (a instanceof Date && b instanceof Date) {
                    return a.getTime() - b.getTime();
                  }
                  return (a as number) - (b as number);
                });
                suggestionArgs = sorted.map(toHypothesisValue);
              } else {
                // Operators like "in"/"nin" that accept any number of values
                valuesUsed = compatibleValues.length;
                suggestionArgs = compatibleValues.map(toHypothesisValue);
              }
            } else if (opInfo.requiresArgument) {
              // Single-value operator - uses first value
              valuesUsed = 1;
              suggestionArgs = [toHypothesisValue(compatibleValues[0]!)];
            }
            
            // Check if this operator was also matched in the input
            const generalKey = op.id;
            const typedKey = `${op.id}:${col.type}`;
            const opMatch = operatorScores.get(typedKey) ?? operatorScores.get(generalKey);
            
            // Calculate argument coverage bonus
            const argumentCoverageBonus = Math.round((valuesUsed / compatibleValues.length) * 1500);
            // Include operator score if the operator was also matched in the input
            const operatorBonus = opMatch ? opMatch.breakdown.adjustedScore : 0;
            const adjustedScore = colBreakdown.adjustedScore + argumentCoverageBonus + operatorBonus;
            
            // Build match metadata for highlighting
            const matchMeta: MatchMetadata = {
              column: {
                inputStart: colNgram.inputStart,
                inputEnd: colNgram.inputEnd,
                inputText: colNgram.text,
                matchedTarget: colMatchedTarget,
                matchIndexes: colMatchIndexes,
                score: colBreakdown.rawScore,
              },
              // Include operator match metadata if the operator was matched
              operator: opMatch?.ngram ? {
                inputStart: opMatch.ngram.inputStart,
                inputEnd: opMatch.ngram.inputEnd,
                inputText: opMatch.ngram.text,
                matchedTarget: opMatch.matchedTarget ?? opMatch.matchedAlias ?? op.id,
                matchIndexes: opMatch.matchIndexes,
                score: opMatch.breakdown.rawScore,
              } : undefined,
            };
            
            suggestions.push(createSuggestion(
              col, 
              op.id, 
              suggestionArgs, 
              adjustedScore, 
              undefined, 
              opMatch?.matchedAlias, 
              contextRowIndices,
              matchMeta,
              tokens
            ));
          }
        } else if (compatibleValues.length === 1) {
          // Single value - suggest operators with that value
          const firstVal = compatibleValues[0]!;
          const argValue = toHypothesisValue(firstVal);
          
          for (const op of ops.slice(0, 5)) {
            const opInfo = getOperator(op.id);
            if (!opInfo.requiresArgument) continue;
            
            // Check if this operator was also matched in the input
            const generalKey = op.id;
            const typedKey = `${op.id}:${col.type}`;
            const opMatch = operatorScores.get(typedKey) ?? operatorScores.get(generalKey);
            
            // Full coverage bonus since only 1 value
            // Include operator score if the operator was also matched in the input
            const operatorBonus = opMatch ? opMatch.breakdown.adjustedScore : 0;
            const adjustedScore = colBreakdown.adjustedScore + 1500 + operatorBonus;
            
            // Build match metadata for highlighting
            const matchMeta: MatchMetadata = {
              column: {
                inputStart: colNgram.inputStart,
                inputEnd: colNgram.inputEnd,
                inputText: colNgram.text,
                matchedTarget: colMatchedTarget,
                matchIndexes: colMatchIndexes,
                score: colBreakdown.rawScore,
              },
              // Include operator match metadata if the operator was matched
              operator: opMatch?.ngram ? {
                inputStart: opMatch.ngram.inputStart,
                inputEnd: opMatch.ngram.inputEnd,
                inputText: opMatch.ngram.text,
                matchedTarget: opMatch.matchedTarget ?? opMatch.matchedAlias ?? op.id,
                matchIndexes: opMatch.matchIndexes,
                score: opMatch.breakdown.rawScore,
              } : undefined,
            };
            
            suggestions.push(createSuggestion(
              col, 
              op.id, 
              [argValue], 
              adjustedScore, 
              undefined, 
              opMatch?.matchedAlias, 
              contextRowIndices,
              matchMeta,
              tokens
            ));
          }
        } else {
          // No compatible values detected - check for no-argument operators
          // First, check if any no-argument operators for this column were matched in operatorScores
          const noArgOps = ops.filter(op => !getOperator(op.id).requiresArgument);
          const matchedNoArgOps: Array<{ 
            opId: Operator; 
            opBreakdown: ScoreBreakdown; 
            matchedAlias?: string;
            opNgram?: NgramWithMeta;
            opMatchedTarget?: string;
            opMatchIndexes?: readonly number[];
          }> = [];
          
          for (const op of noArgOps) {
            // Check if this operator was matched (with or without type restriction)
            const generalKey = op.id;
            const typedKey = `${op.id}:${col.type}`;
            
            const generalMatch = operatorScores.get(generalKey);
            const typedMatch = operatorScores.get(typedKey);
            const match = typedMatch ?? generalMatch;
            
            if (match) {
              matchedNoArgOps.push({ 
                opId: op.id, 
                opBreakdown: match.breakdown,
                matchedAlias: match.matchedAlias,
                opNgram: match.ngram,
                opMatchedTarget: match.matchedTarget,
                opMatchIndexes: match.matchIndexes,
              });
            }
          }
          
          // If we have matched no-argument operators, give them a combined score + completeness bonus
          if (matchedNoArgOps.length > 0) {
            for (const { opId, opBreakdown, matchedAlias, opNgram, opMatchedTarget, opMatchIndexes } of matchedNoArgOps) {
              // Combine column + operator scores, plus completeness bonus
              // Similar to argument coverage bonus (1500), we give a completeness bonus for no-arg operators
              const combinedScore = colBreakdown.adjustedScore + opBreakdown.adjustedScore + 1500;
              
              // Build match metadata for highlighting (both column and operator matched)
              const matchMeta: MatchMetadata = {
                column: {
                  inputStart: colNgram.inputStart,
                  inputEnd: colNgram.inputEnd,
                  inputText: colNgram.text,
                  matchedTarget: colMatchedTarget,
                  matchIndexes: colMatchIndexes,
                  score: colBreakdown.rawScore,
                },
                operator: opNgram ? {
                  inputStart: opNgram.inputStart,
                  inputEnd: opNgram.inputEnd,
                  inputText: opNgram.text,
                  matchedTarget: opMatchedTarget ?? matchedAlias ?? opId,
                  matchIndexes: opMatchIndexes,
                  score: opBreakdown.rawScore,
                } : undefined,
              };
              
              suggestions.push(createSuggestion(col, opId, undefined, combinedScore, undefined, matchedAlias, contextRowIndices, matchMeta, tokens));
            }
            
            // Also add other operators with just column score (lower priority)
            for (const op of ops.slice(0, 3)) {
              // Skip if already added as matched no-arg operator
              if (matchedNoArgOps.some(m => m.opId === op.id)) continue;
              
              const matchMeta: MatchMetadata = {
                column: {
                  inputStart: colNgram.inputStart,
                  inputEnd: colNgram.inputEnd,
                  inputText: colNgram.text,
                  matchedTarget: colMatchedTarget,
                  matchIndexes: colMatchIndexes,
                  score: colBreakdown.rawScore,
                },
              };
              
              suggestions.push(createSuggestion(col, op.id, undefined, colBreakdown, undefined, undefined, contextRowIndices, matchMeta, tokens));
            }
          } else {
            // Fall back to default behavior - suggest top operators with just column score
            for (const op of ops.slice(0, 3)) {
              const matchMeta: MatchMetadata = {
                column: {
                  inputStart: colNgram.inputStart,
                  inputEnd: colNgram.inputEnd,
                  inputText: colNgram.text,
                  matchedTarget: colMatchedTarget,
                  matchIndexes: colMatchIndexes,
                  score: colBreakdown.rawScore,
                },
              };
              
              suggestions.push(createSuggestion(col, op.id, undefined, colBreakdown, undefined, undefined, contextRowIndices, matchMeta, tokens));
            }
          }
        }
      }

      // Operator suggestions - with argument-aware scoring when operator matches but no column matches
      // First, detect which tokens are used for operator matching
      const usedForOperator = new Set<number>();
      for (const [_key, { operator: opId }] of operatorScores) {
        const opInfo = getOperator(opId);
        // Find token(s) that best match this operator
        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i]!;
          const opMatch = fuzzysort.single(token.normalized, opInfo.id.toLowerCase());
          const labelMatch = fuzzysort.single(token.normalized, opInfo.label.toLowerCase());
          if ((opMatch && opMatch.score > -500) || (labelMatch && labelMatch.score > -500)) {
            usedForOperator.add(i);
          }
          // Also check aliases
          for (const alias of opInfo.aliases) {
            const aliasMatch = fuzzysort.single(token.normalized, alias.toLowerCase());
            if (aliasMatch && aliasMatch.score > -500) {
              usedForOperator.add(i);
            }
          }
        }
      }
      
      // Detect numeric and date values from tokens not used for operator matching
      const operatorDetectedValues = detectValueTokens(tokens, usedForOperator);

      for (const [_key, { breakdown: opBreakdown, operator, forType, matchedAlias, ngram: opNgram, matchedTarget: opMatchedTarget, matchIndexes: opMatchIndexes }] of operatorScores) {
        const opInfo = getOperator(operator);
        for (const col of getColumns(state.schema!)) {
          // Skip if this is a type-specific alias that doesn't match the column type
          if (forType && forType !== col.type) continue;
          
          if (opInfo.supportedTypes.includes(col.type)) {
            // Check if this column was also matched in columnScores
            const colMatchEntry = columnScores.get(col.id as string);
            
            if (colMatchEntry && !opInfo.requiresArgument) {
              // Both column and no-argument operator matched - use combined score
              // Note: This creates a potential duplicate with the column suggestions path above,
              // but deduplication later will keep the higher-scored one
              const combinedScore = colMatchEntry.breakdown.adjustedScore + opBreakdown.adjustedScore + 1500;
              
              // Build match metadata for highlighting (both column and operator matched)
              const matchMeta: MatchMetadata = {
                column: {
                  inputStart: colMatchEntry.ngram.inputStart,
                  inputEnd: colMatchEntry.ngram.inputEnd,
                  inputText: colMatchEntry.ngram.text,
                  matchedTarget: colMatchEntry.matchedTarget,
                  matchIndexes: colMatchEntry.matchIndexes,
                  score: colMatchEntry.breakdown.rawScore,
                },
                operator: {
                  inputStart: opNgram.inputStart,
                  inputEnd: opNgram.inputEnd,
                  inputText: opNgram.text,
                  matchedTarget: opMatchedTarget,
                  matchIndexes: opMatchIndexes,
                  score: opBreakdown.rawScore,
                },
              };
              
              suggestions.push(createSuggestion(col, operator, undefined, combinedScore, undefined, matchedAlias, contextRowIndices, matchMeta, tokens));
            } else if (colMatchEntry && opInfo.requiresArgument) {
              // Both column and operator matched, but operator requires arguments
              // This handles cases like "status notin" where both slots are filled
              // Combine column + operator scores with a bonus for matching both
              const combinedScore = colMatchEntry.breakdown.adjustedScore + opBreakdown.adjustedScore + 1500;
              
              // Build match metadata for highlighting (both column and operator matched)
              const matchMeta: MatchMetadata = {
                column: {
                  inputStart: colMatchEntry.ngram.inputStart,
                  inputEnd: colMatchEntry.ngram.inputEnd,
                  inputText: colMatchEntry.ngram.text,
                  matchedTarget: colMatchEntry.matchedTarget,
                  matchIndexes: colMatchEntry.matchIndexes,
                  score: colMatchEntry.breakdown.rawScore,
                },
                operator: {
                  inputStart: opNgram.inputStart,
                  inputEnd: opNgram.inputEnd,
                  inputText: opNgram.text,
                  matchedTarget: opMatchedTarget,
                  matchIndexes: opMatchIndexes,
                  score: opBreakdown.rawScore,
                },
              };
              
              suggestions.push(createSuggestion(col, operator, undefined, combinedScore, undefined, matchedAlias, contextRowIndices, matchMeta, tokens));
            } else if (opInfo.requiresArgument && !colMatchEntry) {
              // Operator matched but no column matched - check for compatible detected values
              // Get compatible values for this column type, filtered by context availability
              const compatibleValues: (number | Date)[] = col.type === DataType.NUMBER 
                ? operatorDetectedValues.numbers
                    .map(n => n.value)
                    .filter(val => {
                      if (!contextAvailableValues) return true;
                      return contextAvailableValues.get(col.id)?.numbers.has(val) ?? false;
                    })
                : col.type === DataType.DATE
                  ? operatorDetectedValues.dates
                      .map(d => d.value)
                      .filter(val => {
                        if (!contextAvailableValues) return true;
                        return contextAvailableValues.get(col.id)?.dates.has(val.getTime()) ?? false;
                      })
                  : [];
              
              if (compatibleValues.length >= 1) {
                // We have compatible values - create suggestions with them
                let valuesUsed = 0;
                let suggestionArgs: HypothesisValueType[] | undefined;
                
                if (opInfo.isVariadic) {
                  const minArgs = opInfo.minArguments ?? 1;
                  
                  if (minArgs === 2) {
                    // Operators like "between" that need exactly 2 values
                    if (compatibleValues.length >= 2) {
                      valuesUsed = 2;
                      // Sort values to ensure start < end
                      const sorted = [...compatibleValues].slice(0, 2).sort((a, b) => {
                        if (a instanceof Date && b instanceof Date) {
                          return a.getTime() - b.getTime();
                        }
                        return (a as number) - (b as number);
                      });
                      suggestionArgs = sorted.map(toHypothesisValue);
                    } else if (compatibleValues.length === 1) {
                      // Single value - show partial progress
                      valuesUsed = 1;
                      suggestionArgs = [toHypothesisValue(compatibleValues[0]!)];
                    }
                  } else {
                    // Operators like "in"/"nin" that accept any number of values (min 1)
                    valuesUsed = compatibleValues.length;
                    suggestionArgs = compatibleValues.map(toHypothesisValue);
                  }
                } else {
                  // Single-value operator - uses first value
                  valuesUsed = 1;
                  suggestionArgs = [toHypothesisValue(compatibleValues[0]!)];
                }
                
                if (valuesUsed > 0 && suggestionArgs) {
                  // Calculate argument coverage bonus
                  const argumentCoverageBonus = Math.round((valuesUsed / compatibleValues.length) * 1500);
                  const adjustedScore = opBreakdown.adjustedScore + argumentCoverageBonus;
                  
                  // Build match metadata for highlighting (operator matched)
                  const matchMeta: MatchMetadata = {
                    operator: {
                      inputStart: opNgram.inputStart,
                      inputEnd: opNgram.inputEnd,
                      inputText: opNgram.text,
                      matchedTarget: opMatchedTarget,
                      matchIndexes: opMatchIndexes,
                      score: opBreakdown.rawScore,
                    },
                  };
                  
                  suggestions.push(createSuggestion(col, operator, suggestionArgs, adjustedScore, undefined, matchedAlias, contextRowIndices, matchMeta, tokens));
                }
              }
              
              // Also create incomplete suggestion (for cases where user wants to specify different values)
              const opOnlyMeta: MatchMetadata = {
                operator: {
                  inputStart: opNgram.inputStart,
                  inputEnd: opNgram.inputEnd,
                  inputText: opNgram.text,
                  matchedTarget: opMatchedTarget,
                  matchIndexes: opMatchIndexes,
                  score: opBreakdown.rawScore,
                },
              };
              suggestions.push(createSuggestion(col, operator, undefined, opBreakdown.adjustedScore, undefined, matchedAlias, contextRowIndices, opOnlyMeta, tokens));
            } else {
              // Only operator matched (with column match but requires argument, or no column match and no values)
              const opOnlyMeta: MatchMetadata = {
                operator: {
                  inputStart: opNgram.inputStart,
                  inputEnd: opNgram.inputEnd,
                  inputText: opNgram.text,
                  matchedTarget: opMatchedTarget,
                  matchIndexes: opMatchIndexes,
                  score: opBreakdown.rawScore,
                },
              };
              suggestions.push(createSuggestion(col, operator, undefined, opBreakdown.adjustedScore, undefined, matchedAlias, contextRowIndices, opOnlyMeta, tokens));
            }
          }
        }
      }

      // Value suggestions
      for (const [_key, { breakdown, match, ngram: valNgram, matchedTarget: valMatchedTarget, matchIndexes: valMatchIndexes }] of valueScores) {
        const col = getColumnById(match.value.columnId);
        if (col) {
          // When there's a filter context, don't use pre-indexed rowCount - compute dynamically
          const rowCount = contextRowIndices !== null 
            ? undefined  // Will be computed by createSuggestion using context
            : match.value.rowCount;
          
          // Check if this value's column also has a matching column score
          // and if there's a matching "eq" operator score.
          // If so, this value suggestion matches more of the query and should score higher.
          const colEntry = columnScores.get(col.id);
          const opEntry = operatorScores.get("eq");
          
          // Check if the value's ngram matches a NON-EQ operator better than the value itself.
          // This handles cases like "not equals" where the ngram should be interpreted as
          // the "neq" operator, not as a fuzzy value match boosted by the "eq" operator.
          // If another operator has a higher-scoring match on an overlapping/same ngram,
          // we should NOT boost this value suggestion with the eq operator bonus.
          let anotherOpMatchesBetter = false;
          for (const [, opScoreEntry] of operatorScores) {
            // Skip the eq operator itself
            if (opScoreEntry.operator === "eq") continue;
            
            // Check if this operator's ngram overlaps with the value's ngram
            const opNgram = opScoreEntry.ngram;
            const valueNgram = valNgram;
            
            // Ngrams overlap if they share any character positions in the original input
            const overlaps = !(opNgram.inputEnd <= valueNgram.inputStart || valueNgram.inputEnd <= opNgram.inputStart);
            
            if (overlaps) {
              // If the operator match is significantly better than the value match,
              // the ngram was likely intended for the operator, not the value
              const opScore = opScoreEntry.breakdown.adjustedScore;
              const valueScore = breakdown.adjustedScore;
              
              // If operator scored higher, don't boost value with eq
              if (opScore > valueScore) {
                anotherOpMatchesBetter = true;
                break;
              }
            }
          }
          
          // Determine which operator to use for this value suggestion.
          // Instead of always using "eq", use the best matching operator from operatorScores
          // that supports string arguments and is compatible with the column type.
          let bestOpForValue: Operator = "eq";
          let bestOpEntry: OpScoreEntry | undefined = opEntry;
          
          // Find the best operator in operatorScores that:
          // 1. Supports the column's type
          // 2. Requires an argument (so it makes sense with a value)
          for (const [, opScoreEntry] of operatorScores) {
            const opInfo = getOperator(opScoreEntry.operator);
            if (opInfo.supportedTypes.includes(col.type) && opInfo.requiresArgument) {
              if (!bestOpEntry || opScoreEntry.breakdown.adjustedScore > bestOpEntry.breakdown.adjustedScore) {
                bestOpEntry = opScoreEntry;
                bestOpForValue = opScoreEntry.operator;
              }
            }
          }
          
          // Calculate combined score when column and operator also matched
          let finalScore = breakdown.adjustedScore;
          if (!anotherOpMatchesBetter && (colEntry || bestOpEntry)) {
            // Bonus for matching additional components beyond just the value
            // This ensures "Status eq Open" for query "status equa open" scores higher
            // than "Status eq (...)" which only matches column+operator
            const colBonus = colEntry ? colEntry.breakdown.adjustedScore : 0;
            const opBonus = bestOpEntry ? bestOpEntry.breakdown.adjustedScore : 0;
            // Add a base bonus for having all components matched + coverage bonuses
            finalScore = breakdown.adjustedScore + colBonus + opBonus;
          }
          
          // Build match metadata for highlighting (value matched)
          const matchMeta: MatchMetadata = {
            column: colEntry ? {
              inputStart: colEntry.ngram.inputStart,
              inputEnd: colEntry.ngram.inputEnd,
              inputText: colEntry.ngram.text,
              matchedTarget: colEntry.matchedTarget,
              matchIndexes: colEntry.matchIndexes,
              score: colEntry.breakdown.rawScore,
            } : undefined,
            operator: bestOpEntry ? {
              inputStart: bestOpEntry.ngram.inputStart,
              inputEnd: bestOpEntry.ngram.inputEnd,
              inputText: bestOpEntry.ngram.text,
              matchedTarget: bestOpEntry.matchedTarget,
              matchIndexes: bestOpEntry.matchIndexes,
              score: bestOpEntry.breakdown.rawScore,
            } : undefined,
            values: [{
              inputStart: valNgram.inputStart,
              inputEnd: valNgram.inputEnd,
              inputText: valNgram.text,
              matchedTarget: valMatchedTarget,
              matchIndexes: valMatchIndexes,
              score: breakdown.rawScore,
            }],
          };
          
          suggestions.push(
            createSuggestion(
              col,
              bestOpForValue,
              [{ kind: "string", value: match.value.value }],
              finalScore,
              rowCount,
              bestOpEntry?.matchedAlias,
              contextRowIndices,
              matchMeta,
              tokens
            )
          );
        }
      }

      // If we have a clear column + operator match, also suggest column-specific values
      if (parsed.column && parsed.operator) {
        const col = parsed.column.match.column;
        const op = parsed.operator.match.operator;
        const opInfo = getOperator(op);

        if (opInfo.requiresArgument) {
          // Get remaining tokens after column and operator as potential value
          const colTokenIdx = tokens.indexOf(parsed.column.token);
          const opTokenIdx = tokens.indexOf(parsed.operator.token);
          const valueTokens = tokens.filter(
            (_, i) => i !== colTokenIdx && i !== opTokenIdx
          );

          // Handle date columns specially
          if (col.type === DataType.DATE) {
            if (valueTokens.length > 0) {
              // Try to parse as a date expression
              const valueQuery = valueTokens.map((t) => t.text).join(" ");
              const parsedDate = parseDate(valueQuery);
              
              if (parsedDate) {
                // Build match metadata for column, operator, and value
                const colToken = parsed.column!.token;
                const opToken = parsed.operator!.token;
                const valueStart = valueTokens[0]?.start ?? 0;
                const valueEnd = valueTokens[valueTokens.length - 1]?.end ?? valueQuery.length;
                const isRangeDate = parsedDate.rangeStart && parsedDate.rangeEnd && opInfo.isVariadic;
                
                const dateMatchMeta: MatchMetadata = {
                  column: {
                    inputStart: colToken.start,
                    inputEnd: colToken.end,
                    inputText: colToken.text,
                    matchedTarget: col.name,
                    score: parsed.column!.match.score,
                  },
                  operator: {
                    inputStart: opToken.start,
                    inputEnd: opToken.end,
                    inputText: opToken.text,
                    matchedTarget: opInfo.label,
                    score: parsed.operator!.match.score,
                  },
                  values: isRangeDate
                    ? [
                        {
                          inputStart: valueStart,
                          inputEnd: valueEnd,
                          inputText: valueQuery,
                          matchedTarget: formatDateForDisplay(parsedDate.rangeStart!),
                          score: 0,
                        },
                        {
                          inputStart: valueStart,
                          inputEnd: valueEnd,
                          inputText: valueQuery,
                          matchedTarget: formatDateForDisplay(parsedDate.rangeEnd!),
                          score: 0,
                        },
                      ]
                    : [
                        {
                          inputStart: valueStart,
                          inputEnd: valueEnd,
                          inputText: valueQuery,
                          matchedTarget: formatDateForDisplay(parsedDate.date),
                          score: 0,
                        },
                      ],
                };
                
                // Add date suggestion with parsed date value
                const key = `${col.id}:${op}:date:${parsedDate.date.toISOString()}`;
                if (!seenValues.has(key)) {
                  seenValues.add(key);
                  suggestions.push(
                    createDateSuggestion(
                      col,
                      op,
                      parsedDate,
                      4500, // High score for complete date filter with explicit column/operator
                      countForDateFilter(col.id, op, parsedDate, contextRowIndices),
                      undefined,
                      contextRowIndices,
                      dateMatchMeta
                    )
                  );
                }
              }
              
              // Also search indexed date values as strings
              const valueQueryNorm = valueTokens.map((t) => t.normalized).join(" ");
              const valMatchesRaw = state.valueTrie.fuzzySearch(valueQueryNorm, 5);
              const valMatches = contextAvailableValues
                ? valMatchesRaw.filter(match => {
                    const available = contextAvailableValues.get(match.value.columnId);
                    return available?.strings.has(match.value.value) ?? false;
                  })
                : valMatchesRaw;
              for (const match of valMatches) {
                if (match.value.columnId === col.id) {
                  const key = `${col.id}:${op}:${match.value.value}`;
                  if (!seenValues.has(key)) {
                    seenValues.add(key);
                    // When there's a filter context, compute count dynamically
                    const rowCount = contextRowIndices !== null ? undefined : match.value.rowCount;
                    suggestions.push(
                      createSuggestion(
                        col,
                        op,
                        [{ kind: "string", value: match.value.value }],
                        match.score + parsed.column.match.score,
                        rowCount,
                        undefined,
                        contextRowIndices,
                        undefined,
                        tokens
                      )
                    );
                  }
                }
              }
            } else {
              // No value tokens yet - suggest common date phrases
              // Build match metadata for column and operator only (no value input yet)
              const colToken = parsed.column!.token;
              const opToken = parsed.operator!.token;
              const colOpMatchMeta: MatchMetadata = {
                column: {
                  inputStart: colToken.start,
                  inputEnd: colToken.end,
                  inputText: colToken.text,
                  matchedTarget: col.name,
                  score: parsed.column!.match.score,
                },
                operator: {
                  inputStart: opToken.start,
                  inputEnd: opToken.end,
                  inputText: opToken.text,
                  matchedTarget: opInfo.label,
                  score: parsed.operator!.match.score,
                },
              };
              
              for (const dateSuggestion of COMMON_DATE_SUGGESTIONS) {
                const parsedDate = parseDate(dateSuggestion.text);
                if (parsedDate) {
                  const key = `${col.id}:${op}:date:${dateSuggestion.text}`;
                  if (!seenValues.has(key)) {
                    seenValues.add(key);
                    suggestions.push(
                      createDateSuggestion(
                        col,
                        op,
                        parsedDate,
                        parsed.column.match.score,
                        countForDateFilter(col.id, op, parsedDate, contextRowIndices),
                        dateSuggestion.label,
                        contextRowIndices,
                        colOpMatchMeta
                      )
                    );
                  }
                }
              }
            }
          } else {
            // Non-date columns - handle variadic operators specially
            if (valueTokens.length > 0) {
              // For variadic operators (in, nin), search for EACH value token separately
              // and combine results into a multi-value suggestion
              if (opInfo.isVariadic && valueTokens.length >= 1) {
                // Track which token matched which value for proper highlighting
                const tokenMatchInfo: Array<{ token: Token; matchedValue: string; score: number } | null> = [];
                const matchedValues: Array<{ value: string; score: number }> = [];
                
                for (const valueToken of valueTokens) {
                  const tokenMatches = state.valueTrie.fuzzySearch(valueToken.normalized, 3);
                  const filteredMatches = contextAvailableValues
                    ? tokenMatches.filter(match => {
                        const available = contextAvailableValues.get(match.value.columnId);
                        return available?.strings.has(match.value.value) ?? false;
                      })
                    : tokenMatches;
                  
                  // Find best match for this token that belongs to the current column
                  const bestMatch = filteredMatches.find(m => m.value.columnId === col.id);
                  if (bestMatch) {
                    // Track this token's match for highlighting
                    tokenMatchInfo.push({ 
                      token: valueToken, 
                      matchedValue: bestMatch.value.value, 
                      score: bestMatch.score 
                    });
                    // Avoid duplicates in the final values list
                    if (!matchedValues.some(v => v.value === bestMatch.value.value)) {
                      matchedValues.push({ value: bestMatch.value.value, score: bestMatch.score });
                    }
                  } else {
                    tokenMatchInfo.push(null);
                  }
                }
                
                if (matchedValues.length > 0) {
                  // Create a suggestion with all matched values
                  const colScore = parsed.column.match.score;
                  const opScore = parsed.operator?.match.score ?? 0;
                  const colBonus = colScore >= -100 ? 500 : Math.max(0, 500 + colScore);
                  const opBonus = opScore >= -100 ? 500 : Math.max(0, 500 + opScore);
                  const avgValScore = matchedValues.reduce((sum, v) => sum + v.score, 0) / matchedValues.length;
                  const valBonus = avgValScore >= -100 ? 500 : Math.max(0, 500 + avgValScore);
                  // Bonus for matching more values (using more of the input)
                  const valueCoverageBonus = Math.round((matchedValues.length / valueTokens.length) * 1000);
                  const combinedScore = 8000 + colBonus + opBonus + valBonus + valueCoverageBonus;
                  
                  const args: HypothesisValueType[] = matchedValues.map(v => ({ kind: "string", value: v.value }));
                  const key = `${col.id}:${op}:${matchedValues.map(v => v.value).join(",")}`;
                  
                  // Build match metadata for highlighting - only include tokens that matched
                  const colToken = parsed.column!.token;
                  const opToken = parsed.operator!.token;
                  const valueMatchEntries = tokenMatchInfo
                    .filter((info): info is { token: Token; matchedValue: string; score: number } => info !== null)
                    .map(info => ({
                      inputStart: info.token.start,
                      inputEnd: info.token.end,
                      inputText: info.token.text,
                      matchedTarget: info.matchedValue,
                      score: info.score,
                    }));
                  
                  const matchMeta: MatchMetadata = {
                    column: {
                      inputStart: colToken.start,
                      inputEnd: colToken.end,
                      inputText: colToken.text,
                      matchedTarget: col.name,
                      score: colScore,
                    },
                    operator: {
                      inputStart: opToken.start,
                      inputEnd: opToken.end,
                      inputText: opToken.text,
                      matchedTarget: op,
                      score: opScore,
                    },
                    values: valueMatchEntries,
                  };
                  
                  if (!seenValues.has(key)) {
                    seenValues.add(key);
                    suggestions.push(
                      createSuggestion(
                        col,
                        op,
                        args,
                        combinedScore,
                        undefined,
                        undefined,
                        contextRowIndices,
                        matchMeta,
                        tokens
                      )
                    );
                  }
                }
              } else {
                // Non-variadic operator: search for single value
                const valueQuery = valueTokens.map((t) => t.normalized).join(" ");
                const valMatchesRaw = state.valueTrie.fuzzySearch(valueQuery, 10);
                
                const valMatches = contextAvailableValues
                  ? valMatchesRaw.filter(match => {
                      const available = contextAvailableValues.get(match.value.columnId);
                      return available?.strings.has(match.value.value) ?? false;
                    })
                  : valMatchesRaw;
                
                for (const match of valMatches) {
                  if (match.value.columnId === col.id) {
                    const colScore = parsed.column.match.score;
                    const opScore = parsed.operator?.match.score ?? 0;
                    const colBonus = colScore >= -100 ? 500 : Math.max(0, 500 + colScore);
                    const opBonus = opScore >= -100 ? 500 : Math.max(0, 500 + opScore);
                    const valBonus = match.score >= -100 ? 500 : Math.max(0, 500 + match.score);
                    const combinedScore = 8000 + colBonus + opBonus + valBonus;
                    const key = `${col.id}:${op}:${match.value.value}`;
                    if (!seenValues.has(key)) {
                      seenValues.add(key);
                      const rowCount = contextRowIndices !== null ? undefined : match.value.rowCount;
                      suggestions.push(
                        createSuggestion(
                          col,
                          op,
                          [{ kind: "string", value: match.value.value }],
                          combinedScore,
                          rowCount,
                          undefined,
                          contextRowIndices,
                          undefined,
                          tokens
                        )
                      );
                    }
                  }
                }
              }
            } else {
              // No value tokens yet, suggest all values for this column
              // Filter to only values available in the context
              const allValues = state.valueTrie
                .entries()
                .filter((e) => e.value.columnId === col.id)
                .filter((e) => {
                  if (!contextAvailableValues) return true;
                  return contextAvailableValues.get(col.id)?.strings.has(e.value.value) ?? false;
                })
                .slice(0, 10);

              for (const entry of allValues) {
                const key = `${col.id}:${op}:${entry.value.value}`;
                if (!seenValues.has(key)) {
                  seenValues.add(key);
                  // When there's a filter context, compute count dynamically
                  const rowCount = contextRowIndices !== null ? undefined : entry.value.rowCount;
                  suggestions.push(
                    createSuggestion(
                      col,
                      op,
                      [{ kind: "string", value: entry.value.value }],
                      parsed.column.match.score,
                      rowCount,
                      undefined,
                      contextRowIndices,
                      undefined,
                      tokens
                    )
                  );
                }
              }
            }
          }
        } else {
          // Operator doesn't need value - suggest the complete filter
          suggestions.push(
            createSuggestion(
              col,
              op,
              undefined,
              parsed.column.match.score + parsed.operator.match.score,
              undefined,
              undefined,
              contextRowIndices,
              undefined,
              tokens
            )
          );
        }
      }

      // =========================================================================
      // Strategy 3: Value-only input detection
      // When no column/operator matches are found, but tokens look like argument
      // values (numbers, dates, or indexed string values), suggest filters for
      // compatible columns with appropriate operators.
      // =========================================================================
      const hasColumnMatches = columnScores.size > 0;
      const hasOperatorMatches = operatorScores.size > 0;
      
      if (!hasColumnMatches && !hasOperatorMatches && tokens.length >= 1) {
        // Detect all potential argument values from tokens
        const allDetectedValues = detectValueTokens(tokens, new Set());
        
        // For variadic operators, we need position-based deduplication:
        // Each character position in the input can only be "spent" once.
        // This prevents overlapping ngrams from independently contributing values.
        // For example, "insert autus sorder" generates ngrams like "insert", "autus", 
        // "insert autus", etc. - these overlap and should compete for the same positions.
        
        // Step 1: Collect ALL value matches per column with their ngram positions
        const allMatchesByColumn = new Map<ColumnId, PositionedValueMatch[]>();
        for (const [_key, { match, breakdown, ngram }] of valueScores) {
          if (!allMatchesByColumn.has(match.value.columnId)) {
            allMatchesByColumn.set(match.value.columnId, []);
          }
          allMatchesByColumn.get(match.value.columnId)!.push({
            value: match.value.value,
            score: breakdown.adjustedScore,
            ngram,
          });
        }
        
        // Step 2: For each column, select non-overlapping matches
        // This ensures each input position contributes to at most one value
        const stringValueMatches: Map<ColumnId, PositionedValueMatch[]> = new Map();
        for (const [columnId, matches] of allMatchesByColumn) {
          const nonOverlapping = selectNonOverlappingMatches(matches);
          // Deduplicate by value (same value matched by different non-overlapping ngrams)
          const seen = new Set<string>();
          const dedupedMatches: PositionedValueMatch[] = [];
          for (const m of nonOverlapping) {
            if (!seen.has(m.value)) {
              seen.add(m.value);
              dedupedMatches.push(m);
            }
          }
          if (dedupedMatches.length > 0) {
            stringValueMatches.set(columnId, dedupedMatches);
          }
        }
        
        // Generate suggestions for numeric columns when we have numeric tokens
        if (allDetectedValues.numbers.length >= 1) {
          for (const col of getColumns(state.schema!)) {
            if (col.type !== DataType.NUMBER) continue;
            
            // Filter to only numeric values that exist in the context for this column
            const numValues = allDetectedValues.numbers
              .map(n => n.value)
              .filter(val => {
                if (!contextAvailableValues) return true;
                return contextAvailableValues.get(col.id)?.numbers.has(val) ?? false;
              });
            
            if (numValues.length === 0) continue;
            
            const ops = getOperatorsForType(col.type);
            
            // Base score for value-only suggestions (high because user provided explicit values)
            const baseScore = 1500;
            
            if (numValues.length >= 2) {
              // Multiple values: prioritize between, in operators
              for (const op of ops) {
                const opInfo = getOperator(op.id);
                
                let valuesUsed = 0;
                let suggestionArgs: HypothesisValueType[] | undefined;
                
                if (opInfo.isVariadic) {
                  const minArgs = opInfo.minArguments ?? 1;
                  
                  if (minArgs === 2) {
                    // Operators like "between" that need exactly 2 values
                    valuesUsed = 2;
                    // Sort values to ensure start < end
                    const sorted = [...numValues].slice(0, 2).sort((a, b) => a - b);
                    suggestionArgs = sorted.map(v => toHypothesisValue(v));
                  } else {
                    // Operators like "in"/"nin" that accept any number of values
                    valuesUsed = numValues.length;
                    suggestionArgs = numValues.map(v => toHypothesisValue(v));
                  }
                } else if (opInfo.requiresArgument) {
                  // Single-value operator - uses first value
                  valuesUsed = 1;
                  suggestionArgs = [toHypothesisValue(numValues[0]!)];
                }
                
                if (valuesUsed > 0) {
                  // Calculate argument coverage bonus
                  const argumentCoverageBonus = Math.round((valuesUsed / numValues.length) * 1500);
                  const adjustedScore = baseScore + argumentCoverageBonus;
                  
                  suggestions.push(createSuggestion(
                    col, 
                    op.id, 
                    suggestionArgs, 
                    adjustedScore, 
                    undefined, 
                    undefined, 
                    contextRowIndices
                  ));
                }
              }
            } else {
              // Single numeric value
              const numVal = numValues[0]!;
              for (const op of ops.slice(0, 5)) {
                const opInfo = getOperator(op.id);
                if (!opInfo.requiresArgument || opInfo.isVariadic) continue;
                
                suggestions.push(createSuggestion(
                  col, 
                  op.id, 
                  [toHypothesisValue(numVal)], 
                  baseScore + 1500, // Full coverage bonus
                  undefined, 
                  undefined, 
                  contextRowIndices
                ));
              }
            }
          }
        }
        
        // Generate suggestions for date columns when we have date tokens
        if (allDetectedValues.dates.length >= 1) {
          for (const col of getColumns(state.schema!)) {
            if (col.type !== DataType.DATE) continue;
            
            // Filter to only date values that exist in the context for this column
            const dateValues = allDetectedValues.dates
              .map(d => d.value)
              .filter(val => {
                if (!contextAvailableValues) return true;
                return contextAvailableValues.get(col.id)?.dates.has(val.getTime()) ?? false;
              });
            
            if (dateValues.length === 0) continue;
            
            const ops = getOperatorsForType(col.type);
            const baseScore = 1500;
            
            if (dateValues.length >= 2) {
              // Multiple dates: prioritize between
              for (const op of ops) {
                const opInfo = getOperator(op.id);
                
                let valuesUsed = 0;
                let suggestionArgs: HypothesisValueType[] | undefined;
                
                if (opInfo.isVariadic) {
                  const minArgs = opInfo.minArguments ?? 1;
                  
                  if (minArgs === 2) {
                    // Operators like "between" that need exactly 2 values
                    valuesUsed = 2;
                    const sorted = [...dateValues].slice(0, 2).sort((a, b) => a.getTime() - b.getTime());
                    suggestionArgs = sorted.map(v => toHypothesisValue(v));
                  } else {
                    // Operators that accept any number of values
                    valuesUsed = dateValues.length;
                    suggestionArgs = dateValues.map(v => toHypothesisValue(v));
                  }
                } else if (opInfo.requiresArgument) {
                  valuesUsed = 1;
                  suggestionArgs = [toHypothesisValue(dateValues[0]!)];
                }
                
                if (valuesUsed > 0) {
                  const argumentCoverageBonus = Math.round((valuesUsed / dateValues.length) * 1500);
                  const adjustedScore = baseScore + argumentCoverageBonus;
                  
                  suggestions.push(createSuggestion(
                    col, 
                    op.id, 
                    suggestionArgs, 
                    adjustedScore, 
                    undefined, 
                    undefined, 
                    contextRowIndices
                  ));
                }
              }
            } else {
              // Single date value
              const dateVal = dateValues[0]!;
              for (const op of ops.slice(0, 5)) {
                const opInfo = getOperator(op.id);
                if (!opInfo.requiresArgument || opInfo.isVariadic) continue;
                
                suggestions.push(createSuggestion(
                  col, 
                  op.id, 
                  [toHypothesisValue(dateVal)], 
                  baseScore + 1500,
                  undefined, 
                  undefined, 
                  contextRowIndices
                ));
              }
            }
          }
        }
        
        // Generate suggestions for string/enum columns when we have indexed value matches
        // Group by column and generate in/eq suggestions
        for (const [columnId, valueMatches] of stringValueMatches) {
          const col = getColumnById(columnId);
          if (!col || (col.type !== DataType.STRING && col.type !== DataType.ENUM)) continue;

          if (valueMatches.length >= 2) {
            // Multiple values matched for same column: suggest "in" and "nin" operators
            // Score higher than single-value suggestions since we explain more of the query
            const ops = getOperatorsForType(col.type);
            const variadicOps = ops.filter(op => {
              const opInfo = getOperator(op.id);
              return opInfo.isVariadic && (opInfo.minArguments ?? 1) === 1;
            });
            
            // Use scores from the non-overlapping matches directly
            const avgValueScore = valueMatches.reduce((sum, v) => sum + v.score, 0) / valueMatches.length;
            
            // Multi-value bonus: each additional value explained is worth more
            const multiValueBonus = valueMatches.length * 1500;
            // Coverage bonus: how much of the query tokens we've explained
            const coverageBonus = Math.round((valueMatches.length / tokens.length) * 2000);
            
            const combinedScore = avgValueScore + multiValueBonus + coverageBonus;
            
            for (const op of variadicOps) {
              suggestions.push(createSuggestion(
                col,
                op.id,
                valueMatches.map(v => toHypothesisValue(v.value)),
                combinedScore,
                undefined,
                undefined,
                contextRowIndices
              ));
            }
          }
          // Note: Single string value matches are already handled by the valueScores loop above
        }
      }
      
      // =========================================================================
      // Strategy 3.5: Column-matched multi-value aggregation (without explicit operator)
      // When a column IS matched AND multiple string values match for that column,
      // but NO explicit operator is matched, generate variadic suggestions (in, nin)
      // that use ALL matching values.
      // This handles queries like "status open closed" where:
      // - "status" matches the Status column
      // - "open" and "closed" match string values for that column
      // - We should suggest "Status in [Open, Closed]" and "Status nin [Open, Closed]"
      // Note: When an operator IS explicitly matched (e.g., "status in open closed"),
      // Strategy 4 handles the multi-value aggregation instead.
      // =========================================================================
      if (hasColumnMatches && valueScores.size > 0 && !hasOperatorMatches) {
        // Collect ALL value matches per column with their ngram positions
        const allValueMatchesByColumn = new Map<ColumnId, PositionedValueMatch[]>();
        for (const [_key, { match, breakdown, ngram: valNgram }] of valueScores) {
          if (!allValueMatchesByColumn.has(match.value.columnId)) {
            allValueMatchesByColumn.set(match.value.columnId, []);
          }
          allValueMatchesByColumn.get(match.value.columnId)!.push({
            value: match.value.value,
            score: breakdown.adjustedScore,
            ngram: valNgram,
          });
        }
        
        // For each column that has a column match, aggregate values using position-based deduplication
        for (const [colId, colEntry] of columnScores) {
          const col = getColumnById(colId as ColumnId);
          if (!col || (col.type !== DataType.STRING && col.type !== DataType.ENUM)) continue;
          
          const matchesForCol = allValueMatchesByColumn.get(col.id);
          if (!matchesForCol || matchesForCol.length === 0) continue;
          
          // Exclude the column's input positions from value matching
          // (those positions are "used" by the column match)
          const excludedPositions = [{ start: colEntry.ngram.inputStart, end: colEntry.ngram.inputEnd }];
          
          // Select non-overlapping value matches (excluding column positions)
          const nonOverlapping = selectNonOverlappingMatches(matchesForCol, excludedPositions);
          
          // Deduplicate by value
          const seenValueStrings = new Set<string>();
          const aggregatedValues: PositionedValueMatch[] = [];
          for (const m of nonOverlapping) {
            if (!seenValueStrings.has(m.value)) {
              seenValueStrings.add(m.value);
              aggregatedValues.push(m);
            }
          }
          
          // Only generate multi-value suggestions if we have 2+ values
          if (aggregatedValues.length >= 2) {
            const ops = getOperatorsForType(col.type);
            const variadicOps = ops.filter(op => {
              const opInfo = getOperator(op.id);
              return opInfo.isVariadic && (opInfo.minArguments ?? 1) === 1;
            });
            
            for (const op of variadicOps) {
              const args: HypothesisValueType[] = aggregatedValues.map(v => toHypothesisValue(v.value));
              
              // Calculate score: column score + average value scores + multi-value coverage bonus
              const avgValueScore = aggregatedValues.reduce((sum, v) => sum + v.score, 0) / aggregatedValues.length;
              // Big bonus for using multiple values - each additional value explained is worth more
              const multiValueBonus = aggregatedValues.length * 1500;
              // Coverage bonus: how much of the non-column tokens we've explained
              const nonColTokenCount = Math.max(1, tokens.length - 1); // Assume 1 token used for column
              const valueCoverage = aggregatedValues.length / nonColTokenCount;
              const coverageBonus = Math.round(valueCoverage * 2000);
              
              const combinedScore = colEntry.breakdown.adjustedScore + avgValueScore + multiValueBonus + coverageBonus;
              
              // Build match metadata
              const matchMeta: MatchMetadata = {
                column: {
                  inputStart: colEntry.ngram.inputStart,
                  inputEnd: colEntry.ngram.inputEnd,
                  inputText: colEntry.ngram.text,
                  matchedTarget: colEntry.matchedTarget,
                  matchIndexes: colEntry.matchIndexes,
                  score: colEntry.breakdown.rawScore,
                },
                values: aggregatedValues.map(v => ({
                  inputStart: v.ngram.inputStart,
                  inputEnd: v.ngram.inputEnd,
                  inputText: v.ngram.text,
                  matchedTarget: v.value,
                  score: v.score,
                })),
              };
              
              const key = `${col.id}:${op.id}:${aggregatedValues.map(v => v.value).join(",")}`;
              if (!seenValues.has(key)) {
                seenValues.add(key);
                suggestions.push(
                  createSuggestion(
                    col,
                    op.id,
                    args,
                    combinedScore,
                    undefined,
                    undefined,
                    contextRowIndices,
                    matchMeta,
                    tokens
                  )
                );
              }
            }
          }
        }
      }
      
      // =========================================================================
      // Strategy 4: Operator-matched variadic value aggregation
      // When an operator IS matched (e.g., "one of" → "in") but no column is matched,
      // combine multiple string values for the same column into a multi-value suggestion.
      // This handles queries like "one of open closed" where the operator is matched
      // via an alias but we need to aggregate the values.
      // =========================================================================
      if (hasOperatorMatches && valueScores.size > 0) {
        // Collect ALL value matches per column with their ngram positions
        const allValueMatchesByColumnForOp = new Map<ColumnId, PositionedValueMatch[]>();
        for (const [_key, { match, breakdown, ngram: valNgram }] of valueScores) {
          if (!allValueMatchesByColumnForOp.has(match.value.columnId)) {
            allValueMatchesByColumnForOp.set(match.value.columnId, []);
          }
          allValueMatchesByColumnForOp.get(match.value.columnId)!.push({
            value: match.value.value,
            score: breakdown.adjustedScore,
            ngram: valNgram,
          });
        }
        
        // For each matched variadic operator, create combined suggestions
        for (const [_opKey, { breakdown: opBreakdown, operator, matchedAlias, ngram: opNgram, matchedTarget: opMatchedTarget, matchIndexes: opMatchIndexes }] of operatorScores) {
          const opInfo = getOperator(operator);
          if (!opInfo.isVariadic) continue;
          
          // For each column, use position-based deduplication
          for (const [colId, matchesForCol] of allValueMatchesByColumnForOp) {
            const col = getColumnById(colId);
            if (!col || !opInfo.supportedTypes.includes(col.type)) continue;
            
            // Check if column was also matched
            const colMatchEntry = columnScores.get(col.id as string);
            
            // Exclude positions used by operator and column matches
            const excludedPositions: Array<{ start: number; end: number }> = [
              { start: opNgram.inputStart, end: opNgram.inputEnd },
            ];
            if (colMatchEntry) {
              excludedPositions.push({ start: colMatchEntry.ngram.inputStart, end: colMatchEntry.ngram.inputEnd });
            }
            
            // Select non-overlapping value matches
            const nonOverlapping = selectNonOverlappingMatches(matchesForCol, excludedPositions);
            
            // Deduplicate by value
            const seenValueStrings = new Set<string>();
            const values: PositionedValueMatch[] = [];
            for (const m of nonOverlapping) {
              if (!seenValueStrings.has(m.value)) {
                seenValueStrings.add(m.value);
                values.push(m);
              }
            }
            
            if (values.length < 2) continue; // Need at least 2 values for variadic to make sense
            
            // Calculate combined score
            const avgValScore = values.reduce((sum, v) => sum + v.score, 0) / values.length;
            const valueCoverageBonus = Math.round((values.length / tokens.length) * 1000);
            const combinedScore = opBreakdown.adjustedScore + avgValScore + valueCoverageBonus + 
              (colMatchEntry ? colMatchEntry.breakdown.adjustedScore : 0);
            
            // Build match metadata
            const matchMeta: MatchMetadata = {
              column: colMatchEntry ? {
                inputStart: colMatchEntry.ngram.inputStart,
                inputEnd: colMatchEntry.ngram.inputEnd,
                inputText: colMatchEntry.ngram.text,
                matchedTarget: colMatchEntry.matchedTarget,
                matchIndexes: colMatchEntry.matchIndexes,
                score: colMatchEntry.breakdown.rawScore,
              } : undefined,
              operator: {
                inputStart: opNgram.inputStart,
                inputEnd: opNgram.inputEnd,
                inputText: opNgram.text,
                matchedTarget: opMatchedTarget,
                matchIndexes: opMatchIndexes,
                score: opBreakdown.rawScore,
              },
              values: values.map(v => ({
                inputStart: v.ngram.inputStart,
                inputEnd: v.ngram.inputEnd,
                inputText: v.ngram.text,
                matchedTarget: v.value,
                score: v.score,
              })),
            };
            
            suggestions.push(
              createSuggestion(
                col,
                operator,
                values.map(v => toHypothesisValue(v.value)),
                combinedScore,
                undefined,
                matchedAlias,
                contextRowIndices,
                matchMeta,
                tokens
              )
            );
          }
        }
      }
    }

    // Deduplicate and sort
    const seen = new Set<string>();
    const uniqueSuggestions = suggestions.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    // Sort by score (higher = better)
    uniqueSuggestions.sort((a, b) => b.score - a.score);

    // Limit results
    const limitedSuggestions = uniqueSuggestions.slice(
      0,
      config.maxSuggestions
    );

    // Compute result counts only for the final limited suggestions (lazy evaluation)
    // This avoids computing counts for suggestions that won't be shown
    for (const suggestion of limitedSuggestions) {
      if (suggestion.resultCount === -1) {
        // Check if this is a date filter based on arguments
        const firstArg = suggestion.arguments?.[0];
        const hasDateArg = firstArg?.kind === "date";

        if (hasDateArg) {
          // For date filters, build ParsedDate from arguments
          const firstDate = firstArg.value as Date;
          const secondArg = suggestion.arguments?.[1];
          const secondDate = secondArg?.kind === "date" ? (secondArg.value as Date) : undefined;

          // Use parsed info from first arg, or construct one
          const baseParsed = firstArg.parsed;
          const parsedDate: ParsedDate = baseParsed
            ? {
                ...baseParsed,
                // Override range if we have two date arguments
                rangeStart: secondDate ? firstDate : baseParsed.rangeStart,
                rangeEnd: secondDate || baseParsed.rangeEnd,
              }
            : {
                text: "",
                date: firstDate,
                isRange: !!secondDate,
                consumedText: "",
                rangeStart: secondDate ? firstDate : undefined,
                rangeEnd: secondDate,
              };

          suggestion.resultCount = countForDateFilter(
            suggestion.column.id,
            suggestion.operator,
            parsedDate,
            contextRowIndices
          );
        } else {
          suggestion.resultCount = countForFilter(
            suggestion.column.id,
            suggestion.operator,
            suggestion.arguments,
            contextRowIndices
          );
        }
      }
    }

    return {
      query,
      cursorPosition: cursorPosition ?? query.length,
      suggestions: limitedSuggestions,
      totalCount: uniqueSuggestions.length,
      responseTimeMs: performance.now() - startTime,
      parseInfo: {
        tokens: tokens.map((t) => t.text),
        dominantStrategy:
          tokens.length === 0
            ? "exploratory"
            : tokens.length === 1
              ? "exploratory"
              : "fullParse",
      },
    };
  }

  /**
   * Truncates a long value string to show the matched portion with ellipsis.
   * Shows context around the matched portion within a max width.
   * 
   * @param value - The full value string
   * @param matchedIndexes - The matched character indexes (from fuzzy matching)
   * @param maxDisplayLength - Maximum display length (default: 30)
   * @returns Truncated string with ellipsis, or undefined if no truncation needed
   */
  function truncateWithEllipsis(
    value: string,
    matchedIndexes?: readonly number[],
    maxDisplayLength = 30
  ): string | undefined {
    // If value is short enough, no truncation needed
    if (value.length <= maxDisplayLength) {
      return undefined;
    }
    
    // If no match indexes, truncate from the start
    if (!matchedIndexes || matchedIndexes.length === 0) {
      return value.slice(0, maxDisplayLength - 1) + "…";
    }
    
    // Find the range of matched characters
    const firstMatchIdx = Math.min(...matchedIndexes);
    const lastMatchIdx = Math.max(...matchedIndexes);
    const matchLength = lastMatchIdx - firstMatchIdx + 1;
    
    // Calculate padding around the match
    const availableSpace = maxDisplayLength - matchLength - 2; // Reserve space for ellipses
    const paddingBefore = Math.floor(availableSpace / 2);
    const paddingAfter = Math.ceil(availableSpace / 2);
    
    // Calculate visible range
    let start = Math.max(0, firstMatchIdx - paddingBefore);
    let end = Math.min(value.length, lastMatchIdx + paddingAfter + 1);
    
    // Adjust if we're near the edges
    if (start === 0) {
      end = Math.min(value.length, maxDisplayLength - 1);
    } else if (end === value.length) {
      start = Math.max(0, value.length - maxDisplayLength + 1);
    }
    
    // Build truncated string with ellipsis
    const showStartEllipsis = start > 0;
    const showEndEllipsis = end < value.length;
    
    let result = value.slice(start, end);
    if (showStartEllipsis) {
      result = "…" + result;
    }
    if (showEndEllipsis) {
      result = result + "…";
    }
    
    return result;
  }

  function createSuggestion(
    column: AnyColumnDefinition,
    operator: Operator,
    args: HypothesisValueType[] | undefined,
    scoreOrBreakdown: number | ScoreBreakdown,
    resultCount?: number,
    matchedAlias?: string,
    _contextRowIndices: Set<number> | null = null,
    matchMetadata?: MatchMetadata,
    queryTokens?: Token[]
  ): FilterSuggestion {
    const opInfo = getOperator(operator);
    
    // Format value text based on arguments
    let valueText = "";
    const argumentParts: { text: string; displayText?: string; highlight?: boolean }[] = [];
    
    if (args && args.length > 0) {
      const formattedValues = args.map(arg => {
        if (arg.kind === "string") return arg.value;
        if (arg.kind === "number") return String(arg.value);
        if (arg.kind === "date") return formatDateForDisplay(arg.value);
        if (arg.kind === "boolean") return String(arg.value);
        return "";
      }).filter(v => v !== "");
      
      // For between, format as "X - Y", for in/nin format as "X, Y, Z"
      if (operator === "between" && formattedValues.length >= 2) {
        valueText = `${formattedValues[0]} - ${formattedValues[1]}`;
      } else {
        valueText = formattedValues.join(", ");
      }
      
      // Create argument parts with truncation for long values
      // Match each formatted value to its corresponding match metadata
      for (let i = 0; i < formattedValues.length; i++) {
        const val = formattedValues[i]!;
        // Find the matching value in matchMetadata (if available)
        const valueMatch = matchMetadata?.values?.find(v => v.matchedTarget === val);
        const displayText = truncateWithEllipsis(val, valueMatch?.matchIndexes);
        argumentParts.push({ text: val, displayText });
      }
    }
    
    // Use matched alias in label if provided, otherwise use operator label
    const operatorDisplay = matchedAlias ?? opInfo.label;
    const label = valueText
      ? `${column.name} ${operatorDisplay} ${valueText}`
      : `${column.name} ${operatorDisplay}`;

    const completionText = valueText
      ? `${column.name} ${operator} "${valueText}"`
      : `${column.name} ${operator} `;

    // Handle both plain score and breakdown
    const isBreakdown = typeof scoreOrBreakdown === "object";
    let score = isBreakdown ? scoreOrBreakdown.adjustedScore : scoreOrBreakdown;
    
    // Calculate token coverage bonus
    // Using more tokens from the query should give a small bonus (tiebreaker)
    // This is proportional and capped so it doesn't override match quality
    // Max bonus: 500 (for 100% coverage), scaled linearly
    if (queryTokens && queryTokens.length > 0 && matchMetadata) {
      const coveredTokenIndices = new Set<number>();
      
      // Helper to mark tokens as covered based on character range
      const markCoveredTokens = (inputStart: number, inputEnd: number) => {
        for (let i = 0; i < queryTokens.length; i++) {
          const token = queryTokens[i]!;
          // A token is covered if its range overlaps with the match range
          if (token.start < inputEnd && token.end > inputStart) {
            coveredTokenIndices.add(i);
          }
        }
      };
      
      // Mark tokens covered by column match
      if (matchMetadata.column) {
        markCoveredTokens(matchMetadata.column.inputStart, matchMetadata.column.inputEnd);
      }
      
      // Mark tokens covered by operator match
      if (matchMetadata.operator) {
        markCoveredTokens(matchMetadata.operator.inputStart, matchMetadata.operator.inputEnd);
      }
      
      // Mark tokens covered by value matches
      if (matchMetadata.values) {
        for (const val of matchMetadata.values) {
          markCoveredTokens(val.inputStart, val.inputEnd);
        }
      }
      
      // For suggestions with detected numeric/date values (not string values from index),
      // mark the value tokens as covered if we have arguments
      if (args && args.length > 0) {
        for (const arg of args) {
          if (arg.kind === "number" || arg.kind === "date") {
            // Find the token that matches this value
            const valueStr = arg.kind === "number" ? String(arg.value) : "";
            for (let i = 0; i < queryTokens.length; i++) {
              const token = queryTokens[i]!;
              // Check if this token represents the numeric value
              if (arg.kind === "number" && token.text === valueStr) {
                coveredTokenIndices.add(i);
              }
              // For dates, check if the token could be part of a date expression
              if (arg.kind === "date" && !isNaN(parseFloat(token.text))) {
                coveredTokenIndices.add(i);
              }
            }
          }
        }
      }
      
      // Calculate token coverage bonus (proportional, max 2500 for full coverage)
      // This is a PRIMARY ranking factor - suggestions that explain more of the query
      // should score significantly higher than those that leave tokens unexplained.
      // For example, "Priority in 1 2 3" (all tokens used) should beat "Priority in 1"
      // (leaves "2" and "3" unexplained) when the user types "in 1 2 3".
      const coverageRatio = coveredTokenIndices.size / queryTokens.length;
      const tokenCoverageBonus = Math.round(coverageRatio * 2500);
      score += tokenCoverageBonus;
    }
    
    const scoreBreakdown = isBreakdown
      ? {
          rawScore: scoreOrBreakdown.rawScore,
          coverageBonus: scoreOrBreakdown.coverageBonus,
          completenessBonus: scoreOrBreakdown.completenessBonus,
          fullQueryBonus: scoreOrBreakdown.fullQueryBonus,
          exactMatchBonus: scoreOrBreakdown.exactMatchBonus,
          tokenCount: scoreOrBreakdown.tokenCount,
          totalTokens: scoreOrBreakdown.totalTokens,
        }
      : undefined;

    // Build queryMatches array from match metadata
    const queryMatches: QueryMatch[] = [];
    if (matchMetadata) {
      if (matchMetadata.column) {
        queryMatches.push({
          inputRange: { start: matchMetadata.column.inputStart, end: matchMetadata.column.inputEnd },
          inputText: matchMetadata.column.inputText,
          matchType: "column",
          matchedTarget: matchMetadata.column.matchedTarget,
          matchedCharIndexes: matchMetadata.column.matchIndexes ? [...matchMetadata.column.matchIndexes] : undefined,
          score: matchMetadata.column.score,
        });
      }
      if (matchMetadata.operator) {
        queryMatches.push({
          inputRange: { start: matchMetadata.operator.inputStart, end: matchMetadata.operator.inputEnd },
          inputText: matchMetadata.operator.inputText,
          matchType: "operator",
          matchedTarget: matchMetadata.operator.matchedTarget,
          matchedCharIndexes: matchMetadata.operator.matchIndexes ? [...matchMetadata.operator.matchIndexes] : undefined,
          score: matchMetadata.operator.score,
        });
      }
      if (matchMetadata.values) {
        for (const val of matchMetadata.values) {
          queryMatches.push({
            inputRange: { start: val.inputStart, end: val.inputEnd },
            inputText: val.inputText,
            matchType: "value",
            matchedTarget: val.matchedTarget,
            matchedCharIndexes: val.matchIndexes ? [...val.matchIndexes] : undefined,
            score: val.score,
          });
        }
      }
    }

    return {
      id: `${column.id}:${operator}:${valueText}`,
      label,
      parts: {
        column: { text: column.name },
        operator: { 
          text: opInfo.label, 
          symbol: opInfo.symbol,
          matchedAlias: matchedAlias,
        },
        arguments: argumentParts.length > 0 ? argumentParts : undefined,
      },
      column,
      operator,
      arguments: args,
      // Defer count computation to post-processing (lazy evaluation)
      // Use -1 as placeholder; counts are computed only for final suggestions
      resultCount: resultCount ?? -1,
      score,
      scoreBreakdown,
      isComplete: !opInfo.requiresArgument || (
        args !== undefined && 
        args.length > 0 && 
        // Variadic operators may require a minimum number of arguments
        (!opInfo.isVariadic || args.length >= (opInfo.minArguments ?? 1))
      ),
      completionText,
      cursorPositionAfter: completionText.length,
      category: score === 0 ? "exact" : scoreBreakdown?.rawScore === 0 ? "exact" : "fuzzy",
      queryMatches: queryMatches.length > 0 ? queryMatches : undefined,
    };
  }

  function countForFilter(
    columnId: ColumnId,
    operator: Operator,
    args: HypothesisValueType[] | undefined,
    contextRowIndices: Set<number> | null = null
  ): number {
    // Determine which rows to iterate over
    const rowsToCheck = contextRowIndices !== null 
      ? Array.from(contextRowIndices).map(i => state.data[i]!)
      : state.data;
    
    // Handle no-argument operators (isTrue, isFalse, isEmpty, isNotEmpty)
    // These operators don't need arguments but still need to filter
    if (!args || args.length === 0) {
      // Check if this is a no-argument operator that still needs filtering
      if (operator === "isTrue" || operator === "isFalse" || operator === "isEmpty" || operator === "isNotEmpty") {
        let count = 0;
        for (const row of rowsToCheck) {
          const cellValue = row[columnId as string];
          switch (operator) {
            case "isTrue":
              if (cellValue === true) count++;
              break;
            case "isFalse":
              if (cellValue === false) count++;
              break;
            case "isEmpty":
              if (cellValue == null || cellValue === "") count++;
              break;
            case "isNotEmpty":
              if (cellValue != null && cellValue !== "") count++;
              break;
          }
        }
        return count;
      }
      // For other operators without arguments, return total count
      return rowsToCheck.length;
    }

    const firstArg = args[0]!;
    
    // Handle single argument operators
    if (args.length === 1) {
      if (firstArg.kind === "string") {
        let count = 0;
        for (const row of rowsToCheck) {
          const cellValue = row[columnId as string];
          if (cellValue == null) continue;
          const strValue = String(cellValue);
          switch (operator) {
            case "eq": if (strValue === firstArg.value) count++; break;
            case "eqIgnoreCase": if (strValue.toLowerCase() === firstArg.value.toLowerCase()) count++; break;
            case "neq": if (strValue !== firstArg.value) count++; break;
            case "contains": if (strValue.includes(firstArg.value)) count++; break;
            case "startsWith": if (strValue.startsWith(firstArg.value)) count++; break;
            case "endsWith": if (strValue.endsWith(firstArg.value)) count++; break;
            default: count++;
          }
        }
        return count;
      }

      if (firstArg.kind === "number") {
        let count = 0;
        for (const row of rowsToCheck) {
          const cellValue = row[columnId as string];
          if (cellValue == null) continue;
          const numValue = typeof cellValue === "number" ? cellValue : parseFloat(String(cellValue));
          if (!isFinite(numValue)) continue;
          switch (operator) {
            case "eq": if (numValue === firstArg.value) count++; break;
            case "neq": if (numValue !== firstArg.value) count++; break;
            case "lt": if (numValue < firstArg.value) count++; break;
            case "lte": if (numValue <= firstArg.value) count++; break;
            case "gt": if (numValue > firstArg.value) count++; break;
            case "gte": if (numValue >= firstArg.value) count++; break;
            default: count++;
          }
        }
        return count;
      }

      if (firstArg.kind === "date") {
        let count = 0;
        const targetDate = firstArg.value;
        for (const row of rowsToCheck) {
          const cellValue = row[columnId as string];
          if (cellValue == null) continue;
          const dateValue = cellValue instanceof Date ? cellValue : new Date(String(cellValue));
          if (isNaN(dateValue.getTime())) continue;
          switch (operator) {
            case "eq": if (isSameDay(dateValue, targetDate)) count++; break;
            case "neq": if (!isSameDay(dateValue, targetDate)) count++; break;
            case "lt":
            case "before": if (dateValue < targetDate) count++; break;
            case "lte": if (dateValue <= targetDate || isSameDay(dateValue, targetDate)) count++; break;
            case "gt":
            case "after": if (dateValue > targetDate) count++; break;
            case "gte": if (dateValue >= targetDate || isSameDay(dateValue, targetDate)) count++; break;
            default: count++;
          }
        }
        return count;
      }
    }

    // Handle variadic operators (between, in, nin)
    if (args.length >= 2) {
      let count = 0;
      for (const row of rowsToCheck) {
        const cellValue = row[columnId as string];
        if (cellValue == null) continue;

        switch (operator) {
          case "between":
            const start = args[0]!;
            const end = args[1]!;
            if (start.kind === "number" && end.kind === "number") {
              const numValue = typeof cellValue === "number" ? cellValue : parseFloat(String(cellValue));
              if (isFinite(numValue) && numValue >= start.value && numValue <= end.value) count++;
            } else if (start.kind === "date" && end.kind === "date") {
              const dateValue = cellValue instanceof Date ? cellValue : new Date(String(cellValue));
              if (!isNaN(dateValue.getTime()) && dateValue >= start.value && dateValue <= end.value) count++;
            }
            break;
          case "in":
            if (args.some(arg => {
              if (arg.kind === "number") {
                const numValue = typeof cellValue === "number" ? cellValue : parseFloat(String(cellValue));
                return isFinite(numValue) && numValue === arg.value;
              }
              if (arg.kind === "string") {
                return String(cellValue) === arg.value;
              }
              return false;
            })) count++;
            break;
          case "nin":
            if (!args.some(arg => {
              if (arg.kind === "number") {
                const numValue = typeof cellValue === "number" ? cellValue : parseFloat(String(cellValue));
                return isFinite(numValue) && numValue === arg.value;
              }
              if (arg.kind === "string") {
                return String(cellValue) === arg.value;
              }
              return false;
            })) count++;
            break;
          default:
            count++;
        }
      }
      return count;
    }

    return rowsToCheck.length;
  }

  /**
   * Create a suggestion for a date value
   */
  function createDateSuggestion(
    column: AnyColumnDefinition,
    operator: Operator,
    parsedDate: ParsedDate,
    score: number,
    resultCount?: number,
    customLabel?: string,
    _contextRowIndices: Set<number> | null = null,
    matchMetadata?: MatchMetadata
  ): FilterSuggestion {
    const opInfo = getOperator(operator);
    
    // For date ranges with variadic operators, show both dates
    const isRangeOperator = opInfo.isVariadic && parsedDate.rangeStart && parsedDate.rangeEnd;
    const displayDate = customLabel ?? (
      isRangeOperator
        ? `${formatDateForDisplay(parsedDate.rangeStart!)} - ${formatDateForDisplay(parsedDate.rangeEnd!)}`
        : formatDateForDisplay(parsedDate.date)
    );
    const label = `${column.name} ${opInfo.label} ${displayDate}`;

    // Use the original text for completion to preserve natural language
    const completionText = `${column.name} ${operator} "${parsedDate.text}"`;

    // Build arguments array - either a range (2 dates) or a single date
    const args: HypothesisValueType[] = isRangeOperator
      ? [
          { kind: "date", value: parsedDate.rangeStart!, parsed: parsedDate },
          { kind: "date", value: parsedDate.rangeEnd!, parsed: parsedDate },
        ]
      : [{ kind: "date", value: parsedDate.date, parsed: parsedDate }];

    // Use range-specific ID if this is a range
    const suggestionId = isRangeOperator
      ? `${column.id}:${operator}:date:${parsedDate.rangeStart!.toISOString()}-${parsedDate.rangeEnd!.toISOString()}`
      : `${column.id}:${operator}:date:${parsedDate.date.toISOString()}`;

    // For range operators, parts.arguments should have two separate entries
    // so the UI renders [date1] [date2] instead of [date1 - date2]
    const argumentParts = isRangeOperator
      ? [
          { text: formatDateForDisplay(parsedDate.rangeStart!) },
          { text: formatDateForDisplay(parsedDate.rangeEnd!) },
        ]
      : [{ text: displayDate }];

    // Build queryMatches array from match metadata
    const queryMatches: QueryMatch[] = [];
    if (matchMetadata) {
      if (matchMetadata.column) {
        queryMatches.push({
          inputRange: { start: matchMetadata.column.inputStart, end: matchMetadata.column.inputEnd },
          inputText: matchMetadata.column.inputText,
          matchType: "column",
          matchedTarget: matchMetadata.column.matchedTarget,
          matchedCharIndexes: matchMetadata.column.matchIndexes ? [...matchMetadata.column.matchIndexes] : undefined,
          score: matchMetadata.column.score,
        });
      }
      if (matchMetadata.operator) {
        queryMatches.push({
          inputRange: { start: matchMetadata.operator.inputStart, end: matchMetadata.operator.inputEnd },
          inputText: matchMetadata.operator.inputText,
          matchType: "operator",
          matchedTarget: matchMetadata.operator.matchedTarget,
          matchedCharIndexes: matchMetadata.operator.matchIndexes ? [...matchMetadata.operator.matchIndexes] : undefined,
          score: matchMetadata.operator.score,
        });
      }
      if (matchMetadata.values) {
        for (const val of matchMetadata.values) {
          queryMatches.push({
            inputRange: { start: val.inputStart, end: val.inputEnd },
            inputText: val.inputText,
            matchType: "value",
            matchedTarget: val.matchedTarget,
            matchedCharIndexes: val.matchIndexes ? [...val.matchIndexes] : undefined,
            score: val.score,
          });
        }
      }
    }

    return {
      id: suggestionId,
      label,
      parts: {
        column: { text: column.name },
        operator: { text: opInfo.label, symbol: opInfo.symbol },
        arguments: argumentParts,
      },
      column,
      operator,
      arguments: args,
      // Defer count computation to post-processing (lazy evaluation)
      // Use -1 as placeholder; counts are computed only for final suggestions
      resultCount: resultCount ?? -1,
      score,
      isComplete: true,
      completionText,
      cursorPositionAfter: completionText.length,
      category: "fuzzy",
      queryMatches: queryMatches.length > 0 ? queryMatches : undefined,
    };
  }

  /**
   * Count rows matching a date filter
   */
  function countForDateFilter(
    colId: ColumnId,
    operator: Operator,
    parsedDate: ParsedDate,
    contextRowIndices: Set<number> | null = null
  ): number {
    let count = 0;
    const targetDate = parsedDate.date;
    const rangeStart = parsedDate.rangeStart;
    const rangeEnd = parsedDate.rangeEnd;

    // Determine which rows to iterate over
    const rowsToCheck = contextRowIndices !== null 
      ? Array.from(contextRowIndices).map(i => state.data[i]!)
      : state.data;

    for (const row of rowsToCheck) {
      const cellValue = row[colId as string];
      if (cellValue == null) continue;

      // Parse the cell value as a date
      const cellDate = cellValue instanceof Date
        ? cellValue
        : new Date(String(cellValue));

      if (isNaN(cellDate.getTime())) continue;

      switch (operator) {
        case "eq":
          // For date equality, compare just the date part (same day)
          if (isSameDay(cellDate, targetDate)) count++;
          break;
        case "neq":
          if (!isSameDay(cellDate, targetDate)) count++;
          break;
        case "lt":
        case "before":
          if (cellDate < targetDate) count++;
          break;
        case "lte":
          if (cellDate <= targetDate) count++;
          break;
        case "gt":
        case "after":
          if (cellDate > targetDate) count++;
          break;
        case "gte":
          if (cellDate >= targetDate) count++;
          break;
        case "between":
          if (rangeStart && rangeEnd) {
            if (cellDate >= rangeStart && cellDate <= rangeEnd) count++;
          }
          break;
        default:
          count++;
      }
    }

    return count;
  }

  /**
   * Check if two dates are the same calendar day
   */
  function isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  // -------------------------------------------------------------------------
  // Filter Compilation & Execution
  // -------------------------------------------------------------------------

  function compile(input: string): CompiledFilter | null {
    const parsed = parse(input);
    if (!parsed.column || !parsed.operator) return null;

    return compileFilter(
      parsed.column.match.column.id,
      parsed.operator.match.operator,
      parsed.value?.match.value
    );
  }

  function compileFilter(
    colId: ColumnId | string,
    operator: Operator,
    value?: unknown
  ): CompiledFilter | null {
    const col = getColumnById(colId);
    if (!col) return null;

    const columnId = typeof colId === "string" ? (colId as ColumnId) : colId;

    // For date columns, try to parse the value as a date expression
    let dateValue: Date | null = null;
    let dateRangeStart: Date | null = null;
    let dateRangeEnd: Date | null = null;
    
    if (col.type === DataType.DATE && value !== undefined) {
      if (value instanceof Date) {
        dateValue = value;
      } else if (Array.isArray(value) && value.length === 2) {
        // Handle date range as [start, end] array (used by dateRange values)
        const [start, end] = value;
        if (start instanceof Date && end instanceof Date) {
          dateValue = start; // Use start as the primary date value
          dateRangeStart = start;
          dateRangeEnd = end;
        } else {
          // Try to parse array elements as dates
          const startDate = start instanceof Date ? start : new Date(String(start));
          const endDate = end instanceof Date ? end : new Date(String(end));
          if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            dateValue = startDate;
            dateRangeStart = startDate;
            dateRangeEnd = endDate;
          }
        }
      } else if (typeof value === "string") {
        // Try to parse as natural language date
        const parsed = parseDate(value);
        if (parsed) {
          dateValue = parsed.date;
          if (parsed.isRange && parsed.rangeStart && parsed.rangeEnd) {
            dateRangeStart = parsed.rangeStart;
            dateRangeEnd = parsed.rangeEnd;
          }
        } else {
          // Fallback: try direct Date parsing
          const directParse = new Date(value);
          if (!isNaN(directParse.getTime())) {
            dateValue = directParse;
          }
        }
      }
    }

    const predicate = (row: Record<string, unknown>): boolean => {
      const cellValue = row[columnId as string];

      // Handle date-specific operators
      if (col.type === DataType.DATE && dateValue) {
        if (cellValue == null) return false;
        
        const cellDate = cellValue instanceof Date
          ? cellValue
          : new Date(String(cellValue));
        
        if (isNaN(cellDate.getTime())) return false;

        switch (operator) {
          case "eq":
            return isSameDay(cellDate, dateValue);
          case "neq":
            return !isSameDay(cellDate, dateValue);
          case "lt":
          case "before":
            return cellDate < dateValue;
          case "lte":
            return cellDate <= dateValue;
          case "gt":
          case "after":
            return cellDate > dateValue;
          case "gte":
            return cellDate >= dateValue;
          case "between":
            if (dateRangeStart && dateRangeEnd) {
              return cellDate >= dateRangeStart && cellDate <= dateRangeEnd;
            }
            return false;
          default:
            // Fall through to standard operators
            break;
        }
      }

      // Standard operators
      switch (operator) {
        case "eq":
          return cellValue === value;
        case "eqIgnoreCase":
          return (
            String(cellValue).toLowerCase() === String(value).toLowerCase()
          );
        case "neq":
          return cellValue !== value;
        case "neqIgnoreCase":
          return (
            String(cellValue).toLowerCase() !== String(value).toLowerCase()
          );
        case "lt":
          return (cellValue as number) < (value as number);
        case "lte":
          return (cellValue as number) <= (value as number);
        case "gt":
          return (cellValue as number) > (value as number);
        case "gte":
          return (cellValue as number) >= (value as number);
        case "contains":
          return String(cellValue).includes(String(value));
        case "notContains":
          return !String(cellValue).includes(String(value));
        case "startsWith":
          return String(cellValue).startsWith(String(value));
        case "endsWith":
          return String(cellValue).endsWith(String(value));
        case "isEmpty":
          return cellValue == null || cellValue === "";
        case "isNotEmpty":
          return cellValue != null && cellValue !== "";
        case "isTrue":
          return cellValue === true;
        case "isFalse":
          return cellValue === false;
        case "in":
          return Array.isArray(value) && value.includes(cellValue);
        case "nin":
          return Array.isArray(value) && !value.includes(cellValue);
        case "before":
          // Non-date fallback for before operator
          return String(cellValue) < String(value);
        case "after":
          // Non-date fallback for after operator
          return String(cellValue) > String(value);
        case "between":
          // For between with array value [start, end]
          if (Array.isArray(value) && value.length === 2) {
            const numValue = cellValue as number;
            return numValue >= (value[0] as number) && numValue <= (value[1] as number);
          }
          return false;
        default:
          return true;
      }
    };

    // Calculate match count
    let matchCount = 0;
    for (const row of state.data) {
      if (predicate(row)) matchCount++;
    }

    // Convert value to arguments array
    const args: unknown[] = value !== undefined 
      ? (Array.isArray(value) ? value : [value])
      : [];

    return {
      columnId,
      operator,
      arguments: args,
      predicate,
      matchCount,
      toString() {
        return `${col.name} ${operator}${args.length > 0 ? ` ${args.join(", ")}` : ""}`;
      },
    };
  }

  function execute(filter: CompiledFilter): FilterResult {
    const startTime = performance.now();
    const matchingRows: number[] = [];

    for (let i = 0; i < state.data.length; i++) {
      if (filter.predicate(state.data[i]!)) {
        matchingRows.push(i);
      }
    }

    return {
      filter,
      matchingRows,
      count: matchingRows.length,
      executionTimeMs: performance.now() - startTime,
    };
  }

  function count(filter: CompiledFilter): number {
    return filter.matchCount;
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  function configure(options: Partial<FuzzyFilterConfig>): void {
    config = {
      ...config,
      ...options,
      scoringWeights: {
        ...config.scoringWeights,
        ...options.scoringWeights,
      },
    };
  }

  function clearCache(): void {
    // No-op for now
  }

  function destroy(): void {
    state.schema = null;
    state.data = [];
    state.columnTrie = createTrie();
    state.valueTrie = createTrie();
  }

  return {
    get config() {
      return config;
    },
    configure,
    setSchema,
    getSchema,
    getColumn: getColumnById,
    getOperatorsForColumn,
    indexData,
    updateRows,
    clearIndex,
    getIndexStats,
    suggest,
    suggestSync,
    parse,
    validate,
    compile,
    compileFilter,
    execute,
    count,
    clearCache,
    destroy,
  };
}
