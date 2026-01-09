/**
 * Sample Data Package
 *
 * Shared sample data and schema definitions for FuzzyFilter examples.
 * Used by both React and Vue example projects.
 *
 * @module @fuzzyfilter/sample-data
 */

import { columnId, type SchemaInput } from "@jasperhino/fuzzyfilter";
import { generateTasks, type Task } from "./generator.ts";

// Import pre-generated large dataset (10,000 rows with seed 42)
// This is generated at build time to avoid loading faker at runtime
import generatedData from "./generated-data.json";

// Re-export generator utilities and Task type
export {
  generateTasks,
  generateLargeDataset,
  createSeededGenerator,
  generateSingleTask,
  type GeneratorOptions,
  type Task,
} from "./generator.ts";

// Re-export lazy-loaded async generator for runtime use
export { generateSingleTaskAsync } from "./lazy-generator.ts";

// ============================================================================
// PRE-GENERATED LARGE DATASET
// ============================================================================

/**
 * Pre-generated large dataset for demos and performance testing.
 * Contains 10,000 tasks generated with seed 42 at build time.
 * 
 * Using this instead of `generateLargeDataset()` avoids loading faker.js
 * at runtime, significantly improving initial page load performance.
 */
export const LARGE_DATASET: Task[] = generatedData as Task[];

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
  dueDate: columnId("dueDate"),
  created: columnId("created"),
  isBlocked: columnId("isBlocked"),
  comments: columnId("comments"),
} as const;

// ============================================================================
// SCHEMA
// ============================================================================

/**
 * Schema definition for the task data (V2 API).
 * 
 * Column labels and enum values use i18n keys for translation support.
 * Native enums are defined using the `values` array - no `type: "enum"` needed.
 */
export const TASK_SCHEMA: SchemaInput = {
  columns: [
    {
      id: COLUMN_IDS.status,
      labelKey: "columns.status",
      values: ["Open", "In Progress", "Closed", "Blocked"],
      valuesI18nPrefix: "status", // Maps to "status.Open", "status.In Progress", etc.
    },
    {
      id: COLUMN_IDS.assignee,
      labelKey: "columns.assignee",
      type: "string",
      aliases: ["owner", "assigned to"],
    },
    {
      id: COLUMN_IDS.priority,
      labelKey: "columns.priority",
      type: "number",
    },
    {
      id: COLUMN_IDS.department,
      labelKey: "columns.department",
      values: ["Engineering", "Design", "Product"],
      valuesI18nPrefix: "department", // Maps to "department.Engineering", etc.
    },
    {
      id: COLUMN_IDS.dueDate,
      labelKey: "columns.dueDate",
      type: "date",
      aliases: ["due", "deadline"],
    },
    {
      id: COLUMN_IDS.created,
      labelKey: "columns.created",
      type: "string",
      aliases: ["timestamp", "createdAt"],
    },
    {
      id: COLUMN_IDS.isBlocked,
      labelKey: "columns.isBlocked",
      type: "boolean",
    },
    {
      id: COLUMN_IDS.comments,
      labelKey: "columns.comments",
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

