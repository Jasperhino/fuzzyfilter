/**
 * Sample Data Package
 *
 * Shared sample data and schema definitions for FuzzyFilter examples.
 * Used by both React and Vue example projects.
 *
 * @module @fuzzyfilter/sample-data
 */

import { columnId, type SchemaInput, type ColumnId } from "fuzzyfilter";

// ============================================================================
// SAMPLE DATA
// ============================================================================

/**
 * Sample task data for demonstration.
 */
export const SAMPLE_DATA = [
  { id: 1, status: "Open", assignee: "Alice Chen", priority: 3, department: "Engineering", createdAt: "2024-01-15", isBlocked: false },
  { id: 2, status: "In Progress", assignee: "Bob Smith", priority: 2, department: "Engineering", createdAt: "2024-02-01", isBlocked: false },
  { id: 3, status: "Closed", assignee: "Alice Chen", priority: 1, department: "Design", createdAt: "2024-01-20", isBlocked: false },
  { id: 4, status: "Blocked", assignee: "Charlie Davis", priority: 5, department: "Engineering", createdAt: "2024-03-01", isBlocked: true },
  { id: 5, status: "Open", assignee: "Diana Evans", priority: 4, department: "Product", createdAt: "2024-02-15", isBlocked: false },
  { id: 6, status: "In Progress", assignee: "Eve Foster", priority: 2, department: "Design", createdAt: "2024-03-10", isBlocked: false },
  { id: 7, status: "Open", assignee: "Frank Garcia", priority: 3, department: "Engineering", createdAt: "2024-03-05", isBlocked: false },
  { id: 8, status: "Closed", assignee: "Grace Hall", priority: 1, department: "Product", createdAt: "2024-02-28", isBlocked: false },
  { id: 9, status: "In Progress", assignee: "Henry Irving", priority: 4, department: "Engineering", createdAt: "2024-03-12", isBlocked: true },
  { id: 10, status: "Open", assignee: "Ivy Johnson", priority: 2, department: "Design", createdAt: "2024-03-08", isBlocked: false },
] as const;

/**
 * Type for a single task row.
 */
export type TaskRow = typeof SAMPLE_DATA[number];

/**
 * Mutable version of TaskRow for filtering results.
 */
export interface Task {
  id: number;
  status: string;
  assignee: string;
  priority: number;
  department: string;
  createdAt: string;
  isBlocked: boolean;
}

// ============================================================================
// COLUMN IDS
// ============================================================================

/**
 * Pre-defined column IDs for the task schema.
 */
export const COLUMN_IDS = {
  status: columnId("status"),
  assignee: columnId("assignee"),
  priority: columnId("priority"),
  department: columnId("department"),
  createdAt: columnId("createdAt"),
  isBlocked: columnId("isBlocked"),
} as const;

// ============================================================================
// SCHEMA
// ============================================================================

/**
 * Schema definition for the task data.
 */
export const TASK_SCHEMA: SchemaInput = {
  columns: [
    {
      id: COLUMN_IDS.status,
      name: "Status",
      type: "enum",
      values: ["Open", "In Progress", "Closed", "Blocked"],
    },
    {
      id: COLUMN_IDS.assignee,
      name: "Assignee",
      type: "string",
      aliases: ["owner", "assigned to"],
    },
    {
      id: COLUMN_IDS.priority,
      name: "Priority",
      type: "number",
      min: 1,
      max: 5,
      isInteger: true,
    },
    {
      id: COLUMN_IDS.department,
      name: "Department",
      type: "enum",
      values: ["Engineering", "Design", "Product"],
    },
    {
      id: COLUMN_IDS.createdAt,
      name: "Created At",
      type: "date",
      aliases: ["created", "date"],
    },
    {
      id: COLUMN_IDS.isBlocked,
      name: "Is Blocked",
      type: "boolean",
      trueLabel: "Blocked",
      falseLabel: "Not Blocked",
    },
  ],
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get sample data as mutable array.
 */
export function getSampleData(): Task[] {
  return SAMPLE_DATA.map((row) => ({ ...row }));
}

/**
 * Status colors for UI display.
 */
export const STATUS_COLORS: Record<string, string> = {
  Open: "bg-blue-100 text-blue-800",
  "In Progress": "bg-yellow-100 text-yellow-800",
  Closed: "bg-green-100 text-green-800",
  Blocked: "bg-red-100 text-red-800",
};

/**
 * Department colors for UI display.
 */
export const DEPARTMENT_COLORS: Record<string, string> = {
  Engineering: "bg-purple-100 text-purple-800",
  Design: "bg-pink-100 text-pink-800",
  Product: "bg-indigo-100 text-indigo-800",
};

