/**
 * Main FuzzyFilter Class
 * 
 * Class-based implementation of the FuzzyFilter interface.
 * Uses the modular architecture with separate engines for suggestions,
 * compilation, parsing, and state management.
 */

// Type declaration for requestIdleCallback (browser API, not available in Node.js)
declare function requestIdleCallback(
  callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
  options?: { timeout: number }
): number;

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
import type { FuzzyFilterable, FuzzyFilterableStatic, TypeHandler } from "../types/index.ts";
import { DataType } from "../types/index.ts";
import {
  getAllOperators,
  getOperator,
} from "../operators.ts";
import { InstanceRegistry } from "../registry.ts";
import { buildSchema, getColumn, getColumns, findSimilarColumns, UnknownColumnError } from "../schema-builder.ts";
import { createTrie } from "../trie.ts";
import { tokenize } from "../tokenizer.ts";
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
import { createEnumHandlerFromValues } from "./engine/enum-handler.ts";
import { getBuiltInTypeHandler } from "./engine/type-handlers.ts";
import type { ColumnDefinition, AnyColumnDefinition } from "../types/schema.ts";
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
export class FuzzyFilterImpl<TCustom extends Record<string, FuzzyFilterable<any>> = {}> 
  implements FuzzyFilter<TCustom> {
  private state: FuzzyFilterState;
  private suggestionEngine: SuggestionEngine;
  private _config: FuzzyFilterConfig<TCustom>;
  private i18nProvider: I18nProvider;
  private unsubscribeLanguageChange?: () => void;
  private telemetry: TelemetryCollector;
  private registry: InstanceRegistry;
  private customTypes: Map<string, FuzzyFilterableStatic<any>> = new Map();

  constructor(userConfig: FuzzyFilterConfig<TCustom>) {
    // Merge config with defaults, ensuring required internal fields are always defined
    this._config = {
      maxSuggestions: userConfig.maxSuggestions ?? DEFAULT_CONFIG.maxSuggestions ?? 10,
      minScore: userConfig.minScore ?? DEFAULT_CONFIG.minScore ?? 0.1,
      scoringWeights: {
        column: userConfig.scoringWeights?.column ?? DEFAULT_CONFIG.scoringWeights?.column ?? 0.4,
        operator: userConfig.scoringWeights?.operator ?? DEFAULT_CONFIG.scoringWeights?.operator ?? 0.35,
        arguments: userConfig.scoringWeights?.arguments ?? DEFAULT_CONFIG.scoringWeights?.arguments ?? 0.4,
      },
      enableCache: userConfig.enableCache ?? DEFAULT_CONFIG.enableCache ?? true,
      maxCacheSize: userConfig.maxCacheSize ?? DEFAULT_CONFIG.maxCacheSize ?? 1000,
      debounceMs: userConfig.debounceMs ?? DEFAULT_CONFIG.debounceMs ?? 150,
      debug: userConfig.debug ?? DEFAULT_CONFIG.debug ?? false,
      benchmark: userConfig.benchmark ?? DEFAULT_CONFIG.benchmark ?? false,
      telemetryOptions: userConfig.telemetryOptions,
      columns: userConfig.columns,
      operators: userConfig.operators,
      i18n: userConfig.i18n,
      types: userConfig.types,
    } as FuzzyFilterConfig<TCustom>;

    // Validate required fields
    if (!this._config.i18n) {
      throw new Error("i18n provider is required in FuzzyFilterConfig");
    }
    if (!this._config.columns || this._config.columns.length === 0) {
      throw new Error("columns are required in FuzzyFilterConfig");
    }

    // Initialize telemetry collector
    if (this._config.benchmark) {
      this.telemetry = createTelemetryCollector({
        enabled: true,
        ...this._config.telemetryOptions,
      });
    } else {
      this.telemetry = NULL_TELEMETRY_COLLECTOR;
    }

    // Initialize i18n provider
    this.i18nProvider = this._config.i18n;

    // Extract custom FuzzyFilterable types from columns
    this.extractCustomTypes();

    // Initialize instance registry with custom operators/types if provided
    // Pass i18n provider for pattern compilation
    // Cast to base FuzzyFilterConfig since InstanceRegistry doesn't need the TCustom generic
    this.registry = new InstanceRegistry(this._config as unknown as Partial<FuzzyFilterConfig>, this.i18nProvider);

    // Initialize state with i18n provider
    this.state = createFuzzyFilterState(this.i18nProvider);

    // Set schema from config columns
    this.setSchema({ columns: this._config.columns });

    // Build operator trie with translations
    this.rebuildOperatorTrie();

    // Initialize suggestion engine
    this.suggestionEngine = new SuggestionEngine(this.state, {
      maxSuggestions: this._config.maxSuggestions ?? 10,
      benchmark: this._config.benchmark,
    });

    // Subscribe to language changes if provider supports it
    if (this.i18nProvider.onChange) {
      this.unsubscribeLanguageChange = this.i18nProvider.onChange(() => {
        // Recompile patterns with new translations
        this.registry.compilePatterns();
        this.rebuildOperatorTrie();
        this.rebuildColumnTrie();
        this.rebuildValueTrieTranslations();
        this.state.contextCache.clear();
      });
    }
  }

  /**
   * Extracts custom FuzzyFilterable types from column definitions.
   * Stores them for use in type resolution.
   */
  private extractCustomTypes(): void {
    // Custom types are passed via generic parameter, not extracted from columns
    // This method is a placeholder for future enhancement if needed
    // For now, custom types must be registered separately if needed
  }

  /**
   * Gets the type handler for a column.
   * 
   * Resolution order:
   * 1. If column has `values` → returns enum handler
   * 2. If column has `type` → checks built-in handlers, then custom FuzzyFilterable types
   * 3. Throws error if no handler found
   * 
   * @param column - The column definition
   * @returns Type handler for the column's type
   */
  getTypeHandler(column: ColumnDefinition<TCustom>): TypeHandler<unknown> {
    // 1. Check if column has values (enum mode)
    if (column.values && column.values.length > 0) {
      return createEnumHandlerFromValues(column, this.i18nProvider);
    }

    // 2. Check if column has explicit type
    if (!column.type) {
      throw new Error(
        `Column "${column.id}" must have either 'values' (enum mode) or 'type' specified`
      );
    }

    const typeName = String(column.type);

    // 3. Check built-in types
    const builtInHandler = getBuiltInTypeHandler(typeName);
    if (builtInHandler) {
      return builtInHandler;
    }

    // 4. Check custom FuzzyFilterable types
    // This would need runtime type registration if we want to support it
    // For now, we assume custom types are handled elsewhere

    throw new Error(
      `No type handler found for column "${column.id}" with type "${typeName}". ` +
      `Register it as a FuzzyFilterable type or use built-in types.`
    );
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
   * Includes both static aliases and translated names from i18n keys.
   */
  private rebuildColumnTrie(): void {
    if (!this.state.schema) return;
    
    // Clear existing column trie
    this.state.columnTrie.clear();
    
    for (const col of getColumns(this.state.schema)) {
      // Insert column ID as a searchable target
      const colIdStr = typeof col.id === 'string' ? col.id : String(col.id);
      this.state.columnTrie.insert(colIdStr, col);
      
      // Insert translated column label from labelKey
      const translatedLabel = this.i18nProvider.getLabel(col.labelKey);
      if (translatedLabel) {
        this.state.columnTrie.insert(translatedLabel, col);
      }
      
      // Insert all aliases from labelKey (if getAliases returns multiple)
      const labelAliases = this.i18nProvider.getAliases(col.labelKey);
      for (const alias of labelAliases) {
        if (alias !== translatedLabel) {
          this.state.columnTrie.insert(alias, col);
        }
      }
      
      // Insert static aliases
      if (col.aliases) {
        for (const alias of col.aliases) {
          this.state.columnTrie.insert(alias, col);
        }
      }
      
      // Insert translated aliases if available
      if (col.aliasKeys) {
        for (const aliasKey of col.aliasKeys) {
          const translatedAliases = this.i18nProvider.getAliases(aliasKey);
          for (const alias of translatedAliases) {
            this.state.columnTrie.insert(alias, col);
          }
        }
      }
    }
  }

  /**
   * Rebuilds the operator trie using the current I18nProvider.
   * Only rebuilds the operator trie, NOT data indexes.
   * Uses operators from the instance registry.
   */
  private rebuildOperatorTrie(): void {
    // Clear existing operator trie
    this.state.operatorTrie.clear();

    // Get all compiled operators from the registry
    // This includes expanded patterns with i18n resolution
    const compiledOperators = this.registry.getAllCompiledOperators();
    const operators = this.registry.getAllOperators();

    // Build operator trie from compiled patterns
    for (const compiled of compiledOperators) {
      const opId = compiled.key;
      
      // Insert general (non-type-specific) trie keywords
      for (const keyword of compiled.trieKeywords) {
        this.state.operatorTrie.insert(keyword, { operator: opId });
      }
      
      // Insert type-specific keywords with their type restriction
      if (compiled.typeSpecificTrieKeywords) {
        for (const [dataType, keywords] of Object.entries(compiled.typeSpecificTrieKeywords)) {
          for (const keyword of keywords) {
            this.state.operatorTrie.insert(keyword, {
              operator: opId,
              forType: dataType as DataType,
            });
          }
        }
      }
    }

    // Also insert aliases from i18n provider
    for (const op of operators) {
      const i18nAliases = this.i18nProvider.getAliases(`operators.${op.id}`);
      for (const alias of i18nAliases) {
        this.state.operatorTrie.insert(alias, { operator: op.id });
      }
    }
  }

  /**
   * Get the instance registry (for internal use by strategies and compiler).
   */
  getRegistry(): InstanceRegistry {
    return this.registry;
  }

  get config(): Readonly<FuzzyFilterConfig<TCustom>> {
    return this._config as Readonly<FuzzyFilterConfig<TCustom>>;
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
      // For enum columns (with values), count as "enum"
      // For other columns, use their type
      const typeKey = col.values && col.values.length > 0 
        ? "enum" 
        : (col.type ? String(col.type) : "unknown");
      columnTypes[typeKey] = (columnTypes[typeKey] ?? 0) + 1;
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

  configure(options: Partial<FuzzyFilterConfig<TCustom>>): void {
    const i18nProviderChanged = options.i18n !== undefined && options.i18n !== this.i18nProvider;
    
    // Merge options, ensuring scoringWeights maintains required structure
    const currentWeights = this._config.scoringWeights ?? { column: 0.4, operator: 0.35, arguments: 0.4 };
    this._config = {
      ...this._config,
      ...options,
      scoringWeights: {
        column: options.scoringWeights?.column ?? currentWeights.column,
        operator: options.scoringWeights?.operator ?? currentWeights.operator,
        arguments: options.scoringWeights?.arguments ?? currentWeights.arguments,
      },
    };

    // Update i18n provider if changed
    if (i18nProviderChanged) {
      // Unsubscribe from old provider's onChange if it exists
      if (this.unsubscribeLanguageChange) {
        this.unsubscribeLanguageChange();
        this.unsubscribeLanguageChange = undefined;
      }

      this.i18nProvider = options.i18n!;
      this.state.i18nProvider = this.i18nProvider;
      
      // Rebuild operator trie with new translations
      this.rebuildOperatorTrie();
      
      // Clear cache (suggestions may reference old labels)
      this.state.contextCache.clear();

      // Subscribe to new provider's onChange if available
      if (this.i18nProvider.onChange) {
        this.unsubscribeLanguageChange = this.i18nProvider.onChange(() => {
          // Recompile patterns with new translations
          this.registry.compilePatterns();
          this.rebuildOperatorTrie();
          this.rebuildColumnTrie();
          this.state.contextCache.clear();
        });
      }
    }

    // Update suggestion engine config
    this.suggestionEngine = new SuggestionEngine(this.state, {
      maxSuggestions: this._config.maxSuggestions ?? 10,
      benchmark: this._config.benchmark,
    });
  }

  setSchema(schema: SchemaInput<TCustom>): void {
    const hadExistingData = this.state.data.length > 0;
    const event = this.telemetry.startEvent<SetSchemaEvent>("setSchema", {
      had_existing_data: hadExistingData,
      triggered_reindex: hadExistingData,
    });
    
    try {
      // Cast to base SchemaInput since buildSchema doesn't need the TCustom generic
      this.state.schema = buildSchema(schema as unknown as SchemaInput);

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

  getColumn(id: string): AnyColumnDefinition | null {
    if (!this.state.schema) return null;
    return getColumn(this.state.schema, id);
  }

  getOperatorsForColumn(colId: string): Operator[] {
    const col = this.getColumn(colId);
    if (!col) return [];
    
    // Operators are now universal - return all operator IDs
    return getAllOperators().map((op) => op.id);
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
      const sortedValuesMap = new Map<string, Array<[string, number]>>();
      const cardinalityPerColumn: Record<string, number> = {};

      for (const col of getColumns(this.state.schema)) {
        const counts = valueCounts.get(col.id as string)!;
        cardinalityPerColumn[col.id as string] = counts.size;
        
        // Sort values by frequency (index ALL values for complete coverage)
        const sortedValues = [...counts.entries()]
          .sort((a, b) => b[1] - a[1]);
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
        phases: event.getPhases() as unknown as import("../telemetry/index.ts").IndexDataPhases,
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
      // Index ALL values for complete coverage
      for (const col of getColumns(this.state.schema)) {
        const counts = valueCounts.get(col.id as string)!;
        const sortedValues = [...counts.entries()]
          .sort((a, b) => b[1] - a[1]);

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
   * 
   * Uses the pattern: {valuesI18nPrefix ?? column.id}.{value}
   */
  private addTranslatedValuesToTrie(): void {
    if (!this.state.schema) return;
    
    for (const col of getColumns(this.state.schema)) {
      // Handle columns with values (enum mode)
      if (col.values && col.values.length > 0) {
        const prefix = col.valuesI18nPrefix ?? (typeof col.id === 'string' ? col.id : String(col.id));
        
        for (const originalValue of col.values) {
          const valueKey = `${prefix}.${originalValue}`;
          
          // Get all aliases for this value
          const aliases = this.i18nProvider.getAliases(valueKey);
          
          // Check if original value exists in trie to get its count
          const strValue = String(originalValue);
          const existingEntry = this.state.valueTrie.lookup(strValue);
          const rowCount = existingEntry?.rowCount ?? 0;
          
          // Insert each alias into the trie pointing to the original value
          for (const alias of aliases) {
            // Skip if alias matches the original value (already in trie)
            if (alias.toLowerCase() !== strValue.toLowerCase()) {
              // col.id is always ColumnId after buildSchema processes it
              this.state.valueTrie.insert(alias, {
                value: strValue, // Store original value as string for filter creation
                columnId: col.id,
                rowCount,
              });
            }
          }
        }
      }
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
      // Increment version and clear cache
      this.state.dataVersion++;
      this.state.contextCache.clear();
      
      // Incremental index update - add/update values in the trie
      if (this.state.schema) {
        for (const col of getColumns(this.state.schema)) {
          const value = row[col.id as string];
          if (value == null) continue;
          
          const strValue = String(value);
          const existing = this.state.valueTrie.lookup(strValue);
          
          if (existing && existing.columnId === col.id) {
            // Value exists for this column - update count by re-inserting with incremented count
            this.state.valueTrie.insert(strValue, {
              value: strValue,
              columnId: col.id,
              rowCount: existing.rowCount + 1,
            });
          } else {
            // New value - insert into trie
            this.state.valueTrie.insert(strValue, {
              value: strValue,
              columnId: col.id,
              rowCount: 1,
            });
          }
        }
      }
      
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

  /**
   * Upserts (inserts or updates) rows and incrementally updates the index.
   * 
   * @param rows - Array of rows to upsert with their row IDs
   */
  upsertRows(
    rows: Array<{
      rowId: number;
      data: Record<string, unknown>;
    }>
  ): void {
    const previousCount = this.state.data.length;
    const event = this.telemetry.startEvent<DataMutationEvent>("upsertRows", {
      mutation: {
        rows_affected: rows.length,
        previous_row_count: previousCount,
        new_row_count: previousCount, // Will be updated after processing
      },
    });

    try {
      for (const { rowId, data } of rows) {
        if (rowId >= 0 && rowId < this.state.data.length) {
          // Update existing row
          this.state.data[rowId] = data;
        } else {
          // Insert new row at the end
          this.state.data.push(data);
        }
      }

      // Increment version and re-index to update value counts
      this.state.dataVersion++;
      const reindexStart = performance.now();
      this.indexData(this.state.data);
      const reindexDuration = performance.now() - reindexStart;

      event.set("mutation", {
        rows_affected: rows.length,
        previous_row_count: previousCount,
        new_row_count: this.state.data.length,
      });
      event.set("reindex_duration_ms", Math.round(reindexDuration * 100) / 100);
      event.success();
    } catch (error) {
      event.recordError(error instanceof Error ? error : String(error));
      event.error();
      throw error;
    }
  }

  /**
   * Deletes rows by their IDs and incrementally updates the index.
   * 
   * @param rowIds - Array of row IDs to delete
   */
  deleteRows(rowIds: number[]): void {
    const previousCount = this.state.data.length;
    const event = this.telemetry.startEvent<DataMutationEvent>("deleteRows", {
      mutation: {
        rows_affected: rowIds.length,
        previous_row_count: previousCount,
        new_row_count: previousCount, // Will be updated after processing
      },
    });

    try {
      // Sort row IDs in descending order to delete from end first
      // This prevents index shifting issues
      const sortedIds = [...rowIds].sort((a, b) => b - a);
      let deletedCount = 0;

      for (const rowId of sortedIds) {
        if (rowId >= 0 && rowId < this.state.data.length) {
          this.state.data.splice(rowId, 1);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        // Increment version and re-index to update value counts
        this.state.dataVersion++;
        const reindexStart = performance.now();
        this.indexData(this.state.data);
        const reindexDuration = performance.now() - reindexStart;
        event.set("reindex_duration_ms", Math.round(reindexDuration * 100) / 100);
      }

      event.set("mutation", {
        rows_affected: deletedCount,
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
        token_count: tokens.tokens.length,
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
        const cat = s.category ?? "fuzzy";
        categories[cat] = (categories[cat] ?? 0) + 1;
      }
      
      const topScore = response.suggestions.length > 0 
        ? response.suggestions[0]!.score 
        : null;
      
      const hasCompleteMatch = response.suggestions.some(
        (s) => s.isComplete
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
      const result = compileFromParsed(parsed, (id) => this.getColumn(id), this.registry);
      
      // Get column type by looking up the column from the result's columnId
      const column = result ? this.getColumn(result.columnId) : null;
      
      event.set("result", {
        success: result !== null,
        column_type: column?.type ? String(column.type) : undefined,
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
    columnId: string,
    operator: Operator,
    value?: unknown
  ): CompiledFilter | null {
    const col = this.getColumn(columnId);
    
    // Validate column exists - throw helpful error if not
    if (!col && this.state.schema) {
      const suggestions = findSimilarColumns(this.state.schema, columnId);
      const availableColumns = this.state.schema.columnOrder.map(String);
      throw new UnknownColumnError(columnId, suggestions, availableColumns);
    }
    
    const event = this.telemetry.startEvent<CompileEvent>("compileFilter", {
      input: {
        type: "structured",
        column_id: columnId,
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
        this.state.data,
        this.registry
      );
      
      event.set("result", {
        success: result !== null,
        column_type: col?.type ? String(col.type) : undefined,
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
 * Creates a new FuzzyFilter instance.
 * 
 * @typeParam TCustom - Map of custom type names to their FuzzyFilterable types.
 *                     Only needed when using custom FuzzyFilterable types.
 *                     Native enums don't need to be declared here.
 * 
 * @param config - Configuration including columns and i18n provider
 * @returns FuzzyFilter instance
 * 
 * @example With native enums
 * ```typescript
 * enum Status { ACTIVE = 'active', INACTIVE = 'inactive' }
 * 
 * const filter = createFuzzyFilter({
 *   columns: [
 *     { id: 'status', labelKey: 'columns.status', values: Object.values(Status) },
 *   ],
 *   i18n: myI18nProvider,
 * });
 * ```
 * 
 * @example With custom FuzzyFilterable type
 * ```typescript
 * class Amount implements FuzzyFilterable<Amount> { ... }
 * 
 * const filter = createFuzzyFilter<{ amount: Amount }>({
 *   columns: [
 *     { id: 'weight', labelKey: 'columns.weight', type: 'amount' },
 *   ],
 *   i18n: myI18nProvider,
 * });
 * ```
 */
export function createFuzzyFilter<TCustom extends Record<string, FuzzyFilterable<any>> = {}>(
  config: FuzzyFilterConfig<TCustom>
): FuzzyFilter<TCustom> {
  return new FuzzyFilterImpl<TCustom>(config);
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
