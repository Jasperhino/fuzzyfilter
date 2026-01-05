/**
 * Strategy: Spread Pattern Detection
 * 
 * Handles patterns like "from X to Y" or "between X and Y" that map to
 * variadic operators like "between".
 */

import type { SuggestionStrategy, StrategyContext } from "./interface.ts";
import type { FilterSuggestion, Token, ParsedDate } from "../../types/index.ts";
import type { SpreadPatternMatch } from "../types.ts";
import { getAllOperators, getOperator } from "../../operators.ts";
import { getColumns } from "../../schema-builder.ts";
import { DataType } from "../../types/index.ts";
import { parseDate, formatDateForDisplay } from "../../date-parser.ts";
import { getSpreadStartKeywords, getSpreadSeparatorKeywords } from "../../alias-generator.ts";
import { toHypothesisValue } from "../engine/helpers.ts";
import {
  createSuggestion,
  createDateSuggestion,
  countForDateFilter,
} from "../engine/suggestion-helpers.ts";
import { SCORING_CONFIG } from "../constants.ts";

/**
 * Strategy for detecting and handling spread patterns
 */
export class SpreadPatternStrategy implements SuggestionStrategy {
  constructor(
    private getSchema: () => import("../../types/index.ts").Schema | null,
    private getData: () => Array<Record<string, unknown>>
  ) {}

  canHandle(context: StrategyContext): boolean {
    // This strategy runs after n-gram matching, so we check for spread patterns
    // in the tokens. The actual detection happens in generate().
    return context.tokens.length >= 3; // Minimum: "from X to" or "between X and"
  }

  generate(context: StrategyContext): FilterSuggestion[] {
    const schema = this.getSchema();
    if (!schema) return [];

    const suggestions: FilterSuggestion[] = [];
    const seenValues = new Set<string>();

    // Detect spread patterns
      const spreadOperators = getAllOperators(context.i18nProvider).filter(op => op.spreadPatterns);
      const spreadMatches = this.detectSpreadPatterns(context.tokens, spreadOperators, context.i18nProvider);

    for (const spreadMatch of spreadMatches) {
      const arg1Text = spreadMatch.arg1Tokens.map(t => t.text).join(" ");
      const arg2Text = spreadMatch.arg2Tokens.map(t => t.text).join(" ");

      // Try to parse each argument
      const arg1Date = arg1Text ? parseDate(arg1Text) : null;
      const arg2Date = arg2Text ? parseDate(arg2Text) : null;
      const arg1Num = arg1Text ? parseFloat(arg1Text) : NaN;
      const arg2Num = arg2Text ? parseFloat(arg2Text) : NaN;

      // Check what columns this could apply to
      for (const col of getColumns(schema)) {
        const opInfo = getOperator(spreadMatch.operator, context.i18nProvider);
        if (!opInfo.supportedTypes.includes(col.type)) continue;

        // Date columns
        if (col.type === DataType.DATE && arg1Date && arg2Date) {
          const key = `${col.id}:${spreadMatch.operator}:spread:${arg1Date.date.toISOString()}-${arg2Date.date.toISOString()}`;
          if (!seenValues.has(key)) {
            seenValues.add(key);

            const combinedParsedDate: ParsedDate = {
              text: `${arg1Text} ${spreadMatch.separatorKeyword} ${arg2Text}`,
              date: arg1Date.date,
              isRange: true,
              rangeStart: arg1Date.date,
              rangeEnd: arg2Date.date,
              consumedText: `${arg1Text} ${spreadMatch.separatorKeyword} ${arg2Text}`,
            };

            const arg1Start = spreadMatch.arg1Tokens[0]?.start ?? 0;
            const arg1End = spreadMatch.arg1Tokens[spreadMatch.arg1Tokens.length - 1]?.end ?? arg1Text.length;
            const arg2Start = spreadMatch.arg2Tokens[0]?.start ?? 0;
            const arg2End = spreadMatch.arg2Tokens[spreadMatch.arg2Tokens.length - 1]?.end ?? arg2Text.length;

            const spreadMatchMeta: import("../types.ts").MatchMetadata = {
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
                SCORING_CONFIG.BONUS.SPREAD_PATTERN_BASE,
                countForDateFilter(
                  col.id,
                  spreadMatch.operator,
                  combinedParsedDate,
                  this.getData(),
                  context.contextRowIndices
                ),
                undefined,
                spreadMatchMeta,
                context.tokens,
                context.i18nProvider
              )
            );
          }
        }

        // Number columns
        if (col.type === DataType.NUMBER && isFinite(arg1Num) && isFinite(arg2Num)) {
          const key = `${col.id}:${spreadMatch.operator}:spread:${arg1Num}-${arg2Num}`;
          if (!seenValues.has(key)) {
            seenValues.add(key);

            const sorted = [arg1Num, arg2Num].sort((a, b) => a - b);
            const args = sorted.map(v => toHypothesisValue(v));

            const startToken = context.tokens[spreadMatch.startIndex]!;
            const sepToken = context.tokens[spreadMatch.separatorIndex]!;
            const numArg1Start = spreadMatch.arg1Tokens[0]?.start ?? 0;
            const numArg1End = spreadMatch.arg1Tokens[spreadMatch.arg1Tokens.length - 1]?.end ?? arg1Text.length;
            const numArg2Start = spreadMatch.arg2Tokens[0]?.start ?? 0;
            const numArg2End = spreadMatch.arg2Tokens[spreadMatch.arg2Tokens.length - 1]?.end ?? arg2Text.length;

            const numSpreadMatchMeta: import("../types.ts").MatchMetadata = {
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
                SCORING_CONFIG.BONUS.SPREAD_PATTERN_BASE,
                undefined,
                undefined,
                numSpreadMatchMeta,
                context.tokens,
                context.i18nProvider
              )
            );
          }
        }
      }
    }

    return suggestions;
  }

  /**
   * Detects spread patterns in tokens
   */
  private detectSpreadPatterns(
    tokens: Token[],
    operators: Array<{ id: import("../../types/index.ts").Operator; spreadPatterns?: readonly import("../../types/index.ts").SpreadPattern[] }>,
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
  ): SpreadPatternMatch[] {
    const matches: SpreadPatternMatch[] = [];

    for (const op of operators) {
      if (!op.spreadPatterns) continue;

      const startKeywords = getSpreadStartKeywords(op.spreadPatterns, i18nProvider);
      const separatorKeywords = getSpreadSeparatorKeywords(op.spreadPatterns, i18nProvider);

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
}
