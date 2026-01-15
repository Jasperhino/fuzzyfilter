import { zocker } from 'zocker';
import { writeFileSync } from 'fs';

import { SampleDataSchema } from './user-configured/domain-types';

const NUM_EXAMPLES = 100;
export const sampleData = zocker(SampleDataSchema)
  .setSeed(42)
  .array({ min: NUM_EXAMPLES, max: NUM_EXAMPLES })
  .generate();

writeFileSync('sample-data.json', JSON.stringify(sampleData, null, 2));
console.log(`Generated ${sampleData.length} rows to sample-data.json`);
