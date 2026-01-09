/**
 * Amount - Example Complex Domain Type
 *
 * Demonstrates how to implement a custom FuzzyFilterable type that combines
 * multiple fields (value and unit) into a single filterable entity.
 *
 * This example uses weight units (kg, t) to show how domain-specific
 * types can be integrated with FuzzyFilter.
 *
 * @module @fuzzyfilter/sample-data/amount
 */

import type {
  FuzzyFilterable,
  FuzzyFilterableStatic,
} from "@jasperhino/fuzzyfilter";

/**
 * Supported weight units for Amount values.
 */
export const WEIGHT_UNITS = ["kg", "t"] as const;

/**
 * Type for weight units.
 */
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/**
 * Amount represents a weight value with a unit (kg or tonnes).
 *
 * This is an example of a complex domain type that implements
 * the FuzzyFilterable interface for use with FuzzyFilter.
 *
 * @example
 * ```typescript
 * const weight = new Amount(150, "kg");
 * console.log(weight.format()); // "150 kg"
 *
 * const parsed = Amount.parse("2.5 t");
 * console.log(parsed?.format()); // "2.5 t"
 * console.log(parsed?.toKg()); // 2500
 * ```
 */
export class Amount implements FuzzyFilterable<Amount> {
  /**
   * Creates a new Amount instance.
   *
   * @param value - The numeric value
   * @param unit - The weight unit ("kg" or "t")
   */
  constructor(
    public readonly value: number,
    public readonly unit: WeightUnit
  ) {}

  /**
   * Convert this amount to kilograms for comparison.
   *
   * @returns Value in kilograms
   */
  toKg(): number {
    return this.unit === "t" ? this.value * 1000 : this.value;
  }

  /**
   * Format this amount for display in suggestions.
   *
   * @returns Formatted string like "150 kg" or "2.5 t"
   */
  format(): string {
    return `${this.value.toLocaleString()} ${this.unit}`;
  }

  /**
   * Compare this amount to another for range operators.
   *
   * Converts both amounts to kg for accurate comparison.
   *
   * @param other - The amount to compare against
   * @returns -1 if less, 0 if equal, 1 if greater
   */
  compare(other: Amount): number {
    const thisKg = this.toKg();
    const otherKg = other.toKg();
    if (thisKg < otherKg) return -1;
    if (thisKg > otherKg) return 1;
    return 0;
  }

  /**
   * Convert to a plain object for JSON serialization.
   *
   * @returns Plain object representation
   */
  toJSON(): { value: number; unit: WeightUnit } {
    return { value: this.value, unit: this.unit };
  }

  /**
   * Create an Amount from a plain object.
   *
   * @param obj - Plain object with value and unit properties
   * @returns Amount instance or null if invalid
   */
  static fromJSON(obj: unknown): Amount | null {
    if (
      typeof obj === "object" &&
      obj !== null &&
      "value" in obj &&
      "unit" in obj &&
      typeof (obj as { value: unknown }).value === "number" &&
      typeof (obj as { unit: unknown }).unit === "string" &&
      WEIGHT_UNITS.includes((obj as { unit: string }).unit as WeightUnit)
    ) {
      return new Amount(
        (obj as { value: number }).value,
        (obj as { unit: WeightUnit }).unit
      );
    }
    return null;
  }

  /**
   * Parse user input string into an Amount instance.
   *
   * Supports formats:
   * - "150 kg" - value followed by unit
   * - "2.5 t" - tonnes
   * - "150" - value only (defaults to kg)
   * - "1,500 kg" - formatted numbers
   *
   * @param input - User input string
   * @returns Amount instance or null if parsing fails
   */
  static parse(input: string): Amount | null {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;

    // Try to match "value unit" pattern
    const match = trimmed.match(/^([\d,.']+)\s*(kg|t)?$/);
    if (!match) return null;

    // Parse the numeric value, handling different locales
    const valueStr = match[1]?.replace(/[,'\s]/g, "");
    if (!valueStr) return null;
    const value = parseFloat(valueStr);
    if (isNaN(value)) return null;

    // Parse the unit, defaulting to kg
    const unitStr = (match[2] || "kg") as WeightUnit;

    return new Amount(value, unitStr);
  }
}

/**
 * Type assertion to ensure Amount implements FuzzyFilterableStatic.
 */
const _staticCheck: FuzzyFilterableStatic<Amount> = Amount;
void _staticCheck;

/**
 * Serialize an Amount to JSON-safe format.
 *
 * @param amount - The Amount to serialize
 * @returns Plain object representation
 */
export function serializeAmount(
  amount: Amount
): { value: number; unit: WeightUnit } {
  return amount.toJSON();
}

/**
 * Deserialize an Amount from JSON data.
 *
 * @param data - Plain object with value and unit properties
 * @returns Amount instance or null if invalid
 */
export function deserializeAmount(data: unknown): Amount | null {
  return Amount.fromJSON(data);
}
