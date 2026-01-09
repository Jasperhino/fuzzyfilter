/**
 * Strategy 1: Empty Query
 * 
 * When the user hasn't typed anything yet, show all columns with their
 * default operators to help them get started.
 */

import type { SuggestionStrategy, StrategyContext } from "./interface.ts";
import type { FilterSuggestion } from "../../types/index.ts";
import { DataType } from "../../types/index.ts";
import { getColumns } from "../../schema-builder.ts";
import { getDefaultOperatorForType, getOperator } from "../../operators.ts";
import { createSuggestion } from "../engine/suggestion-helpers.ts";

/**
 * Strategy for handling empty queries
 */
export class EmptyQueryStrategy implements SuggestionStrategy {
  constructor(
    private getSchema: () => import("../../types/index.ts").Schema | null
  ) {}

  canHandle(context: StrategyContext): boolean {
    return context.tokens.length === 0;
  }

  generate(context: StrategyContext): FilterSuggestion[] {
    const schema = this.getSchema();
    if (!schema) return [];

    const suggestions: FilterSuggestion[] = [];

    for (const col of getColumns(schema)) {
      // Skip columns without a type (shouldn't happen but handle gracefully)
      if (!col.type) continue;
      const defaultOpId = getDefaultOperatorForType(col.type as DataType);
      const defaultOp = getOperator(defaultOpId);
      if (defaultOp) {
        suggestions.push(
          createSuggestion(
            col,
            defaultOpId,
            undefined,
            0,
            undefined,
            undefined,
            undefined,
            context.tokens,
            context.i18nProvider
          )
        );
      }
    }

    return suggestions;
  }
}
