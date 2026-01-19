/**
 * Main FuzzyFilter Class
 *
 * Field-centric implementation of the FuzzyFilter interface with beam search.
 */

declare function requestIdleCallback(
  callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
  options?: { timeout: number }
): number;

import type {
  FuzzyFilter,
  FuzzyFilterConfig,
  FilterSuggestion,
  SuggestionResponse,
  ParsedInput,
  CompiledFilter,
  FilterResult,
  FieldSchema,
  OperatorOverload,
  ArgumentTypeRegistry,
  TabCompletion,
} from "../types/index.ts";
import type {
  TelemetryCollector,
  IndexDataAsyncOptions,
  IndexProgress,
} from "../telemetry/index.ts";
import type { ValueParser, ParsedValue, ValueTrieEntry, Chunking, ParseMatch } from "../parsing/index.ts";
import {
  createTelemetryCollector,
  NULL_TELEMETRY_COLLECTOR,
} from "../telemetry/index.ts";
import { FieldRegistry, createFieldRegistry } from "../field-registry.ts";
import { createTrie } from "../trie.ts";
import { tokenize } from "../tokenizer.ts";
import {
  createCandidateEngine,
  createParsedValue,
  extractNumbers,
  createUniversalNumberParser,
} from "../parsing/index.ts";
import { RoaringBitmap32, roaringLibraryInitialize } from 'roaring-wasm';

// WASM initialization promise - initialize once
let wasmInitialized: Promise<void> | null = null;

/**
 * Initialize the roaring WASM library. Safe to call multiple times.
 * Returns a promise that resolves when initialization is complete.
 * 
 * Note: In browser environments, it's recommended to use `indexDataAsync()` 
 * instead of `indexData()` to ensure WASM is initialized before creating bitmaps.
 */
function ensureWasmInitialized(): Promise<void> {
  if (!wasmInitialized) {
    wasmInitialized = roaringLibraryInitialize();
  }
  return wasmInitialized;
}
import { createUnitRegistry } from "../units/index.ts";
import type { Trie } from "../types/index.ts";
import type { UnitRegistry } from "../units/index.ts";
import type {
  CandidateEngine,
  CandidateSuggestion,
  Candidate,
  ArgumentFilling,
} from "../parsing/candidate-engine.ts";

interface FuzzyFilterState {
  data: Array<Record<string, unknown>>;
  dataVersion: number;
  valueTrie: Trie<ValueTrieEntry>;
  bitmaps: Map<string, Map<string, RoaringBitmap32>>;
  contextCache: Map<string, unknown>;
  // Indexes for efficient range queries and complex predicates
  numericIndex: Map<string, { values: number[]; bitmap: RoaringBitmap32 }>;
  dateIndex: Map<string, { values: Date[]; bitmap: RoaringBitmap32 }>;
}

/**
 * FuzzyFilter class implementation with field-centric API and beam search.
 */
export class FuzzyFilterImpl implements FuzzyFilter {
  private state: FuzzyFilterState;
  private _config: FuzzyFilterConfig;
  private telemetry: TelemetryCollector;
  private registry: FieldRegistry;

  // Candidate engine dependencies
  private fieldTrie: Trie<{ key: string; schema: FieldSchema<unknown> }>;
  private argumentValueTrie: Trie<{ value: string; argumentType: string }>;
  private unitRegistry: UnitRegistry;
  private valueParsers: Map<string, ValueParser<unknown>>;
  private argumentTypes: ArgumentTypeRegistry;
  private candidateEngine: CandidateEngine;

  constructor(userConfig: FuzzyFilterConfig) {
    // Validate required fields
    if (!userConfig.fields || Object.keys(userConfig.fields).length === 0) {
      throw new Error("fields are required in FuzzyFilterConfig");
    }
    if (!userConfig.translations) {
      throw new Error("translations are required in FuzzyFilterConfig");
    }

    // Use arguments if provided, otherwise create empty registry (parsers will be handled separately)
    const argumentsConfig: ArgumentTypeRegistry = userConfig.arguments ?? {};

    // Merge config with defaults
    this._config = {
      maxSuggestions: userConfig.maxSuggestions ?? 10,
      minScore: userConfig.minScore ?? 0.1,
      scoringWeights: {
        column: userConfig.scoringWeights?.column ?? 0.4,
        operator: userConfig.scoringWeights?.operator ?? 0.35,
        arguments: userConfig.scoringWeights?.arguments ?? 0.4,
      },
      enableCache: userConfig.enableCache ?? true,
      maxCacheSize: userConfig.maxCacheSize ?? 1000,
      debounceMs: userConfig.debounceMs ?? 150,
      debug: userConfig.debug ?? false,
      enableAutocomplete: userConfig.enableAutocomplete ?? false,
      benchmark: userConfig.benchmark ?? false,
      telemetryOptions: userConfig.telemetryOptions,
      fields: userConfig.fields,
      arguments: argumentsConfig,
      translations: userConfig.translations,
      units: userConfig.units,
    };

    this.argumentTypes = argumentsConfig;

    // Initialize telemetry
    this.telemetry = this._config.benchmark
      ? createTelemetryCollector({
        enabled: true,
        ...this._config.telemetryOptions,
      })
      : NULL_TELEMETRY_COLLECTOR;

    // Initialize field registry (use parsers for backwards compatibility)
    this.registry = createFieldRegistry(
      this._config.fields,
      this._config.translations
    );

    // Initialize state
    this.state = {
      data: [],
      dataVersion: 0,
      valueTrie: createTrie(),
      bitmaps: new Map(),
      contextCache: new Map(),
      numericIndex: new Map(),
      dateIndex: new Map(),
    };

    // Initialize candidate engine dependencies
    this.fieldTrie = createTrie();
    this.argumentValueTrie = createTrie();
    this.valueParsers = new Map();
    this.unitRegistry = this.createUnitRegistry();

    // Build field trie
    this.rebuildFieldTrie();

    // Create default value parsers
    this.createDefaultValueParsers();

    // Build argument value trie from indexed argument types
    this.buildArgumentValueTrie();

    // Create candidate engine
    this.candidateEngine = this.createCandidateEngine();
  }

  /**
   * Creates the candidate engine with current state.
   */
  private createCandidateEngine(): CandidateEngine {
    return createCandidateEngine({
      fields: new Map(Object.entries(this._config.fields)),
      fieldTrie: this.fieldTrie,
      valueTrie: this.state.valueTrie,
      argumentValueTrie: this.argumentValueTrie,
      argumentTypes: this.argumentTypes,
      unitRegistry: this.unitRegistry,
      valueParsers: this.valueParsers,
      getFieldLabel: (fieldKey) => {
        const field = this.registry.getField(fieldKey);
        return field ? this.registry.getLabel(field.labelKey) ?? fieldKey : fieldKey;
      },
      getOperatorLabel: (i18nKey) => this.registry.getLabel(i18nKey) ?? i18nKey,
      getFieldAliases: (labelKey) => this.registry.getAliases(labelKey),
      getOperatorAliases: (i18nKey) => this.registry.getAliases(i18nKey),
    });
  }

  /**
   * Changes the active locale and rebuilds all indexes with new translations.
   * This updates field labels, operator labels, unit names, and indexed argument values.
   */
  public setLocale(locale: string): void {
    // Update field registry locale
    this.registry.setLocale(locale);

    // Rebuild unit registry (recreate with new getAliases results)
    this.unitRegistry = this.createUnitRegistry();

    // Rebuild field trie with localized labels
    this.rebuildFieldTrie();

    // Rebuild argument value trie with localized values
    this.buildArgumentValueTrie();

    // Rebuild candidate engine with updated dependencies
    this.candidateEngine = this.createCandidateEngine();
  }

  /**
   * Creates the unit registry from config.
   */
  private createUnitRegistry(): UnitRegistry {
    const units = this._config.units ?? [];
    return createUnitRegistry({
      units,
      getAliases: (key) => this.registry.getAliases(key),
    });
  }

  /**
   * Creates default value parsers for common types.
   */
  private createDefaultValueParsers(): void {
    // Universal number parser - handles all numeric values with units
    const universalNumberParser = createUniversalNumberParser();
    this.valueParsers.set(universalNumberParser.type, universalNumberParser);

    // Number parser (legacy, for compatibility)
    const numberParser: ValueParser<number> = {
      type: "number",
      parse: (query, unitRegistry, context) => {
        const results: ParsedValue<number>[] = [];
        const numbers = extractNumbers(query);

        for (const n of numbers) {
          // Check for unit after number
          const afterNumber = query.slice(n.end).trim();
          const unitMatch = afterNumber.match(/^([a-zA-Z]+)/);

          if (unitMatch && unitMatch[1] && context?.field?.unitDimension) {
            // Search for unit
            const unitMatches = unitRegistry.search(
              unitMatch[1],
              context.field.unitDimension
            );
            for (const um of unitMatches) {
              results.push(
                createParsedValue(
                  n.value,
                  n.text + unitMatch[0],
                  n.start,
                  n.end + unitMatch[0].length,
                  um.score,
                  um
                )
              );
            }
          }

          // Also add number without unit
          results.push(createParsedValue(n.value, n.text, n.start, n.end, 0.9));
        }

        return results;
      },
    };
    this.valueParsers.set("number", numberParser);

    // String parser (matches remaining text as value)
    const stringParser: ValueParser<string> = {
      type: "string",
      parse: (query) => {
        const trimmed = query.trim();
        if (!trimmed) return [];
        return [createParsedValue(trimmed, trimmed, 0, query.length, 0.8)];
      },
    };
    this.valueParsers.set("string", stringParser);

    // Adapt user-provided ArgumentParsers from arguments config to ValueParser interface
    if (this._config.arguments) {
      for (const [argTypeName, argType] of Object.entries(this._config.arguments)) {
        // Wrap ArgumentParser in ValueParser interface
        const wrappedParser: ValueParser<unknown> = {
          type: argTypeName,
          parse: (query: string, unitRegistry, context) => {
            const results = argType.parser.parse(query);
            return results.map((r) =>
              createParsedValue(r.value, r.text, r.index, r.index + r.text.length, 0.9)
            );
          },
        };
        this.valueParsers.set(argTypeName, wrappedParser);
      }
    }
  }
  /**
   * Builds the argument value trie from indexed argument types.
   * This trie is used for fuzzy matching of argument values (e.g., material types).
   */
  private buildArgumentValueTrie(): void {
    this.argumentValueTrie = createTrie();

    for (const [argTypeName, argType] of Object.entries(this.argumentTypes)) {
      const typedArgType = argType as import("../types/field-centric.ts").ArgumentTypeDefinition<unknown>;
      if (!typedArgType.indexing?.i18nKey) continue;

      // Resolve i18nKey to get canonical values and their aliases
      const valueAliases = this.registry.resolveValueAliases(typedArgType.indexing.i18nKey);

      // valueAliases = { water: ['water', 'H2O', 'Wasser'], biochar: ['biochar', 'Biokohle'], ... }
      for (const [canonicalValue, aliases] of Object.entries(valueAliases)) {
        const aliasArray = Array.isArray(aliases) ? aliases : [aliases];
        for (const alias of aliasArray) {
          this.argumentValueTrie.insert(alias.toLowerCase(), {
            value: canonicalValue,
            argumentType: argTypeName,
          });
        }
      }
    }
  }

  /**
   * Rebuilds the field trie for fuzzy matching.
   */
  private rebuildFieldTrie(): void {
    this.fieldTrie = createTrie();
    for (const [fieldKey, fieldSchema] of this.registry.getFields()) {
      const terms = this.registry.getFieldSearchTerms(fieldKey);
      for (const term of terms) {
        this.fieldTrie.insert(term.toLowerCase(), {
          key: fieldKey,
          schema: fieldSchema as FieldSchema<unknown>,
        });
      }
    }
  }

  get config(): Readonly<FuzzyFilterConfig> {
    return this._config;
  }

  configure(options: Partial<FuzzyFilterConfig>): void {
    this._config = { ...this._config, ...options };

    if (options.fields || options.translations) {
      this.registry = createFieldRegistry(
        this._config.fields,
        this._config.translations
      );
      this.rebuildFieldTrie();
    }

    if (options.units) {
      this.unitRegistry = this.createUnitRegistry();
    }

    // Recreate candidate engine with updated dependencies
    this.candidateEngine = this.createCandidateEngine();

    this.state.contextCache.clear();
  }

  getField(fieldKey: string): FieldSchema<unknown> | null {
    return this.registry.getField(fieldKey);
  }

  getOverloadsForField(
    fieldKey: string
  ): OperatorOverload<unknown, Record<string, unknown>>[] {
    return this.registry.getOverloadsForField(fieldKey);
  }

  indexData(data: Array<Record<string, unknown>>): void {
    // Dispose old bitmaps before creating new ones
    this.disposeAllBitmaps();

    this.state.data = data;
    this.state.valueTrie = createTrie();
    this.state.bitmaps = new Map();
    this.state.numericIndex = new Map();
    this.state.dateIndex = new Map();
    this.state.dataVersion++;
    this.state.contextCache.clear();

    // Ensure WASM is initialized (this will be a no-op if already initialized)
    // Note: In browser environments, this should ideally be awaited before calling indexData
    ensureWasmInitialized().catch(() => {
      // WASM initialization failed - bitmaps will be created but may not work
      // This is a soft failure to avoid breaking synchronous indexData calls
    });

    // Count values per field
    const valueCounts = new Map<string, Map<string, number>>();
    for (const fieldKey of this.registry.getFieldKeys()) {
      valueCounts.set(fieldKey, new Map());
      this.state.bitmaps.set(fieldKey, new Map());
    }

    for (let i = 0; i < data.length; i++) {
      const row = data[i]!;
      for (const fieldKey of this.registry.getFieldKeys()) {
        const value = row[fieldKey];
        if (value == null) continue;

        const strValue = String(value);
        const counts = valueCounts.get(fieldKey)!;
        counts.set(strValue, (counts.get(strValue) ?? 0) + 1);

        // Update bitmap for exact value matching
        const fieldBitmaps = this.state.bitmaps.get(fieldKey)!;
        let bitmap = fieldBitmaps.get(strValue);
        if (!bitmap) {
          bitmap = new RoaringBitmap32();
          fieldBitmaps.set(strValue, bitmap);
        }
        bitmap.add(i);

        // Index numeric values for range queries
        if (typeof value === 'number') {
          let numericIdx = this.state.numericIndex.get(fieldKey);
          if (!numericIdx) {
            numericIdx = { values: new Array(data.length).fill(null), bitmap: new RoaringBitmap32() };
            this.state.numericIndex.set(fieldKey, numericIdx);
          }
          numericIdx.values[i] = value;
          numericIdx.bitmap.add(i);
        }

        // Index date values for range queries
        if (value instanceof Date) {
          let dateIdx = this.state.dateIndex.get(fieldKey);
          if (!dateIdx) {
            dateIdx = { values: new Array(data.length).fill(null), bitmap: new RoaringBitmap32() };
            this.state.dateIndex.set(fieldKey, dateIdx);
          }
          dateIdx.values[i] = value;
          dateIdx.bitmap.add(i);
        }
      }
    }

    // Build value trie
    for (const fieldKey of this.registry.getFieldKeys()) {
      const counts = valueCounts.get(fieldKey)!;
      for (const [value, count] of counts) {
        this.state.valueTrie.insert(value.toLowerCase(), {
          value,
          fieldKey,
          rowCount: count,
        });
      }
    }

    // Rebuild beam engine with updated value trie
    this.rebuildCandidateEngine();
  }

  /**
   * Extracts searchable string values from a value.
   * Handles primitives, arrays, and objects.
   */
  private extractSearchableValues(value: unknown): string[] {
    const results: string[] = [];

    if (value == null) {
      return results;
    }

    if (typeof value === "string") {
      results.push(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      results.push(String(value));
    } else if (value instanceof Date) {
      results.push(value.toISOString());
    } else if (Array.isArray(value)) {
      // Recursively extract from array items
      for (const item of value) {
        results.push(...this.extractSearchableValues(item));
      }
    } else if (typeof value === "object") {
      // Extract string values from object properties
      for (const propValue of Object.values(value)) {
        if (typeof propValue === "string") {
          results.push(propValue);
        } else if (typeof propValue === "number" || typeof propValue === "boolean") {
          results.push(String(propValue));
        }
        // Don't recurse into nested objects to avoid too much noise
      }
    }

    return results;
  }

  /**
   * Rebuilds the candidate engine with current state.
   */
  private rebuildCandidateEngine(): void {
    this.candidateEngine = this.createCandidateEngine();
  }

  async indexDataAsync(
    data: Array<Record<string, unknown>>,
    options?: IndexDataAsyncOptions
  ): Promise<void> {
    // Dispose old bitmaps before creating new ones
    this.disposeAllBitmaps();

    // Ensure WASM is initialized before creating bitmaps
    await ensureWasmInitialized();

    const { chunkSize = 100, onProgress, signal } = options ?? {};
    const totalRows = data.length;
    const totalChunks = Math.ceil(totalRows / chunkSize);

    this.state.data = data;
    this.state.valueTrie = createTrie();
    this.state.bitmaps = new Map();
    this.state.numericIndex = new Map();
    this.state.dateIndex = new Map();
    this.state.dataVersion++;
    this.state.contextCache.clear();

    const valueCounts = new Map<string, Map<string, number>>();
    for (const fieldKey of this.registry.getFieldKeys()) {
      valueCounts.set(fieldKey, new Map());
      this.state.bitmaps.set(fieldKey, new Map());
    }

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      if (signal?.aborted) {
        throw new DOMException("Indexing aborted", "AbortError");
      }

      const startIdx = chunkIndex * chunkSize;
      const endIdx = Math.min(startIdx + chunkSize, totalRows);

      for (let i = startIdx; i < endIdx; i++) {
        const row = data[i]!;
        for (const fieldKey of this.registry.getFieldKeys()) {
          const value = row[fieldKey];
          if (value == null) continue;
          const strValue = String(value);
          const counts = valueCounts.get(fieldKey)!;
          counts.set(strValue, (counts.get(strValue) ?? 0) + 1);

          // Update bitmap for exact value matching
          let fieldBitmaps = this.state.bitmaps.get(fieldKey)!;
          let bitmap = fieldBitmaps.get(strValue);
          if (!bitmap) {
            bitmap = new RoaringBitmap32();
            fieldBitmaps.set(strValue, bitmap);
          }
          bitmap.add(i);

          // Index numeric values for range queries
          if (typeof value === 'number') {
            let numericIdx = this.state.numericIndex.get(fieldKey);
            if (!numericIdx) {
              numericIdx = { values: new Array(totalRows).fill(null), bitmap: new RoaringBitmap32() };
              this.state.numericIndex.set(fieldKey, numericIdx);
            }
            numericIdx.values[i] = value;
            numericIdx.bitmap.add(i);
          }

          // Index date values for range queries
          if (value instanceof Date) {
            let dateIdx = this.state.dateIndex.get(fieldKey);
            if (!dateIdx) {
              dateIdx = { values: new Array(totalRows).fill(null), bitmap: new RoaringBitmap32() };
              this.state.dateIndex.set(fieldKey, dateIdx);
            }
            dateIdx.values[i] = value;
            dateIdx.bitmap.add(i);
          }
        }
      }

      const progress: IndexProgress = {
        processed: endIdx,
        total: totalRows,
        percentage: Math.round((endIdx / totalRows) * 100),
        currentChunk: chunkIndex + 1,
        totalChunks,
      };
      onProgress?.(progress);

      if (chunkIndex < totalChunks - 1) {
        await yieldToMain();
      }
    }

    for (const fieldKey of this.registry.getFieldKeys()) {
      const counts = valueCounts.get(fieldKey)!;
      for (const [value, count] of counts) {
        this.state.valueTrie.insert(value.toLowerCase(), {
          value,
          fieldKey,
          rowCount: count,
        });
      }
    }

    // Rebuild beam engine with updated value trie
    this.rebuildCandidateEngine();
  }

  upsertRows(
    rows: Array<{ rowId: number; data: Record<string, unknown> }>
  ): void {
    for (const { rowId, data } of rows) {
      if (rowId >= 0 && rowId < this.state.data.length) {
        this.state.data[rowId] = data;
      } else {
        this.state.data.push(data);
      }
    }
    this.state.dataVersion++;
    this.indexData(this.state.data);
  }

  deleteRows(rowIds: number[]): void {
    const sortedIds = [...rowIds].sort((a, b) => b - a);
    for (const rowId of sortedIds) {
      if (rowId >= 0 && rowId < this.state.data.length) {
        this.state.data.splice(rowId, 1);
      }
    }
    this.state.dataVersion++;
    this.indexData(this.state.data);
  }

  addRow(row: Record<string, unknown>): void {
    this.state.data.push(row);
    this.state.dataVersion++;
    this.indexData(this.state.data);
  }

  removeRow(index: number): void {
    if (index >= 0 && index < this.state.data.length) {
      this.state.data.splice(index, 1);
      this.state.dataVersion++;
      this.indexData(this.state.data);
    }
  }

  removeRows(predicate: (row: Record<string, unknown>) => boolean): void {
    const originalLength = this.state.data.length;
    this.state.data = this.state.data.filter((row) => !predicate(row));
    if (this.state.data.length !== originalLength) {
      this.state.dataVersion++;
      this.indexData(this.state.data);
    }
  }

  getData(): Array<Record<string, unknown>> {
    return this.state.data;
  }

  clearIndex(): void {
    // Dispose all bitmaps before clearing
    this.disposeAllBitmaps();

    this.state.data = [];
    this.state.valueTrie = createTrie();
    this.state.bitmaps = new Map();
    this.state.numericIndex = new Map();
    this.state.dateIndex = new Map();
    this.state.dataVersion++;
    this.state.contextCache.clear();
  }

  /**
   * Dispose all bitmaps in the state to free WASM memory.
   */
  private disposeAllBitmaps(): void {
    // Dispose bitmaps from value bitmaps map
    for (const fieldBitmaps of this.state.bitmaps.values()) {
      for (const bitmap of fieldBitmaps.values()) {
        bitmap.dispose();
      }
    }

    // Dispose bitmaps from numeric index
    for (const numericIdx of this.state.numericIndex.values()) {
      numericIdx.bitmap.dispose();
    }

    // Dispose bitmaps from date index
    for (const dateIdx of this.state.dateIndex.values()) {
      dateIdx.bitmap.dispose();
    }
  }

  getIndexStats(): {
    totalRows: number;
    fieldsIndexed: number;
    uniqueValues: number;
    indexSizeBytes: number;
  } {
    return {
      totalRows: this.state.data.length,
      fieldsIndexed: this.registry.getFieldKeys().length,
      uniqueValues: this.state.valueTrie.size,
      indexSizeBytes: 0,
    };
  }

  async suggest(
    query: string,
    cursorPosition?: number,
    filterContext?: CompiledFilter[]
  ): Promise<SuggestionResponse> {
    return this.suggestSync(query, cursorPosition, filterContext);
  }

  /**
   * Generates filter suggestions using beam search.
   */
  suggestSync(
    query: string,
    cursorPosition?: number,
    filterContext?: CompiledFilter[]
  ): SuggestionResponse {
    const startTime = performance.now();
    const cursor = cursorPosition ?? query.length;

    if (!query.trim()) {
      return {
        suggestions: [],
        query,
        cursorPosition: cursor,
        responseTimeMs: performance.now() - startTime,
      };
    }

    // Run candidate engine
    const candidateSuggestions = this.candidateEngine.suggest(query);

    // Compute combined bitmap for filter context (intersection of all existing filters)
    const contextBitmap = filterContext && filterContext.length > 0
      ? this.computeFilterBitmap(filterContext)
      : null;

    try {
      // Convert candidate suggestions to filter suggestions (with per-suggestion tab completion)
      const suggestions: FilterSuggestion[] = candidateSuggestions.map((cs) =>
        this.candidateSuggestionToFilterSuggestion(cs, query, cursor, contextBitmap)
      );

      return {
        suggestions,
        query,
        cursorPosition: cursor,
        responseTimeMs: performance.now() - startTime,
      };
    } finally {
      // Dispose context bitmap after use
      if (contextBitmap) {
        contextBitmap.dispose();
      }
    }
  }

  /**
   * Converts a CandidateSuggestion to a FilterSuggestion.
   */
  private candidateSuggestionToFilterSuggestion(
    cs: CandidateSuggestion,
    query: string,
    cursorPosition: number,
    contextBitmap: RoaringBitmap32 | null
  ): FilterSuggestion {
    const { candidate, filling, score, scoreBreakdown, chunking, isComplete } = cs;

    // Build label: Field + Operator + Arguments
    const fieldLabel = this.registry.getLabel(candidate.fieldSchema.labelKey) ?? candidate.fieldKey;
    const opLabel = this.registry.getLabel(candidate.overload.i18nKey) ?? candidate.operatorId;

    // Format filled arguments for display
    const argParts: string[] = [];
    const filledArgs = filling.filledArgs;

    // Special case: timeframe with start and end dates
    if ('start' in filledArgs && 'end' in filledArgs &&
      filledArgs.start instanceof Date && filledArgs.end instanceof Date) {
      const startStr = filledArgs.start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const endStr = filledArgs.end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      argParts.push(`${startStr} - ${endStr}`);
    } else {
      for (const [argName, argValue] of Object.entries(filledArgs)) {
        if (Array.isArray(argValue)) {
          argParts.push(argValue.join(", "));
        } else if (argValue instanceof Date) {
          // Format dates nicely (e.g., "Jan 15, 2026")
          argParts.push(argValue.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
        } else if (typeof argValue === "object" && argValue !== null && "value" in argValue) {
          const obj = argValue as { value: number; unit?: string };
          argParts.push(`${obj.value}${obj.unit ?? ""}`);
        } else {
          argParts.push(String(argValue));
        }
      }
    }

    const label = [fieldLabel, opLabel, ...argParts].filter(Boolean).join(" ");

    // Determine category
    let category: "field" | "operator" | "value" = "operator";
    if (filling.filledArgs && Object.keys(filling.filledArgs).length > 0) {
      category = "value";
    }

    // Build per-suggestion tab completion if enabled
    let tabCompletion: TabCompletion | undefined;
    if (this._config.enableAutocomplete && chunking && filling.matches) {
      tabCompletion = this.buildSuggestionTabCompletion(chunking, filling.matches, cursorPosition);
    }

    // Compute result count using bitmaps
    let resultCount: number | undefined;
    if (isComplete && filling.filledArgs && Object.keys(filling.filledArgs).length > 0) {
      resultCount = this.computeCandidateResultCount(
        candidate,
        filling.filledArgs,
        contextBitmap
      );
    }

    return {
      label: label || `${fieldLabel} ${opLabel}`,
      displayLabel: label || `${fieldLabel} ${opLabel}`,
      score,
      isComplete,
      category,
      fieldKey: candidate.fieldKey,
      operatorId: candidate.operatorId,
      overloadIds: [candidate.overload.id],
      chunking,
      matches: filling.matches,
      parsedValues: filling.parsedValues,
      scoreBreakdown,
      remaining: filling.unusedChunks.join(" ") || undefined,
      tabCompletion,
      args: filling.filledArgs,
      resultCount,
    };
  }

  /**
   * Builds tab completion for a specific suggestion based on its matches.
   * 
   * Finds the chunk at the cursor position and uses the match's resolvedTo
   * as the completion. This way, each suggestion offers its own completion
   * based on how it interpreted the query.
   */
  private buildSuggestionTabCompletion(
    chunking: Chunking,
    matches: ParseMatch[],
    cursorPosition: number
  ): TabCompletion | undefined {
    // Find the chunk that contains the cursor
    const chunkAtCursor = chunking.chunks.find(
      (c) => cursorPosition >= c.start && cursorPosition <= c.end
    );

    if (!chunkAtCursor || chunkAtCursor.text.length < 1) {
      return undefined;
    }

    // Find a match that overlaps with the cursor chunk
    const matchAtCursor = matches.find(
      (m) => m.start <= chunkAtCursor.start && m.end >= chunkAtCursor.end
    ) ?? matches.find(
      // Also try to find match that starts at same position
      (m) => m.start === chunkAtCursor.start
    ) ?? matches.find(
      // Last resort: find any match that contains the cursor position
      (m) => m.start <= cursorPosition && m.end >= cursorPosition
    );

    if (!matchAtCursor) {
      return undefined;
    }

    const original = matchAtCursor.text;
    const completion = matchAtCursor.resolvedTo;
    const role = matchAtCursor.role;

    // Only complete if the completion is different (and ideally longer)
    if (completion === original) {
      return undefined;
    }

    // Map role to matchType
    const matchType: TabCompletion["matchType"] =
      role === "field" ? "field" :
        role === "operator" ? "operator" :
          role === "unit" ? "unit" : "value";

    return {
      original,
      completion,
      range: {
        start: matchAtCursor.start,
        end: matchAtCursor.end,
      },
      score: matchAtCursor.score,
      matchType,
    };
  }

  parse(input: string): ParsedInput {
    const tokens = tokenize(input);
    return {
      raw: input,
      tokens: tokens.tokens,
      classifications: [],
      column: undefined,
      operator: undefined,
      value: undefined,
    };
  }

  validate(input: string): {
    valid: boolean;
    errors: string[];
    parsed?: ParsedInput;
  } {
    const parsed = this.parse(input);
    return {
      valid: true,
      errors: [],
      parsed,
    };
  }

  compile(input: string): CompiledFilter | null {
    // Simple implementation - parse overload ID
    const parts = input.split(":");
    if (parts.length < 2) return null;

    const fieldKey = parts[0]!;
    const operatorId = parts[1]!;
    const value = parts.slice(2).join(":");

    const field = this.registry.getField(fieldKey);
    if (!field) return null;

    const overloads = this.registry.getOverloadsForOperator(fieldKey, operatorId);
    if (overloads.length === 0) return null;

    const overload = overloads[0]!;
    const args = { value };

    return {
      columnId: fieldKey,
      operator: operatorId,
      value: args,
      predicate: (row: Record<string, unknown>) => {
        const operand = row[fieldKey];
        return overload.predicate(operand, args, row);
      },
      label: `${fieldKey} ${operatorId} ${value}`,
    };
  }

  compileFromOverload(
    overloadId: string,
    args: Record<string, unknown>
  ): CompiledFilter | null {
    const result = this.registry.getOverloadById(overloadId);
    if (!result) return null;

    const { fieldKey, overload } = result;
    const field = this.registry.getField(fieldKey);
    if (!field) return null;

    // Validate args
    let validatedArgs = args;
    if (overload.argumentSchema) {
      const parseResult = overload.argumentSchema.safeParse(args);
      if (!parseResult.success) return null;
      validatedArgs = parseResult.data;
    } else if (overload.arguments) {
      // In the new pattern, args are produced by the ArgumentParser.
      // We assume they are valid for now, or we could validate against 
      // the schemas in the argument registry.
      validatedArgs = args;
    } else {
      // No schema or arguments defined - should not happen for well-defined overloads
      return null;
    }
    const opLabel = this.registry.getLabel(overload.i18nKey) ?? overload.id;
    const fieldLabel = this.registry.getLabel(field.labelKey) ?? fieldKey;

    return {
      columnId: fieldKey,
      operator: overloadId,
      value: validatedArgs,
      predicate: (row: Record<string, unknown>) => {
        const operand = row[fieldKey];
        return overload.predicate(operand, validatedArgs, row);
      },
      label: `${fieldLabel} ${opLabel}`,
    };
  }

  execute(filter: CompiledFilter): FilterResult {
    const start = performance.now();
    const matchingRows: number[] = [];

    for (let i = 0; i < this.state.data.length; i++) {
      if (filter.predicate(this.state.data[i]!)) {
        matchingRows.push(i);
      }
    }

    return {
      matchingRows,
      totalRows: this.state.data.length,
      executionTimeMs: performance.now() - start,
    };
  }

  count(filter: CompiledFilter): number {
    let count = 0;
    for (const row of this.state.data) {
      if (filter.predicate(row)) count++;
    }
    return count;
  }

  private computeFilterBitmap(filters: CompiledFilter[]): RoaringBitmap32 | null {
    if (filters.length === 0) return null;

    const result = new RoaringBitmap32();

    for (let i = 0; i < this.state.data.length; i++) {
      const row = this.state.data[i]!;
      const matches = filters.every(f => f.predicate(row));
      if (matches) {
        result.add(i);
      }
    }

    return result;
  }

  /**
   * Computes the result count for a candidate suggestion using roaring bitmaps.
   * Uses the operator's predicate function to determine matching rows, ensuring
   * consistency with the actual filter execution logic.
   */
  private computeCandidateResultCount(
    candidate: Candidate,
    filledArgs: Record<string, unknown>,
    contextBitmap: RoaringBitmap32 | null
  ): number {
    const { fieldKey, overload } = candidate;

    // Always use the predicate function defined in the overload - it's the source of truth
    // for how comparisons and filtering should work (e.g., Date equality via getTime(),
    // Amount comparisons with unit conversion, array contains logic, etc.)
    const candidateBitmap = this.computePredicateBitmap(fieldKey, filledArgs, overload);

    try {
      // Intersect with existing filters if any using roaring bitmap operations
      if (contextBitmap) {
        return contextBitmap.andCardinality(candidateBitmap);
      }

      return candidateBitmap.size;
    } finally {
      // Dispose candidate bitmap after use (it's a temporary bitmap created for counting)
      candidateBitmap.dispose();
    }
  }

  /**
   * Computes bitmap by evaluating the predicate against all rows.
   * Uses the operator overload's predicate function, which is the authoritative
   * definition of how the filter should work.
   */
  private computePredicateBitmap(
    fieldKey: string,
    filledArgs: Record<string, unknown>,
    overload: import("../types/field-centric.ts").OperatorOverload<unknown, Record<string, unknown>>
  ): RoaringBitmap32 {
    const result = new RoaringBitmap32();
    const data = this.state.data;

    for (let i = 0; i < data.length; i++) {
      const row = data[i]!;
      const operand = row[fieldKey];

      try {
        // Use the predicate function from the overload - it handles all comparison logic
        // including Date equality, Amount comparisons, array contains, timeframe overlaps, etc.
        if (overload.predicate(operand, filledArgs, row)) {
          result.add(i);
        }
      } catch (e) {
        // Skip rows that cause errors in predicate evaluation
        continue;
      }
    }

    return result;
  }

  clearCache(): void {
    this.state.contextCache.clear();
  }

  destroy(): void {
    // Dispose all bitmaps before destroying
    this.disposeAllBitmaps();

    this.state.data = [];
    this.state.valueTrie = createTrie();
    this.fieldTrie = createTrie();
    this.state.bitmaps = new Map();
    this.state.numericIndex = new Map();
    this.state.dateIndex = new Map();
    this.state.contextCache.clear();
    this.candidateEngine.invalidateCache();
  }

  getTelemetry(): TelemetryCollector | null {
    return this._config.benchmark ? this.telemetry : null;
  }
}

/**
 * Creates a new FuzzyFilter instance.
 */
export function createFuzzyFilter(config: FuzzyFilterConfig): FuzzyFilter {
  return new FuzzyFilterImpl(config);
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}
