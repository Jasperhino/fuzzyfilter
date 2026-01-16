//ts-worksheet

import z from 'zod';
import { zocker } from 'zocker';
import {
  FuzzyFilter,
  formatResponse,
} from "@jasperhino/fuzzyfilter";
import {
  ProcessingTypeSchema,
  DateSchema,
  CountSchema,
  AmountSchema,
  TimeframeSchema,
  PercentageSchema,
  MaterialTypeSchema,
  type Amount,
  type Timeframe,
  type MaterialContainer,
} from "./config/domain-models";
import { DateParser, TimeframeParser, AmountParser, CountParser, PercentageParser } from "./config/domain-parsers";


const NUM_ROWS = 100000;

const PlaygroundDataSchema = z.array(
  z.object({
    id: z.uuidv4(),
    processing_type: ProcessingTypeSchema,
    date: DateSchema,
    count: CountSchema,
    amount: AmountSchema,
    timeframe: TimeframeSchema,
    // Fixed: one water container and one biochar container
    contents: z.tuple([
      z.object({ materialName: z.literal('water'), weightInKg: z.number().int().positive().min(1).max(10000) }),
      z.object({ materialName: z.literal('biochar'), weightInKg: z.number().int().positive().min(1).max(10000) }),
    ])
  }));

type PlaygroundData = z.infer<typeof PlaygroundDataSchema>;

const sampleData = zocker(PlaygroundDataSchema.length(NUM_ROWS)).setSeed(42).generate();

const ff = new FuzzyFilter({
  parsers: {
    date: new DateParser(),
    timeframe: new TimeframeParser(),
    amount: new AmountParser(),
    count: new CountParser(),
    percentage: new PercentageParser(),
  },

  // Unit definitions for the universal number parser
  units: [
    // Mass units
    { id: 'kg', dimension: 'mass', toBase: 1, i18nKey: 'units.mass.kg' },
    { id: 't', dimension: 'mass', toBase: 1000, i18nKey: 'units.mass.t' },
    { id: 'g', dimension: 'mass', toBase: 0.001, i18nKey: 'units.mass.g' },
    { id: 'lb', dimension: 'mass', toBase: 0.453592, i18nKey: 'units.mass.lb' },
    // Percentage units
    { id: '%', dimension: 'percentage', toBase: 1, i18nKey: 'units.percentage.percent' },
  ],

  fields: {
    processing_type: {
      labelKey: 'columns.processing_type',
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
      operators: [
        {
          operatorId: 'overlaps',
          overloads: [{
            id: 'timeframe:overlaps:timeframe',
            i18nKey: 'operators.overlaps',
            argumentSchema: z.object({ start: DateSchema, end: DateSchema }),
            // Two ranges [A, B] and [C, D] overlap if A <= D && C <= B
            predicate: (operand: Timeframe, { start, end }) =>
              operand.start.getTime() <= end.getTime() &&
              start.getTime() <= operand.end.getTime(),
          }],
        },
        {
          operatorId: 'within',
          overloads: [{
            id: 'timeframe:within:timeframe',
            i18nKey: 'operators.within',
            argumentSchema: z.object({ start: DateSchema, end: DateSchema }),
            // Operand is fully contained within the argument range
            predicate: (operand: Timeframe, { start, end }) =>
              operand.start.getTime() >= start.getTime() &&
              operand.end.getTime() <= end.getTime(),
          }],
        },
        {
          operatorId: 'contains',
          overloads: [{
            id: 'timeframe:contains:timeframe',
            i18nKey: 'operators.timeframe.contains',
            argumentSchema: z.object({ start: DateSchema, end: DateSchema }),
            // Operand fully contains the argument range
            predicate: (operand: Timeframe, { start, end }) =>
              operand.start.getTime() <= start.getTime() &&
              operand.end.getTime() >= end.getTime(),
          }],
        },
      ],
    },

    contents: {
      labelKey: 'columns.contents',
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
      units: {
        mass: {
          kg: ['kg', 'KG', 'kilogram', 'kilograms', 'kilo'],
          t: ['t', 'T', 'ton', 'tons', 'tonne', 'tonnes'],
          g: ['g', 'G', 'gram', 'grams'],
          lb: ['lb', 'lbs', 'pound', 'pounds'],
        },
        percentage: {
          percent: ['%', 'percent', 'pct', 'percentage'],
        },
      },
      values: {
        materialTypes: ['water', 'biochar', 'ash', 'compost', 'wood_chips'],
      },
    },
    en: {
      columns: {
        processing_type: ['Processing Type', 'Type'],
        date: ['Date', 'Created'],
        count: ['Count', 'Quantity'],
        amount: ['Amount', 'Weight'],
        timeframe: ['Timeframe', 'Period', 'Time Range'],
        contents: ['Content', 'Composition', 'Materials'],
      },
      operators: {
        eq: ['equals', 'is', 'equal to'],
        gt: ['greater than', 'more than', 'over', 'above'],
        lt: ['less than', 'under', 'below'],
        contains: ['contains', 'has', 'includes'],
        overlaps: ['overlaps', 'overlapping', 'intersects'],
        within: ['within', 'inside', 'during'],
        timeframe: {
          contains: ['contains', 'spans', 'covers'],
        },
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
//ff.indexData(sampleData);

// Test multiple queries
const queries = [
  "20% wa",                    // percentage + partial value
  "water > 50",                // value + operator + number
  "biocharr",                  // just a value (typo)
  "contents contains",         // field + operator
  "100 kg bio",                // amount + partial value
  // Timeframe queries
  "last week - yesterday",     // timeframe range with natural language
  "today - 5 minutes ago",     // short timeframe with relative times
  "timeframe overlaps yesterday - today", // timeframe overlaps month
  "period within last month - last friday",   // timeframe within range
];

for (const q of queries) {
  const result = await ff.suggest(q);
  console.log("\n" + formatResponse(result));
}