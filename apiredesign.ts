// ============================================================================
// PATTERN-DRIVEN FUZZYFILTER API - DESIGN DOCUMENT
// ============================================================================
//
// NOTE: This is a design document showing the intended API surface.
// The actual type implementation is in packages/fuzzyfilter/src/types/pattern-types.ts
// Type tests are in packages/fuzzyfilter/src/create-operator.tst.ts
//
// This API design uses pattern strings with type hints to drive type inference.
// Union syntax {value:type1|type2} restricts operator availability to specific types.
//
// Key Features:
// - Self-documenting patterns that guide both developers and UI
// - Full type inference without `as const` (using const type parameters)
// - Union syntax for restricting operator availability
// - Strict validation that predicates exist for all referenced types
// ============================================================================
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================================================
// Type Registry & Built-in Types
// ============================================================================

/**
 * Interface that custom types must implement to be used in FuzzyFilter.
 * The type itself knows how to parse, format, and compare its values.
 */
interface FuzzyFilterable<T> {
  /** Format this value for display in suggestions */
  format(): string;
  
  /** Compare this value to another (-1, 0, 1) for range operators */
  compare(other: T): number;
}

/**
 * Static methods that FuzzyFilterable classes must provide.
 */
interface FuzzyFilterableStatic<T extends FuzzyFilterable<T>> {
  /** Parse user input string into an instance */
  parse(input: string): T | null;
}

/**
 * Constructor type combining instance and static requirements.
 */
type FuzzyFilterableConstructor<T extends FuzzyFilterable<T>> = 
  FuzzyFilterableStatic<T> & (new (...args: any[]) => T);

/**
 * A type definition can be:
 * - A FuzzyFilterable class
 * - A simple handler object with parse/format/compare
 */
type TypeDef<T = any> = {
  /** Parse user input into the type */
  parse(input: string): T | null;
  /** Format for display (optional) */
  format?: (value: T) => string;
  /** Compare two values (optional) */
  compare?: (a: T, b: T) => number;
  /** Type brand for inference */
  _type?: T;
};

/** Registry mapping type names to their definitions */
type TypeRegistry = Record<string, TypeDef<any>>;

/** Extract the TypeScript type from a type definition */
type InferType<T> = T extends TypeDef<infer U> 
  ? U 
  : T extends FuzzyFilterableConstructor<infer U> 
    ? U 
    : never;

/** Extract types from the registry */
type InferTypes<TRegistry extends TypeRegistry> = {
  [K in keyof TRegistry]: InferType<TRegistry[K]>;
};

/** Built-in type handlers */
const types = {
  string: {
    parse: (input: string) => input,
    format: (value: string) => value,
    compare: (a: string, b: string) => a.localeCompare(b),
  } as TypeDef<string>,
  number: {
    parse: (input: string) => {
      const n = parseFloat(input);
      return isNaN(n) ? null : n;
    },
    format: (value: number) => String(value),
    compare: (a: number, b: number) => a - b,
  } as TypeDef<number>,
  date: {
    parse: (input: string) => {
      const d = new Date(input);
      return isNaN(d.getTime()) ? null : d;
    },
    format: (value: Date) => value.toLocaleDateString(),
    compare: (a: Date, b: Date) => a.getTime() - b.getTime(),
  } as TypeDef<Date>,
  boolean: {
    parse: (input: string) => {
      const lower = input.toLowerCase();
      if (['true', 'yes', '1'].includes(lower)) return true;
      if (['false', 'no', '0'].includes(lower)) return false;
      return null;
    },
    format: (value: boolean) => value ? 'true' : 'false',
    compare: (a: boolean, b: boolean) => (a === b ? 0 : a ? 1 : -1),
  } as TypeDef<boolean>,
};

// ============================================================================
// Pattern Parsing Type Utilities
// ============================================================================

/**
 * Parse a union type string into a union of string literals.
 * Example: "string|amount|number" → "string" | "amount" | "number"
 */
type ParseUnionTypes<T extends string> = 
  T extends `${infer First}|${infer Rest}`
    ? First | ParseUnionTypes<Rest>
    : T;

/**
 * Check if a type string is a union (contains |).
 */
type IsUnionType<T extends string> = T extends `${string}|${string}` ? true : false;

/**
 * Extract typed parameters {name:type} or {name:type1|type2} from a pattern string.
 * For union types, the param inherits from the operand type.
 */
type ExtractTypedParams<
  TPattern extends string,
  TTypes extends Record<string, any>,
  TOperandType
> = TPattern extends `${string}{${infer Name}:${infer Type}}${infer Rest}`
  ? (IsUnionType<Type> extends true
      ? { [K in Name]: TOperandType }  // Union → inherits operand type
      : ParseUnionTypes<Type> extends keyof TTypes
        ? { [K in Name]: TTypes[ParseUnionTypes<Type>] }  // Single type → explicit
        : { [K in Name]: unknown })
    & ExtractTypedParams<Rest, TTypes, TOperandType>
  : {};

/**
 * Extract untyped parameters {name} from a pattern string.
 * These inherit the operand's type.
 */
type ExtractUntypedParams<TPattern extends string, TOperandType> =
  TPattern extends `${string}{${infer Param}}${infer Rest}`
    ? (Param extends `${string}:${string}` 
        ? ExtractUntypedParams<Rest, TOperandType>  // Skip typed params
        : Param extends `...${infer Name}`
          ? { [K in Name]: TOperandType[] } & ExtractUntypedParams<Rest, TOperandType>  // Array
          : { [K in Param]: TOperandType } & ExtractUntypedParams<Rest, TOperandType>)  // Single
    : {};

/**
 * Extract which type names are referenced in patterns via {param:type} or {param:type1|type2} syntax.
 * Used to validate that predicates exist for all referenced types.
 */
type ExtractReferencedTypes<TPattern extends string> =
  TPattern extends `${string}{${string}:${infer Type}}${infer Rest}`
    ? ParseUnionTypes<Type> | ExtractReferencedTypes<Rest>
    : never;

/**
 * Build the complete params object type for a predicate.
 */
type BuildParams<
  TPattern extends string,
  TTypes extends Record<string, any>,
  TOperandType
> = ExtractTypedParams<TPattern, TTypes, TOperandType> 
    & ExtractUntypedParams<TPattern, TOperandType>;

// ============================================================================
// I18nProvider Interface
// ============================================================================

interface I18nProvider {
  /** Get all aliases for matching user input (always returns array) */
  getAliases(key: string): string[];
  
  /** Get primary display label for suggestions */
  getLabel(key: string): string;
  
  /** Current locale */
  locale: string;
}

// ============================================================================
// Column Definition
// ============================================================================

interface ColumnDefinition<TTypeNames extends string> {
  /** Unique column identifier */
  id: string;
  
  /** i18n key for column label */
  labelKey: string;
  
  /** Type must be one of the registered type names */
  type?: TTypeNames;
  
  /** Enum values - type auto-handled */
  values?: readonly unknown[];
  
  /** i18n key prefix for value labels */
  valuesI18nPrefix?: string;
}

// ============================================================================
// Operator Definition with Pattern-Driven Typing
// ============================================================================

/**
 * Typed predicate function.
 */
type TypedPredicate<
  TOperand,
  TParams extends Record<string, any>
> = (operand: TOperand, params: TParams) => boolean;

/**
 * Operator predicates map with full type inference.
 */
type OperatorPredicates<
  TTypes extends Record<string, any>,
  TPatterns extends readonly string[]
> = {
  [TypeName in keyof TTypes]?: TypedPredicate<
    TTypes[TypeName],
    BuildParams<TPatterns[number], TTypes, TTypes[TypeName]>
  >;
};

/**
 * Operator definition with pattern-driven type inference.
 * 
 * Pattern Syntax:
 * - {value}           → param inherits operand type, works for any type with predicate
 * - {value:number}    → param is number, pattern only works when number is involved
 * - {value:string|amount} → pattern only for string/amount columns, param inherits operand
 * - {:type}           → shorthand where param name = type name
 * - {values...}       → array of operand type
 */
interface OperatorDefinition<
  TTypes extends Record<string, any>,
  TPatterns extends readonly string[] = readonly string[]
> {
  /** Unique identifier for the operator */
  id: string;
  
  /** 
   * Pattern strings that define operator syntax.
   * Use t(key) for i18n, {param}, {param:type}, {:type}, {param...}
   */
  patterns: TPatterns;
  
  /** Universal predicate for all types (optional) */
  predicate?: (operand: any, params: any) => boolean;
  
  /** 
   * Type-specific predicates.
   * Required for any type referenced in patterns via {param:type} syntax.
   */
  predicates?: OperatorPredicates<TTypes, TPatterns>;
}

// ============================================================================
// Main Config & Factory
// ============================================================================

interface FuzzyFilterConfig<
  TTypes extends TypeRegistry
> {
  /** Type registry - maps names to type handlers */
  types: TTypes;
  
  /** Column definitions - type field constrained to registry keys */
  columns: readonly ColumnDefinition<Extract<keyof TTypes, string>>[];
  
  /** Operator definitions with pattern-driven typing */
  operators?: readonly OperatorDefinition<InferTypes<TTypes>, readonly string[]>[];
  
  /** i18n provider */
  i18n: I18nProvider;
  
  /** Max suggestions (default: 10) */
  maxSuggestions?: number;
}

interface FuzzyFilter<TTypes extends TypeRegistry> {
  /** Index data for filtering */
  indexData(data: any[]): void;
  
  /** Upsert rows incrementally */
  upsertRows(rows: { rowId: string | number; data: Record<string, unknown> }[]): void;
  
  /** Delete rows by ID */
  deleteRows(rowIds: (string | number)[]): void;
  
  /** Get suggestions for user input */
  suggest(input: string): Promise<Suggestion[]>;
  
  /** Apply filters to get matching row IDs */
  filter(filters: Filter[]): (string | number)[];
}

interface Suggestion {
  label: string;
  value: string;
  operator: string;
  column: string;
}

interface Filter {
  column: string;
  operator: string;
  value: unknown;
}

/**
 * Create a FuzzyFilter with full type inference.
 * 
 * The `const` type parameter ensures patterns are captured as literal strings,
 * enabling full inference without `as const`.
 */
declare function createFuzzyFilter<
  const TTypes extends TypeRegistry
>(
  config: FuzzyFilterConfig<TTypes>
): FuzzyFilter<TTypes>;

// ============================================================================
// Example Custom Types
// ============================================================================

class Amount implements FuzzyFilterable<Amount> {
  constructor(
    public readonly value: number,
    public readonly unit: string
  ) {}

  static parse(input: string): Amount | null {
    const match = input.match(/^([\d.]+)\s*(\w+)?$/);
    if (!match) return null;
    return new Amount(parseFloat(match[1]), match[2] ?? 'kg');
  }

  format(): string {
    return `${this.value} ${this.unit}`;
  }

  compare(other: Amount): number {
    return this.value - other.value;
  }
  
  toBaseUnit(): number {
    // Convert to base unit (e.g., grams)
    const conversions: Record<string, number> = { kg: 1000, g: 1, lb: 453.592 };
    return this.value * (conversions[this.unit] ?? 1);
  }
}

class CulaDate implements FuzzyFilterable<CulaDate> {
  constructor(public readonly date: Date) {}

  static parse(input: string): CulaDate | null {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : new CulaDate(d);
  }

  format(): string {
    return this.date.toLocaleDateString('de-DE');
  }

  compare(other: CulaDate): number {
    return this.date.getTime() - other.date.getTime();
  }
}

// Native TypeScript enum - works automatically with values
enum TrackingState {
  INCOMPLETE = 'incomplete',
  COMPLETE = 'complete',
  LOCKED = 'locked',
  USED = 'used',
  DEACTIVATED = 'deactivated',
}

// ============================================================================
// Example i18n Provider Implementation
// ============================================================================

// In real usage, you would import from vue-i18n:
// import { useI18n } from 'vue-i18n';

/**
 * Example i18n provider implementation for Vue.
 * This shows how to integrate with vue-i18n.
 */
function createCulaI18nProvider(): I18nProvider {
  // In real code: const { t, locale, messages } = useI18n();
  // For this design doc, we use a mock:
  const locale = { value: 'en' };
  const messages = { value: { en: {} } };
  
  const getValue = (key: string): any => {
    const currentMessages = messages.value[locale.value as keyof typeof messages.value] as any;
    const parts = key.split('.');
    let value: any = currentMessages;
    
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) break;
    }
    
    return value;
  };
  
  return {
    get locale() {
      return locale.value;
    },
    
    getAliases(key: string): string[] {
      const value = getValue(key);
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') return [value];
      return [key];
    },
    
    getLabel(key: string): string {
      const value = getValue(key);
      if (Array.isArray(value)) return value[0];
      if (typeof value === 'string') return value;
      return key;
    },
  };
}

const culaI18nProvider = createCulaI18nProvider();

// ============================================================================
// FULL USAGE EXAMPLE - Pattern-Driven API
// ============================================================================

const filter = createFuzzyFilter({
  // Type Registry - defines all available types
  types: {
    string: types.string,
    number: types.number,
    date: types.date,
    amount: Amount as unknown as TypeDef<Amount>,
    culaDate: CulaDate as unknown as TypeDef<CulaDate>,
  },
  
  // Columns - type field constrained to registry keys
  columns: [
    { id: 'name', labelKey: 'columns.name', type: 'string' },
    { id: 'quantity', labelKey: 'columns.quantity', type: 'number' },
    { id: 'weight', labelKey: 'columns.weight', type: 'amount' },
    { id: 'createdAt', labelKey: 'columns.createdAt', type: 'culaDate' },
    // Enum column - type auto-handled via values
    { 
      id: 'trackingState', 
      labelKey: 'columns.trackingState',
      values: Object.values(TrackingState),
      valuesI18nPrefix: 'trackingState',
    },
    // { id: 'invalid', labelKey: 'x', type: 'foo' },  // ✗ Error! 'foo' not in types
  ],
  
  // Operators with Pattern-Driven Typing
  operators: [
    // ================================================================
    // Generic operators - {value} works for any type with a predicate
    // ================================================================
    {
      id: 'eq',
      patterns: ['t(operators.eq) {value}', 'is {value}', '= {value}'],
      predicates: {
        // value: string (inherits from operand)
        string: (operand, { value }) => operand === value,
        // value: number (inherits from operand)
        number: (operand, { value }) => operand === value,
        // value: Amount (inherits from operand)
        amount: (operand, { value }) => 
          operand.value === value.value && operand.unit === value.unit,
        // value: CulaDate (inherits from operand)
        culaDate: (operand, { value }) => operand.compare(value) === 0,
      },
    },
    
    {
      id: 'between',
      patterns: ['t(operators.between) {min} t(operators.and) {max}'],
      predicates: {
        // min, max: number (inherit from operand)
        number: (operand, { min, max }) => operand >= min && operand <= max,
        // min, max: CulaDate (inherit from operand)
        culaDate: (operand, { min, max }) => 
          operand.compare(min) >= 0 && operand.compare(max) <= 0,
      },
    },
    
    // ================================================================
    // Explicit type - {value:number} always number regardless of operand
    // ================================================================
    {
      id: 'lengthEquals',
      patterns: ['length is {value:number}'],
      predicates: {
        // operand: string, { value: number }
        string: (operand, { value }) => operand.length === value,
      },
    },
    
    // ================================================================
    // Union syntax - restricts which types see this operator
    // ================================================================
    {
      id: 'contains',
      // Only appears for string columns
      patterns: ['contains {needle:string}'],
      predicates: {
        // operand: string, { needle: string }
        string: (operand, { needle }) => operand.includes(needle),
      },
    },
    
    {
      id: 'fuzzyMatch',
      // Appears for string AND amount columns only, not number/date
      patterns: ['similar to {val:string|amount}'],
      predicates: {
        // val: string (inherits from operand)
        string: (operand, { val }) => {
          // Fuzzy string match
          return operand.toLowerCase().includes(val.toLowerCase());
        },
        // val: Amount (inherits from operand)
        amount: (operand, { val }) => {
          // Within 10% tolerance
          return Math.abs(operand.value - val.value) < operand.value * 0.1;
        },
      },
    },
    
    {
      id: 'compareNumeric',
      // Works for number AND amount, params are always numbers
      patterns: ['value between {min:number} and {max:number}'],
      predicates: {
        // operand: number, { min: number, max: number }
        number: (operand, { min, max }) => operand >= min && operand <= max,
        // operand: Amount, { min: number, max: number }
        amount: (operand, { min, max }) => 
          operand.value >= min && operand.value <= max,
      },
    },
    
    // ================================================================
    // Shorthand syntax - {:type} where param name = type name
    // ================================================================
    {
      id: 'amountGreater',
      patterns: ['greater than {:amount}'],
      predicates: {
        // operand: Amount, { amount: Amount }
        amount: (operand, { amount }) => operand.toBaseUnit() > amount.toBaseUnit(),
      },
    },
    
    // ================================================================
    // Array params - {values...}
    // ================================================================
    {
      id: 'in',
      patterns: ['t(operators.in) {values...}', 'one of {values...}'],
      predicates: {
        // { values: string[] }
        string: (operand, { values }) => values.includes(operand),
        // { values: number[] }
        number: (operand, { values }) => values.includes(operand),
      },
    },
    
    // ================================================================
    // Custom Cula operator with union
    // ================================================================
    {
      id: 'overlaps',
      // Only for date types
      patterns: ['t(operators.overlaps) {start:culaDate|date} t(operators.to) {end:culaDate|date}'],
      predicates: {
        // start, end: CulaDate (inherit from operand)
        culaDate: (operand, { start, end }) =>
          operand.compare(start) >= 0 && operand.compare(end) <= 0,
        // start, end: Date (inherit from operand)
        date: (operand, { start, end }) =>
          operand >= start && operand <= end,
      },
    },
  ],
  
  i18n: culaI18nProvider,
  maxSuggestions: 12,
});

// ============================================================================
// Usage Examples
// ============================================================================

// Index data
filter.indexData([
  { id: 1, name: 'Widget A', quantity: 100, weight: new Amount(5, 'kg'), createdAt: new CulaDate(new Date()) },
  { id: 2, name: 'Widget B', quantity: 200, weight: new Amount(10, 'kg'), createdAt: new CulaDate(new Date()) },
]);

// Upsert rows incrementally (partial data supported)
filter.upsertRows([
  { rowId: 1, data: { quantity: 150 } },  // Update
  { rowId: 3, data: { name: 'Widget C', quantity: 50 } },  // Insert
]);

// Delete rows
filter.deleteRows([2]);

// Get suggestions
filter.suggest('name contains wid');
// → [{ label: "Name contains 'wid'", value: "wid", operator: "contains", column: "name" }]

filter.suggest('weight greater than 5kg');
// → [{ label: "Weight greater than 5 kg", ... }]

filter.suggest('quantity between 10 and 100');
// → [{ label: "Quantity between 10 and 100", ... }]

// ============================================================================
// TYPE SAFETY EXAMPLES
// ============================================================================

/*
 * The following would produce TypeScript errors:
 *
 * 1. Invalid column type:
 *    { id: 'foo', labelKey: 'x', type: 'invalid' }
 *    // Error: Type '"invalid"' is not assignable to type '"string" | "number" | "date" | "amount" | "culaDate"'
 *
 * 2. Missing predicate for union type:
 *    patterns: ['match {value:string|amount}'],
 *    predicates: {
 *      string: (operand, { value }) => true,
 *      // Missing 'amount' - Error!
 *    }
 *
 * 3. Wrong param type in predicate:
 *    patterns: ['length is {value:number}'],
 *    predicates: {
 *      string: (operand, { value }) => operand === value.toLowerCase(),
 *      // Error: Property 'toLowerCase' does not exist on type 'number'
 *    }
 *
 * 4. Wrong operand type usage:
 *    patterns: ['is {value}'],
 *    predicates: {
 *      number: (operand, { value }) => operand.includes(value),
 *      // Error: Property 'includes' does not exist on type 'number'
 *    }
 */

// ============================================================================
// HOW THE UI USES PATTERN TYPE INFO
// ============================================================================

/**
 * Runtime helper to extract param types from patterns.
 * The UI can use this to determine what input component to show.
 */
function getParamTypes(pattern: string): Map<string, { types: string[]; isArray: boolean }> {
  const params = new Map<string, { types: string[]; isArray: boolean }>();
  const regex = /\{(\.{3})?(\w+)(?::(\w+(?:\|\w+)*))?\}/g;
  let match;
  
  while ((match = regex.exec(pattern)) !== null) {
    const [, dots, name, typeStr] = match;
    const isArray = !!dots;
    const types = typeStr ? typeStr.split('|') : ['inherit'];
    params.set(name, { types, isArray });
  }
  
  return params;
}

// Examples:
getParamTypes('greater than {val:number}');
// → Map { 'val' => { types: ['number'], isArray: false } }

getParamTypes('similar to {val:string|amount}');
// → Map { 'val' => { types: ['string', 'amount'], isArray: false } }

getParamTypes('one of {values...}');
// → Map { 'values' => { types: ['inherit'], isArray: true } }

getParamTypes('between {min} and {max}');
// → Map { 'min' => { types: ['inherit'], isArray: false }, 'max' => { types: ['inherit'], isArray: false } }

// ============================================================================
// SUMMARY: PATTERN SYNTAX
// ============================================================================
//
// {value}              - Param inherits operand type, pattern works for all types
// {value:number}       - Param is always number, pattern works for all types
// {value:string|amount} - Pattern only for string/amount, param inherits operand
// {:amount}            - Shorthand: param name = 'amount', type = Amount
// {values...}          - Array param, inherits operand type
// t(key)               - i18n translation key
//
// Union syntax is ideal for:
// - Operators that only make sense for certain types (e.g., 'contains' for strings)
// - Restricting operator visibility in the UI
// - Ensuring type-specific predicates exist
//
// ============================================================================
