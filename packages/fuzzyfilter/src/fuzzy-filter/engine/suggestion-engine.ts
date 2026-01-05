/**
 * Suggestion Engine
 * 
 * Orchestrates all suggestion strategies, handles deduplication, ranking, and limiting.
 */

import type { FilterSuggestion, SuggestionResponse, Token } from "../../types/index.ts";
import type { SuggestionStrategy, StrategyContext } from "../strategies/interface.ts";
import type {
  FuzzyFilterState,
  ColumnScoreEntry,
  OpScoreEntry,
  ValScoreEntry,
} from "../types.ts";
import { EmptyQueryStrategy } from "../strategies/empty-query.ts";
import { SpreadPatternStrategy } from "../strategies/spread-pattern.ts";
import { NgramMatchStrategy } from "../strategies/ngram-match.ts";
import { ValueInferenceStrategy } from "../strategies/value-inference.ts";
import { generateNgrams } from "./ngrams.ts";
import { adjustScoreForCoverage, calculateSmartScore } from "./scorer.ts";
import { SCORING_CONFIG, SCORING_WEIGHTS } from "../constants.ts";
import { getAllOperators } from "../../operators.ts";
import { countForFilter, countForDateFilter } from "./suggestion-helpers.ts";
import { computeFilterContext } from "../state.ts";
import { getColumns, getColumn } from "../../schema-builder.ts";

/**
 * Context for building strategy context
 */
interface BuildContextOptions {
  query: string;
  tokens: Token[];
  parsed: import("../../types/index.ts").ParsedInput;
  contextRowIndices: Set<number> | null;
  contextAvailableValues: import("../types.ts").ContextAvailableValues | null;
  state: FuzzyFilterState;
}

/**
 * Builds the strategy context with n-gram matching scores
 */
function buildStrategyContext(options: BuildContextOptions): StrategyContext {
  const { tokens, parsed, contextRowIndices, contextAvailableValues, state } = options;
  const ngrams = generateNgrams(tokens);
  
  // Include i18nProvider in context for strategies to use

  // Track best matches to avoid duplicates (keep best score)
  const columnScores = new Map<string, ColumnScoreEntry>();
  const operatorScores = new Map<string, OpScoreEntry>();
  const valueScores = new Map<string, ValScoreEntry>();

  // Search each n-gram against all tries
  for (const ngram of ngrams) {
    // Column matches
    const colMatches = state.columnTrie.fuzzySearch(ngram.text, 5);
    for (const match of colMatches) {
      // NEW: Use smart scoring
      const score = calculateSmartScore(
        match.score, 
        match.indexes, 
        match.value.name
      );
      
      // Filter noise immediately
      if (score < SCORING_WEIGHTS.THRESHOLD) continue;

      const key = match.value.id as string;
      const existing = columnScores.get(key);
      
      if (!existing || score > existing.breakdown.adjustedScore) {
        // Store the smart 0-1 score in breakdown.adjustedScore for now (backward compat)
        // TODO: Refactor to use simple number score
        columnScores.set(key, {
          breakdown: {
            rawScore: match.score,
            coverageBonus: 0,
            completenessBonus: 0,
            fullQueryBonus: 0,
            tokenCount: ngram.tokenCount,
            totalTokens: ngram.totalTokens,
            adjustedScore: score,
          },
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
      const opInfo = getAllOperators(state.i18nProvider).find((op) => op.id === opEntry.operator);
      if (!opInfo) continue;

      // Use the matched alias/key as target text for smart scoring
      const targetText = match.key || opInfo.label;
      const score = calculateSmartScore(
        match.score,
        match.indexes,
        targetText
      );
      
      // Filter noise immediately
      if (score < SCORING_WEIGHTS.THRESHOLD) continue;

      // Store with type restriction info and matched alias
      const key = opEntry.forType
        ? `${opEntry.operator}:${opEntry.forType}`
        : opEntry.operator;
      const existing = operatorScores.get(key);
      if (!existing || score > existing.breakdown.adjustedScore) {
        operatorScores.set(key, {
          breakdown: {
            rawScore: match.score,
            coverageBonus: 0,
            completenessBonus: 0,
            fullQueryBonus: 0,
            tokenCount: ngram.tokenCount,
            totalTokens: ngram.totalTokens,
            adjustedScore: score,
          },
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
      ? valMatchesRaw.filter((match) => {
          const available = contextAvailableValues.get(match.value.columnId);
          return available?.strings.has(match.value.value) ?? false;
        })
      : valMatchesRaw;
    for (const match of valMatches) {
      const key = `${match.value.columnId}:${match.value.value}`;
      
      // NEW: Use smart scoring
      const score = calculateSmartScore(
        match.score,
        match.indexes,
        match.value.value
      );
      
      // Filter noise immediately
      if (score < SCORING_WEIGHTS.THRESHOLD) continue;
      
      const existing = valueScores.get(key);
      if (!existing || score > existing.breakdown.adjustedScore) {
        // Store the source token text to track which token matched this value
        valueScores.set(key, {
          breakdown: {
            rawScore: match.score,
            coverageBonus: 0,
            completenessBonus: 0,
            fullQueryBonus: 0,
            tokenCount: ngram.tokenCount,
            totalTokens: ngram.totalTokens,
            adjustedScore: score,
          },
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
  const operatorsToRemove = new Set<string>();
  for (const [keyA, entryA] of operatorScores) {
    for (const [keyB, entryB] of operatorScores) {
      if (keyA === keyB) continue;

      // Check if ngrams overlap
      const ngramA = entryA.ngram;
      const ngramB = entryB.ngram;
      const overlaps =
        !(ngramA.inputEnd <= ngramB.inputStart || ngramB.inputEnd <= ngramA.inputStart);

      if (overlaps) {
        // If one is a proper superset of the other in terms of token coverage,
        // prefer the one with more tokens (more complete interpretation)
        if (
          ngramA.tokenCount > ngramB.tokenCount &&
          entryA.breakdown.adjustedScore >=
            entryB.breakdown.adjustedScore * SCORING_CONFIG.THRESHOLD.OPERATOR_OVERLAP_RATIO
        ) {
          // A uses more tokens and has a reasonable score - remove B
          operatorsToRemove.add(keyB);
        } else if (
          ngramB.tokenCount > ngramA.tokenCount &&
          entryB.breakdown.adjustedScore >=
            entryA.breakdown.adjustedScore * SCORING_CONFIG.THRESHOLD.OPERATOR_OVERLAP_RATIO
        ) {
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

  return {
    query: options.query,
    parsed,
    tokens,
    ngrams,
    contextRowIndices,
    contextAvailableValues,
    i18nProvider: state.i18nProvider,
    columnScores,
    operatorScores,
    valueScores,
  };
}

/**
 * Suggestion Engine that orchestrates all strategies
 */
export class SuggestionEngine {
  private strategies: SuggestionStrategy[];

  constructor(
    private state: FuzzyFilterState,
    private config: { maxSuggestions: number }
  ) {
    this.strategies = [
      new EmptyQueryStrategy(() => this.state.schema),
      new SpreadPatternStrategy(() => this.state.schema, () => this.state.data),
      new NgramMatchStrategy(
        () => this.state.schema,
        () => this.state.data,
        () => this.state.valueTrie,
        (id) => {
          if (!this.state.schema) return null;
          return getColumn(this.state.schema, id);
        }
      ),
      new ValueInferenceStrategy(
        () => this.state.schema,
        (id) => {
          if (!this.state.schema) return null;
          return getColumn(this.state.schema, id);
        }
      )
    ];
  }

  /**
   * Generate suggestions for a query
   */
  suggest(
    query: string,
    cursorPosition: number | undefined,
    filterContext: import("../../types/index.ts").CompiledFilter[] | undefined,
    parseFn: (input: string) => import("../../types/index.ts").ParsedInput,
    tokenizeFn: (input: string) => { tokens: Token[] }
  ): SuggestionResponse {
    const startTime = performance.now();
    const suggestions: FilterSuggestion[] = [];

    if (!this.state.schema) {
      return {
        query,
        cursorPosition: cursorPosition ?? query.length,
        suggestions: [],
        totalCount: 0,
        responseTimeMs: performance.now() - startTime,
      };
    }

    // Compute filter context
    const [contextRowIndices, contextAvailableValues] =
      filterContext && filterContext.length > 0
        ? computeFilterContext(this.state, filterContext)
        : [null, null];

    // Parse input
    const parsed = parseFn(query);
    const { tokens } = tokenizeFn(query);

    // Build strategy context with n-gram matching
    const strategyContext = buildStrategyContext({
      query,
      tokens,
      parsed,
      contextRowIndices,
      contextAvailableValues,
      state: this.state,
    });

    // Execute strategies
    const suggestionIds = new Set<string>();
    for (const strategy of this.strategies) {
      if (strategy.canHandle(strategyContext)) {
        const results = strategy.generate(strategyContext);
        for (const res of results) {
          if (!suggestionIds.has(res.id)) {
            suggestions.push(res);
            suggestionIds.add(res.id);
          }
        }
      }
    }

    // Deduplicate by ID (keep highest score)
    const uniqueSuggestions = new Map<string, FilterSuggestion>();
    for (const suggestion of suggestions) {
      const existing = uniqueSuggestions.get(suggestion.id);
      if (!existing || suggestion.score > existing.score) {
        uniqueSuggestions.set(suggestion.id, suggestion);
      }
    }

    // Sort by score (higher = better)
    const sortedSuggestions = Array.from(uniqueSuggestions.values()).sort(
      (a, b) => b.score - a.score
    );

    // Limit results
    const limitedSuggestions = sortedSuggestions.slice(0, this.config.maxSuggestions);

    // Compute result counts only for the final limited suggestions (lazy evaluation)
    for (const suggestion of limitedSuggestions) {
      if (suggestion.resultCount === -1) {
        // Check if this is a date filter based on arguments
        const firstArg = suggestion.arguments?.[0];
        const hasDateArg = firstArg?.kind === "date";

        if (hasDateArg) {
          // For date filters, build ParsedDate from arguments
          const firstDate = firstArg.value as Date;
          const secondArg = suggestion.arguments?.[1];
          const secondDate =
            secondArg?.kind === "date" ? (secondArg.value as Date) : undefined;

          // Use parsed info from first arg, or construct one
          const baseParsed = firstArg.parsed;
          const parsedDate: import("../../types/index.ts").ParsedDate = baseParsed
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
            this.state.data,
            contextRowIndices
          );
        } else {
          suggestion.resultCount = countForFilter(
            suggestion.column.id,
            suggestion.operator,
            suggestion.arguments,
            this.state.data,
            contextRowIndices
          );
        }
      }
    }

    return {
      query,
      cursorPosition: cursorPosition ?? query.length,
      suggestions: limitedSuggestions,
      totalCount: uniqueSuggestions.size,
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
}
