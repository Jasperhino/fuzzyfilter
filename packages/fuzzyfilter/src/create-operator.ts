/**
 * createOperator - Type-safe operator creation with pattern-based argument extraction
 *
 * Creates operators with compile-time type safety for pattern arguments.
 * Supports both single-type (predicate) and multi-type (predicates) operators.
 *
 * @packageDocumentation
 * @module fuzzyfilter/create-operator
 */

import type {
  AssertAllValidations,
  CombinedTypeKeys,
  MultiTypeOperatorDefOutput,
  OperatorArgs,
  PredicatesMap,
  Prettify,
  StrictArgs,
  TypeRegistry,
  ValidateRequiredPredicates,
} from "./types/pattern-types.ts";

// Re-export TypeRegistry for module augmentation
export type { TypeRegistry } from "./types/pattern-types.ts";

// =============================================================================
// SINGLE-TYPE OPERATOR DEFINITION
// =============================================================================

/**
 * Input type for single-type operator definitions.
 * @internal
 */
type SingleTypeOperatorDefInput<
  TValue,
  TPatterns extends readonly string[],
  TArgs,
  TTypeMap extends Record<string, unknown> = {},
  TTranslationKeys extends string = string
> = {
  /** Unique identifier for the operator */
  id: string;
  /** Pattern strings with validation - errors surface here */
  patterns: TPatterns & ValidatePatterns<TPatterns, TTranslationKeys>;
  /** Predicate function that tests operand values against extracted arguments */
  predicate: (
    operand: TValue,
    args: StrictArgs<OperatorArgs<TPatterns, TValue, TTypeMap>, TArgs>
  ) => boolean;
  /** Not allowed when using single predicate */
  predicates?: never;
};

/**
 * Input type for multi-type operator definitions.
 * @internal
 */
type MultiTypeOperatorDefInput<
  TPatterns extends readonly string[],
  TTypeMap extends Record<string, unknown>,
  TImplKeys extends CombinedTypeKeys<TTypeMap>,
  TTranslationKeys extends string = string
> = {
  /** Unique identifier for the operator */
  id: string;
  /** Pattern strings with validation - errors surface here */
  patterns: TPatterns & ValidatePatterns<TPatterns, TTranslationKeys>;
  /** Not allowed when using predicates map */
  predicate?: never;
  /** Type-specific predicates - validates required keys and provides typed signatures */
  predicates: PredicatesMap<TPatterns, TTypeMap, TImplKeys>;
};

/**
 * Validates patterns at compile time.
 * @internal
 */
type ValidatePatterns<
  TPatterns extends readonly string[],
  TTranslationKeys extends string
> = AssertAllValidations<TPatterns, TTranslationKeys> extends TPatterns
  ? TPatterns
  : AssertAllValidations<TPatterns, TTranslationKeys>;

/**
 * Output type for validated single-type operator definitions.
 * @internal
 */
type SingleTypeOperatorDefOutput<
  TValue,
  TPatterns extends readonly string[],
  TArgs,
  TTypeMap extends Record<string, unknown> = {},
  TTranslationKeys extends string = string
> = AssertAllValidations<TPatterns, TTranslationKeys> extends TPatterns
  ? {
      /** Unique identifier for the operator */
      id: string;
      /** Validated pattern strings */
      patterns: TPatterns;
      /** Predicate function with properly typed arguments */
      predicate: (
        operand: TValue,
        args: Prettify<OperatorArgs<TPatterns, TValue, TTypeMap>>
      ) => boolean;
      /** Supported types derived from patterns */
      supportedTypes: string[];
    }
  : AssertAllValidations<TPatterns, TTranslationKeys>;

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Creates a type-safe operator with pattern-based argument extraction.
 *
 * This function parses pattern strings at compile time to extract typed arguments,
 * validates i18n keys, and ensures pattern consistency across multiple patterns.
 *
 * ## Single-Type Operator (predicate)
 *
 * Use `predicate` for operators that work on one operand type:
 *
 * ```typescript
 * const betweenOp = createOperator({
 *   id: 'between',
 *   patterns: ['{min} to {max}'],
 *   predicate: (operand: number, { min, max }) => operand >= min && operand <= max,
 * });
 * ```
 *
 * ## Multi-Type Operator (predicates)
 *
 * Use `predicates` for operators that work across multiple operand types:
 *
 * ```typescript
 * const betweenOp = createOperator({
 *   id: 'between',
 *   patterns: ['{min} to {max}'],
 *   predicates: {
 *     number: (operand, { min, max }) => operand >= min && operand <= max,
 *     amount: (operand, { min, max }) => operand.value >= min.value,
 *   },
 * });
 * ```
 *
 * ## With Explicit Types
 *
 * Use `:type` syntax to specify argument types:
 *
 * ```typescript
 * createOperator({
 *   id: 'threshold',
 *   patterns: ['{value:number} or more'],
 *   predicate: (operand: string, { value }) => operand.length >= value,
 * });
 * ```
 *
 * ## With Shorthand Type Syntax
 *
 * Use `{:type}` when the argument name should equal the type name:
 *
 * ```typescript
 * createOperator<{ amount: Amount }>()({
 *   id: 'exceeds',
 *   patterns: ['exceeds {:amount}'],
 *   predicate: (operand: number, { amount }) => operand > amount.value,
 * });
 * ```
 *
 * ## With Translation Keys
 *
 * Use `t(key)` syntax for i18n support:
 *
 * ```typescript
 * createOperator({
 *   id: 'range',
 *   patterns: ['t(filter.from) {min} t(filter.to) {max}'],
 *   predicate: (operand: number, { min, max }) => operand >= min && operand <= max,
 * });
 * ```
 *
 * ## With Variadic Arguments
 *
 * Use `{...name}` for array arguments (always non-empty):
 *
 * ```typescript
 * createOperator({
 *   id: 'oneOf',
 *   patterns: ['one of {...values}'],
 *   predicate: (operand: number, { values }) => values.includes(operand),
 * });
 * ```
 *
 * ## With Custom Type Mappings
 *
 * For custom types not in TypeRegistry, call with a type parameter:
 *
 * ```typescript
 * interface Amount { value: number; unit: string }
 *
 * createOperator<{ amount: Amount }>()({
 *   id: 'custom',
 *   patterns: ['{:amount}'],
 *   predicate: (operand: number, { amount }) => operand === amount.value,
 * });
 * ```
 *
 * @typeParam TTypeMap - Optional custom type mappings for pattern arguments
 *
 * @param def - The operator definition object
 * @returns The validated operator definition with proper typing
 *
 * @example
 * ```typescript
 * // Simple range operator
 * const rangeOp = createOperator({
 *   id: 'range',
 *   patterns: ['{min:number} to {max:number}'],
 *   predicate: (operand: number, { min, max }) => operand >= min && operand <= max,
 * });
 *
 * // Multi-type operator
 * createOperator({
 *   id: 'greater',
 *   patterns: ['t(operators.greater) {:amount}', 't(operators.greater) {:number}'],
 *   predicates: {
 *     number: (operand, { number }) => operand > number,
 *     amount: (operand, { amount }) => operand.toKg() > amount.toKg(),
 *   },
 * });
 * ```
 */
// Overload 1: Curried form with custom type map - single-type
export function createOperator<
  TTypeMap extends Record<string, unknown> = {},
  TTranslationKeys extends string = string
>(): {
  // Single-type with predicate
  <
    TValue,
    const TPatterns extends readonly string[],
    TArgs extends OperatorArgs<TPatterns, TValue, TTypeMap> = OperatorArgs<
      TPatterns,
      TValue,
      TTypeMap
    >
  >(
    def: SingleTypeOperatorDefInput<TValue, TPatterns, TArgs, TTypeMap, TTranslationKeys>
  ): SingleTypeOperatorDefOutput<TValue, TPatterns, TArgs, TTypeMap, TTranslationKeys>;
  // Multi-type with predicates
  <
    const TPatterns extends readonly string[],
    TImplKeys extends CombinedTypeKeys<TTypeMap>
  >(
    def: MultiTypeOperatorDefInput<TPatterns, TTypeMap, TImplKeys, TTranslationKeys>
  ): MultiTypeOperatorDefOutput<TPatterns, TTypeMap, TTranslationKeys, TImplKeys>;
};

// Overload 2: Direct form - single-type with predicate
export function createOperator<
  TValue,
  const TPatterns extends readonly string[],
  TArgs extends OperatorArgs<TPatterns, TValue, {}> = OperatorArgs<TPatterns, TValue, {}>,
  TTranslationKeys extends string = string
>(
  def: SingleTypeOperatorDefInput<TValue, TPatterns, TArgs, {}, TTranslationKeys>
): SingleTypeOperatorDefOutput<TValue, TPatterns, TArgs, {}, TTranslationKeys>;

// Overload 3: Direct form - multi-type with predicates
export function createOperator<
  const TPatterns extends readonly string[],
  TImplKeys extends CombinedTypeKeys<{}>,
  TTranslationKeys extends string = string
>(
  def: MultiTypeOperatorDefInput<TPatterns, {}, TImplKeys, TTranslationKeys>
): MultiTypeOperatorDefOutput<TPatterns, {}, TTranslationKeys, TImplKeys>;

// Implementation
export function createOperator(def?: any): any {
  if (def === undefined) {
    // Curried form: createOperator<TypeMap>()({ ... })
    return (d: any) => processOperatorDef(d);
  }
  // Direct form: createOperator({ ... })
  return processOperatorDef(def);
}

/**
 * Extracts type names from patterns.
 * Finds all {:type} and {arg:type} patterns and returns unique type names.
 * @internal
 */
function extractTypesFromPatterns(patterns: readonly string[]): string[] {
  const types = new Set<string>();
  
  for (const pattern of patterns) {
    // Match {:type} shorthand
    const shorthandMatches = pattern.matchAll(/\{:(\w+)\}/g);
    for (const match of shorthandMatches) {
      types.add(match[1]!);
    }
    
    // Match {name:type} or {...name:type}
    const typedMatches = pattern.matchAll(/\{\.{0,3}\w+:(\w+)\}/g);
    for (const match of typedMatches) {
      types.add(match[1]!);
    }
  }
  
  return Array.from(types);
}

/**
 * Internal helper to process operator definitions.
 * @internal
 */
function processOperatorDef(def: {
  id: string;
  patterns: readonly string[];
  predicate?: (operand: any, args: any) => boolean;
  predicates?: Record<string, (operand: any, args: any) => boolean>;
}) {
  // Multi-type operator with predicates
  if (def.predicates) {
    const supportedTypes = Object.keys(def.predicates) as (keyof TypeRegistry)[];
    return {
      id: def.id,
      patterns: def.patterns,
      predicates: def.predicates,
      supportedTypes,
      getPredicateForType(typeName: string) {
        return def.predicates![typeName];
      },
    };
  }
  
  // Single-type operator with predicate
  // Extract supported types from patterns
  const supportedTypes = extractTypesFromPatterns(def.patterns);
  
  return {
    ...def,
    supportedTypes,
  };
}
