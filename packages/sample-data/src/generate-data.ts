#!/usr/bin/env bun
/**
 * Build Script - Generate Static Sample Data
 *
 * This script generates the sample dataset at build time and writes it to a JSON file.
 * Run with: bun run packages/sample-data/src/generate-data.ts
 *
 * @module @fuzzyfilter/sample-data/generate-data
 */

import { generateTasks, type Task } from "./generator.ts";

/**
 * Configuration for the pre-generated dataset
 */
const DATASET_CONFIG = {
  count: 10000,
  seed: 42,
  dateRange: {
    from: new Date("2020-01-01"),
    to: new Date("2024-12-31"),
  },
} as const;

/**
 * Generate the dataset and write to JSON file
 */
async function main(): Promise<void> {
  console.log(`Generating ${DATASET_CONFIG.count} tasks with seed ${DATASET_CONFIG.seed}...`);

  const startTime = performance.now();
  const tasks: Task[] = generateTasks({
    count: DATASET_CONFIG.count,
    seed: DATASET_CONFIG.seed,
    dateRange: DATASET_CONFIG.dateRange,
  });
  const generateTime = performance.now() - startTime;

  console.log(`Generated ${tasks.length} tasks in ${generateTime.toFixed(2)}ms`);

  // Write to JSON file
  const outputPath = new URL("./generated-data.json", import.meta.url).pathname;
  const jsonContent = JSON.stringify(tasks, null, 2);

  await Bun.write(outputPath, jsonContent);

  const fileSizeKB = (jsonContent.length / 1024).toFixed(2);
  console.log(`Wrote ${fileSizeKB}KB to ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to generate data:", error);
  process.exit(1);
});
