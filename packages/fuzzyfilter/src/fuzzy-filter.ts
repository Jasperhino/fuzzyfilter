/**
 * FuzzyFilter - Main Implementation
 *
 * A library for parsing fuzzy filter queries with intelligent suggestions.
 * Uses fuzzysort for typo-tolerant matching and chrono-node for natural language dates.
 *
 * @module fuzzyfilter
 */

import fuzzysort from "fuzzysort";
import * as chrono from "chrono-node";
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
} from "./types/index.ts";
import { columnId, DEFAULT_CONFIG } from "./types/index.ts";
import {
  OPERATOR_REGISTRY,
  getOperatorsForType,
  getOperator,
  isOperator,
} from "./operators/registry.ts";
import { buildSchema, getColumn, getColumns } from "./schema-builder.ts";
import { createTrie } from "./trie.ts";
import { tokenize } from "./tokenizer.ts";

/**
 * Internal state for FuzzyFilter
 */
interface FuzzyFilterState {
  schema: Schema | null;
  columnTrie: Trie<AnyColumnDefinition>;
  operatorTrie: Trie<Operator>;
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
    operatorTrie: createTrie<Operator>(),
    valueTrie: createTrie<{ value: string; columnId: ColumnId; rowCount: number }>(),
    data: [],
  };

  // Initialize operator trie with all operators and their aliases
  for (const op of Object.values(OPERATOR_REGISTRY)) {
    state.operatorTrie.insert(op.id, op.id);
    state.operatorTrie.insert(op.label, op.id);
    for (const alias of op.aliases) {
      state.operatorTrie.insert(alias, op.id);
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
        // Use a compound key to avoid collisions
        const key = `${col.id}:${value}`;
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
    const { tokens, isComplete } = tokenize(input);
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
          operator: m.value,
          score: m.score,
          matchedOn: "id" as const,
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
      if (opInfo?.requiresArgument && !parsed.value) {
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
    cursorPosition?: number
  ): Promise<SuggestionResponse> {
    return suggestSync(query, cursorPosition);
  }

  function suggestSync(
    query: string,
    cursorPosition?: number
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

    const parsed = parse(query);
    const { tokens } = parsed;

    // Generate n-grams for multi-word matching
    const ngrams = generateNgrams(tokens);

    // Strategy 1: Empty query - show all columns with default operators
    if (tokens.length === 0) {
      for (const col of getColumns(state.schema)) {
        const defaultOp = getOperatorsForType(col.type)[0];
        if (defaultOp) {
          suggestions.push(createSuggestion(col, defaultOp.id, undefined, 0));
        }
      }
    }
    // Strategy 2: Has tokens - search with n-grams
    else {
      // Track best matches to avoid duplicates (keep best score)
      const columnScores = new Map<string, ScoreBreakdown>();
      const operatorScores = new Map<string, ScoreBreakdown>();
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
          const opInfo = getOperator(match.value);
          if (!opInfo) continue;
          
          // Use the longer of id or label for target length
          const targetLength = Math.max(opInfo.id.length, opInfo.label.length);
          const breakdown = adjustScoreForCoverage(
            match.score,
            ngram,
            targetLength
          );
          const existing = operatorScores.get(match.value);
          if (!existing || breakdown.adjustedScore > existing.adjustedScore) {
            operatorScores.set(match.value, breakdown);
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

      // Now create suggestions from the best scores
      
      // Column suggestions
      for (const [colId, breakdown] of columnScores) {
        const col = getColumnById(colId);
        if (col) {
          const ops = getOperatorsForType(col.type);
          for (const op of ops.slice(0, 3)) {
            suggestions.push(createSuggestion(col, op.id, undefined, breakdown));
          }
        }
      }

      // Operator suggestions
      for (const [opId, breakdown] of operatorScores) {
        const opInfo = getOperator(opId as Operator);
        if (!opInfo) continue;
        for (const col of getColumns(state.schema!)) {
          if (opInfo.supportedTypes.includes(col.type)) {
            suggestions.push(createSuggestion(col, opId as Operator, undefined, breakdown));
          }
        }
      }

      // Value suggestions
      for (const [_key, { breakdown, match }] of valueScores) {
        const col = getColumnById(match.value.columnId);
        if (col) {
          suggestions.push(
            createSuggestion(
              col,
              "eq",
              { kind: "string", value: match.value.value },
              breakdown,
              match.value.rowCount
            )
          );
        }
      }

      // If we have a clear column + operator match, also suggest column-specific values
      if (parsed.column && parsed.operator) {
        const col = parsed.column.match.column;
        const op = parsed.operator.match.operator;
        const opInfo = getOperator(op);

        if (opInfo?.requiresArgument) {
          // Get remaining tokens after column and operator as potential value
          const colTokenIdx = tokens.indexOf(parsed.column.token);
          const opTokenIdx = tokens.indexOf(parsed.operator.token);
          const valueTokens = tokens.filter(
            (_, i) => i !== colTokenIdx && i !== opTokenIdx
          );

          if (valueTokens.length > 0) {
            // Search for values matching the remaining tokens
            const valueQuery = valueTokens.map((t) => t.normalized).join(" ");
            const valMatches = state.valueTrie.fuzzySearch(valueQuery, 10);

            for (const match of valMatches) {
              if (match.value.columnId === col.id) {
                const key = `${col.id}:${op}:${match.value.value}`;
                if (!seenValues.has(key)) {
                  seenValues.add(key);
                  suggestions.push(
                    createSuggestion(
                      col,
                      op,
                      { kind: "string", value: match.value.value },
                      match.score + parsed.column.match.score,
                      match.value.rowCount
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
                suggestions.push(
                  createSuggestion(
                    col,
                    op,
                    { kind: "string", value: entry.value.value },
                    parsed.column.match.score,
                    entry.value.rowCount
                  )
                );
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
              parsed.column.match.score + parsed.operator.match.score
            )
          );
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
    value: HypothesisValueType | undefined,
    scoreOrBreakdown: number | ScoreBreakdown,
    resultCount?: number
  ): FilterSuggestion {
    const opInfo = getOperator(operator);
    const valueText = value?.kind === "string" ? value.value : "";
    const label = valueText
      ? `${column.name} ${opInfo?.label ?? operator} ${valueText}`
      : `${column.name} ${opInfo?.label ?? operator}`;

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
        operator: { text: opInfo?.label ?? operator, symbol: opInfo?.symbol },
        argument: valueText ? { text: valueText } : undefined,
      },
      column,
      operator,
      value,
      resultCount: resultCount ?? countForFilter(column.id, operator, value),
      score,
      scoreBreakdown,
      isComplete: !opInfo?.requiresArgument || value !== undefined,
      completionText,
      cursorPositionAfter: completionText.length,
      category: score === 0 ? "exact" : scoreBreakdown?.rawScore === 0 ? "exact" : "fuzzy",
    };
  }

  function countForFilter(
    columnId: ColumnId,
    operator: Operator,
    value: HypothesisValueType | undefined
  ): number {
    if (!value || value.kind === "empty") {
      return state.data.length;
    }

    if (value.kind === "string") {
      // Count matching rows
      let count = 0;
      for (const row of state.data) {
        const cellValue = row[columnId as string];
        if (cellValue == null) continue;

        const strValue = String(cellValue);

        switch (operator) {
          case "eq":
            if (strValue === value.value) count++;
            break;
          case "eqIgnoreCase":
            if (strValue.toLowerCase() === value.value.toLowerCase()) count++;
            break;
          case "neq":
            if (strValue !== value.value) count++;
            break;
          case "contains":
            if (strValue.includes(value.value)) count++;
            break;
          case "startsWith":
            if (strValue.startsWith(value.value)) count++;
            break;
          case "endsWith":
            if (strValue.endsWith(value.value)) count++;
            break;
          default:
            count++;
        }
      }
      return count;
    }

    return state.data.length;
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

    const predicate = (row: Record<string, unknown>): boolean => {
      const cellValue = row[columnId as string];

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
        default:
          return true;
      }
    };

    // Calculate match count
    let matchCount = 0;
    for (const row of state.data) {
      if (predicate(row)) matchCount++;
    }

    return {
      columnId,
      operator,
      argument: value,
      predicate,
      matchCount,
      toString() {
        return `${col.name} ${operator}${value !== undefined ? ` ${value}` : ""}`;
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
