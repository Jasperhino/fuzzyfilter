/**
 * Main FuzzyFilter Class
 * 
 * Field-centric implementation of the FuzzyFilter interface.
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
} from "../types/index.ts";
import type {
  TelemetryCollector,
  IndexDataAsyncOptions,
  IndexProgress,
} from "../telemetry/index.ts";
import {
  createTelemetryCollector,
  NULL_TELEMETRY_COLLECTOR,
} from "../telemetry/index.ts";
import { FieldRegistry, createFieldRegistry } from "../field-registry.ts";
import { createTrie } from "../trie.ts";
import { tokenize } from "../tokenizer.ts";
import type { Trie } from "../types/index.ts";

interface ValueTrieEntry {
  value: string;
  fieldKey: string;
  rowCount: number;
}

interface FuzzyFilterState {
  data: Array<Record<string, unknown>>;
  dataVersion: number;
  fieldTrie: Trie<FieldSchema<any>>;
  valueTrie: Trie<ValueTrieEntry>;
  operatorTrie: Trie<{ overloadId: string; fieldKey: string }>;
  contextCache: Map<string, any>;
}

/**
 * FuzzyFilter class implementation with field-centric API.
 */
export class FuzzyFilterImpl implements FuzzyFilter {
  private state: FuzzyFilterState;
  private _config: FuzzyFilterConfig;
  private telemetry: TelemetryCollector;
  private registry: FieldRegistry;

  constructor(userConfig: FuzzyFilterConfig) {
    // Validate required fields
    if (!userConfig.fields || Object.keys(userConfig.fields).length === 0) {
      throw new Error("fields are required in FuzzyFilterConfig");
    }
    if (!userConfig.parsers) {
      throw new Error("parsers are required in FuzzyFilterConfig");
    }
    if (!userConfig.translations) {
      throw new Error("translations are required in FuzzyFilterConfig");
    }

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
      benchmark: userConfig.benchmark ?? false,
      telemetryOptions: userConfig.telemetryOptions,
      fields: userConfig.fields,
      parsers: userConfig.parsers,
      translations: userConfig.translations,
    };

    // Initialize telemetry
    this.telemetry = this._config.benchmark
      ? createTelemetryCollector({ enabled: true, ...this._config.telemetryOptions })
      : NULL_TELEMETRY_COLLECTOR;

    // Initialize field registry
    this.registry = createFieldRegistry(
      this._config.fields,
      this._config.parsers,
      this._config.translations
    );

    // Initialize state
    this.state = {
      data: [],
      dataVersion: 0,
      fieldTrie: createTrie(),
      valueTrie: createTrie(),
      operatorTrie: createTrie(),
      contextCache: new Map(),
    };

    // Build tries
    this.rebuildFieldTrie();
    this.rebuildOperatorTrie();
  }

  get config(): Readonly<FuzzyFilterConfig> {
    return this._config;
  }

  configure(options: Partial<FuzzyFilterConfig>): void {
    this._config = { ...this._config, ...options };

    if (options.fields || options.translations) {
      this.registry = createFieldRegistry(
        this._config.fields,
        this._config.parsers,
        this._config.translations
      );
      this.rebuildFieldTrie();
      this.rebuildOperatorTrie();
    }

    this.state.contextCache.clear();
  }

  getField(fieldKey: string): FieldSchema<any> | null {
    return this.registry.getField(fieldKey);
  }

  getOverloadsForField(fieldKey: string): OperatorOverload<any, any>[] {
    return this.registry.getOverloadsForField(fieldKey);
  }

  private rebuildFieldTrie(): void {
    this.state.fieldTrie = createTrie();
    for (const [fieldKey, fieldSchema] of this.registry.getFields()) {
      const searchTerms = this.registry.getFieldSearchTerms(fieldKey);
      for (const term of searchTerms) {
        this.state.fieldTrie.insert(term.toLowerCase(), fieldSchema);
      }
    }
  }

  private rebuildOperatorTrie(): void {
    this.state.operatorTrie = createTrie();
    for (const { fieldKey, overload } of this.registry.getAllOverloads()) {
      const searchTerms = this.registry.getOverloadSearchTerms(overload);
      for (const term of searchTerms) {
        this.state.operatorTrie.insert(term.toLowerCase(), {
          overloadId: overload.id,
          fieldKey,
        });
      }
    }
  }

  indexData(data: Array<Record<string, unknown>>): void {
    this.state.data = data;
    this.state.valueTrie = createTrie();
    this.state.dataVersion++;
    this.state.contextCache.clear();

    // Count values per field
    const valueCounts = new Map<string, Map<string, number>>();
    for (const fieldKey of this.registry.getFieldKeys()) {
      valueCounts.set(fieldKey, new Map());
    }

    for (const row of data) {
      for (const fieldKey of this.registry.getFieldKeys()) {
        const value = row[fieldKey];
        if (value == null) continue;
        const strValue = String(value);
        const counts = valueCounts.get(fieldKey)!;
        counts.set(strValue, (counts.get(strValue) ?? 0) + 1);
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
  }

  async indexDataAsync(
    data: Array<Record<string, unknown>>,
    options?: IndexDataAsyncOptions
  ): Promise<void> {
    const { chunkSize = 100, onProgress, signal } = options ?? {};
    const totalRows = data.length;
    const totalChunks = Math.ceil(totalRows / chunkSize);

    this.state.data = data;
    this.state.valueTrie = createTrie();
    this.state.dataVersion++;
    this.state.contextCache.clear();

    const valueCounts = new Map<string, Map<string, number>>();
    for (const fieldKey of this.registry.getFieldKeys()) {
      valueCounts.set(fieldKey, new Map());
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
  }

  upsertRows(rows: Array<{ rowId: number; data: Record<string, unknown> }>): void {
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
    this.state.data = this.state.data.filter(row => !predicate(row));
    if (this.state.data.length !== originalLength) {
      this.state.dataVersion++;
      this.indexData(this.state.data);
    }
  }

  getData(): Array<Record<string, unknown>> {
    return this.state.data;
  }

  clearIndex(): void {
    this.state.data = [];
    this.state.valueTrie = createTrie();
    this.state.dataVersion++;
    this.state.contextCache.clear();
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

  suggestSync(
    query: string,
    cursorPosition?: number,
    filterContext?: CompiledFilter[]
  ): SuggestionResponse {
    const suggestions: FilterSuggestion[] = [];
    const tokens = tokenize(query);
    const lowerQuery = query.toLowerCase();

    // Parse arguments from query
    const parsedArgs = this.registry.parseArguments(query);

    // Strategy 1: Match fields
    const fieldMatches = this.state.fieldTrie.search(lowerQuery, 10);
    for (const match of fieldMatches) {
      const fieldKey = this.findFieldKeyForSchema(match.item);
      if (!fieldKey) continue;

      const label = this.registry.getLabel(match.item.labelKey) ?? fieldKey;
      suggestions.push({
        label,
        displayLabel: label,
        filterExpression: fieldKey,
        score: match.score,
        isComplete: false,
        category: "field",
      });
    }

    // Strategy 2: Match operators
    const operatorMatches = this.state.operatorTrie.search(lowerQuery, 10);
    for (const match of operatorMatches) {
      const { overloadId, fieldKey } = match.item;
      const result = this.registry.getOverloadById(overloadId);
      if (!result) continue;

      const fieldLabel = this.registry.getLabel(
        this.registry.getField(fieldKey)?.labelKey ?? ''
      ) ?? fieldKey;
      const opLabel = this.registry.getLabel(result.overload.i18nKey) ?? result.overload.id;

      suggestions.push({
        label: `${fieldLabel} ${opLabel}`,
        displayLabel: `${fieldLabel} ${opLabel}`,
        filterExpression: overloadId,
        score: match.score,
        isComplete: false,
        category: "operator",
        metadata: { overloadId, fieldKey },
      });
    }

    // Strategy 3: Match values
    const valueMatches = this.state.valueTrie.search(lowerQuery, 10);
    for (const match of valueMatches) {
      const { value, fieldKey, rowCount } = match.item;
      const fieldLabel = this.registry.getLabel(
        this.registry.getField(fieldKey)?.labelKey ?? ''
      ) ?? fieldKey;

      suggestions.push({
        label: `${fieldLabel} = ${value}`,
        displayLabel: `${fieldLabel} = ${value}`,
        filterExpression: `${fieldKey}:eq:${value}`,
        score: match.score,
        isComplete: true,
        resultCount: rowCount,
        category: "value",
      });
    }

    // Sort by score
    suggestions.sort((a, b) => b.score - a.score);

    return {
      suggestions: suggestions.slice(0, this._config.maxSuggestions ?? 10),
      query,
      cursorPosition: cursorPosition ?? query.length,
    };
  }

  private findFieldKeyForSchema(schema: FieldSchema<any>): string | null {
    for (const [key, s] of this.registry.getFields()) {
      if (s === schema) return key;
    }
    return null;
  }

  parse(input: string): ParsedInput {
    const tokens = tokenize(input);
    return {
      raw: input,
      tokens: tokens.tokens,
      column: null,
      operator: null,
      value: null,
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
    const parts = input.split(':');
    if (parts.length < 2) return null;
    
    const fieldKey = parts[0]!;
    const operatorId = parts[1]!;
    const value = parts.slice(2).join(':');

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

    // Validate args against schema
    const parseResult = overload.argumentSchema.safeParse(args);
    if (!parseResult.success) return null;

    const validatedArgs = parseResult.data;
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

  clearCache(): void {
    this.state.contextCache.clear();
  }

  destroy(): void {
    this.state.data = [];
    this.state.fieldTrie = createTrie();
    this.state.valueTrie = createTrie();
    this.state.operatorTrie = createTrie();
    this.state.contextCache.clear();
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
