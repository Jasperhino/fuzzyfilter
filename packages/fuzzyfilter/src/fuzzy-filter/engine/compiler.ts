/**
 * Filter Compilation Engine
 * 
 * Handles compilation of filter expressions into executable predicates
 * and execution of filters against data.
 */

import type {
  CompiledFilter,
  FilterResult,
  ColumnId,
  Operator,
  AnyColumnDefinition,
  ParsedInput,
} from "../../types/index.ts";
import { DataType } from "../../types/index.ts";
import { parseDate } from "../../date-parser.ts";

/**
 * Check if two dates are the same calendar day
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
 * @returns Compiled filter or null if invalid
 */
export function compileFromParsed(
  parsed: ParsedInput,
  getColumnById: (id: ColumnId | string) => AnyColumnDefinition | null
): CompiledFilter | null {
  if (!parsed.column || !parsed.operator) return null;

  return compileFilter(
    parsed.column.match.column.id,
    parsed.operator.match.operator,
    parsed.value?.match.value,
    getColumnById
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
 * @returns Compiled filter or null if invalid
 */
export function compileFilter(
  colId: ColumnId | string,
  operator: Operator,
  value: unknown,
  getColumnById: (id: ColumnId | string) => AnyColumnDefinition | null,
  data: Array<Record<string, unknown>> = []
): CompiledFilter | null {
  const col = getColumnById(colId);
  if (!col) return null;

  const columnId = typeof colId === "string" ? (colId as ColumnId) : colId;

  // For date columns, try to parse the value as a date expression
  let dateValue: Date | null = null;
  let dateRangeStart: Date | null = null;
  let dateRangeEnd: Date | null = null;

  if (col.type === DataType.DATE && value !== undefined) {
    if (value instanceof Date) {
      dateValue = value;
    } else if (Array.isArray(value) && value.length === 2) {
      // Handle date range as [start, end] array
      const [start, end] = value;
      if (start instanceof Date && end instanceof Date) {
        dateValue = start;
        dateRangeStart = start;
        dateRangeEnd = end;
      } else {
        const startDate = start instanceof Date ? start : new Date(String(start));
        const endDate = end instanceof Date ? end : new Date(String(end));
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          dateValue = startDate;
          dateRangeStart = startDate;
          dateRangeEnd = endDate;
        }
      }
    } else if (typeof value === "string") {
      // Try to parse as natural language date
      const parsed = parseDate(value);
      if (parsed) {
        dateValue = parsed.date;
        if (parsed.isRange && parsed.rangeStart && parsed.rangeEnd) {
          dateRangeStart = parsed.rangeStart;
          dateRangeEnd = parsed.rangeEnd;
        }
      } else {
        // Fallback: try direct Date parsing
        const directParse = new Date(value);
        if (!isNaN(directParse.getTime())) {
          dateValue = directParse;
        }
      }
    }
  }

  const predicate = (row: Record<string, unknown>): boolean => {
    const cellValue = row[columnId as string];

    // Handle date-specific operators
    if (col.type === DataType.DATE && dateValue) {
      if (cellValue == null) return false;

      const cellDate =
        cellValue instanceof Date ? cellValue : new Date(String(cellValue));

      if (isNaN(cellDate.getTime())) return false;

      switch (operator) {
        case "eq":
          return isSameDay(cellDate, dateValue);
        case "neq":
          return !isSameDay(cellDate, dateValue);
        case "lt":
        case "before":
          return cellDate < dateValue;
        case "lte":
          return cellDate <= dateValue;
        case "gt":
        case "after":
          return cellDate > dateValue;
        case "gte":
          return cellDate >= dateValue;
        case "between":
          if (dateRangeStart && dateRangeEnd) {
            return cellDate >= dateRangeStart && cellDate <= dateRangeEnd;
          }
          return false;
        default:
          // Fall through to standard operators
          break;
      }
    }

    // Standard operators
    switch (operator) {
      case "eq":
        return cellValue === value;
      case "eqIgnoreCase":
        return String(cellValue).toLowerCase() === String(value).toLowerCase();
      case "neq":
        return cellValue !== value;
      case "neqIgnoreCase":
        return (
          String(cellValue).toLowerCase() !== String(value).toLowerCase()
        );
      case "lt":
        return (cellValue as number) < (value as number);
      case "lte":
        return (cellValue as number) <= (value as number);
      case "gt":
        return (cellValue as number) > (value as number);
      case "gte":
        return (cellValue as number) >= (value as number);
      case "contains":
        return String(cellValue).includes(String(value));
      case "notContains":
        return !String(cellValue).includes(String(value));
      case "startsWith":
        return String(cellValue).startsWith(String(value));
      case "endsWith":
        return String(cellValue).endsWith(String(value));
      case "isEmpty":
        return cellValue == null || cellValue === "";
      case "isNotEmpty":
        return cellValue != null && cellValue !== "";
      case "isTrue":
        return cellValue === true;
      case "isFalse":
        return cellValue === false;
      case "in":
        return Array.isArray(value) && value.includes(cellValue);
      case "nin":
        return Array.isArray(value) && !value.includes(cellValue);
      case "before":
        // Non-date fallback for before operator
        return String(cellValue) < String(value);
      case "after":
        // Non-date fallback for after operator
        return String(cellValue) > String(value);
      case "between":
        // For between with array value [start, end]
        if (Array.isArray(value) && value.length === 2) {
          const numValue = cellValue as number;
          return (
            numValue >= (value[0] as number) && numValue <= (value[1] as number)
          );
        }
        return false;
      default:
        return true;
    }
  };

  // Calculate match count
  let matchCount = 0;
  for (const row of data) {
    if (predicate(row)) matchCount++;
  }

  // Convert value to arguments array
  const args: unknown[] = value !== undefined ? (Array.isArray(value) ? value : [value]) : [];

  return {
    columnId,
    operator,
    arguments: args,
    predicate,
    matchCount,
    toString() {
      return `${col.name} ${operator}${args.length > 0 ? ` ${args.join(", ")}` : ""}`;
    },
  };
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
