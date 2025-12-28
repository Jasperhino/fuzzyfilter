/**
 * Sample Data Package
 *
 * Shared sample data and schema definitions for FuzzyFilter examples.
 * Used by both React and Vue example projects.
 *
 * @module @fuzzyfilter/sample-data
 */

import { columnId, type SchemaInput } from "fuzzyfilter";
import { generateTasks } from "./generator.ts";

// Re-export generator utilities
export {
  generateTasks,
  generateLargeDataset,
  createSeededGenerator,
  type GeneratorOptions,
} from "./generator.ts";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Fixed seed for deterministic sample data generation.
 * Using this seed ensures the same data is generated every time.
 */
export const SAMPLE_DATA_SEED = 42;

/**
 * Default number of sample tasks to generate.
 */
export const SAMPLE_DATA_COUNT = 50;

// ============================================================================
// SAMPLE DATA
// ============================================================================

/**
 * Task type definition for filtering results.
 * Includes index signature for compatibility with Record<string, unknown>.
 */
export interface Task {
  id: number;
  status: string;
  assignee: string;
  priority: number;
  department: string;
  created: string;
  isBlocked: boolean;
  comments: string;
  [key: string]: string | number | boolean;
}

/**
 * Deterministic sample task data for demonstration.
 * Generated with a fixed seed for consistency across runs.
 */
export const SAMPLE_DATA: Task[] = generateTasks({
  count: SAMPLE_DATA_COUNT,
  seed: SAMPLE_DATA_SEED,
  dateRange: {
    from: new Date("2024-01-01"),
    to: new Date("2024-12-31"),
  },
});

/**
 * Type for a single task row (alias for Task).
 */
export type TaskRow = Task;

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
  created: columnId("created"),
  isBlocked: columnId("isBlocked"),
  comments: columnId("comments"),
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
      id: COLUMN_IDS.created,
      name: "Created",
      type: "date",
      aliases: ["date"],
    },
    {
      id: COLUMN_IDS.isBlocked,
      name: "Is Blocked",
      type: "boolean",
      trueLabel: "Blocked",
      falseLabel: "Not Blocked",
    },
    {
      id: COLUMN_IDS.comments,
      name: "Comments",
      type: "string",
      aliases: ["notes", "description", "text"],
    },
  ],
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get sample data as a fresh mutable array.
 * Each call returns a new array with the same deterministic data.
 */
export function getSampleData(): Task[] {
  return generateTasks({
    count: SAMPLE_DATA_COUNT,
    seed: SAMPLE_DATA_SEED,
    dateRange: {
      from: new Date("2024-01-01"),
      to: new Date("2024-12-31"),
    },
  });
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

