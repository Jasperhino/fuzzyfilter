/**
 * Load sample data from JSON and convert date strings back to Date objects.
 */
import { readFileSync, existsSync } from 'fs';

interface RawSampleDataRow {
  id: string;
  processing_type: string;
  date: string;
  count: number;
  amount: { value: number; unit: string };
  timeframe: { start: string; end: string };
  contents: Array<{ materialName: string; weightInKg: number }>;
}

export interface SampleDataRow {
  id: string;
  processing_type: string;
  date: Date;
  count: number;
  amount: { value: number; unit: 'kg' | 't' };
  timeframe: { start: Date; end: Date };
  contents: Array<{ materialName: string; weightInKg: number }>;
}

/**
 * Loads sample data from the JSON file and converts date strings to Date objects.
 * @returns Array of sample data rows with proper Date objects
 * @throws Error if sample-data.json doesn't exist - run generate-sample-data.ts first
 */
export function loadSampleData(): SampleDataRow[] {
  const dataPath = new URL('../sample-data.json', import.meta.url).pathname;
  
  if (!existsSync(dataPath)) {
    throw new Error(
      `Sample data not found at ${dataPath}. Run 'bun run playground/generate-sample-data.ts' first.`
    );
  }
  
  const rawData: RawSampleDataRow[] = JSON.parse(readFileSync(dataPath, 'utf-8'));
  
  return rawData.map(row => ({
    ...row,
    amount: row.amount as SampleDataRow['amount'],
    date: new Date(row.date),
    timeframe: {
      start: new Date(row.timeframe.start),
      end: new Date(row.timeframe.end),
    },
  }));
}
