/**
 * Filter Compilation Engine
 * 
 * Handles compilation of filter expressions into executable predicates
 * and execution of filters against data.
 * 
 * Uses operator predicates from the InstanceRegistry for unified execution.
 */

import type {
  CompiledFilter,
  FilterResult,
  ColumnId,
  Operator,
  AnyColumnDefinition,
  ParsedInput,
  OperatorDefinition,
} from "../../types/index.ts";
import { DataType } from "../../types/index.ts";
import { parseDate } from "../../date-parser.ts";
import type { InstanceRegistry } from "../../registry.ts";
import { OPERATORS } from "../../operators.ts";


/**
 * Compile a filter from parsed input
 *
 * @param parsed - The parsed input
 * @param getColumnById - Function to get column by ID
 * @param registry - Optional instance registry for custom operators
 * @returns Compiled filter or null if invalid
 */
export function compileFromParsed(
  parsed: ParsedInput,
  getColumnById: (id: ColumnId | string) => AnyColumnDefinition | null,
  registry?: InstanceRegistry
): CompiledFilter | null {
  if (!parsed.column || !parsed.operator) return null;

  return compileFilter(
    parsed.column.match.column.id,
    parsed.operator.match.operator,
    parsed.value?.match.value,
    getColumnById,
    [],
    registry
  );
}

/**
 * Compile a filter from structured components
 *
 * @param colId - The column ID
 * @param operator - The operator
 * @param value - Optional value for the operator
 * @param getColumnById - Function to get column by ID
 * @param data - The data array (for computing match count)
 * @param registry - Optional instance registry for custom operators
 * @returns Compiled filter or null if invalid
 */
export function compileFilter(
  colId: ColumnId | string,
  operator: Operator | string,
  value: unknown,
  getColumnById: (id: ColumnId | string) => AnyColumnDefinition | null,
  data: Array<Record<string, unknown>> = [],
  registry?: InstanceRegistry
): CompiledFilter | null {
  const col = getColumnById(colId);
  if (!col) return null;

  const columnId = typeof colId === "string" ? (colId as ColumnId) : colId;

  // Get operator definition from registry or fall back to built-in OPERATORS
  const opDef: OperatorDefinition | undefined = registry 
    ? registry.getOperator(operator) 
    : OPERATORS[operator];

  if (!opDef) {
    console.warn(`Unknown operator: "${operator}"`);
    return null;
  }

  if (!opDef.predicate) {
    console.warn(`Operator "${operator}" is missing a predicate implementation`);
    return null;
  }

  // For date columns, parse the value as a date expression
  let processedValue = value;
  
  if (col.type === DataType.DATE && value !== undefined) {
    processedValue = parseDateValue(value);
  }

  // Convert value to arguments array (predicates now expect arrays)
  const argsArray: unknown[] = processedValue !== undefined 
    ? (Array.isArray(processedValue) ? processedValue : [processedValue]) 
    : [];

  // Create the predicate using the operator's predicate function
  const predicate = (row: Record<string, unknown>): boolean => {
    const cellValue = row[columnId as string];
    
    // Handle date-specific processing for date columns
    if (col.type === DataType.DATE && processedValue !== undefined) {
      if (cellValue == null) return false;
      
      const cellDate = cellValue instanceof Date ? cellValue : new Date(String(cellValue));
      if (isNaN(cellDate.getTime())) return false;
      
      // For date equality, we need special handling for "same day" comparison
      if (operator === "eq" && argsArray[0] instanceof Date) {
        return isSameDay(cellDate, argsArray[0]);
      }
      if (operator === "neq" && argsArray[0] instanceof Date) {
        return !isSameDay(cellDate, argsArray[0]);
      }
      
      // For other date operators, pass args array to predicate
      return opDef.predicate(cellDate, argsArray, row);
    }
    
    // Use the operator's predicate with args array for non-date columns
    return opDef.predicate(cellValue, argsArray, row);
  };

  // Calculate match count
  let matchCount = 0;
  for (const row of data) {
    if (predicate(row)) matchCount++;
  }

  return {
    columnId,
    operator: operator as Operator,
    arguments: argsArray,
    predicate,
    matchCount,
    toString() {
      // Extract label from labelKey for display (e.g., "columns.status" -> "status")
      const labelParts = col.labelKey.split(".");
      const displayLabel = labelParts[labelParts.length - 1] ?? col.labelKey;
      return `${displayLabel} ${opDef.id}${argsArray.length > 0 ? ` ${argsArray.join(", ")}` : ""}`;
    },
  };
}

/**
 * Parse a value for date filtering.
 * Handles Date objects, arrays (for ranges), and string expressions.
 */
function parseDateValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value;
  }
  
  if (Array.isArray(value) && value.length === 2) {
    // Handle date range as [start, end] array
    const [start, end] = value;
    const startDate = start instanceof Date ? start : new Date(String(start));
    const endDate = end instanceof Date ? end : new Date(String(end));
    
    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
      return [startDate, endDate];
    }
    return value;
  }
  
  if (typeof value === "string") {
    // Try to parse as natural language date
    const parsed = parseDate(value);
    if (parsed) {
      if (parsed.isRange && parsed.rangeStart && parsed.rangeEnd) {
        return [parsed.rangeStart, parsed.rangeEnd];
      }
      return parsed.date;
    }
    
    // Fallback: try direct Date parsing
    const directParse = new Date(value);
    if (!isNaN(directParse.getTime())) {
      return directParse;
    }
  }
  
  return value;
}

/**
 * Execute a compiled filter and return matching row IDs
 *
 * @param filter - The compiled filter
 * @param data - The data array
 * @returns Filter result with matching rows and timing info
 */
export function executeFilter(
  filter: CompiledFilter,
  data: Array<Record<string, unknown>>
): FilterResult {
  const startTime = performance.now();
  const matchingRows: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (filter.predicate(data[i]!)) {
      matchingRows.push(i);
    }
  }

  return {
    filter,
    matchingRows,
    count: matchingRows.length,
    executionTimeMs: performance.now() - startTime,
  };
}

/**
 * Get the count for a filter without full execution
 *
 * @param filter - The compiled filter
 * @returns Number of matching rows
 */
export function getFilterCount(filter: CompiledFilter): number {
  return filter.matchCount;
}
