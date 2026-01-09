/**
 * Lazy Sample Data Generator
 *
 * Generates fake task data using dynamically imported Faker.js.
 * This module avoids loading faker at initial bundle time by using dynamic imports.
 *
 * @module @fuzzyfilter/sample-data/lazy-generator
 */

import type { Task, GeneratorOptions } from "./generator.ts";
import { Amount, type WeightUnit } from "./amount.ts";

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
// LAZY GENERATOR FUNCTIONS
// ============================================================================

/**
 * Cached faker module to avoid repeated dynamic imports
 */
let fakerModule: typeof import("@faker-js/faker") | null = null;

/**
 * Lazily load the faker module
 */
async function getFaker() {
  if (!fakerModule) {
    fakerModule = await import("@faker-js/faker");
  }
  return fakerModule.faker;
}

/**
 * Generate a single fake task with lazy-loaded faker
 */
async function generateTaskAsync(id: number, options: GeneratorOptions = {}): Promise<Task> {
  const faker = await getFaker();
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

  const dueDate = faker.date
    .between({ from: fromDate, to: toDate })
    .toISOString()
    .split("T")[0] as string;

  // Generate a created timestamp - for generated data, use a random past timestamp
  const createdDate = faker.date.between({ 
    from: new Date("2023-01-01"), 
    to: new Date() 
  });
  // Format as ISO string with second precision (remove milliseconds)
  const created = createdDate.toISOString().replace(/\.\d{3}Z$/, "Z");

  // Generate a task-related comment (longer, more realistic)
  const verb = faker.word.verb();
  const capitalizedVerb = verb.charAt(0).toUpperCase() + verb.slice(1);
  const noun = faker.word.noun();
  const adjective = faker.word.adjective();
  const commentOptions = [
    faker.lorem.sentences({ min: 2, max: 4 }),
    faker.lorem.paragraph(),
    `${capitalizedVerb} the ${adjective} ${noun} before the upcoming deadline. This is critical for the next milestone and should be prioritized accordingly.`,
    `Waiting on ${faker.person.firstName()} ${faker.person.lastName()} for code review. They mentioned they would get to it by end of day. Follow up if no response by tomorrow morning.`,
    `Need to ${faker.word.verb()} the ${faker.word.noun()} module. The current implementation has some performance issues that need to be addressed before we can ship to production.`,
    `Blocked by ${faker.company.name()} integration - their API is currently returning 503 errors. Support ticket #${faker.number.int({ min: 10000, max: 99999 })} has been opened and we're awaiting their response.`,
    `High priority task - ${faker.lorem.sentences(2)} Please escalate if this is not resolved within 48 hours.`,
    `Follow up with ${faker.person.fullName()} regarding the ${adjective} ${noun} implementation. They have context from the previous sprint that would be helpful here.`,
    `Technical debt: The ${faker.word.noun()} component needs refactoring. Current code is difficult to maintain and lacks proper test coverage. Estimate: ${faker.number.int({ min: 2, max: 8 })} story points.`,
    `Customer feedback received: "${faker.lorem.sentence()}" - This should be addressed in the next iteration to improve user experience.`,
  ];
  const comments = faker.helpers.arrayElement(commentOptions) as string;

  // Generate an amount with realistic weights
  const priority = faker.number.int({ min: PRIORITY_MIN, max: PRIORITY_MAX });
  const useKg = faker.datatype.boolean({ probability: 0.7 });
  const weightValue = useKg
    ? faker.number.int({ min: 10, max: 5000 })  // 10-5000 kg
    : faker.number.float({ min: 0.5, max: 50, fractionDigits: 1 });  // 0.5-50 tonnes
  const weightUnit = useKg ? "kg" : "t";
  const amount = new Amount(weightValue, weightUnit as WeightUnit);

  return {
    id,
    status,
    assignee: faker.person.fullName(),
    priority,
    department: faker.helpers.arrayElement(DEPARTMENTS as unknown as string[]),
    dueDate,
    created,
    isBlocked,
    comments,
    amount: amount.toJSON(),
  };
}

/**
 * Generate a single task with a given ID (async version with lazy-loaded faker).
 *
 * Useful for dynamically adding rows to an existing dataset.
 * This version dynamically imports faker.js only when called,
 * avoiding the performance penalty of loading faker at initial page load.
 *
 * @param id - The unique ID for the task
 * @param options - Optional generator options (seed, dateRange, etc.)
 * @returns A promise resolving to a single generated task
 *
 * @example
 * ```typescript
 * // Generate a new task with the next available ID
 * const newTask = await generateSingleTaskAsync(currentData.length + 1);
 *
 * // Generate with a specific seed for reproducibility
 * const seededTask = await generateSingleTaskAsync(100, { seed: 12345 });
 * ```
 */
export async function generateSingleTaskAsync(
  id: number,
  options: GeneratorOptions = {}
): Promise<Task> {
  const faker = await getFaker();
  
  // Use current timestamp as default seed for unique data
  if (options.seed === undefined) {
    faker.seed(Date.now() + Math.random());
  } else {
    faker.seed(options.seed);
  }

  return generateTaskAsync(id, options);
}
