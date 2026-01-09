/**
 * Schema Builder
 * Creates and validates schema definitions.
 */

import fuzzysort from "fuzzysort";
import type {
  Schema,
  SchemaInput,
  AnyColumnDefinition,
  ColumnId,
} from "./types/index.ts";
import { columnId } from "./types/index.ts";

/**
 * Build a Schema from SchemaInput
 */
export function buildSchema(input: SchemaInput): Schema {
  const columns = new Map<ColumnId, AnyColumnDefinition>();
  const columnOrder: ColumnId[] = [];

  for (const col of input.columns) {
    // Ensure ID is a ColumnId
    const id = typeof col.id === "string" ? columnId(col.id as string) : col.id;
    const column = { ...col, id } as AnyColumnDefinition;

    columns.set(id, column);
    columnOrder.push(id);
  }

  const defaultColumns = input.defaultColumns?.map((id) =>
    columnId(id)
  );

  return {
    columns,
    columnOrder,
    defaultColumns,
  };
}

/**
 * Get a column by ID from schema
 */
export function getColumn(
  schema: Schema,
  id: ColumnId | string
): AnyColumnDefinition | null {
  const colId = typeof id === "string" ? columnId(id) : id;
  return schema.columns.get(colId) ?? null;
}

/**
 * Find the most similar column names for a given input using fuzzysort.
 * Returns up to 3 suggestions sorted by similarity.
 * 
 * @param schema - The schema to search
 * @param input - The input string to match
 * @param minScore - Minimum fuzzysort score to consider (default: -10000)
 * @returns Array of similar column IDs sorted by similarity (best match first)
 */
export function findSimilarColumns(
  schema: Schema,
  input: string,
): string[] {
  // Build a list of searchable targets with their column IDs
  const targets: Array<{ target: string; colId: string }> = [];

  for (const [colId, column] of schema.columns) {
    const id = String(colId);
    
    // Add column ID as a target
    targets.push({ target: id, colId: id });
    
    // Add labelKey (extract last part as fallback label)
    // e.g., "columns.status" -> "status"
    const labelKeyParts = column.labelKey.split(".");
    const fallbackLabel = labelKeyParts[labelKeyParts.length - 1] ?? column.labelKey;
    targets.push({ target: fallbackLabel, colId: id });
    
    // Add aliases as targets
    if (column.aliases) {
      for (const alias of column.aliases) {
        targets.push({ target: alias, colId: id });
      }
    }
  }

  // Use fuzzysort to find matches
  const results = fuzzysort.go(input, targets, {
    key: "target",
    limit: 10,
  });

  // Deduplicate by column ID and return top 3
  const seen = new Set<string>();
  const suggestions: string[] = [];
  
  for (const result of results) {
    const colId = result.obj.colId;
    if (!seen.has(colId)) {
      seen.add(colId);
      suggestions.push(colId);
      if (suggestions.length >= 3) break;
    }
  }

  return suggestions;
}

/**
 * Error thrown when a column is not found in the schema.
 * Includes helpful suggestions for similar column names.
 */
export class UnknownColumnError extends Error {
  /** The column ID that was not found */
  readonly columnId: string;
  /** Similar column names that might be what the user meant */
  readonly suggestions: string[];
  /** All available column IDs in the schema */
  readonly availableColumns: string[];

  constructor(
    columnId: string,
    suggestions: string[],
    availableColumns: string[]
  ) {
    let message = `Unknown column "${columnId}".`;
    
    if (suggestions.length > 0) {
      message += ` Did you mean "${suggestions[0]}"?`;
    }
    
    if (availableColumns.length <= 10) {
      message += ` Available columns: ${availableColumns.join(", ")}`;
    } else {
      message += ` Available columns: ${availableColumns.slice(0, 10).join(", ")}... (${availableColumns.length} total)`;
    }

    super(message);
    this.name = "UnknownColumnError";
    this.columnId = columnId;
    this.suggestions = suggestions;
    this.availableColumns = availableColumns;
  }
}

/**
 * Get a column by ID from schema, throwing a helpful error if not found.
 * 
 * Use this in places where a column must exist (e.g., compileFilter).
 * 
 * @param schema - The schema to search
 * @param id - The column ID to look up
 * @throws {UnknownColumnError} If the column is not found
 * @returns The column definition
 */
export function getColumnOrThrow(
  schema: Schema,
  id: ColumnId | string
): AnyColumnDefinition {
  const column = getColumn(schema, id);
  
  if (!column) {
    const suggestions = findSimilarColumns(schema, String(id));
    const availableColumns = schema.columnOrder.map(String);
    throw new UnknownColumnError(String(id), suggestions, availableColumns);
  }
  
  return column;
}

/**
 * Get all column IDs
 */
export function getColumnIds(schema: Schema): ColumnId[] {
  return schema.columnOrder;
}

/**
 * Get columns as array
 */
export function getColumns(schema: Schema): AnyColumnDefinition[] {
  return schema.columnOrder.map((id) => schema.columns.get(id)!);
}

