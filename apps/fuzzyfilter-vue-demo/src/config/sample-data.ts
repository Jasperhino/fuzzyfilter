/**
 * Sample data for the playground DataModel
 * 
 * This generates sample data for the industrial processing demo.
 * Uses a seeded random for reproducibility.
 */
import type { PlaygroundDataRow, ProcessingType, MaterialContainer } from "./domain-models";

// Simple seeded random number generator for reproducibility
function createSeededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const random = createSeededRandom(42);

function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(random() * arr.length)]!;
}

function randomDate(start: Date, end: Date): Date {
  const startTime = start.getTime();
  const endTime = end.getTime();
  return new Date(startTime + random() * (endTime - startTime));
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const PROCESSING_TYPES: ProcessingType[] = ['biochar', 'biomass', 'pyrolysis'];
const MATERIAL_TYPES = ['WATER', 'BIOCHAR', 'ASH', 'COMPOST', 'WOOD_CHIPS'] as const;
const UNITS = ['kg', 't'] as const;

function generateRow(index: number): PlaygroundDataRow {
  const startDate = randomDate(new Date('2023-01-01'), new Date('2024-12-31'));
  const endDate = new Date(startDate.getTime() + randomInt(1, 30) * 24 * 60 * 60 * 1000);
  
  // Generate random materials for contents (always include water and biochar for consistency)
  const contents: MaterialContainer[] = [
    { materialName: 'WATER', weightInKg: randomInt(10, 500) },
    { materialName: 'BIOCHAR', weightInKg: randomInt(5, 200) },
  ];
  
  // Randomly add more materials
  if (random() > 0.5) {
    contents.push({ materialName: 'ASH', weightInKg: randomInt(1, 50) });
  }
  if (random() > 0.7) {
    contents.push({ materialName: 'COMPOST', weightInKg: randomInt(10, 100) });
  }
  if (random() > 0.8) {
    contents.push({ materialName: 'WOOD_CHIPS', weightInKg: randomInt(20, 300) });
  }

  return {
    id: generateUUID(),
    processing_type: randomChoice(PROCESSING_TYPES),
    date: randomDate(new Date('2023-01-01'), new Date('2024-12-31')),
    count: randomInt(1, 100),
    amount: {
      value: randomInt(10, 1000),
      unit: randomChoice(UNITS),
    },
    timeframe: {
      start: startDate,
      end: endDate,
    },
    contents,
  };
}

/**
 * Generate a dataset of playground data rows
 */
export function generatePlaygroundData(count: number): PlaygroundDataRow[] {
  const data: PlaygroundDataRow[] = [];
  for (let i = 0; i < count; i++) {
    data.push(generateRow(i));
  }
  return data;
}

// Pre-generate large dataset (10,000 rows for good performance demo)
export const PLAYGROUND_DATASET: PlaygroundDataRow[] = generatePlaygroundData(10000);

/**
 * Generate a single random row (for adding new rows)
 */
export function generateSingleRow(): PlaygroundDataRow {
  const row = generateRow(Date.now());
  // Set the date field to current timestamp
  row.date = new Date();
  return row;
}
