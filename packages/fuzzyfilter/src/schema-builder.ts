/**
 * Schema Builder
 * Creates and validates schema definitions.
 */

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

