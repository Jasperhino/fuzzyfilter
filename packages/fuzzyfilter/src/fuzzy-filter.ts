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
} from "./types/index.ts";
import { DataType, DEFAULT_CONFIG } from "./types/index.ts";
import {
  getAllOperators,
  getOperatorsForType,
  getOperator,
} from "./operators/registry.ts";
import { buildSchema, getColumn, getColumns } from "./schema-builder.ts";
import { createTrie } from "./trie.ts";
import { tokenize } from "./tokenizer.ts";
import {
  parseDate,
  COMMON_DATE_SUGGESTIONS,
  formatDateForDisplay,
  mightBeDateExpression,
} from "./date-parser.ts";

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
interface FuzzyFilterState {
  schema: Schema | null;
  columnTrie: Trie<AnyColumnDefinition>;
  operatorTrie: Trie<OperatorAliasEntry>;
  valueTrie: Trie<{ value: string; columnId: ColumnId; rowCount: number }>;
  data: Array<Record<string, unknown>>;
}

/**
 * N-gram with metadata for scoring
 */
interface NgramWithMeta {
  text: string;
  tokenCount: number;      // How many tokens this ngram spans
  totalTokens: number;     // Total tokens in the input
  isFullQuery: boolean;    // Is this the full query?
}

/**
 * Generate n-grams from tokens for matching multi-word phrases
 * For tokens ["is", "not", "empty"], generates:
 * - Individual: ["is", "not", "empty"]
 * - Bigrams: ["is not", "not empty"]
 * - Full: ["is not empty"]
 * 
 * Returns with metadata for scoring adjustments
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
    });
  }

  // N-grams (size 2 to all tokens)
  for (let n = 2; n <= tokens.length; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const ngram = tokens
        .slice(i, i + n)
        .map((t) => t.normalized)
        .join(" ");
      ngrams.push({
        text: ngram,
        tokenCount: n,
        totalTokens,
        isFullQuery: n === totalTokens,
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
 * Score breakdown for debugging/display
 */
interface ScoreBreakdown {
  rawScore: number;
  coverageBonus: number;
  completenessBonus: number;
  fullQueryBonus: number;
  tokenCount: number;
  totalTokens: number;
  adjustedScore: number;
}

/**
 * Adjust score based on how much of the query was matched
 * Fuzzysort scores: 0 = exact match, negative = worse match
 * We boost scores for longer n-gram matches to prefer "in progress" over "in"
 */
function adjustScoreForCoverage(
  baseScore: number,
  ngram: NgramWithMeta,
  targetLength: number
): ScoreBreakdown {
  // Calculate coverage ratio (how much of the query this ngram represents)
  const coverageRatio = ngram.tokenCount / ngram.totalTokens;
  
  // Calculate match completeness (how well does query cover the target)
  const queryLength = ngram.text.length;
  const completenessRatio = Math.min(1, queryLength / targetLength);
  
  // Bonus for high coverage (using more of the input)
  // Max bonus of 2000 points for full coverage
  const coverageBonus = Math.round(coverageRatio * 2000);
  
  // Bonus for matching more of the target
  // Max bonus of 1000 points for complete match
  const completenessBonus = Math.round(completenessRatio * 1000);
  
  // Additional bonus if this is the full query AND it's a good match
  const fullQueryBonus = ngram.isFullQuery && baseScore >= -1000 ? 500 : 0;
  
  const adjustedScore = baseScore + coverageBonus + completenessBonus + fullQueryBonus;
  
  return {
    rawScore: baseScore,
    coverageBonus,
    completenessBonus,
    fullQueryBonus,
    tokenCount: ngram.tokenCount,
    totalTokens: ngram.totalTokens,
    adjustedScore,
  };
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
  };

  // Initialize operator trie with all operators and their aliases
  for (const op of getAllOperators()) {
    // Insert operator id and label as general (no type restriction)
    state.operatorTrie.insert(op.id, { operator: op.id });
    state.operatorTrie.insert(op.label, { operator: op.id });
    
    // Insert general aliases (no type restriction)
    for (const alias of op.aliases) {
      state.operatorTrie.insert(alias, { operator: op.id });
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
    for (const col of getColumns(state.schema)) {
      const counts = valueCounts.get(col.id as string)!;
      for (const [value, count] of counts) {
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

    // Find best matches for each slot
    let column: ParsedInput["column"];
    let operator: ParsedInput["operator"];
    let value: ParsedInput["value"];

    for (const classification of classifications) {
      // Check for column match
      if (classification.columnMatches.length > 0 && !column) {
        const best = classification.columnMatches[0]!;
        column = { token: classification.token, match: best };
      }

      // Check for operator match
      if (classification.operatorMatches.length > 0 && !operator) {
        const best = classification.operatorMatches[0]!;
        operator = { token: classification.token, match: best };
      }

      // Check for value match
      if (classification.valueMatches.length > 0 && !value) {
        const best = classification.valueMatches[0]!;
        value = { token: classification.token, match: best };
      }
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
    let contextRowIndices: Set<number> | null = null;
    if (filterContext && filterContext.length > 0) {
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
      const columnScores = new Map<string, ScoreBreakdown>();
      type OpScoreEntry = { breakdown: ScoreBreakdown; operator: Operator; forType?: DataType; matchedAlias?: string };
      const operatorScores = new Map<string, OpScoreEntry>();
      type ValMatch = { value: { value: string; columnId: ColumnId; rowCount: number }; score: number };
      const valueScores = new Map<string, { breakdown: ScoreBreakdown; match: ValMatch }>();
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
            match.value.name.length
          );
          const existing = columnScores.get(key);
          if (!existing || breakdown.adjustedScore > existing.adjustedScore) {
            columnScores.set(key, breakdown);
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
            targetLength
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
              forType: opEntry.forType 
            });
          }
        }

        // Value matches
        const valMatches = state.valueTrie.fuzzySearch(ngram.text, 10);
        for (const match of valMatches) {
          const key = `${match.value.columnId}:${match.value.value}`;
          const breakdown = adjustScoreForCoverage(
            match.score,
            ngram,
            match.value.value.length
          );
          const existing = valueScores.get(key);
          if (!existing || breakdown.adjustedScore > existing.breakdown.adjustedScore) {
            valueScores.set(key, { breakdown, match });
          }
        }
      }

      // Check if the full query might be a date expression
      const fullQuery = tokens.map((t) => t.text).join(" ");
      if (mightBeDateExpression(fullQuery)) {
        const parsedDate = parseDate(fullQuery);
        if (parsedDate) {
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
                        contextRowIndices
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
                      contextRowIndices
                    )
                  );
                }
              }
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
      for (const [colId, breakdown] of columnScores) {
        const col = getColumnById(colId);
        if (!col) continue;
        
        const ops = getOperatorsForType(col.type);
        
        // Get compatible values for this column type
        const compatibleValues: (number | Date)[] = col.type === DataType.NUMBER 
          ? detectedValues.numbers.map(n => n.value)
          : col.type === DataType.DATE
            ? detectedValues.dates.map(d => d.value)
            : [];
        
        // Helper to convert primitive value to HypothesisValueType
        const toArgValue = (val: number | Date): HypothesisValueType => {
          if (typeof val === "number") {
            return { kind: "number", value: val };
          } else {
            const dateText = val.toISOString();
            return { 
              kind: "date", 
              value: val, 
              parsed: { 
                text: dateText, 
                date: val, 
                isRange: false, 
                consumedText: dateText 
              } 
            };
          }
        };

        // If we have 2+ compatible values, prioritize variadic operators
        if (compatibleValues.length >= 2) {
          // Generate suggestions for operators that can use multiple values
          for (const op of ops) {
            const opInfo = getOperator(op.id);
            
            let valuesUsed = 0;
            let suggestionArgs: HypothesisValueType[] | undefined;
            
            if (opInfo.isVariadic) {
              if (op.id === "between") {
                valuesUsed = 2;
                // Sort values for between to ensure start < end
                const sorted = [...compatibleValues].slice(0, 2).sort((a, b) => {
                  if (a instanceof Date && b instanceof Date) {
                    return a.getTime() - b.getTime();
                  }
                  return (a as number) - (b as number);
                });
                suggestionArgs = sorted.map(toArgValue);
              } else if (op.id === "in" || op.id === "nin") {
                valuesUsed = compatibleValues.length;
                suggestionArgs = compatibleValues.map(toArgValue);
              }
            } else if (opInfo.requiresArgument) {
              // Single-value operator - uses first value
              valuesUsed = 1;
              suggestionArgs = [toArgValue(compatibleValues[0]!)];
            }
            
            // Calculate argument coverage bonus
            const argumentCoverageBonus = Math.round((valuesUsed / compatibleValues.length) * 1500);
            const adjustedScore = breakdown.adjustedScore + argumentCoverageBonus;
            
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
        } else if (compatibleValues.length === 1) {
          // Single value - suggest operators with that value
          const firstVal = compatibleValues[0]!;
          const argValue = toArgValue(firstVal);
          
          for (const op of ops.slice(0, 5)) {
            const opInfo = getOperator(op.id);
            if (!opInfo.requiresArgument) continue;
            
            // Full coverage bonus since only 1 value
            const adjustedScore = breakdown.adjustedScore + 1500;
            
            suggestions.push(createSuggestion(
              col, 
              op.id, 
              [argValue], 
              adjustedScore, 
              undefined, 
              undefined, 
              contextRowIndices
            ));
          }
        } else {
          // No compatible values detected - check for no-argument operators
          // First, check if any no-argument operators for this column were matched in operatorScores
          const noArgOps = ops.filter(op => !getOperator(op.id).requiresArgument);
          const matchedNoArgOps: Array<{ opId: Operator; opBreakdown: ScoreBreakdown; matchedAlias?: string }> = [];
          
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
              });
            }
          }
          
          // If we have matched no-argument operators, give them a combined score + completeness bonus
          if (matchedNoArgOps.length > 0) {
            for (const { opId, opBreakdown, matchedAlias } of matchedNoArgOps) {
              // Combine column + operator scores, plus completeness bonus
              // Similar to argument coverage bonus (1500), we give a completeness bonus for no-arg operators
              const combinedScore = breakdown.adjustedScore + opBreakdown.adjustedScore + 1500;
              suggestions.push(createSuggestion(col, opId, undefined, combinedScore, undefined, matchedAlias, contextRowIndices));
            }
            
            // Also add other operators with just column score (lower priority)
            for (const op of ops.slice(0, 3)) {
              // Skip if already added as matched no-arg operator
              if (matchedNoArgOps.some(m => m.opId === op.id)) continue;
              suggestions.push(createSuggestion(col, op.id, undefined, breakdown, undefined, undefined, contextRowIndices));
            }
          } else {
            // Fall back to default behavior - suggest top operators with just column score
            for (const op of ops.slice(0, 3)) {
              suggestions.push(createSuggestion(col, op.id, undefined, breakdown, undefined, undefined, contextRowIndices));
            }
          }
        }
      }

      // Operator suggestions
      for (const [_key, { breakdown: opBreakdown, operator, forType, matchedAlias }] of operatorScores) {
        const opInfo = getOperator(operator);
        for (const col of getColumns(state.schema!)) {
          // Skip if this is a type-specific alias that doesn't match the column type
          if (forType && forType !== col.type) continue;
          
          if (opInfo.supportedTypes.includes(col.type)) {
            // Check if this column was also matched in columnScores
            const colScoreEntry = columnScores.get(col.id as string);
            
            if (colScoreEntry && !opInfo.requiresArgument) {
              // Both column and no-argument operator matched - use combined score
              // Note: This creates a potential duplicate with the column suggestions path above,
              // but deduplication later will keep the higher-scored one
              const combinedScore = colScoreEntry.adjustedScore + opBreakdown.adjustedScore + 1500;
              suggestions.push(createSuggestion(col, operator, undefined, combinedScore, undefined, matchedAlias, contextRowIndices));
            } else {
              // Only operator matched - use just operator score
              suggestions.push(createSuggestion(col, operator, undefined, opBreakdown.adjustedScore, undefined, matchedAlias, contextRowIndices));
            }
          }
        }
      }

      // Value suggestions
      for (const [_key, { breakdown, match }] of valueScores) {
        const col = getColumnById(match.value.columnId);
        if (col) {
          // When there's a filter context, don't use pre-indexed rowCount - compute dynamically
          const rowCount = contextRowIndices !== null 
            ? undefined  // Will be computed by createSuggestion using context
            : match.value.rowCount;
          suggestions.push(
            createSuggestion(
              col,
              "eq",
              [{ kind: "string", value: match.value.value }],
              breakdown,
              rowCount,
              undefined,
              contextRowIndices
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
                      contextRowIndices
                    )
                  );
                }
              }
              
              // Also search indexed date values as strings
              const valueQueryNorm = valueTokens.map((t) => t.normalized).join(" ");
              const valMatches = state.valueTrie.fuzzySearch(valueQueryNorm, 5);
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
                        contextRowIndices
                      )
                    );
                  }
                }
              }
            } else {
              // No value tokens yet - suggest common date phrases
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
                        contextRowIndices
                      )
                    );
                  }
                }
              }
            }
          } else {
            // Non-date columns - original logic
            if (valueTokens.length > 0) {
              // Search for values matching the remaining tokens
              const valueQuery = valueTokens.map((t) => t.normalized).join(" ");
              const valMatches = state.valueTrie.fuzzySearch(valueQuery, 10);

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
                        contextRowIndices
                      )
                    );
                  }
                }
              }
            } else {
              // No value tokens yet, suggest all values for this column
              const allValues = state.valueTrie
                .entries()
                .filter((e) => e.value.columnId === col.id)
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
                      contextRowIndices
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
              contextRowIndices
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
        
        // Also check which tokens matched indexed string values
        const stringValueMatches: Map<ColumnId, string[]> = new Map();
        for (const [_key, { match }] of valueScores) {
          const existing = stringValueMatches.get(match.value.columnId) || [];
          if (!existing.includes(match.value.value)) {
            existing.push(match.value.value);
            stringValueMatches.set(match.value.columnId, existing);
          }
        }
        
        // Helper to convert primitive value to HypothesisValueType
        const toArgValue = (val: number | Date | string): HypothesisValueType => {
          if (typeof val === "number") {
            return { kind: "number", value: val };
          } else if (val instanceof Date) {
            const dateText = val.toISOString();
            return { 
              kind: "date", 
              value: val, 
              parsed: { 
                text: dateText, 
                date: val, 
                isRange: false, 
                consumedText: dateText 
              } 
            };
          } else {
            return { kind: "string", value: val };
          }
        };
        
        // Generate suggestions for numeric columns when we have numeric tokens
        if (allDetectedValues.numbers.length >= 1) {
          const numValues = allDetectedValues.numbers.map(n => n.value);
          
          for (const col of getColumns(state.schema!)) {
            if (col.type !== DataType.NUMBER) continue;
            
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
                  if (op.id === "between") {
                    valuesUsed = 2;
                    // Sort values for between to ensure start < end
                    const sorted = [...numValues].slice(0, 2).sort((a, b) => a - b);
                    suggestionArgs = sorted.map(v => toArgValue(v));
                  } else if (op.id === "in" || op.id === "nin") {
                    valuesUsed = numValues.length;
                    suggestionArgs = numValues.map(v => toArgValue(v));
                  }
                } else if (opInfo.requiresArgument) {
                  // Single-value operator - uses first value
                  valuesUsed = 1;
                  suggestionArgs = [toArgValue(numValues[0]!)];
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
                  [toArgValue(numVal)], 
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
          const dateValues = allDetectedValues.dates.map(d => d.value);
          
          for (const col of getColumns(state.schema!)) {
            if (col.type !== DataType.DATE) continue;
            
            const ops = getOperatorsForType(col.type);
            const baseScore = 1500;
            
            if (dateValues.length >= 2) {
              // Multiple dates: prioritize between
              for (const op of ops) {
                const opInfo = getOperator(op.id);
                
                let valuesUsed = 0;
                let suggestionArgs: HypothesisValueType[] | undefined;
                
                if (opInfo.isVariadic && op.id === "between") {
                  valuesUsed = 2;
                  const sorted = [...dateValues].slice(0, 2).sort((a, b) => a.getTime() - b.getTime());
                  suggestionArgs = sorted.map(v => toArgValue(v));
                } else if (opInfo.requiresArgument && !opInfo.isVariadic) {
                  valuesUsed = 1;
                  suggestionArgs = [toArgValue(dateValues[0]!)];
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
                  [toArgValue(dateVal)], 
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
        for (const [columnId, values] of stringValueMatches) {
          const col = getColumnById(columnId);
          if (!col || (col.type !== DataType.STRING && col.type !== DataType.ENUM)) continue;
          
          const baseScore = 1500;
          
          if (values.length >= 2) {
            // Multiple values matched for same column: suggest "in" operator
            const ops = getOperatorsForType(col.type);
            const inOp = ops.find(op => op.id === "in");
            
            if (inOp) {
              const argumentCoverageBonus = Math.round((values.length / tokens.length) * 1500);
              suggestions.push(createSuggestion(
                col,
                "in",
                values.map(v => toArgValue(v)),
                baseScore + argumentCoverageBonus,
                undefined,
                undefined,
                contextRowIndices
              ));
            }
          }
          // Note: Single string value matches are already handled by the valueScores loop above
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

  function createSuggestion(
    column: AnyColumnDefinition,
    operator: Operator,
    args: HypothesisValueType[] | undefined,
    scoreOrBreakdown: number | ScoreBreakdown,
    resultCount?: number,
    matchedAlias?: string,
    contextRowIndices: Set<number> | null = null
  ): FilterSuggestion {
    const opInfo = getOperator(operator);
    
    // Format value text based on arguments
    let valueText = "";
    const argumentParts: { text: string; highlight?: boolean }[] = [];
    
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
      
      for (const val of formattedValues) {
        argumentParts.push({ text: val });
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
    const score = isBreakdown ? scoreOrBreakdown.adjustedScore : scoreOrBreakdown;
    const scoreBreakdown = isBreakdown
      ? {
          rawScore: scoreOrBreakdown.rawScore,
          coverageBonus: scoreOrBreakdown.coverageBonus,
          completenessBonus: scoreOrBreakdown.completenessBonus,
          fullQueryBonus: scoreOrBreakdown.fullQueryBonus,
          tokenCount: scoreOrBreakdown.tokenCount,
          totalTokens: scoreOrBreakdown.totalTokens,
        }
      : undefined;

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
      resultCount: resultCount ?? countForFilter(column.id, operator, args, contextRowIndices),
      score,
      scoreBreakdown,
      isComplete: !opInfo.requiresArgument || (args !== undefined && args.length > 0),
      completionText,
      cursorPositionAfter: completionText.length,
      category: score === 0 ? "exact" : scoreBreakdown?.rawScore === 0 ? "exact" : "fuzzy",
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
    contextRowIndices: Set<number> | null = null
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

    return {
      id: suggestionId,
      label,
      parts: {
        column: { text: column.name },
        operator: { text: opInfo.label, symbol: opInfo.symbol },
        arguments: [{ text: displayDate }],
      },
      column,
      operator,
      arguments: args,
      resultCount: resultCount ?? countForDateFilter(column.id, operator, parsedDate, contextRowIndices),
      score,
      isComplete: true,
      completionText,
      cursorPositionAfter: completionText.length,
      category: "fuzzy",
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
