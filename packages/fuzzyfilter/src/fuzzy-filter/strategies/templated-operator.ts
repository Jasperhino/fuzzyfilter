/**
 * Strategy: Templated Operator Detection
 * 
 * Handles patterns like "from X to Y" or "between X and Y" that map to
 * variadic operators like "between".
 * 
 * Works with the new pattern-based operator format where template patterns
 * are embedded in the patterns array (e.g., "$from {min} @to {max}").
 */

import type { SuggestionStrategy, StrategyContext } from "./interface.ts";
import type { FilterSuggestion, Token, ParsedDate, OperatorDefinition } from "../../types/index.ts";
import type { TemplatePatternMatch } from "../types.ts";
import { getAllOperators, getOperator } from "../../operators.ts";
import { getColumns } from "../../schema-builder.ts";
import { DataType } from "../../types/index.ts";
import { parseDate, formatDateForDisplay } from "../../date-parser.ts";
import { toHypothesisValue } from "../engine/helpers.ts";
import {
  createSuggestion,
  createDateSuggestion,
  countForDateFilter,
} from "../engine/suggestion-helpers.ts";
import { SCORING_CONFIG } from "../constants.ts";
import type { I18nProvider } from "../../types/i18n.ts";

/**
 * Information about a template pattern extracted from operator patterns
 */
interface ExtractedTemplate {
  /** Operator ID */
  operatorId: string;
  /** Start keywords (before first arg) */
  startKeywords: Set<string>;
  /** Separator keywords (between args) */
  separatorKeywords: Set<string>;
}

/**
 * Strategy for detecting and handling templated operators
 */
export class TemplatedOperatorStrategy implements SuggestionStrategy {
  constructor(
    private getSchema: () => import("../../types/index.ts").Schema | null,
    private getData: () => Array<Record<string, unknown>>
  ) {}

  canHandle(context: StrategyContext): boolean {
    // This strategy runs after n-gram matching, so we check for template patterns
    // in the tokens. The actual detection happens in generate().
    return context.tokens.length >= 3; // Minimum: "from X to" or "between X and"
  }

  generate(context: StrategyContext): FilterSuggestion[] {
    const schema = this.getSchema();
    if (!schema) return [];

    const suggestions: FilterSuggestion[] = [];
    const seenValues = new Set<string>();

    // Extract template patterns from operators
    const templates = this.extractTemplates(context.i18nProvider);
    
    // Detect template patterns in tokens
    const templateMatches = this.detectTemplatePatterns(context.tokens, templates);

    for (const templateMatch of templateMatches) {
      const arg1Text = templateMatch.arg1Tokens.map(t => t.text).join(" ");
      const arg2Text = templateMatch.arg2Tokens.map(t => t.text).join(" ");

      // Try to parse each argument
      const arg1Date = arg1Text ? parseDate(arg1Text) : null;
      const arg2Date = arg2Text ? parseDate(arg2Text) : null;
      const arg1Num = arg1Text ? parseFloat(arg1Text) : NaN;
      const arg2Num = arg2Text ? parseFloat(arg2Text) : NaN;

      // Check what columns this could apply to
      for (const col of getColumns(schema)) {
        if (!col.type) continue;
        const opInfo = getOperator(templateMatch.operator);
        if (!opInfo || !(opInfo.supportedTypes as readonly string[]).includes(col.type)) continue;

        // Date columns
        if (col.type === DataType.DATE && arg1Date && arg2Date) {
          const key = `${col.id}:${templateMatch.operator}:template:${arg1Date.date.toISOString()}-${arg2Date.date.toISOString()}`;
          if (!seenValues.has(key)) {
            seenValues.add(key);

            const combinedParsedDate: ParsedDate = {
              text: `${arg1Text} ${templateMatch.separatorKeyword} ${arg2Text}`,
              date: arg1Date.date,
              isRange: true,
              rangeStart: arg1Date.date,
              rangeEnd: arg2Date.date,
              consumedText: `${arg1Text} ${templateMatch.separatorKeyword} ${arg2Text}`,
            };

            const arg1Start = templateMatch.arg1Tokens[0]?.start ?? 0;
            const arg1End = templateMatch.arg1Tokens[templateMatch.arg1Tokens.length - 1]?.end ?? arg1Text.length;
            const arg2Start = templateMatch.arg2Tokens[0]?.start ?? 0;
            const arg2End = templateMatch.arg2Tokens[templateMatch.arg2Tokens.length - 1]?.end ?? arg2Text.length;

            const templateMatchMeta: import("../types.ts").MatchMetadata = {
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
              createDateSuggestion({
                column: col,
                operator: templateMatch.operator,
                parsedDate: combinedParsedDate,
                score: SCORING_CONFIG.BONUS.SPREAD_PATTERN_BASE,
                resultCount: countForDateFilter(
                  col.id,
                  templateMatch.operator,
                  combinedParsedDate,
                  this.getData(),
                  context.contextRowIndices
                ),
                matchMetadata: templateMatchMeta,
                queryTokens: context.tokens,
                i18nProvider: context.i18nProvider,
              })
            );
          }
        }

        // Number columns
        if (col.type === DataType.NUMBER && isFinite(arg1Num) && isFinite(arg2Num)) {
          const key = `${col.id}:${templateMatch.operator}:template:${arg1Num}-${arg2Num}`;
          if (!seenValues.has(key)) {
            seenValues.add(key);

            const sorted = [arg1Num, arg2Num].sort((a, b) => a - b);
            const args = sorted.map(v => toHypothesisValue(v));

            const startToken = context.tokens[templateMatch.startIndex]!;
            const sepToken = context.tokens[templateMatch.separatorIndex]!;
            const numArg1Start = templateMatch.arg1Tokens[0]?.start ?? 0;
            const numArg1End = templateMatch.arg1Tokens[templateMatch.arg1Tokens.length - 1]?.end ?? arg1Text.length;
            const numArg2Start = templateMatch.arg2Tokens[0]?.start ?? 0;
            const numArg2End = templateMatch.arg2Tokens[templateMatch.arg2Tokens.length - 1]?.end ?? arg2Text.length;

            const numTemplateMatchMeta: import("../types.ts").MatchMetadata = {
              operator: {
                inputStart: startToken.start,
                inputEnd: startToken.end,
                inputText: startToken.text,
                matchedTarget: templateMatch.operator,
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
                  matchedTarget: templateMatch.separatorKeyword,
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
                templateMatch.operator,
                args,
                SCORING_CONFIG.BONUS.SPREAD_PATTERN_BASE,
                undefined,
                undefined,
                numTemplateMatchMeta,
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
   * Extract template patterns from operators using the new pattern format.
   * 
   * Patterns like "$from {min} @to {max}" are parsed to extract:
   * - Start keywords: words before the first {arg}
   * - Separator keywords: words between {arg} placeholders
   */
  private extractTemplates(i18nProvider?: I18nProvider): ExtractedTemplate[] {
    const templates: ExtractedTemplate[] = [];
    const operators = getAllOperators();

    for (const op of operators) {
      // Parse patterns to extract template info
      if (!op.patterns) continue;
      
      const startKeywords = new Set<string>();
      const separatorKeywords = new Set<string>();

      for (const pattern of op.patterns) {
        // Skip patterns that don't have multiple arguments
        // Match both {} (anonymous) and {name} (named) arguments
        const argMatches = pattern.match(/\{(\w*)\}/g);
        if (!argMatches || argMatches.length < 2) continue;

        // Parse the pattern to find keywords between arguments
        // Pattern like: "t(from) {} @to {}"
        const parts = pattern.split(/\{[^}]*\}/);
        
        if (parts.length >= 2) {
          // First part: start keywords (before first arg)
          const startPart = parts[0]?.trim();
          if (startPart) {
            const expanded = this.expandRefs(startPart, op, i18nProvider);
            expanded.forEach(k => startKeywords.add(k.toLowerCase()));
          }
          
          // Middle parts: separator keywords (between args)
          for (let i = 1; i < parts.length - 1; i++) {
            const sepPart = parts[i]?.trim();
            if (sepPart) {
              const expanded = this.expandRefs(sepPart, op, i18nProvider);
              expanded.forEach(k => separatorKeywords.add(k.toLowerCase()));
            }
          }
          
          // Last middle part (before last arg)
          if (parts.length >= 3) {
            const lastSepPart = parts[parts.length - 2]?.trim();
            if (lastSepPart) {
              const expanded = this.expandRefs(lastSepPart, op, i18nProvider);
              expanded.forEach(k => separatorKeywords.add(k.toLowerCase()));
            }
          }
        }
      }

      if (startKeywords.size > 0 && separatorKeywords.size > 0) {
        templates.push({ operatorId: op.id, startKeywords, separatorKeywords });
      }
    }

    return templates;
  }

  /**
   * Expand @aliasRef and t(key) refs in a pattern part to get all keywords
   */
  private expandRefs(part: string, op: OperatorDefinition, i18nProvider?: I18nProvider): string[] {
    const results: string[] = [];
    
    // Check for @aliasRef
    const aliasMatch = part.match(/@(\w+)/);
    if (aliasMatch && op.aliases) {
      const refKey = `@${aliasMatch[1]}`;
      const aliases = op.aliases[refKey];
      if (aliases) {
        for (const alias of aliases) {
          // Skip i18n refs (t(key) syntax)
          if (!alias.startsWith("t(")) {
            // Convert underscores to spaces
            results.push(alias.replace(/_/g, " "));
          }
        }
      }
    }
    
    // Check for t(key) i18nRef
    const i18nMatch = part.match(/t\(([^)]+)\)/);
    if (i18nMatch) {
      const key = i18nMatch[1]!;
      // Try i18n provider
      if (i18nProvider?.translate) {
        try {
          const translated = i18nProvider.translate(key);
          if (translated) {
            const values = Array.isArray(translated) ? translated : [translated];
            results.push(...values);
          }
        } catch {
          // Ignore errors
        }
      }
      // Fallback to key itself
      if (results.length === 0) {
        results.push(key.replace(/[._]/g, " "));
      }
    }
    
    // Also add any literal text (no refs)
    const cleaned = part.replace(/@\w+/g, "").replace(/t\([^)]+\)/g, "").trim();
    if (cleaned) {
      results.push(cleaned);
    }
    
    return results;
  }

  /**
   * Detects template patterns in tokens using extracted templates
   */
  private detectTemplatePatterns(
    tokens: Token[],
    templates: ExtractedTemplate[]
  ): TemplatePatternMatch[] {
    const matches: TemplatePatternMatch[] = [];

    for (const template of templates) {
      // Look for start keywords in tokens
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (!template.startKeywords.has(token.normalized)) continue;

        // Found a start keyword, now look for a separator keyword after it
        for (let j = i + 1; j < tokens.length; j++) {
          const sepToken = tokens[j]!;
          if (!template.separatorKeywords.has(sepToken.normalized)) continue;

          // Found a separator, extract argument tokens
          const arg1Tokens = tokens.slice(i + 1, j);
          const arg2Tokens = tokens.slice(j + 1);

          // Only valid if we have at least some argument tokens
          if (arg1Tokens.length > 0 || arg2Tokens.length > 0) {
            matches.push({
              operator: template.operatorId,
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

