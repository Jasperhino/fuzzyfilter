import z from "zod";

export const ProcessingType = {
  BIOCHAR: 'biochar',
  BIOMASS: 'biomass',
  PYROLYSIS: 'pyrolysis',
} as const;
export type ProcessingType = typeof ProcessingType[keyof typeof ProcessingType];
export const ProcessingTypeSchema = z.enum(ProcessingType);

export const MaterialTypeI18nKeys = {
  BIOCHAR: 'materialTypes.biochar',
  WATER: 'materialTypes.water',
  ASH: 'materialTypes.ash',
  COMPOST: 'materialTypes.compost',
  WOOD_CHIPS: 'materialTypes.wood_chips',
} as const;
export type MaterialTypeI18nKey = typeof MaterialTypeI18nKeys[keyof typeof MaterialTypeI18nKeys];
export const MaterialTypeSchema = z.enum(Object.keys(MaterialTypeI18nKeys));
export type MaterialType = z.infer<typeof MaterialTypeSchema>;


export const AmountSchema = z.object({
  value: z.number().int().positive().min(1).max(1000),
  unit: z.enum(['kg', 't']),
});
export type Amount = z.infer<typeof AmountSchema>;

export const CountSchema = z.number().int().positive().min(1).max(10000);
export type Count = z.infer<typeof CountSchema>;

export const DateSchema = z.date();
export type DateType = z.infer<typeof DateSchema>;

export const TimeframeSchema = z.object({
  start: DateSchema,
  end: DateSchema,
}).refine((data) => data.start < data.end, {
  message: "Start date must be before end date",
  path: ["end"],
});
export type Timeframe = z.infer<typeof TimeframeSchema>;

export const MaterialContainerSchema = z.object({
  materialName: MaterialTypeSchema,
  weightInKg: z.number().int().positive().min(1).max(10000),
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

export type PlaygroundArgumentType = keyof typeof ArgumentSchemas;

export const ArgumentSchemaKeys = Object.keys(ArgumentSchemas).reduce(
  (acc, k) => ({ ...acc, [k]: k }),
  {} as { [K in PlaygroundArgumentType]: K }
);

/**
 * Sample data row interface for the playground dataset
 */
export interface PlaygroundDataRow {
  id: string;
  processing_type: ProcessingType;
  date: Date;
  count: number;
  amount: Amount;
  timeframe: Timeframe;
  contents: MaterialContainer[];
}
