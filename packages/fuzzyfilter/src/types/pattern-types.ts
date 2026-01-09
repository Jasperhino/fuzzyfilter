/**
 * Pattern Types - Type Definitions
 *
 * Internal type utilities for pattern parsing, validation, and argument extraction.
 * Provides compile-time type safety for operator definitions with pattern-based argument extraction.
 *
 * @packageDocumentation
 * @module fuzzyfilter/types/pattern-types
 */

// =============================================================================
// INTERNAL TYPES - Pattern Parsing & Validation
// =============================================================================

/**
 * Branded error type for clear IDE tooltips.
 * @internal
 */
export type PatternError<
  TCode extends string,
  TMessage extends string,
  TDetails extends Record<string, unknown> = {}
> = {
  readonly __brand: "PatternTypeError";
  readonly code: TCode;
  readonly message: TMessage;
} & TDetails;

/**
 * 1. PARSE NAMED ARGS FROM PATTERN
 * Extracts {name:type} or {name} or {:type} or {...name:type} or {...name} or {...:type}
 */
export type ParseArgName<T extends string> = T extends `:${infer Type}`
  ? { name: Type; type: Type } // {:type} shortcut - name IS the type
  : T extends `${infer Name}:${infer Type}`
    ? { name: Name; type: Type }
    : { name: T; type: "default" };

/**
 * Default type map for built-in primitives.
 */
export type DefaultTypeMap = {
  string: string;
  number: number;
  boolean: boolean;
  bool: boolean; // alias
  bigint: bigint;
  symbol: symbol;
  null: null;
  undefined: undefined;
  object: object;
  int: number;
  float: number;
};

/**
 * Resolve type from string.
 * Priority: TTypeMap > TypeRegistry > DefaultTypeMap > TFallback
 */
export type TypeFromString<
  T extends string,
  TFallback,
  TTypeMap extends Record<string, unknown> = {}
> = T extends keyof TTypeMap
  ? TTypeMap[T] // User-provided type map takes precedence
  : T extends keyof TypeRegistry
    ? TypeRegistry[T] // Then check TypeRegistry (for registered types like 'amount')
    : T extends keyof DefaultTypeMap
      ? DefaultTypeMap[T] // Then defaults (string, number, etc.)
      : TFallback; // Finally, fall back to operand type

/**
 * 2. BUILD NAMED ARGS OBJECT
 * Process string by jumping to next `{` - avoids character-by-character recursion.
 */
export type ExtractArgsObject<
  T extends string,
  TFallback,
  TTypeMap extends Record<string, unknown> = {},
  Acc extends Record<string, unknown> = {}
> =
  // Match variadic arg: {...name} or {...name:type}
  T extends `${string}{...${infer Arg}}${infer Rest}`
    ? ParseArgName<Arg> extends {
        name: infer N extends string;
        type: infer Ty extends string;
      }
      ? ExtractArgsObject<
          Rest,
          TFallback,
          TTypeMap,
          Acc & {
            [K in N]: [
              TypeFromString<Ty, TFallback, TTypeMap>,
              ...TypeFromString<Ty, TFallback, TTypeMap>[],
            ];
          }
        >
      : never
    : // Match regular arg: {name} or {name:type} - jump past any prefix
      T extends `${string}{${infer Arg}}${infer Rest}`
      ? ParseArgName<Arg> extends {
          name: infer N extends string;
          type: infer Ty extends string;
        }
        ? ExtractArgsObject<
            Rest,
            TFallback,
            TTypeMap,
            Acc & { [K in N]: TypeFromString<Ty, TFallback, TTypeMap> }
          >
        : never
      : // No more args found - flatten accumulated intersections into clean object
        { [K in keyof Acc]: Acc[K] };

/**
 * 3. UTILITIES FOR MERGING ARGS FROM MULTIPLE PATTERNS
 */

/**
 * Helper to flatten intersection types for cleaner hover types.
 */
export type Prettify<T> = {
  [K in keyof T]: {} extends Pick<T, K> ? Exclude<T[K], undefined> : T[K];
} & {};

/** Get union of all keys from all members of a union type */
export type KeysOfUnion<T> = T extends T ? keyof T : never;

/** Extract the value type for a key from whichever union member has it */
export type ValueInUnion<T, K extends PropertyKey> = T extends {
  [P in K]: infer V;
}
  ? V
  : never;

/** Merge args: required keys (in all patterns) + optional keys (in some patterns) */
export type MergedPatternArgs<
  TPatterns extends readonly string[],
  TFallback,
  TTypeMap extends Record<string, unknown> = {}
> = ExtractArgsObject<TPatterns[number], TFallback, TTypeMap> extends infer U
  ? Prettify<
      // Required: keys in the intersection (keyof U on a union = intersection of keys)
      { [K in keyof U & string]: ValueInUnion<U, K> } & // Optional: keys that appear in some but not all patterns
        Partial<{
          [K in Exclude<KeysOfUnion<U>, keyof U> & string]: ValueInUnion<U, K>;
        }>
    >
  : never;

/**
 * 4. SYNTAX VALIDATION
 */

/** Check for unclosed { - finds { not followed by matching } */
export type HasUnclosedBrace<T extends string> =
  T extends `${string}{${infer AfterOpen}`
    ? AfterOpen extends `${infer _}}${infer AfterClose}`
      ? HasUnclosedBrace<AfterClose>
      : true
    : false;

/** Check for unclosed t( - finds t( not followed by matching ) */
export type HasUnclosedTranslation<T extends string> =
  T extends `${string}t(${infer AfterOpen}`
    ? AfterOpen extends `${infer _})${infer AfterClose}`
      ? HasUnclosedTranslation<AfterClose>
      : true
    : false;

/** Validate syntax for all patterns */
export type ValidateSyntax<TPatterns extends readonly string[]> =
  TPatterns extends readonly [
    infer First extends string,
    ...infer Rest extends readonly string[],
  ]
    ? HasUnclosedBrace<First> extends true
      ? PatternError<
          "UNCLOSED_BRACE",
          "Pattern has unclosed { brace",
          { pattern: First }
        >
      : HasUnclosedTranslation<First> extends true
        ? PatternError<
            "UNCLOSED_TRANSLATION",
            "Pattern has unclosed t( translation key",
            { pattern: First }
          >
        : ValidateSyntax<Rest>
    : true;

/**
 * 5. DUPLICATE ARGUMENT NAME VALIDATION
 */

/** Check for duplicate arg names in a single pattern */
export type CheckDuplicateArgs<
  T extends string,
  Seen extends string = never
> = T extends `${string}{...${infer Arg}}${infer Rest}`
  ? ParseArgName<Arg>["name"] extends infer N extends string
    ? N extends Seen
      ? PatternError<
          "DUPLICATE_ARG",
          "Duplicate argument name in pattern",
          { duplicate: N }
        >
      : CheckDuplicateArgs<Rest, Seen | N>
    : never
  : T extends `${string}{${infer Arg}}${infer Rest}`
    ? ParseArgName<Arg>["name"] extends infer N extends string
      ? N extends Seen
        ? PatternError<
            "DUPLICATE_ARG",
            "Duplicate argument name in pattern",
            { duplicate: N }
          >
        : CheckDuplicateArgs<Rest, Seen | N>
      : never
    : true;

/** Validate no pattern has duplicate args */
export type ValidateNoDuplicates<TPatterns extends readonly string[]> =
  TPatterns extends readonly [
    infer First extends string,
    ...infer Rest extends readonly string[],
  ]
    ? CheckDuplicateArgs<First> extends true
      ? ValidateNoDuplicates<Rest>
      : CheckDuplicateArgs<First> & { pattern: First }
    : true;

/**
 * 6. PATTERN CONSISTENCY VALIDATION
 */

/** Extract argument names from a single pattern as a union */
export type ExtractArgNames<T extends string> =
  T extends `${string}{...${infer Arg}}${infer Rest}`
    ? ParseArgName<Arg>["name"] | ExtractArgNames<Rest>
    : T extends `${string}{${infer Arg}}${infer Rest}`
      ? ParseArgName<Arg>["name"] | ExtractArgNames<Rest>
      : never;

/** Count arguments in a pattern using tuple accumulator */
export type CountArgs<T extends string, Count extends any[] = []> =
  T extends `${string}{...${string}}${infer Rest}`
    ? CountArgs<Rest, [...Count, 1]>
    : T extends `${string}{${string}}${infer Rest}`
      ? CountArgs<Rest, [...Count, 1]>
      : Count["length"];

/** Check if two unions of strings are equal */
export type UnionsEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

/** Validate each pattern against all others with the same arg count */
export type ValidatePatternConsistency<TPatterns extends readonly string[]> =
  ValidateEachPattern<TPatterns, TPatterns>;

/** Iterate through patterns, validating each against the full list */
export type ValidateEachPattern<
  TCheck extends readonly string[],
  TAll extends readonly string[]
> = TCheck extends readonly [
  infer First extends string,
  ...infer Rest extends readonly string[],
]
  ? ValidateAgainstAll<First, TAll> extends true
    ? ValidateEachPattern<Rest, TAll>
    : ValidateAgainstAll<First, TAll>
  : true;

/**
 * Check if two patterns have compatible explicit types.
 */
type PatternsHaveCompatibleTypes<A extends string, B extends string> =
  [PatternRegistryTypes<A>] extends [never]
    ? [PatternRegistryTypes<B>] extends [never]
      ? true  // Both untyped
      : false // A untyped, B typed
    : [PatternRegistryTypes<B>] extends [never]
      ? false // A typed, B untyped
      : UnionsEqual<PatternRegistryTypes<A>, PatternRegistryTypes<B>>;

/** Check one pattern against all others with matching arg count */
export type ValidateAgainstAll<
  TPattern extends string,
  TAll extends readonly string[]
> = TAll extends readonly [
  infer Other extends string,
  ...infer Rest extends readonly string[],
]
  ? CountArgs<TPattern> extends CountArgs<Other>
    ? PatternsHaveCompatibleTypes<TPattern, Other> extends true
      ? UnionsEqual<
          ExtractArgNames<TPattern>,
          ExtractArgNames<Other>
        > extends true
        ? ValidateAgainstAll<TPattern, Rest>
        : PatternError<
            "INCONSISTENT_ARGS",
            "Patterns with same arg count must have same arg names",
            {
              count: CountArgs<TPattern>;
              expected: ExtractArgNames<TPattern>;
              found: ExtractArgNames<Other>;
            }
          >
      : ValidateAgainstAll<TPattern, Rest>
    : ValidateAgainstAll<TPattern, Rest>
  : true;

/**
 * 7. PROGRESSIVE PATTERN VALIDATION
 */

/** Get the pattern with the most args */
export type GetMaxArgCount<
  TPatterns extends readonly string[],
  Max extends number = 0
> = TPatterns extends readonly [
  infer First extends string,
  ...infer Rest extends readonly string[],
]
  ? CountArgs<First> extends infer C extends number
    ? C extends number
      ? GetMaxArgCount<
          Rest,
          C extends number
            ? Max extends 0
              ? C
              : C extends Max
                ? Max
                : IsGreater<C, Max> extends true
                  ? C
                  : Max
            : Max
        >
      : Max
    : Max
  : Max;

/** Simple numeric comparison using tuple length */
export type IsGreater<
  A extends number,
  B extends number,
  Acc extends any[] = []
> = Acc["length"] extends A
  ? false
  : Acc["length"] extends B
    ? true
    : IsGreater<A, B, [...Acc, 1]>;

/** Get all arg names from the pattern with the most args */
export type GetLargestPatternArgs<TPatterns extends readonly string[]> =
  CollectLargestArgs<TPatterns, GetMaxArgCount<TPatterns>>;

export type CollectLargestArgs<
  TPatterns extends readonly string[],
  MaxCount extends number
> = TPatterns extends readonly [
  infer First extends string,
  ...infer Rest extends readonly string[],
]
  ? CountArgs<First> extends MaxCount
    ? ExtractArgNames<First> | CollectLargestArgs<Rest, MaxCount>
    : CollectLargestArgs<Rest, MaxCount>
  : never;

/** Validate that each pattern's args are a subset of the largest pattern's args */
export type ValidateProgressiveArgs<TPatterns extends readonly string[]> =
  ValidateEachIsSubset<TPatterns, GetLargestPatternArgs<TPatterns>>;

export type ValidateEachIsSubset<
  TPatterns extends readonly string[],
  SupersetArgs extends string
> = TPatterns extends readonly [
  infer First extends string,
  ...infer Rest extends readonly string[],
]
  ? ExtractArgNames<First> extends SupersetArgs
    ? ValidateEachIsSubset<Rest, SupersetArgs>
    : PatternError<
        "NON_PROGRESSIVE_ARGS",
        "Pattern args must be subsets of the largest pattern. Use consistent arg names across all patterns.",
        {
          pattern: First;
          patternArgs: ExtractArgNames<First>;
          expectedSubsetOf: SupersetArgs;
          invalidArgs: Exclude<ExtractArgNames<First>, SupersetArgs>;
        }
      >
  : true;

/** Assert patterns are consistent */
export type AssertPatternConsistency<TPatterns extends readonly string[]> =
  ValidateNoDuplicates<TPatterns> extends true
    ? ValidatePatternConsistency<TPatterns> extends true
      ? ValidateProgressiveArgs<TPatterns> extends true
        ? TPatterns
        : ValidateProgressiveArgs<TPatterns>
      : ValidatePatternConsistency<TPatterns>
    : ValidateNoDuplicates<TPatterns>;

/**
 * 8. FINAL ARGS TYPE (with merged optional properties)
 */
export type OperatorArgs<
  TPatterns extends readonly string[],
  TFallback,
  TTypeMap extends Record<string, unknown> = {}
> = MergedPatternArgs<TPatterns, TFallback, TTypeMap>;

/**
 * 9. ENSURE ALL KEYS ARE PRESENT (strict check)
 */
export type StrictArgs<TExpected, TActual> =
  [RequiredKeys<TExpected>] extends [RequiredKeys<TActual>]
    ? [RequiredKeys<TActual>] extends [RequiredKeys<TExpected>]
      ? [keyof TActual] extends [keyof TExpected]
        ? TActual
        : never
      : never
    : never;

/** Helper to extract required keys from an object type */
export type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

/**
 * 10. EXTRACT i18n KEYS FROM PATTERN
 */
export type ExtractI18nKeys<
  T extends string,
  Acc extends string = never
> = T extends `${string}t(${infer Key})${infer Rest}`
  ? ExtractI18nKeys<Rest, Acc | Key>
  : Acc;

/**
 * 11. VALIDATE i18n KEYS EXIST IN TRANSLATIONS
 */
export type ValidateI18nKeys<
  TPatterns extends readonly string[],
  TKeys extends string
> = [ExtractI18nKeys<TPatterns[number]>] extends [never]
  ? true // No t() keys used, always valid
  : ExtractI18nKeys<TPatterns[number]> extends TKeys
    ? true
    : PatternError<
        "MISSING_I18N_KEY",
        "Missing translation keys",
        { missing: Exclude<ExtractI18nKeys<TPatterns[number]>, TKeys> }
      >;

/** Assert i18n keys - Returns patterns if valid, otherwise error type */
export type AssertI18nKeys<
  TPatterns extends readonly string[],
  TKeys extends string
> = ValidateI18nKeys<TPatterns, TKeys> extends true
  ? TPatterns
  : ValidateI18nKeys<TPatterns, TKeys>;

/**
 * 12. COMBINED VALIDATION
 */
export type AssertAllValidations<
  TPatterns extends readonly string[],
  TKeys extends string
> = ValidateSyntax<TPatterns> extends true
  ? ValidateNoDuplicates<TPatterns> extends true
    ? ValidatePatternConsistency<TPatterns> extends true
      ? ValidateProgressiveArgs<TPatterns> extends true
        ? AssertI18nKeys<TPatterns, TKeys>
        : ValidateProgressiveArgs<TPatterns>
      : ValidatePatternConsistency<TPatterns>
    : ValidateNoDuplicates<TPatterns>
  : ValidateSyntax<TPatterns>;

/**
 * 13. NESTED KEY EXTRACTION
 * Recursively extracts dot-separated paths from nested objects.
 */
export type NestedKeyOf<T, Prefix extends string = ""> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends
        | string
        | number
        | boolean
        | readonly string[]
        | string[]
        ? `${Prefix}${K}`
        : NestedKeyOf<T[K], `${Prefix}${K}.`>;
    }[keyof T & string]
  : never;

// =============================================================================
// TYPE REGISTRY
// =============================================================================

/**
 * Type registry for mapping type names to their actual TypeScript types.
 * Users extend this interface to register their custom types globally.
 *
 * @example
 * ```typescript
 * declare module 'fuzzyfilter' {
 *   interface TypeRegistry {
 *     amount: Amount;
 *     date: Date;
 *   }
 * }
 * ```
 */
export interface TypeRegistry {
  // Built-in types
  number: number;
  string: string;
  boolean: boolean;
  bigint: bigint;
}

/**
 * Lookup a type from the registry by name.
 * Falls back to `unknown` for unregistered types.
 */
export type LookupType<TName extends string> = TName extends keyof TypeRegistry
  ? TypeRegistry[TName]
  : unknown;

// =============================================================================
// MULTI-TYPE OPERATOR SUPPORT
// =============================================================================

/**
 * Combined type keys from TypeRegistry and user-provided TTypeMap.
 */
export type CombinedTypeKeys<TTypeMap extends Record<string, unknown>> = 
  keyof TypeRegistry | keyof TTypeMap;

/**
 * Extract the explicit type from an arg string.
 */
type ExtractArgRegistryType<
  T extends string,
  TTypeMap extends Record<string, unknown> = {}
> = 
  T extends `:${infer Type}` 
    ? Type extends CombinedTypeKeys<TTypeMap> ? Type : never
    : T extends `${string}:${infer Type}` 
      ? Type extends CombinedTypeKeys<TTypeMap> ? Type : never
      : never;

/**
 * Get all typed keys explicitly used in a single pattern.
 */
type PatternRegistryTypes<
  T extends string,
  TTypeMap extends Record<string, unknown> = {}
> = 
  T extends `${string}{...${infer Arg}}${infer Rest}` 
    ? ExtractArgRegistryType<Arg, TTypeMap> | PatternRegistryTypes<Rest, TTypeMap>
    : T extends `${string}{${infer Arg}}${infer Rest}`
      ? ExtractArgRegistryType<Arg, TTypeMap> | PatternRegistryTypes<Rest, TTypeMap>
      : never;

/**
 * Get all typed keys from all patterns.
 */
export type AllPatternsRegistryTypes<
  TPatterns extends readonly string[],
  TTypeMap extends Record<string, unknown> = {}
> = PatternRegistryTypes<TPatterns[number], TTypeMap>;

/**
 * Check if a pattern matches predicate key K.
 */
type PatternMatchesKey<
  T extends string,
  K extends CombinedTypeKeys<TTypeMap>,
  TTypeMap extends Record<string, unknown> = {}
> = 
  [PatternRegistryTypes<T, TTypeMap>] extends [never]
    ? true  // No explicit types = generic pattern, matches all
    : [K] extends [PatternRegistryTypes<T, TTypeMap>]
      ? true  // K is one of the pattern's explicit types
      : false;

/**
 * Lookup type from combined TypeRegistry and TTypeMap.
 */
type LookupCombinedType<
  K extends string,
  TTypeMap extends Record<string, unknown>
> = K extends keyof TypeRegistry
  ? TypeRegistry[K]
  : K extends keyof TTypeMap
    ? TTypeMap[K]
    : unknown;

/**
 * Collect args from patterns that match predicate key K.
 */
type CollectArgsFromMatchingPatterns<
  TPatterns extends readonly string[],
  K extends CombinedTypeKeys<TTypeMap>,
  TTypeMap extends Record<string, unknown>,
  Acc extends Record<string, unknown> = {}
> = TPatterns extends readonly [infer First extends string, ...infer Rest extends readonly string[]]
  ? [PatternRegistryTypes<First, TTypeMap>] extends [never]
    ? CollectArgsFromMatchingPatterns<
        Rest, K, TTypeMap, 
        Acc & ExtractArgsObject<First, LookupCombinedType<K & string, TTypeMap>, TTypeMap>
      >
    : [K] extends [PatternRegistryTypes<First, TTypeMap>]
      ? CollectArgsFromMatchingPatterns<
          Rest, K, TTypeMap, 
          Acc & ExtractArgsObject<First, LookupCombinedType<K & string, TTypeMap>, TTypeMap>
        >
      : CollectArgsFromMatchingPatterns<Rest, K, TTypeMap, Acc>
  : Prettify<Acc>;

/**
 * Compute args for a specific predicate based on matching patterns.
 */
type ArgsForPredicate<
  TPatterns extends readonly string[],
  K extends CombinedTypeKeys<TTypeMap>,
  TTypeMap extends Record<string, unknown>
> = CollectArgsFromMatchingPatterns<TPatterns, K, TTypeMap>;

/**
 * Check if any pattern in the array is untyped.
 */
type HasUntypedPatterns<
  TPatterns extends readonly string[],
  TTypeMap extends Record<string, unknown>
> = TPatterns extends readonly [infer First extends string, ...infer Rest extends readonly string[]]
  ? [PatternRegistryTypes<First, TTypeMap>] extends [never]
    ? true
    : HasUntypedPatterns<Rest, TTypeMap>
  : false;

/**
 * Validate required predicates are provided.
 */
export type ValidateRequiredPredicates<
  TPatterns extends readonly string[],
  TTypeMap extends Record<string, unknown>,
  TProvidedKeys extends CombinedTypeKeys<TTypeMap>
> = [AllPatternsRegistryTypes<TPatterns, TTypeMap>] extends [never]
  ? true  // No explicit types in patterns
  : AllPatternsRegistryTypes<TPatterns, TTypeMap> extends TProvidedKeys
    ? HasUntypedPatterns<TPatterns, TTypeMap> extends true
      ? true
      : TProvidedKeys extends AllPatternsRegistryTypes<TPatterns, TTypeMap>
        ? true
        : PatternError<
            "EXTRA_PREDICATE",
            "Predicate provided but no matching pattern exists for this type",
            { 
              extra: Exclude<TProvidedKeys, AllPatternsRegistryTypes<TPatterns, TTypeMap>>;
              allowed: AllPatternsRegistryTypes<TPatterns, TTypeMap>;
            }
          >
    : PatternError<
        "MISSING_PREDICATE",
        "Missing predicate for explicitly typed pattern arg",
        { 
          missing: Exclude<AllPatternsRegistryTypes<TPatterns, TTypeMap>, TProvidedKeys>;
          required: AllPatternsRegistryTypes<TPatterns, TTypeMap>;
        }
      >;

/**
 * A typed predicate function.
 */
export type TypedPredicate<
  TOperandType,
  TPatterns extends readonly string[],
  TTypeMap extends Record<string, unknown> = {}
> = (
  operand: TOperandType,
  args: OperatorArgs<TPatterns, TOperandType, TTypeMap>
) => boolean;

/**
 * Internal predicates map without validation.
 */
type PredicatesMapInternal<
  TPatterns extends readonly string[],
  TTypeMap extends Record<string, unknown>,
  TKeys extends CombinedTypeKeys<TTypeMap>
> = {
  [K in TKeys]: K extends infer ConcreteK extends CombinedTypeKeys<TTypeMap>
    ? (
        operand: LookupCombinedType<ConcreteK & string, TTypeMap>,
        args: Prettify<ArgsForPredicate<TPatterns, ConcreteK, TTypeMap>>
      ) => boolean
    : never;
};

/**
 * Predicates map with validation.
 */
export type PredicatesMap<
  TPatterns extends readonly string[],
  TTypeMap extends Record<string, unknown>,
  TKeys extends CombinedTypeKeys<TTypeMap>
> = ValidateRequiredPredicates<TPatterns, TTypeMap, TKeys> extends true
  ? PredicatesMapInternal<TPatterns, TTypeMap, TKeys>
  : ValidateRequiredPredicates<TPatterns, TTypeMap, TKeys>;

/**
 * Output type for validated multi-type operator definitions.
 */
export type MultiTypeOperatorDefOutput<
  TPatterns extends readonly string[],
  TTypeMap extends Record<string, unknown> = {},
  TTranslationKeys extends string = string,
  TImplKeys extends CombinedTypeKeys<TTypeMap> = CombinedTypeKeys<TTypeMap>
> = AssertAllValidations<TPatterns, TTranslationKeys> extends TPatterns
  ? ValidateRequiredPredicates<TPatterns, TTypeMap, TImplKeys> extends true
    ? {
        id: string;
        patterns: TPatterns;
        predicates: Prettify<PredicatesMap<TPatterns, TTypeMap, TImplKeys>>;
        getPredicateForType<TName extends TImplKeys>(
          typeName: TName
        ): (
          operand: LookupCombinedType<TName & string, TTypeMap>,
          args: Prettify<ArgsForPredicate<TPatterns, TName, TTypeMap>>
        ) => boolean;
        supportedTypes: TImplKeys[];
      }
    : ValidateRequiredPredicates<TPatterns, TTypeMap, TImplKeys>
  : AssertAllValidations<TPatterns, TTranslationKeys>;
