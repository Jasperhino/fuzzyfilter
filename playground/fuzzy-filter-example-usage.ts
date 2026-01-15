//ts-worksheet
import z from 'zod';
import { zocker } from 'zocker';
import { FuzzyFilter } from "@jasperhino/fuzzyfilter";
import {
  ProcessingTypeSchema,
  DateSchema,
  CountSchema,
  AmountSchema,
  TimeframeSchema,
  ContentsSchema,
  PercentageSchema,
  MaterialTypeSchema,
  MaterialContainerSchema,
  type Amount,
  type Timeframe,
  type MaterialContainer,
} from "./config/domain-models";
import { DateParser, TimeframeParser, AmountParser, CountParser } from "./config/domain-parsers";

/**
 * Schema for sample data matching the FuzzyFilter field configuration
 * Uses constrained values for realistic data generation
 */
const PlaygroundMaterialContainerSchema = z.object({
  materialName: MaterialTypeSchema,
  weightInKg: z.number().min(10).max(500).int(),
});

const PlaygroundDataSchema = z.object({
  id: z.string().uuid(),
  processing_type: ProcessingTypeSchema,
  date: DateSchema,
  count: z.number().int().min(1).max(100),
  amount: z.object({
    value: z.number().int().min(10).max(500),
    unit: z.enum(['kg', 't']),
  }),
  timeframe: TimeframeSchema,
  contents: z.array(PlaygroundMaterialContainerSchema).min(1).max(4),
});
type PlaygroundData = z.infer<typeof PlaygroundDataSchema>;

/**
 * Generate sample data using zocker
 */
const NUM_ROWS = 50;
const sampleData = Array.from({ length: NUM_ROWS }, (_, i) =>
  zocker(PlaygroundDataSchema).setSeed(42 + i).generate()
);

const ff = new FuzzyFilter({
  parsers: {
    date: new DateParser(),
    timeframe: new TimeframeParser(),
    amount: new AmountParser(),
    count: new CountParser(),
  },

  fields: {
    processing_type: {
      labelKey: 'columns.processing_type',
      operandSchema: ProcessingTypeSchema,
      operators: [
        {
          operatorId: 'eq',
          overloads: [{
            id: 'processing_type:eq:processing_type',
            i18nKey: 'operators.eq',
            argumentSchema: z.object({ value: ProcessingTypeSchema }),
            predicate: (operand, { value }) => operand === value,
          }],
        },
      ],
    },

    date: {
      labelKey: 'columns.date',
      operandSchema: DateSchema,
      operators: [
        {
          operatorId: 'eq',
          overloads: [{
            id: 'date:eq:date',
            i18nKey: 'operators.eq',
            argumentSchema: z.object({ value: DateSchema }),
            predicate: (operand, { value }) => operand.getTime() === value.getTime(),
          }],
        },
        {
          operatorId: 'gt',
          overloads: [{
            id: 'date:gt:date',
            i18nKey: 'operators.date.after',
            argumentSchema: z.object({ value: DateSchema }),
            predicate: (operand, { value }) => operand.getTime() > value.getTime(),
          }],
        },
        {
          operatorId: 'lt',
          overloads: [{
            id: 'date:lt:date',
            i18nKey: 'operators.date.before',
            argumentSchema: z.object({ value: DateSchema }),
            predicate: (operand, { value }) => operand.getTime() < value.getTime(),
          }],
        },
      ],
    },

    count: {
      labelKey: 'columns.count',
      operandSchema: CountSchema,
      operators: [
        {
          operatorId: 'eq',
          overloads: [{
            id: 'count:eq:count',
            i18nKey: 'operators.eq',
            argumentSchema: z.object({ value: CountSchema }),
            predicate: (operand, { value }) => operand === value,
          }],
        },
        {
          operatorId: 'gt',
          overloads: [{
            id: 'count:gt:count',
            i18nKey: 'operators.gt',
            argumentSchema: z.object({ value: CountSchema }),
            predicate: (operand, { value }) => operand > value,
          }],
        },
        {
          operatorId: 'lt',
          overloads: [{
            id: 'count:lt:count',
            i18nKey: 'operators.lt',
            argumentSchema: z.object({ value: CountSchema }),
            predicate: (operand, { value }) => operand < value,
          }],
        },
      ],
    },

    amount: {
      labelKey: 'columns.amount',
      operandSchema: AmountSchema,
      operators: [
        {
          operatorId: 'eq',
          overloads: [{
            id: 'amount:eq:amount',
            i18nKey: 'operators.eq',
            argumentSchema: z.object({ value: AmountSchema }),
            predicate: (operand: Amount, { value }) =>
              operand.value === value.value && operand.unit === value.unit,
          }],
        },
        {
          operatorId: 'gt',
          overloads: [{
            id: 'amount:gt:amount',
            i18nKey: 'operators.amount.heavier',
            argumentSchema: z.object({ value: AmountSchema }),
            predicate: (operand: Amount, { value }) =>
              operand.value > value.value && operand.unit === value.unit,
          }],
        },
        {
          operatorId: 'lt',
          overloads: [{
            id: 'amount:lt:amount',
            i18nKey: 'operators.amount.lighter',
            argumentSchema: z.object({ value: AmountSchema }),
            predicate: (operand: Amount, { value }) =>
              operand.value < value.value && operand.unit === value.unit,
          }],
        },
      ],
    },

    timeframe: {
      labelKey: 'columns.timeframe',
      operandSchema: TimeframeSchema,
      operators: [
        {
          operatorId: 'overlaps',
          overloads: [{
            id: 'timeframe:overlaps:timeframe',
            i18nKey: 'operators.overlaps',
            argumentSchema: z.object({ start: DateSchema, end: DateSchema }),
            predicate: (operand: Timeframe, { start, end }) =>
              operand.start.getTime() >= start.getTime() &&
              operand.end.getTime() <= end.getTime(),
          }],
        },
      ],
    },

    contents: {
      labelKey: 'columns.contents',
      operandSchema: ContentsSchema,
      operators: [
        {
          operatorId: 'contains',
          overloads: [{
            id: 'contents:contains:materialTypes[]',
            i18nKey: 'operators.contains',
            argumentSchema: z.object({ materialTypes: z.array(MaterialTypeSchema).min(1) }),
            predicate: (containers: MaterialContainer[], { materialTypes }) =>
              materialTypes.every((mt: z.infer<typeof MaterialTypeSchema>) =>
                containers.some(c => c.materialName === mt)
              ),
          }],
        },
        {
          operatorId: 'eq',
          overloads: [{
            id: 'contents:eq:amount+materialTypes[]',
            i18nKey: 'operators.contents.eq',
            argumentSchema: z.object({
              amount: AmountSchema,
              materialTypes: z.array(MaterialTypeSchema).min(1),
            }),
            predicate: (containers: MaterialContainer[], { amount, materialTypes }) => {
              const weight = containers
                .filter(c => materialTypes.includes(c.materialName))
                .reduce((sum, c) => sum + c.weightInKg, 0);
              const compareWeight = amount.unit === 't' ? amount.value * 1000 : amount.value;
              return weight === compareWeight;
            },
          }],
        },
        {
          operatorId: 'gt',
          overloads: [
            {
              id: 'contents:gt:percentage+materialTypes[]',
              i18nKey: 'operators.contents.gt.percentage',
              argumentSchema: z.object({
                percentage: PercentageSchema,
                materialTypes: z.array(MaterialTypeSchema).min(1),
              }),
              predicate: (containers: MaterialContainer[], { percentage, materialTypes }) => {
                const totalWeight = containers.reduce((sum, c) => sum + c.weightInKg, 0);
                if (totalWeight === 0) return false;
                const materialWeight = containers
                  .filter(c => materialTypes.includes(c.materialName))
                  .reduce((sum, c) => sum + c.weightInKg, 0);
                return (materialWeight / totalWeight) * 100 > percentage;
              },
              priority: 10,
            },
            {
              id: 'contents:gt:amount+materialTypes[]',
              i18nKey: 'operators.contents.gt.amount',
              argumentSchema: z.object({
                amount: AmountSchema,
                materialTypes: z.array(MaterialTypeSchema).min(1),
              }),
              predicate: (containers: MaterialContainer[], { amount, materialTypes }) => {
                const materialWeight = containers
                  .filter(c => materialTypes.includes(c.materialName))
                  .reduce((sum, c) => sum + c.weightInKg, 0);
                const compareWeight = amount.unit === 't' ? amount.value * 1000 : amount.value;
                return materialWeight > compareWeight;
              },
              priority: 5,
            },
          ],
        },
        {
          operatorId: 'lt',
          overloads: [
            {
              id: 'contents:lt:percentage+materialTypes[]',
              i18nKey: 'operators.contents.lt.percentage',
              argumentSchema: z.object({
                percentage: PercentageSchema,
                materialTypes: z.array(MaterialTypeSchema).min(1),
              }),
              predicate: (containers: MaterialContainer[], { percentage, materialTypes }) => {
                const totalWeight = containers.reduce((sum, c) => sum + c.weightInKg, 0);
                if (totalWeight === 0) return false;
                const materialWeight = containers
                  .filter(c => materialTypes.includes(c.materialName))
                  .reduce((sum, c) => sum + c.weightInKg, 0);
                return (materialWeight / totalWeight) * 100 < percentage;
              },
              priority: 10,
            },
            {
              id: 'contents:lt:amount+materialTypes[]',
              i18nKey: 'operators.contents.lt.amount',
              argumentSchema: z.object({
                amount: AmountSchema,
                materialTypes: z.array(MaterialTypeSchema).min(1),
              }),
              predicate: (containers: MaterialContainer[], { amount, materialTypes }) => {
                const materialWeight = containers
                  .filter(c => materialTypes.includes(c.materialName))
                  .reduce((sum, c) => sum + c.weightInKg, 0);
                const compareWeight = amount.unit === 't' ? amount.value * 1000 : amount.value;
                return materialWeight < compareWeight;
              },
              priority: 5,
            },
          ],
        },
      ],
    },
  },

  translations: {
    common: {
      operators: {
        gt: ['>'],
        lt: ['<'],
        eq: ['=', '=='],
        contains: ['∋'],
        overlaps: ['~='],
      },
    },
    en: {
      columns: {
        processing_type: ['Processing Type', 'Type'],
        date: ['Date', 'Created'],
        count: ['Count', 'Quantity'],
        amount: ['Amount', 'Weight'],
        timeframe: ['Timeframe', 'Period'],
        contents: ['Content', 'Composition', 'Materials'],
      },
      operators: {
        eq: ['equals', 'is', 'equal to'],
        gt: ['greater than', 'more than', 'over', 'above'],
        lt: ['less than', 'under', 'below'],
        contains: ['contains', 'has', 'includes'],
        overlaps: ['overlaps', 'between', 'in range'],
        date: {
          after: ['after', 'later than', 'since'],
          before: ['before', 'earlier than', 'until'],
        },
        amount: {
          heavier: ['heavier than', 'weighs more than'],
          lighter: ['lighter than', 'weighs less than'],
        },
        contents: {
          eq: ['exactly', 'precisely'],
          gt: {
            percentage: ['more than', 'over', '> %'],
            amount: ['greater than', 'heavier than', '>'],
          },
          lt: {
            percentage: ['less than', 'under', '< %'],
            amount: ['lighter than', 'less than', '<'],
          },
        },
      },
    },
    de: {
      columns: {
        processing_type: ['Verarbeitungstyp', 'Typ'],
        contents: ['Inhalt', 'Zusammensetzung'],
      },
      operators: {
        gt: ['größer als', 'mehr als', 'über'],
        lt: ['kleiner als', 'weniger als', 'unter'],
        overlaps: ['überschneidet', 'zwischen'],
        contents: {
          gt: {
            percentage: ['mehr als', 'über'],
            amount: ['schwerer als', 'größer als'],
          },
          lt: {
            percentage: ['weniger als', 'unter'],
            amount: ['leichter als', 'kleiner als'],
          },
        },
      },
    },
  },
});

// Index the generated sample data
ff.indexData(sampleData);

// Show index stats
console.log('\n📊 Index Stats:', ff.getIndexStats());

// Show a few sample rows to understand the data
console.log('\n📋 Sample Data (first 3 rows):');
sampleData.slice(0, 3).forEach((row, i) => {
  console.log(`  Row ${i + 1}:`, {
    processing_type: row.processing_type,
    count: row.count,
    contents: row.contents.map(c => `${c.materialName}: ${c.weightInKg}kg`),
  });
});

// Test various queries
const queries = [
  'biochar',
  'processing',
  'count > 100',
  'biomass',
];

console.log('\n🔍 Testing Suggestions:\n');
for (const query of queries) {
  const result = await ff.suggest(query);
  console.log(`Query: "${query}"`);
  console.log(`  Suggestions (${result.suggestions.length}):`);
  result.suggestions.slice(0, 5).forEach(s => {
    console.log(`    - ${s.label} (score: ${s.score.toFixed(2)}, category: ${(s as any).category})`);
  });
  console.log();
}
