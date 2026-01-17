/**
 * Script to generate sample data and save it to a JSON file.
 * Run with: bun run playground/generate-sample-data.ts
 */
import z from 'zod';
import { zocker } from 'zocker';
import { writeFileSync } from 'fs';
import {
  ProcessingTypeSchema,
  DateSchema,
  CountSchema,
  AmountSchema,
  TimeframeSchema,
  MaterialTypeSchema,
} from "./config/domain-models";

const NUM_ROWS = 100000;

const PlaygroundDataSchema = z.array(
  z.object({
    id: z.uuidv4(),
    processing_type: ProcessingTypeSchema,
    date: DateSchema,
    count: CountSchema,
    amount: AmountSchema,
    timeframe: TimeframeSchema,
    contents: z.tuple([
      z.object({ materialName: z.literal('water'), weightInKg: z.number().int().positive().min(1).max(10000) }),
      z.object({ materialName: z.literal('biochar'), weightInKg: z.number().int().positive().min(1).max(10000) }),
    ])
  }));

console.log(`Generating ${NUM_ROWS} rows of sample data...`);
const startTime = performance.now();

const sampleData = zocker(PlaygroundDataSchema.length(NUM_ROWS)).setSeed(42).generate();

const generationTime = performance.now() - startTime;
console.log(`Generation took ${generationTime.toFixed(0)}ms`);

const outputPath = new URL('./sample-data.json', import.meta.url).pathname;
writeFileSync(outputPath, JSON.stringify(sampleData, null, 2));
console.log(`Saved ${sampleData.length} rows to ${outputPath}`);
