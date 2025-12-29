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

/**
 * FuzzyFilter class implementation
 */
export class FuzzyFilterImpl implements FuzzyFilter {
  private state: FuzzyFilterState;
  private suggestionEngine: SuggestionEngine;
  private _config: FuzzyFilterConfig;

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

    // Initialize state
    this.state = createFuzzyFilterState();

    // Initialize operator trie with all operators and their aliases
    for (const op of getAllOperators()) {
      // Insert operator id and label as general (no type restriction)
      this.state.operatorTrie.insert(op.id, { operator: op.id });
      this.state.operatorTrie.insert(op.label, { operator: op.id });

      // Insert explicit aliases (no type restriction)
      for (const alias of op.aliases) {
        this.state.operatorTrie.insert(alias, { operator: op.id });
      }

      // Insert expanded aliases from patterns (no type restriction)
      if (op.aliasPatterns) {
        const expandedAliases = expandAliasPatterns(op.aliasPatterns);
        for (const alias of expandedAliases) {
          this.state.operatorTrie.insert(alias, { operator: op.id });
        }
      }

      // Insert type-specific aliases with their type restriction
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

    // Initialize suggestion engine
    this.suggestionEngine = new SuggestionEngine(this.state, {
      maxSuggestions: this._config.maxSuggestions,
    });
  }

  get config(): Readonly<FuzzyFilterConfig> {
    return this._config as Readonly<FuzzyFilterConfig>;
  }

  configure(options: Partial<FuzzyFilterConfig>): void {
    this._config = {
      ...this._config,
      ...options,
      scoringWeights: {
        ...this._config.scoringWeights,
        ...options.scoringWeights,
      },
    };
    // Update suggestion engine config
    this.suggestionEngine = new SuggestionEngine(this.state, {
      maxSuggestions: this._config.maxSuggestions,
    });
  }

  setSchema(schema: SchemaInput): void {
    this.state.schema = buildSchema(schema);

    // Rebuild column trie
    this.state.columnTrie = createTrie();
    for (const col of getColumns(this.state.schema)) {
      this.state.columnTrie.insert(col.name, col);
      if (col.aliases) {
        for (const alias of col.aliases) {
          this.state.columnTrie.insert(alias, col);
        }
      }
    }

    // Re-index data if we have it
    if (this.state.data.length > 0) {
      this.indexData(this.state.data);
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
    return getOperatorsForType(col.type).map((op) => op.id);
  }

  indexData(data: Array<Record<string, unknown>>): void {
    this.state.data = data;
    this.state.valueTrie = createTrie();
    // Increment version and clear cache on data change
    this.state.dataVersion++;
    this.state.contextCache.clear();

    if (!this.state.schema) return;

    // Count values per column
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

    // Build value trie
    // Limit indexed values per column to top 100 most frequent for performance
    const MAX_VALUES_PER_COLUMN = 100;

    for (const col of getColumns(this.state.schema)) {
      const counts = valueCounts.get(col.id as string)!;

      // Sort values by frequency and take top N
      const sortedValues = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_VALUES_PER_COLUMN);

      for (const [value, count] of sortedValues) {
        // Insert value with metadata into trie
        this.state.valueTrie.insert(value, {
          value,
          columnId: col.id,
          rowCount: count,
        });
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
    // Simple implementation: just re-index
    for (const change of changes) {
      if (change.oldData && change.newData) {
        this.state.data[change.rowId] = change.newData;
      } else if (change.newData) {
        this.state.data.push(change.newData);
      }
    }
    this.indexData(this.state.data);
  }

  clearIndex(): void {
    this.state.data = [];
    this.state.valueTrie = createTrie();
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
    return this.suggestionEngine.suggest(
      query,
      cursorPosition,
      filterContext,
      (input) => parseInput(input, this.state),
      (input) => tokenize(input)
    );
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
    const parsed = this.parse(input);
    return compileFromParsed(parsed, (id) => this.getColumn(id));
  }

  compileFilter(
    columnId: ColumnId | string,
    operator: Operator,
    value?: unknown
  ): CompiledFilter | null {
    return compileFilterImpl(
      columnId,
      operator,
      value,
      (id) => this.getColumn(id),
      this.state.data
    );
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
    this.state.schema = null;
    this.state.data = [];
    this.state.columnTrie = createTrie();
    this.state.valueTrie = createTrie();
    this.state.contextCache.clear();
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
