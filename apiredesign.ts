// ============================================================================
// FuzzyFilterable Interface - All custom types must implement this
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

// ============================================================================
// Built-in Types - Always available, no registration needed
// ============================================================================

type BuiltInTypes = {
  string: string;
  number: number;
  date: Date;
};

// Library provides default parse/format/compare for these
const BUILT_IN_TYPE_HANDLERS = {
  string: {
    parse: (input: string) => input,
    format: (value: string) => value,
    compare: (a: string, b: string) => a.localeCompare(b),
  },
  number: {
    parse: (input: string) => {
      const n = parseFloat(input);
      return isNaN(n) ? null : n;
    },
    format: (value: number) => String(value),
    compare: (a: number, b: number) => a - b,
  },
  date: {
    parse: (input: string) => {
      const d = new Date(input);
      return isNaN(d.getTime()) ? null : d;
    },
    format: (value: Date) => value.toLocaleDateString(),
    compare: (a: Date, b: Date) => a.getTime() - b.getTime(),
  },
} as const;

// ============================================================================
// Type Map combines built-ins with custom types
// ============================================================================

type TypeMap<TCustom> = BuiltInTypes & TCustom;

// ============================================================================
// FuzzyFilterConfig - No types property needed!
// ============================================================================

interface FuzzyFilterConfig<TCustom extends Record<string, FuzzyFilterable<any>>> {
  /** Column definitions */
  columns: ColumnDefinition<TypeMap<TCustom>>[];
  
  /** Custom operators (optional, defaults provided) */
  operators?: OperatorDefinition[];
  
  /** i18n provider for translations */
  i18n: I18nProvider;
  
  /** Maximum suggestions to return (default: 10) */
  maxSuggestions?: number;
}

// ============================================================================
// Column Definition - Automatic enum handling when values is provided
// ============================================================================

interface ColumnDefinition<TTypes> {
  /** Unique column identifier */
  id: string;
  
  /** i18n key for column label */
  labelKey: string;
  
  /** 
   * Data type - required for built-in types (string, number, date) or custom FuzzyFilterable types.
   * Optional when `values` is provided (enum mode - type inferred automatically).
   */
  type?: keyof TTypes;
  
  /** 
   * Predefined values for enum-like columns.
   * When provided, the library automatically handles parsing, formatting, and comparison.
   * Equality operators (eq, neq, in, notIn) work automatically with these values.
   */
  values?: unknown[];
  
  /** 
   * i18n key prefix for value labels.
   * Defaults to column id (e.g., 'status' → 'status.incomplete').
   * Set to match your i18n structure (e.g., 'trackingState' → 'trackingState.incomplete').
   */
  valuesI18nPrefix?: string;
}

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
// i18n file in fuzzyfilter/translations/common.json - Common
// ============================================================================
const commonDefaultTranslations = {
  operators: {
    eq: ['=', '==', '==='],
    neq: ['!=', '!=='],
    gt: ['>'],
    gte: ['>='],
    lt: ['<'],
    lte: ['<='],
  },
};

// ============================================================================
// i18n file in fuzzyfilter/translations/en.json - English
// ============================================================================
const enDefaultTranslations = {

  // Built-in operator aliases (arrays = multiple accepted inputs)
  operators: {
    eq: ['is', 'equals'],
    neq: ['is not', 'not equals'],
    gt: ['greater than', 'more than', 'above'],
    gte: ['at least', 'greater or equal'],
    lt: ['less than', 'below', 'under'],
    lte: ['at most', 'less or equal'],
    contains: ['contains', 'includes', 'has'],
    startsWith: ['starts with', 'begins with'],
    endsWith: ['ends with'],
    in: ['in', 'one of', 'any of'],
    notIn: ['not in', 'none of'],
    isEmpty: ['is empty', 'empty', 'blank', 'null'],
    isNotEmpty: ['is not empty', 'not empty', 'exists'],
    isTrue: ['is true', 'true', 'yes', 'checked'],
    isFalse: ['is false', 'false', 'no', 'unchecked'],
  },
}

// ============================================================================
// i18n file in fuzzyfilter/translations/de.json - German
// ============================================================================
const deDefaultTranslations = {
  operators: {
    eq: ['ist', 'gleich', '=', '=='],
    neq: ['ist nicht', 'ungleich', '!=', '<>'],
    gt: ['größer als', 'mehr als', 'über', '>'],
    gte: ['mindestens', 'größer gleich', '>='],
    lt: ['kleiner als', 'weniger als', 'unter', '<'],
    lte: ['höchstens', 'kleiner gleich', '<='],
    contains: ['enthält', 'beinhaltet'],
    startsWith: ['beginnt mit'],
    endsWith: ['endet mit'],
    in: ['in', 'einer von'],
    notIn: ['nicht in', 'keiner von'],
    isEmpty: ['ist leer', 'leer', 'null'],
    isNotEmpty: ['ist nicht leer', 'nicht leer', 'vorhanden'],
    isTrue: ['ist wahr', 'ja', 'aktiviert'],
    isFalse: ['ist falsch', 'nein', 'deaktiviert'],
    overlaps: ['überlappt', 'überschneidet'],
  },
};

// ============================================================================
// i18n file in cula-platform/translations/common.json - Common
// ============================================================================
const commonTranslations = {
  operators: {
    overlaps: ['<>'], // custom cula operator with language independent translation
  },
};

// ============================================================================
// i18n file in cula-platform/translations/en.json - English
// ============================================================================
const enTranslations = {
  operators: {
    overlaps: ['overlaps', 'overlapping'],
  },
  
  columns: {
    trackingState: 'Tracking State',
    verificationState: 'Verification State',
    weight: 'Weight',
    createdAt: 'Created',
    name: 'Name',
  },
  
  // Enum values (the enum value IS the i18n key)
  trackingState: {
    incomplete: 'Incomplete',
    complete: 'Complete',
    locked: 'Locked',
    used: 'Used',
    deactivated: 'Deactivated',
  },
  verificationState: {
    pending: 'Pending',
    verified: 'Verified',
    rejected: 'Rejected',
  },
};

// ============================================================================
// i18n file in cula platform: fuzzyfilter/translations/de.json - German
// ============================================================================

const deTranslations = {
  operators: {    
    overlaps: ['überlappt', 'überschneidet'],
  },
  columns: {
    trackingState: 'Verfolgungsstatus',
    verificationState: 'Verifizierungsstatus',
    weight: 'Gewicht',
    createdAt: 'Erstellt am',
    name: 'Name',
  },
  trackingState: {
    incomplete: 'Unvollständig',
    complete: 'Vollständig',
    locked: 'Gesperrt',
    used: 'Verwendet',
    deactivated: 'Deaktiviert',
  },
  verificationState: {
    pending: 'Ausstehend',
    verified: 'Verifiziert',
    rejected: 'Abgelehnt',
  },
};

// ============================================================================
// Cula i18n Provider Implementation
// ============================================================================

import { useI18n } from 'vue-i18n';  // or your i18n library

function createCulaI18nProvider(): I18nProvider {
  const { t, locale, messages } = useI18n();
  
  const getValue = (key: string): any => {
    // Get current locale's messages
    const currentMessages = messages.value[locale.value];
    
    // Split key: 'operators.eq' → ['operators', 'eq']
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
      return [key]; // Fallback: return the key itself
    },
    
    getLabel(key: string): string {
      const value = getValue(key);
      if (Array.isArray(value)) return value[0]; // First alias is primary label
      if (typeof value === 'string') return value;
      return key; // Fallback: return the key itself
    },
  };
}

// ============================================================================
// Example: Amount implements FuzzyFilterable
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
}

// ============================================================================
// Example: CulaDate implements FuzzyFilterable
// ============================================================================

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

// ============================================================================
// Example: Native TypeScript Enums - No wrapper needed!
// ============================================================================

/**
 * Native TypeScript enums work automatically when you provide `values` in the column definition.
 * The library automatically handles:
 * - Parsing: Matches user input against i18n aliases for each enum value
 * - Formatting: Returns i18n key (e.g., 'trackingState.incomplete')
 * - Comparison: Uses array index order
 * - Equality operators: Standard === comparison works automatically
 */
enum TrackingState {
  INCOMPLETE = 'incomplete',
  COMPLETE = 'complete',
  LOCKED = 'locked',
  USED = 'used',
  DEACTIVATED = 'deactivated',
}

enum VerificationState {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

// ============================================================================
// How Automatic Enum Handling Works Internally
// ============================================================================

/**
 * When a column has `values` defined, the library creates a type handler automatically:
 * 
 * ```typescript
 * function createEnumHandlerFromValues(
 *   column: ColumnDefinition<any>,
 *   i18n: I18nProvider
 * ) {
 *   const values = column.values!;
 *   const prefix = column.valuesI18nPrefix ?? column.id;
 *   
 *   return {
 *     parse(input: string): unknown {
 *       // Try matching against i18n aliases for each value
 *       for (const value of values) {
 *         const key = `${prefix}.${value}`;
 *         const aliases = i18n.getAliases(key);
 *         
 *         // Match against translated aliases
 *         if (aliases.some(a => a.toLowerCase() === input.toLowerCase())) {
 *           return value;
 *         }
 *         
 *         // Also match against raw value
 *         if (String(value).toLowerCase() === input.toLowerCase()) {
 *           return value;
 *         }
 *       }
 *       return null;
 *     },
 *     
 *     format(value: unknown): string {
 *       return `${prefix}.${value}`; // Returns i18n key
 *     },
 *     
 *     compare(a: unknown, b: unknown): number {
 *       return values.indexOf(a) - values.indexOf(b);
 *     },
 *   };
 * }
 * ```
 * 
 * Equality operators work automatically because they use simple === comparison:
 * - `eq`: operand === value
 * - `neq`: operand !== value  
 * - `in`: values.includes(operand)
 * - `notIn`: !values.includes(operand)
 */

// ============================================================================
// TypeScript Enforcement
// ============================================================================

// The generic constraint ensures only FuzzyFilterable types are accepted for complex types:

// ✅ Compiles - Amount implements FuzzyFilterable
// const filter = createFuzzyFilter<{
//   amount: Amount;
// }>({ ... });

// ✅ Native enums don't need to be in generic - they work automatically!
// enum Status { ACTIVE = 'active', INACTIVE = 'inactive' }
// const filter = createFuzzyFilter({
//   columns: [
//     { id: 'status', labelKey: 'columns.status', values: Object.values(Status) }
//   ],
//   // ...
// });

// ❌ Error - BadType doesn't implement FuzzyFilterable
// class BadType {
//   value: number;
// }
// const filter = createFuzzyFilter<{
//   bad: BadType;  // Error: Type 'BadType' does not satisfy constraint 'FuzzyFilterable<any>'
// }>({ ... });

// ============================================================================
// When to Use FuzzyFilterable vs Native Enums
// ============================================================================

/**
 * Use FuzzyFilterable for complex types that need custom parsing logic:
 * - Amount: "500kg" → { value: 500, unit: 'kg' }
 * - DateRange: "2024-01-01 to 2024-12-31" → { start: Date, end: Date }
 * - Custom units, formats, or validation
 * 
 * Use native enums (with `values`) for simple enum-like types:
 * - Status enums: 'active', 'inactive', 'pending'
 * - Priority levels: 'low', 'medium', 'high'
 * - Any fixed set of string/number values
 * 
 * Native enums automatically get:
 * - Parsing via i18n aliases
 * - Formatting via i18n keys
 * - Comparison via array order
 * - Equality operators (eq, neq, in, notIn) work automatically
 */

// ============================================================================
// Create Filter - Native Enums Work Automatically!
// ============================================================================

const culaI18nProvider = createCulaI18nProvider();

/**
 * Native enums don't need to be in the generic type parameter.
 * Only complex FuzzyFilterable types like Amount need to be declared.
 */
const filter = createFuzzyFilter<{
  amount: Amount;
  culaDate: CulaDate;
}>({
  // Columns with native enums - just provide values, no type needed!
  columns: [
    { 
      id: 'trackingState', 
      labelKey: 'columns.trackingState',
      values: Object.values(TrackingState),
      valuesI18nPrefix: 'trackingState', // Maps to 'trackingState.incomplete', etc.
    },
    { 
      id: 'verificationState', 
      labelKey: 'columns.verificationState',
      values: Object.values(VerificationState),
      valuesI18nPrefix: 'verificationState',
    },
    // Complex types still need explicit type
    { id: 'weight', labelKey: 'columns.weight', type: 'amount' },
    { id: 'createdAt', labelKey: 'columns.createdAt', type: 'culaDate' },
    // Built-in types work as before
    { id: 'name', labelKey: 'columns.name', type: 'string' },
    { id: 'quantity', labelKey: 'columns.quantity', type: 'number' },
  ],
  
  // Operators: defaults + custom
  operators: [
    ...DEFAULT_FUZZYFILTER_OPERATORS,
    {
      id: 'overlaps',
      // t() references resolve via i18n provider
      patterns: [
        't(operators.overlaps) {start} t(operators.to) {end}',
      ],
      predicates: {
        culaDate: (operand, { start, end }) => {
          return operand >= start && operand <= end;
        },
      },
    },
  ],
  
  // i18n provider
  i18n: culaI18nProvider,
  
  maxSuggestions: 12,
});

// ============================================================================
// DEFAULT_FUZZYFILTER_OPERATORS - What they look like internally
// ============================================================================

/**
 * Equality operators work automatically with native enums because they use simple === comparison.
 * The library handles parsing enum values from user input via i18n aliases, then the predicate
 * just compares the parsed enum value directly.
 */
const DEFAULT_FUZZYFILTER_OPERATORS: OperatorDefinition[] = [
  {
    id: 'eq',
    patterns: ['t(operators.eq) {value}'],
    // Simple equality - works for enums, strings, numbers, everything
    predicate: (operand, { value }) => operand === value,
  },
  {
    id: 'neq',
    patterns: ['t(operators.neq) {value}'],
    predicate: (operand, { value }) => operand !== value,
  },
  {
    id: 'in',
    patterns: ['t(operators.in) {values...}'],
    // Works with enum arrays - library parses multiple enum values
    predicate: (operand, { values }) => values.includes(operand),
  },
  {
    id: 'notIn',
    patterns: ['t(operators.notIn) {values...}'],
    predicate: (operand, { values }) => !values.includes(operand),
  },
  {
    id: 'gt',
    patterns: ['t(operators.gt) {value}'],
    predicate: (operand, { value }) => operand > value,
  },
  {
    id: 'between',
    patterns: [
      't(operators.between) {min} t(operators.and) {max}',
      't(operators.from) {min} t(operators.to) {max}',
    ],
    predicate: (operand, { min, max }) => operand >= min && operand <= max,
  },
  // ... etc
];
  Also redesign this api to accept partial objects for the updates and split into upser and delete
   /**
   * Updates the index incrementally for changed rows.
   *
   * More efficient than re-indexing the entire dataset when only
   * a few rows have changed.
   *
   * @param changes - Array of row changes
   *
   * @example
   * ```typescript
   * ff.updateRows([
   *   { rowId: 5, newData: { status: "Closed" } }, // insert / update
   *   { rowId: 10, newData: { status: "New" } }, // Insert
   *   { rowId: 3, oldData: { status: "Open" } }, // Delete
   * ]);
   * ```
   */

  
  ff.upsertRows([
  { rowId: 5, data: { status: "Closed" } },
  { rowId: 10, data: { status: "New" } },
]);

ff.deleteRows([3]); // Just IDs
// ============================================================================
// Usage Examples - Native Enums Work Automatically
// ============================================================================

filter.indexData(materialContainers);

// English locale
await filter.suggest('tracking is incomplete');
// Matches: 
//   - t('operators.eq') → ['is', 'equals']
//   - t('trackingState.incomplete') → 'Incomplete'
//   - Library parses "incomplete" → TrackingState.INCOMPLETE
//   - Predicate: operand === TrackingState.INCOMPLETE ✓
// → [{ label: "Tracking State is Incomplete", ... }]

// German locale
await filter.suggest('status ist unvollständig');
// Matches:
//   - t('operators.eq') → ['ist', 'gleich']
//   - t('trackingState.incomplete') → 'Unvollständig'
//   - Library parses "unvollständig" → TrackingState.INCOMPLETE
// → [{ label: "Verfolgungsstatus ist Unvollständig", ... }]

// Multiple values with 'in' operator
await filter.suggest('status in incomplete complete');
// Parses to: operand in [TrackingState.INCOMPLETE, TrackingState.COMPLETE]
// Predicate: [TrackingState.INCOMPLETE, TrackingState.COMPLETE].includes(operand) ✓


// ============================================================================
// Complete Usage Example
// ============================================================================

import { createFuzzyFilter, DEFAULT_FUZZYFILTER_OPERATORS } from 'fuzzyfilter';

// Custom complex types implement FuzzyFilterable
class Amount implements FuzzyFilterable<Amount> { /* ... */ }
class CulaDate implements FuzzyFilterable<CulaDate> { /* ... */ }

// Native enums - no wrapper needed!
enum TrackingState {
  INCOMPLETE = 'incomplete',
  COMPLETE = 'complete',
  LOCKED = 'locked',
}

// Create i18n provider
const i18nProvider = createCulaI18nProvider();

// Create filter - only declare complex FuzzyFilterable types in generic
const filter = createFuzzyFilter<{
  amount: Amount;
  culaDate: CulaDate;
}>({
  columns: [
    // Complex types need explicit type
    { id: 'weight', labelKey: 'columns.weight', type: 'amount' },
    { id: 'createdAt', labelKey: 'columns.createdAt', type: 'culaDate' },
    // Native enums - just provide values, equality operators work automatically!
    { 
      id: 'status', 
      labelKey: 'columns.status',
      values: Object.values(TrackingState),
      valuesI18nPrefix: 'trackingState',
    },
    // Built-in types work as before
    { id: 'name', labelKey: 'columns.name', type: 'string' },
    { id: 'quantity', labelKey: 'columns.quantity', type: 'number' },
  ],
  
  operators: [
    ...DEFAULT_FUZZYFILTER_OPERATORS,
    {
      id: 'overlaps',
      patterns: ['t(operators.overlaps) {start} t(operators.to) {end}'],
      predicates: {
        culaDate: (operand, { start, end }) => operand >= start && operand <= end,
      },
    },
    {
      id: 'equals',
      patterns: ['t(operators.equals) {:amount}'],
      predicates: {
        amount: (operand, { amount }) => operand.value === amount.value && operand.unit === amount.unit,
      },
    },
    {
      id: 'greater',
      patterns: ['t(operators.greater) {:amount}'],
      predicates: {
        amount: (operand, { amount }) => operand.toBaseUnit() > amount.toBaseUnit(),
      },
    },
    //...
  ],
  
  i18n: i18nProvider,
  maxSuggestions: 12,
});

// Index data (values are instances of FuzzyFilterable types or native enum values)
filter.indexData(materialContainers);

// Get suggestions
await filter.suggest('weight greater than 500kg');
await filter.suggest('status is incomplete'); // Works with native enum automatically!

// ============================================================================
// Works with Plain Arrays Too - Not Just Enums
// ============================================================================

/**
 * You can use plain arrays of strings/numbers - they work the same way as enums:
 */
const filterWithPlainArray = createFuzzyFilter({
  columns: [
    {
      id: 'priority',
      labelKey: 'columns.priority',
      values: ['low', 'medium', 'high', 'critical'],
      // i18n keys: 'priority.low', 'priority.medium', etc.
      // Equality operators work automatically!
    },
    {
      id: 'rating',
      labelKey: 'columns.rating',
      values: [1, 2, 3, 4, 5],
      // Works with numbers too
    },
  ],
  i18n: i18nProvider,
});

// Query: "priority is high" → works automatically
// Query: "rating is 5" → works automatically