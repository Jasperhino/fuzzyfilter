/**
 * Field-Centric Types
 * 
 * This module defines the new field-centric API where each field owns its
 * operator definitions and overloads. This allows for:
 * - Multiple operator overloads per field (e.g., percentage vs amount comparison)
 * - Field-specific i18n keys for operators
 * - Type-safe argument schemas using Zod
 * 
 * @module fuzzyfilter/types/field-centric
 */

import type { ZodType } from "zod";

/**
 * Predicate function signature for operator overloads.
 * 
 * @typeParam TOperand - The type of the field value being filtered
 * @typeParam TArgs - The shape of parsed arguments
 */
export type PredicateFn<TOperand, TArgs extends Record<string, unknown>> = (
  operand: TOperand,
  args: TArgs,
  row?: Record<string, unknown>
) => boolean;

/**
 * A single overload of an operator for a specific field.
 * Each overload has its own argument schema, i18n key, and predicate.
 * 
 * @example
 * ```typescript
 * const percentageOverload: OperatorOverload<MaterialContainer[], { percentage: number; materialTypes: string[] }> = {
 *   id: 'contents:gt:percentage+materialTypes[]',
 *   i18nKey: 'operators.contents.gt.percentage',
 *   argumentSchema: z.object({
 *     percentage: z.number().min(0).max(100),
 *     materialTypes: z.array(z.string()).min(1),
 *   }),
 *   predicate: (containers, { percentage, materialTypes }) => {
 *     // ... comparison logic
 *   },
 *   priority: 10,
 * };
 * ```
 */
export interface OperatorOverload<
  TOperand = unknown,
  TArgs extends Record<string, unknown> = Record<string, unknown>
> {
  /**
   * Unique ID for this overload.
   * Format: `field:operator:argumentType(s)`
   * 
   * @example
   * - `date:eq:date`
   * - `contents:gt:percentage+materialTypes[]`
   * - `amount:lt:amount`
   */
  id: string;

  /**
   * i18n key specific to this overload.
   * Allows different labels per context.
   * 
   * @example
   * - `operators.eq` (generic)
   * - `operators.date.after` (field-specific)
   * - `operators.contents.gt.percentage` (overload-specific)
   */
  i18nKey: string;

  /**
   * Zod schema for parsing/validating arguments.
   * The schema shape defines what the predicate receives.
   */
  argumentSchema: ZodType<TArgs>;

  /**
   * The predicate function for this overload.
   */
  predicate: PredicateFn<TOperand, TArgs>;

  /**
   * Priority for suggestion ranking when multiple overloads match.
   * Higher values = shown first in suggestions.
   * @default 0
   */
  priority?: number;
}

/**
 * Configuration for an operator on a specific field.
 * Groups all overloads for a single operator.
 */
export interface FieldOperatorConfig<TOperand = unknown> {
  /**
   * Base operator ID (e.g., 'gt', 'eq', 'contains').
   * Used for grouping and lookup.
   */
  operatorId: string;

  /**
   * All overloads for this operator on this field.
   * Multiple overloads allow different argument signatures.
   */
  overloads: OperatorOverload<TOperand, any>[];
}

/**
 * Complete field schema including its type and operator configurations.
 * 
 * @typeParam TOperand - The runtime type of this field's values
 * 
 * @example
 * ```typescript
 * const dateField: FieldSchema<Date> = {
 *   labelKey: 'columns.date',
 *   operandSchema: z.date(),
 *   operators: [
 *     {
 *       operatorId: 'eq',
 *       overloads: [{
 *         id: 'date:eq:date',
 *         i18nKey: 'operators.eq',
 *         argumentSchema: z.object({ value: z.date() }),
 *         predicate: (operand, { value }) => operand.getTime() === value.getTime(),
 *       }],
 *     },
 *   ],
 * };
 * ```
 */
export interface FieldSchema<TOperand = unknown> {
  /**
   * i18n key for the field label.
   * Used for display and fuzzy matching.
   */
  labelKey: string;

  /**
   * Zod schema for the field's operand type.
   * Used for type inference and validation.
   */
  operandSchema: ZodType<TOperand>;

  /**
   * All operators available for this field.
   * Each operator can have multiple overloads.
   */
  operators: FieldOperatorConfig<TOperand>[];

  /**
   * Alternative names/aliases for fuzzy matching.
   * @optional
   */
  aliases?: string[];

  /**
   * i18n keys for aliases (looked up dynamically).
   * @optional
   */
  aliasKeys?: string[];

  /**
   * Whether this field can contain null values.
   * @default false
   */
  nullable?: boolean;

  /**
   * Description for tooltips/help.
   * @optional
   */
  description?: string;

  /**
   * i18n key for the description.
   * @optional
   */
  descriptionKey?: string;
}

/**
 * Result from parsing an argument using an ArgumentParser.
 */
export interface ArgumentParseResult<T> {
  /** The argument type identifier */
  type: string;
  /** The parsed value */
  value: T;
  /** Start index in the original query */
  index: number;
  /** The matched text from the query */
  text: string;
}

/**
 * Parser for extracting typed arguments from user input.
 * 
 * @typeParam T - The type this parser produces
 * 
 * @example
 * ```typescript
 * class AmountParser implements ArgumentParser<Amount> {
 *   parse(query: string): ArgumentParseResult<Amount>[] {
 *     const regex = /(\d+)\s*(kg|t)/gi;
 *     const results: ArgumentParseResult<Amount>[] = [];
 *     let match;
 *     while ((match = regex.exec(query)) !== null) {
 *       results.push({
 *         type: 'amount',
 *         value: { value: parseInt(match[1]), unit: match[2].toLowerCase() },
 *         index: match.index,
 *         text: match[0],
 *       });
 *     }
 *     return results;
 *   }
 * }
 * ```
 */
export interface ArgumentParser<T> {
  /**
   * Parse the query string and return all matches.
   * 
   * @param query - The user's input text
   * @returns Array of parse results with positions
   */
  parse(query: string): ArgumentParseResult<T>[];
}

/**
 * Registry of argument parsers keyed by type name.
 */
export type ParserRegistry = Record<string, ArgumentParser<unknown>>;

/**
 * Registry of field schemas keyed by field name.
 */
export type FieldRegistry<T extends Record<string, FieldSchema<any>> = Record<string, FieldSchema<any>>> = T;

/**
 * Resolved overload after argument parsing.
 * Contains the matched overload and parsed arguments.
 */
export interface ResolvedOverload<TOperand = unknown, TArgs extends Record<string, unknown> = Record<string, unknown>> {
  /** The field key */
  fieldKey: string;
  /** The matched overload */
  overload: OperatorOverload<TOperand, TArgs>;
  /** Parsed and validated arguments */
  parsedArgs: TArgs;
  /** Match score from fuzzy matching */
  score: number;
}

/**
 * Translation structure for field-specific operator labels.
 * Supports nested paths for overload-specific translations.
 * 
 * @example
 * ```typescript
 * const translations: FieldCentricTranslations = {
 *   en: {
 *     columns: {
 *       contents: ['Content', 'Composition'],
 *     },
 *     operators: {
 *       eq: ['equals', 'is'],
 *       contents: {
 *         gt: {
 *           percentage: ['more than', 'over'],
 *           amount: ['greater than', 'heavier than'],
 *         },
 *       },
 *     },
 *   },
 * };
 * ```
 */
export interface FieldCentricTranslations {
  /** Locale-independent translations (symbols) */
  common?: {
    operators?: Record<string, string[]>;
  };
  /** Locale-specific translations */
  [locale: string]: {
    columns?: Record<string, string[]>;
    operators?: Record<string, string[] | Record<string, string[] | Record<string, string[]>>>;
  } | undefined;
}
