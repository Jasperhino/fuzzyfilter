/**
 * Sample Data Generator
 *
 * Generates fake task data using Faker.js that follows the TASK_SCHEMA.
 *
 * @module @fuzzyfilter/sample-data/generator
 */

import { faker } from "@faker-js/faker";
import type { Task } from "./index.ts";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Valid status values matching the schema
 */
const STATUSES = ["Open", "In Progress", "Closed", "Blocked"] as const;

/**
 * Valid department values matching the schema
 */
const DEPARTMENTS = ["Engineering", "Design", "Product"] as const;

/**
 * Priority range matching the schema (1-5)
 */
const PRIORITY_MIN = 1;
const PRIORITY_MAX = 5;

// ============================================================================
// GENERATOR OPTIONS
// ============================================================================

/**
 * Options for generating sample data
 */
export interface GeneratorOptions {
  /**
   * Number of tasks to generate
   * @default 50
   */
  count?: number;

  /**
   * Seed for reproducible random data
   * If provided, the same seed will always generate the same data
   */
  seed?: number;

  /**
   * Date range for createdAt field
   */
  dateRange?: {
    /** Start date for createdAt range */
    from?: Date;
    /** End date for createdAt range */
    to?: Date;
  };

  /**
   * Probability of a task being blocked (0-1)
   * @default 0.15
   */
  blockedProbability?: number;
}

// ============================================================================
// GENERATOR FUNCTIONS
// ============================================================================

/**
 * Generate a single fake task
 */
function generateTask(id: number, options: GeneratorOptions = {}): Task {
  const { blockedProbability = 0.15, dateRange } = options;

  const isBlocked = faker.datatype.boolean({ probability: blockedProbability });

  // If blocked, status is always "Blocked", otherwise random from other statuses
  const status = isBlocked
    ? "Blocked"
    : faker.helpers.arrayElement(
        STATUSES.filter((s) => s !== "Blocked") as string[]
      );

  const fromDate = dateRange?.from ?? new Date("2024-01-01");
  const toDate = dateRange?.to ?? new Date();

  const createdAt = faker.date
    .between({ from: fromDate, to: toDate })
    .toISOString()
    .split("T")[0];

  return {
    id,
    status,
    assignee: faker.person.fullName(),
    priority: faker.number.int({ min: PRIORITY_MIN, max: PRIORITY_MAX }),
    department: faker.helpers.arrayElement(DEPARTMENTS as unknown as string[]),
    createdAt,
    isBlocked,
  };
}

/**
 * Generate an array of fake tasks
 *
 * @param options - Configuration options for the generator
 * @returns Array of generated tasks
 *
 * @example
 * ```typescript
 * // Generate 100 tasks with a fixed seed for reproducibility
 * const tasks = generateTasks({ count: 100, seed: 42 });
 *
 * // Generate tasks within a specific date range
 * const recentTasks = generateTasks({
 *   count: 50,
 *   dateRange: {
 *     from: new Date("2024-06-01"),
 *     to: new Date("2024-12-31"),
 *   },
 * });
 * ```
 */
export function generateTasks(options: GeneratorOptions = {}): Task[] {
  const { count = 50, seed } = options;

  // Set seed for reproducible results
  if (seed !== undefined) {
    faker.seed(seed);
  }

  const tasks: Task[] = [];

  for (let i = 1; i <= count; i++) {
    tasks.push(generateTask(i, options));
  }

  return tasks;
}

/**
 * Generate a large dataset for performance testing
 *
 * @param size - Number of tasks to generate (default: 1000)
 * @param seed - Optional seed for reproducibility
 * @returns Array of generated tasks
 *
 * @example
 * ```typescript
 * // Generate 10,000 tasks for stress testing
 * const largeTasks = generateLargeDataset(10000, 12345);
 * ```
 */
export function generateLargeDataset(size = 1000, seed?: number): Task[] {
  return generateTasks({
    count: size,
    seed,
    dateRange: {
      from: new Date("2020-01-01"),
      to: new Date(),
    },
  });
}

/**
 * Create a seeded generator function for consistent test data
 *
 * @param seed - Seed value for the random generator
 * @returns A function that generates tasks with the given seed
 *
 * @example
 * ```typescript
 * const seededGenerator = createSeededGenerator(42);
 *
 * // Will always produce the same 10 tasks
 * const tasks1 = seededGenerator(10);
 * const tasks2 = seededGenerator(10); // Same as tasks1
 * ```
 */
export function createSeededGenerator(
  seed: number
): (count?: number) => Task[] {
  return (count = 50) => generateTasks({ count, seed });
}

