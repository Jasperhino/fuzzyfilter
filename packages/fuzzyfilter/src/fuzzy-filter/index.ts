/**
 * Main FuzzyFilter Class
 * 
 * Class-based implementation of the FuzzyFilter interface.
 * Uses the modular architecture with separate engines for suggestions,
 * compilation, parsing, and state management.
 */

import type {
  FuzzyFilter,
  FuzzyFilterConfig,
  SchemaInput,
  Schema,
  ColumnId,
  Operator,
  FilterSuggestion,
  SuggestionResponse,
  ParsedInput,
  CompiledFilter,
  FilterResult,
} from "../types/index.ts";
import { DEFAULT_CONFIG } from "../types/index.ts";
import { DataType } from "../types/index.ts";
import {
  getAllOperators,
  getOperatorsForType,
  getOperator,
} from "../operators.ts";
import { buildSchema, getColumn, getColumns } from "../schema-builder.ts";
import { createTrie } from "../trie.ts";
import { tokenize } from "../tokenizer.ts";
import {
  expandAliasPatterns,
  getSpreadStartKeywords,
  getSpreadSeparatorKeywords,
} from "../alias-generator.ts";
import { createFuzzyFilterState, computeFilterContext } from "./state.ts";
import type { FuzzyFilterState, OperatorAliasEntry } from "./types.ts";
import { SuggestionEngine } from "./engine/suggestion-engine.ts";
import {
  compileFromParsed,
  compileFilter as compileFilterImpl,
  executeFilter,
  getFilterCount,
} from "./engine/compiler.ts";
import { parseInput, validateInput } from "./engine/parser.ts";
import type { I18nProvider } from "../types/i18n.ts";
import { createDefaultEnglishProvider } from "../i18n/default-provider.ts";
import type {
  TelemetryCollector,
  IndexDataAsyncOptions,
  IndexProgress,
  WideEventBuilder,
  SetSchemaEvent,
  IndexDataEvent,
  SuggestEvent,
  CompileEvent,
  DataMutationEvent,
  SchemaContext,
  DataContext,
} from "../telemetry/index.ts";
import {
  createTelemetryCollector,
  NULL_TELEMETRY_COLLECTOR,
} from "../telemetry/index.ts";

/**
 * FuzzyFilter class implementation
 */
export class FuzzyFilterImpl implements FuzzyFilter {
  private state: FuzzyFilterState;
  private suggestionEngine: SuggestionEngine;
  private _config: FuzzyFilterConfig;
  private i18nProvider: I18nProvider;
  private unsubscribeLanguageChange?: () => void;
  private telemetry: TelemetryCollector;

  constructor(userConfig?: Partial<FuzzyFilterConfig>) {
    // Merge config with defaults
    this._config = {
      ...DEFAULT_CONFIG,
      ...userConfig,
      scoringWeights: {
        ...DEFAULT_CONFIG.scoringWeights,
        ...userConfig?.scoringWeights,
      },
      hypothesisOptions: {
        ...DEFAULT_CONFIG.hypothesisOptions,
        ...userConfig?.hypothesisOptions,
      },
      countOptions: {
        ...DEFAULT_CONFIG.countOptions,
        ...userConfig?.countOptions,
      },
    };

    // Initialize telemetry collector
    if (this._config.benchmark) {
      this.telemetry = createTelemetryCollector({
        enabled: true,
        ...this._config.telemetryOptions,
      });
    } else {
      this.telemetry = NULL_TELEMETRY_COLLECTOR;
    }

    // Initialize i18n provider (default to English if not provided)
    this.i18nProvider = userConfig?.i18nProvider ?? createDefaultEnglishProvider();

    // Initialize state with i18n provider
    this.state = createFuzzyFilterState(this.i18nProvider);

    // Build operator trie with translations
    this.rebuildOperatorTrie();

    // Initialize suggestion engine
    this.suggestionEngine = new SuggestionEngine(this.state, {
      maxSuggestions: this._config.maxSuggestions,
      benchmark: this._config.benchmark,
    });

    // Subscribe to language changes if provider supports it
    if (this.i18nProvider.onChange) {
      this.unsubscribeLanguageChange = this.i18nProvider.onChange(() => {
        this.rebuildOperatorTrie();
        this.rebuildColumnTrie();
        this.rebuildValueTrieTranslations();
        this.state.contextCache.clear();
      });
    }
  }

  /**
   * Rebuilds the value trie translations when language changes.
   * Re-indexes data to include new translated enum values.
   */
  private rebuildValueTrieTranslations(): void {
    if (this.state.data.length > 0) {
      // Re-index data to rebuild value trie with new translations
      this.indexData(this.state.data);
    }
  }
  
  /**
   * Rebuilds the column trie using the current I18nProvider.
   * Includes both static names/aliases and translated names from i18n keys.
   */
  private rebuildColumnTrie(): void {
    if (!this.state.schema) return;
    
    // Clear existing column trie
    this.state.columnTrie.clear();
    
    for (const col of getColumns(this.state.schema)) {
      // Insert static column name
      this.state.columnTrie.insert(col.name, col);
      
      // Insert static aliases
      if (col.aliases) {
        for (const alias of col.aliases) {
          this.state.columnTrie.insert(alias, col);
        }
      }
      
      // Insert translated column name if available
      if (col.nameKey && this.i18nProvider.translate) {
        const translatedName = this.i18nProvider.translate(col.nameKey);
        if (translatedName && translatedName !== col.name) {
          this.state.columnTrie.insert(translatedName, col);
        }
      }
      
      // Insert translated aliases if available
      if (col.aliasKeys && this.i18nProvider.translate) {
        for (const aliasKey of col.aliasKeys) {
          const translatedAlias = this.i18nProvider.translate(aliasKey);
          if (translatedAlias) {
            this.state.columnTrie.insert(translatedAlias, col);
          }
        }
      }
    }
  }

  /**
   * Rebuilds the operator trie using the current I18nProvider.
   * Only rebuilds the operator trie, NOT data indexes.
   */
  private rebuildOperatorTrie(): void {
    // Clear existing operator trie
    this.state.operatorTrie.clear();

    // Get all operators with translations applied
    const operators = getAllOperators(this.i18nProvider);

    // Build operator trie with translated aliases
    for (const op of operators) {
      // Insert operator id and label as general (no type restriction)
      this.state.operatorTrie.insert(op.id, { operator: op.id });
      this.state.operatorTrie.insert(op.label, { operator: op.id });

      // Insert explicit aliases (no type restriction)
      for (const alias of op.aliases) {
        this.state.operatorTrie.insert(alias, { operator: op.id });
      }

      // Insert expanded aliases from patterns (no type restriction)
      // Use i18nProvider for word set translations
      if (op.aliasPatterns) {
        const expandedAliases = expandAliasPatterns(op.aliasPatterns, this.i18nProvider);
        for (const alias of expandedAliases) {
          this.state.operatorTrie.insert(alias, { operator: op.id });
        }
      }

      // Insert type-specific aliases with their type restriction
      // Note: Type-specific aliases come from the operator definition, not translations
      if (op.typeSpecificAliases) {
        for (const [dataType, aliases] of Object.entries(op.typeSpecificAliases)) {
          for (const alias of aliases) {
            this.state.operatorTrie.insert(alias, {
              operator: op.id,
              forType: dataType as DataType,
            });
          }
        }
      }
    }
  }

  get config(): Readonly<FuzzyFilterConfig> {
    return this._config as Readonly<FuzzyFilterConfig>;
  }

  /**
   * Builds schema context for wide events
   */
  private buildSchemaContext(): SchemaContext {
    if (!this.state.schema) {
      return { column_count: 0, column_types: {} };
    }
    
    const columnTypes: Record<string, number> = {};
    for (const col of getColumns(this.state.schema)) {
      columnTypes[col.type] = (columnTypes[col.type] ?? 0) + 1;
    }
    
    return {
      column_count: this.state.schema.columns.size,
      column_types: columnTypes,
    };
  }

  /**
   * Builds data context for wide events
   */
  private buildDataContext(): DataContext {
    return {
      row_count: this.state.data.length,
      unique_values: this.state.valueTrie.size,
      data_version: this.state.dataVersion,
    };
  }

  configure(options: Partial<FuzzyFilterConfig>): void {
    const i18nProviderChanged = options.i18nProvider !== undefined && options.i18nProvider !== this.i18nProvider;
    
    this._config = {
      ...this._config,
      ...options,
      scoringWeights: {
        ...this._config.scoringWeights,
        ...options.scoringWeights,
      },
    };

    // Update i18n provider if changed
    if (i18nProviderChanged) {
      // Unsubscribe from old provider's onChange if it exists
      if (this.unsubscribeLanguageChange) {
        this.unsubscribeLanguageChange();
        this.unsubscribeLanguageChange = undefined;
      }

      this.i18nProvider = options.i18nProvider!;
      this.state.i18nProvider = this.i18nProvider;
      
      // Rebuild operator trie with new translations
      this.rebuildOperatorTrie();
      
      // Clear cache (suggestions may reference old labels)
      this.state.contextCache.clear();

      // Subscribe to new provider's onChange if available
      if (this.i18nProvider.onChange) {
        this.unsubscribeLanguageChange = this.i18nProvider.onChange(() => {
          this.rebuildOperatorTrie();
          this.rebuildColumnTrie();
          this.state.contextCache.clear();
        });
      }
    }

    // Update suggestion engine config
    this.suggestionEngine = new SuggestionEngine(this.state, {
      maxSuggestions: this._config.maxSuggestions,
      benchmark: this._config.benchmark,
    });
  }

  setSchema(schema: SchemaInput): void {
    const hadExistingData = this.state.data.length > 0;
    const event = this.telemetry.startEvent<SetSchemaEvent>("setSchema", {
      had_existing_data: hadExistingData,
      triggered_reindex: hadExistingData,
    });
    
    try {
      this.state.schema = buildSchema(schema);

      // Rebuild column trie with translated names
      this.rebuildColumnTrie();

      // Build schema context for the event
      event.set("schema", this.buildSchemaContext());

      // Re-index data if we have it
      if (hadExistingData) {
        this.indexData(this.state.data);
      }
      
      event.success();
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }

  getSchema(): Schema | null {
    return this.state.schema;
  }

  getColumn(id: ColumnId | string): import("../../types/index.ts").AnyColumnDefinition | null {
    if (!this.state.schema) return null;
    return getColumn(this.state.schema, id);
  }

  getOperatorsForColumn(colId: ColumnId | string): Operator[] {
    const col = this.getColumn(colId);
    if (!col) return [];
    return getOperatorsForType(col.type, this.i18nProvider).map((op) => op.id);
  }

  indexData(data: Array<Record<string, unknown>>): void {
    const event = this.telemetry.startEvent<IndexDataEvent>("indexData", {
      indexing: {
        row_count: data.length,
        is_async: false,
      },
    });
    
    try {
      this.state.data = data;
      this.state.valueTrie = createTrie();
      // Increment version and clear cache on data change
      this.state.dataVersion++;
      this.state.contextCache.clear();

      if (!this.state.schema) {
        event.merge({
          result: { columns_indexed: 0, unique_values: 0 },
        });
        event.success();
        return;
      }

      // Phase 1: Count values per column
      const endCounting = event.startPhase("value_counting_ms");
      const valueCounts = new Map<string, Map<string, number>>();

      for (const col of getColumns(this.state.schema)) {
        valueCounts.set(col.id as string, new Map());
      }

      for (const row of data) {
        for (const col of getColumns(this.state.schema!)) {
          const value = row[col.id as string];
          if (value == null) continue;

          const strValue = String(value);
          const counts = valueCounts.get(col.id as string)!;
          counts.set(strValue, (counts.get(strValue) ?? 0) + 1);
        }
      }
      endCounting();

      // Phase 2: Sort values by frequency
      const endSorting = event.startPhase("value_sorting_ms");
      const MAX_VALUES_PER_COLUMN = 100;
      const sortedValuesMap = new Map<string, Array<[string, number]>>();
      const cardinalityPerColumn: Record<string, number> = {};

      for (const col of getColumns(this.state.schema)) {
        const counts = valueCounts.get(col.id as string)!;
        cardinalityPerColumn[col.id as string] = counts.size;
        
        // Sort values by frequency and take top N
        const sortedValues = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_VALUES_PER_COLUMN);
        sortedValuesMap.set(col.id as string, sortedValues);
      }
      endSorting();

      // Phase 3: Build value trie
      const endTrieBuild = event.startPhase("trie_building_ms");
      for (const col of getColumns(this.state.schema)) {
        const sortedValues = sortedValuesMap.get(col.id as string)!;
        for (const [value, count] of sortedValues) {
          // Insert value with metadata into trie
          this.state.valueTrie.insert(value, {
            value,
            columnId: col.id,
            rowCount: count,
          });
        }
      }
      endTrieBuild();
      
      // Phase 4: Add translated enum values to the trie
      const endTranslation = event.startPhase("translation_insert_ms");
      this.addTranslatedValuesToTrie();
      endTranslation();
      
      event.merge({
        result: {
          columns_indexed: this.state.schema.columns.size,
          unique_values: this.state.valueTrie.size,
        },
        phases: event.getPhases() as import("../telemetry/index.ts").IndexDataPhases,
        trie_node_count: this.state.valueTrie.size,
        cardinality_per_column: cardinalityPerColumn,
      });
      event.success();
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }

  async indexDataAsync(
    data: Array<Record<string, unknown>>,
    options?: IndexDataAsyncOptions
  ): Promise<void> {
    const {
      chunkSize = 100,
      onProgress,
      signal,
    } = options ?? {};

    const totalRows = data.length;
    const totalChunks = Math.ceil(totalRows / chunkSize);
    
    const event = this.telemetry.startEvent<IndexDataEvent>("indexDataAsync", {
      indexing: {
        row_count: totalRows,
        chunk_size: chunkSize,
        chunk_count: totalChunks,
        is_async: true,
      },
    });

    try {
      this.state.data = data;
      this.state.valueTrie = createTrie();
      this.state.dataVersion++;
      this.state.contextCache.clear();

      if (!this.state.schema) {
        event.merge({
          result: { columns_indexed: 0, unique_values: 0 },
        });
        event.success();
        return;
      }

      const valueCounts = new Map<string, Map<string, number>>();

      for (const col of getColumns(this.state.schema)) {
        valueCounts.set(col.id as string, new Map());
      }

      // Process data in chunks with yielding
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // Check for abort
        if (signal?.aborted) {
          event.recordError("Indexing aborted", "AbortError");
          event.cancel();
          throw new DOMException("Indexing aborted", "AbortError");
        }

        const startIdx = chunkIndex * chunkSize;
        const endIdx = Math.min(startIdx + chunkSize, totalRows);
        
        // Process this chunk
        for (let i = startIdx; i < endIdx; i++) {
          const row = data[i]!;
          for (const col of getColumns(this.state.schema!)) {
            const value = row[col.id as string];
            if (value == null) continue;
            const strValue = String(value);
            const counts = valueCounts.get(col.id as string)!;
            counts.set(strValue, (counts.get(strValue) ?? 0) + 1);
          }
        }

        // Report progress
        const processed = endIdx;
        const progress: IndexProgress = {
          processed,
          total: totalRows,
          percentage: Math.round((processed / totalRows) * 100),
          currentChunk: chunkIndex + 1,
          totalChunks,
        };
        onProgress?.(progress);

        // Yield to the UI using requestIdleCallback or setTimeout fallback
        if (chunkIndex < totalChunks - 1) {
          await yieldToMain();
        }
      }

      // Build value trie (fast operation, no need to chunk)
      const MAX_VALUES_PER_COLUMN = 100;
      for (const col of getColumns(this.state.schema)) {
        const counts = valueCounts.get(col.id as string)!;
        const sortedValues = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_VALUES_PER_COLUMN);

        for (const [value, count] of sortedValues) {
          this.state.valueTrie.insert(value, {
            value,
            columnId: col.id,
            rowCount: count,
          });
        }
      }

      this.addTranslatedValuesToTrie();

      // Add final progress to the event
      event.set("progress", {
        processed: totalRows,
        total: totalRows,
        percentage: 100,
        current_chunk: totalChunks,
        total_chunks: totalChunks,
      });
      
      event.merge({
        result: {
          columns_indexed: this.state.schema.columns.size,
          unique_values: this.state.valueTrie.size,
        },
      });
      event.success();
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }
  
  /**
   * Adds translated enum values to the value trie.
   * This allows fuzzy searching by translated value names.
   */
  private addTranslatedValuesToTrie(): void {
    if (!this.state.schema || !this.i18nProvider.translate) return;
    
    for (const col of getColumns(this.state.schema)) {
      // Handle enum columns with translated value keys
      if (col.type === DataType.ENUM && "valueKeys" in col && col.valueKeys) {
        const enumCol = col as import("../types/index.ts").EnumColumnDefinition;
        
        for (let i = 0; i < enumCol.values.length; i++) {
          const originalValue = enumCol.values[i]!;
          const valueKey = enumCol.valueKeys[i];
          
          if (valueKey) {
            const translatedValue = this.i18nProvider.translate(valueKey);
            if (translatedValue && translatedValue !== originalValue) {
              // Insert translated value pointing to the original value
              // Check if original value exists in trie to get its count
              const existingEntry = this.state.valueTrie.lookup(originalValue);
              const rowCount = existingEntry?.rowCount ?? 0;
              
              this.state.valueTrie.insert(translatedValue, {
                value: originalValue, // Store original value for filter creation
                columnId: col.id,
                rowCount,
              });
            }
          }
        }
      }
    }
  }

  updateRows(
    changes: Array<{
      rowId: number;
      oldData?: Record<string, unknown>;
      newData?: Record<string, unknown>;
    }>
  ): void {
    const previousCount = this.state.data.length;
    const event = this.telemetry.startEvent<DataMutationEvent>("addRow", {
      mutation: {
        rows_affected: changes.length,
        previous_row_count: previousCount,
        new_row_count: previousCount, // Will be updated
      },
    });
    
    try {
      // Simple implementation: just re-index
      for (const change of changes) {
        if (change.oldData && change.newData) {
          this.state.data[change.rowId] = change.newData;
        } else if (change.newData) {
          this.state.data.push(change.newData);
        }
      }
      this.indexData(this.state.data);
      
      event.set("mutation", {
        rows_affected: changes.length,
        previous_row_count: previousCount,
        new_row_count: this.state.data.length,
      });
      event.success();
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }

  addRow(row: Record<string, unknown>): void {
    const previousCount = this.state.data.length;
    const event = this.telemetry.startEvent<DataMutationEvent>("addRow", {
      mutation: {
        rows_affected: 1,
        previous_row_count: previousCount,
        new_row_count: previousCount + 1,
      },
    });
    
    try {
      this.state.data.push(row);
      // Re-index to update value counts and track reindex time
      const reindexStart = performance.now();
      this.indexData(this.state.data);
      const reindexDuration = performance.now() - reindexStart;
      event.set("reindex_duration_ms", Math.round(reindexDuration * 100) / 100);
      event.success();
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }

  removeRow(index: number): void {
    const previousCount = this.state.data.length;
    const event = this.telemetry.startEvent<DataMutationEvent>("removeRow", {
      mutation: {
        rows_affected: 1,
        previous_row_count: previousCount,
        new_row_count: previousCount - 1,
      },
    });
    
    try {
      if (index < 0 || index >= this.state.data.length) {
        event.set("mutation", {
          rows_affected: 0,
          previous_row_count: previousCount,
          new_row_count: previousCount,
        });
        event.success();
        return;
      }
      this.state.data.splice(index, 1);
      // Re-index to update value counts and track reindex time
      const reindexStart = performance.now();
      this.indexData(this.state.data);
      const reindexDuration = performance.now() - reindexStart;
      event.set("reindex_duration_ms", Math.round(reindexDuration * 100) / 100);
      event.success();
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }

  removeRows(predicate: (row: Record<string, unknown>) => boolean): void {
    const previousCount = this.state.data.length;
    const event = this.telemetry.startEvent<DataMutationEvent>("removeRows");
    
    try {
      this.state.data = this.state.data.filter((row) => !predicate(row));
      const removedCount = previousCount - this.state.data.length;
      
      if (removedCount > 0) {
        // Re-index to update value counts and track reindex time
        const reindexStart = performance.now();
        this.indexData(this.state.data);
        const reindexDuration = performance.now() - reindexStart;
        event.set("reindex_duration_ms", Math.round(reindexDuration * 100) / 100);
      }
      
      event.set("mutation", {
        rows_affected: removedCount,
        previous_row_count: previousCount,
        new_row_count: this.state.data.length,
      });
      event.success();
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }

  getData(): Array<Record<string, unknown>> {
    return this.state.data;
  }

  clearIndex(): void {
    const previousCount = this.state.data.length;
    const event = this.telemetry.startEvent<DataMutationEvent>("removeRows", {
      mutation: {
        rows_affected: previousCount,
        previous_row_count: previousCount,
        new_row_count: 0,
      },
    });
    this.state.data = [];
    this.state.valueTrie = createTrie();
    event.success();
  }

  getIndexStats(): {
    totalRows: number;
    columnsIndexed: number;
    uniqueValues: number;
    indexSizeBytes: number;
  } {
    return {
      totalRows: this.state.data.length,
      columnsIndexed: this.state.schema?.columns.size ?? 0,
      uniqueValues: this.state.valueTrie.size,
      indexSizeBytes: 0, // Not tracking this for now
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
    const tokens = tokenize(query);
    
    const event = this.telemetry.startEvent<SuggestEvent>("suggest", {
      query: {
        text: query,
        length: query.length,
        token_count: tokens.length,
        cursor_position: cursorPosition,
        filter_context_count: filterContext?.length ?? 0,
      },
      schema: this.buildSchemaContext(),
      data: this.buildDataContext(),
    });
    
    try {
      const response = this.suggestionEngine.suggest(
        query,
        cursorPosition,
        filterContext,
        (input) => parseInput(input, this.state),
        (input) => tokenize(input)
      );
      
      // Build result context
      const categories: Record<string, number> = {};
      for (const s of response.suggestions) {
        categories[s.type] = (categories[s.type] ?? 0) + 1;
      }
      
      const topScore = response.suggestions.length > 0 
        ? response.suggestions[0]!.score 
        : null;
      
      const hasCompleteMatch = response.suggestions.some(
        (s) => s.type === "column_operator_value"
      );
      
      event.set("result", {
        suggestion_count: response.suggestions.length,
        top_score: topScore,
        has_complete_match: hasCompleteMatch,
        categories,
      });
      
      // Add phase timing and strategy data if available
      if (response.phaseTiming) {
        event.set("phases", response.phaseTiming as import("../telemetry/index.ts").SuggestPhases);
      }
      if (response.strategyTimings) {
        event.set("strategies", response.strategyTimings as import("../telemetry/index.ts").StrategyTiming[]);
      }
      if (response.cacheMetrics) {
        event.set("cache", response.cacheMetrics as import("../telemetry/index.ts").CacheMetrics);
      }
      
      event.success();
      
      return response;
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }

  parse(input: string): ParsedInput {
    return parseInput(input, this.state);
  }

  validate(input: string): {
    valid: boolean;
    errors: string[];
    parsed?: ParsedInput;
  } {
    return validateInput(input, this.state);
  }

  compile(input: string): CompiledFilter | null {
    const event = this.telemetry.startEvent<CompileEvent>("compile", {
      input: {
        type: "string",
        has_value: input.length > 0,
      },
    });
    
    try {
      const parsed = this.parse(input);
      const result = compileFromParsed(parsed, (id) => this.getColumn(id));
      
      // Get column type by looking up the column from the result's columnId
      const column = result ? this.getColumn(result.columnId) : null;
      
      event.set("result", {
        success: result !== null,
        column_type: column?.type,
      });
      event.success();
      
      return result;
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }

  compileFilter(
    columnId: ColumnId | string,
    operator: Operator,
    value?: unknown
  ): CompiledFilter | null {
    const col = this.getColumn(columnId);
    
    const event = this.telemetry.startEvent<CompileEvent>("compileFilter", {
      input: {
        type: "structured",
        column_id: String(columnId),
        operator,
        has_value: value !== undefined,
      },
    });
    
    try {
      const result = compileFilterImpl(
        columnId,
        operator,
        value,
        (id) => this.getColumn(id),
        this.state.data
      );
      
      event.set("result", {
        success: result !== null,
        column_type: col?.type,
      });
      event.success();
      
      return result;
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }

  execute(filter: CompiledFilter): FilterResult {
    return executeFilter(filter, this.state.data);
  }

  count(filter: CompiledFilter): number {
    return getFilterCount(filter);
  }

  clearCache(): void {
    this.state.contextCache.clear();
  }

  destroy(): void {
    if (this.unsubscribeLanguageChange) {
      this.unsubscribeLanguageChange();
      this.unsubscribeLanguageChange = undefined;
    }
    
    this.state.schema = null;
    this.state.data = [];
    this.state.columnTrie = createTrie();
    this.state.valueTrie = createTrie();
    this.state.contextCache.clear();
  }

  getTelemetry(): TelemetryCollector | null {
    if (!this._config.benchmark) {
      return null;
    }
    return this.telemetry;
  }
}

/**
 * Factory function for backward compatibility
 * Creates a new FuzzyFilter instance
 */
export function createFuzzyFilter(
  userConfig?: Partial<FuzzyFilterConfig>
): FuzzyFilter {
  return new FuzzyFilterImpl(userConfig);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Yields to the main thread to allow UI updates.
 * Uses requestIdleCallback if available, otherwise falls back to setTimeout.
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}
