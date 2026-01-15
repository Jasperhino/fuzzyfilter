import z from "zod";

export const ProcessingType = {
  BIOCHAR: 'biochar',
  BIOMASS: 'biomass',
  PYROLYSIS: 'pyrolysis',
} as const;

export type ProcessingType = typeof ProcessingType[keyof typeof ProcessingType];

export const ProcessingTypeSchema = z.enum(ProcessingType);

export const AmountSchema = z.object({
  value: z.number().int().positive().min(1).max(1000),
  unit: z.enum(['kg', 't']),
});
export type Amount = z.infer<typeof AmountSchema>;

export const CountSchema = z.number().int().positive().min(1).max(10000);
export type Count = z.infer<typeof CountSchema>;

export const DateSchema = z.date();
export type Date = z.infer<typeof DateSchema>;

export const TimeframeSchema = z.object({
  start: DateSchema,
  end: DateSchema,
}).refine((data) => data.start < data.end, {
  message: "Start date must be before end date",
  path: ["end"],
});
export type Timeframe = z.infer<typeof TimeframeSchema>;

export const SampleDataSchema = z.array(
  z.object({
    id: z.uuidv4(),
    created: DateSchema,
    count: CountSchema,
    comment: z.string(),
    processing_type: ProcessingTypeSchema,
    amount: AmountSchema,
    timeframe: TimeframeSchema,
  })
);
export type SampleData = z.infer<typeof SampleDataSchema>;


// Material Container schemas for contents field
export const MaterialTypeSchema = z.enum(['biochar', 'water', 'ite', 'ite2']);
export type MaterialType = z.infer<typeof MaterialTypeSchema>;

export const MaterialContainerSchema = z.object({
  materialName: MaterialTypeSchema,
  weightInKg: z.number(),
});
export type MaterialContainer = z.infer<typeof MaterialContainerSchema>;

export const ContentsSchema = z.array(MaterialContainerSchema);
export type Contents = z.infer<typeof ContentsSchema>;

export const PercentageSchema = z.number().min(0).max(100);
export type Percentage = z.infer<typeof PercentageSchema>;

export const ArgumentSchemas = {
  date: DateSchema,
  count: CountSchema,
  amount: AmountSchema,
  processing_type: ProcessingTypeSchema,
  timeframe: TimeframeSchema,
  contents: ContentsSchema,
  percentage: PercentageSchema,
  materialType: MaterialTypeSchema,
} as const;

export type SampleDataArgumentType = keyof typeof ArgumentSchemas;

export const ArgumentSchemaKeys = Object.keys(ArgumentSchemas).reduce(
  (acc, k) => ({ ...acc, [k]: k }),
  {} as { [K in SampleDataArgumentType]: K }
);