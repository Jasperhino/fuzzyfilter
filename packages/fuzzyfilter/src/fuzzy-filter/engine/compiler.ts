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
 * Checks if two dates are on the same day (ignoring time).
 * 
 * @param date1 - First date
 * @param date2 - Second date
 * @returns True if both dates are on the same calendar day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}


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
  getColumnById: (id: string) => AnyColumnDefinition | null,
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
  colId: string,
  operator: Operator | string,
  value: unknown,
  getColumnById: (id: string) => AnyColumnDefinition | null,
  data: Array<Record<string, unknown>> = [],
  registry?: InstanceRegistry
): CompiledFilter | null {
  const col = getColumnById(colId);
  if (!col) return null;

  const columnId = colId;

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

  // Process value based on column type
  let processedValue = value;
  
  if (col.type === DataType.DATE && value !== undefined) {
    processedValue = parseDateValue(value);
  }
  
  // For boolean columns, convert string "true"/"false" to actual booleans
  if (col.type === DataType.BOOLEAN && typeof value === "string") {
    const lower = value.toLowerCase();
    if (["true", "yes", "1", "on"].includes(lower)) {
      processedValue = true;
    } else if (["false", "no", "0", "off"].includes(lower)) {
      processedValue = false;
    }
  }

  // Build named args object from value based on operator pattern
  const namedArgs = buildNamedArgs(operator, processedValue);

  // Create the predicate using the operator's predicate function
  const predicate = (row: Record<string, unknown>): boolean => {
    const cellValue = row[columnId as string];
    
    // Handle date-specific processing for date columns
    if (col.type === DataType.DATE && processedValue !== undefined) {
      if (cellValue == null) return false;
      
      const cellDate = cellValue instanceof Date ? cellValue : new Date(String(cellValue));
      if (isNaN(cellDate.getTime())) return false;
      
      // For date equality, we need special handling for "same day" comparison
      if (operator === "eq" && namedArgs.value instanceof Date) {
        return isSameDay(cellDate, namedArgs.value);
      }
      if (operator === "neq" && namedArgs.value instanceof Date) {
        return !isSameDay(cellDate, namedArgs.value);
      }
      
      // For other date operators, pass named args to predicate
      return opDef.predicate(cellDate, namedArgs, row);
    }
    
    // Use the operator's predicate with named args for non-date columns
    return opDef.predicate(cellValue, namedArgs, row);
  };

  // Calculate match count
  let matchCount = 0;
  for (const row of data) {
    if (predicate(row)) matchCount++;
  }

  // Convert named args back to array for backward compatibility with CompiledFilter.arguments
  const argsArray = Object.values(namedArgs).filter(v => v !== undefined);

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
 * Build named arguments object from value based on operator pattern.
 * 
 * @param operator - The operator ID
 * @param value - The processed value
 * @returns Named arguments object
 */
function buildNamedArgs(operator: string, value: unknown): Record<string, unknown> {
  // Handle between operator specially (expects min and max)
  if (operator === "between") {
    if (Array.isArray(value) && value.length === 2) {
      return { min: value[0], max: value[1] };
    }
    // Fallback: if not array, treat as single value (shouldn't happen)
    return { min: value, max: value };
  }
  
  // Handle variadic operators (in, nin) - expect values array
  if (operator === "in" || operator === "nin") {
    if (Array.isArray(value)) {
      return { values: value };
    }
    // Single value - wrap in array
    return { values: value !== undefined ? [value] : [] };
  }
  
  // Handle operators with no arguments (isEmpty, isNotEmpty, isTrue, isFalse)
  if (operator === "isEmpty" || operator === "isNotEmpty" || operator === "isTrue" || operator === "isFalse") {
    return {};
  }
  
  // Default: single value argument
  return { value };
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
