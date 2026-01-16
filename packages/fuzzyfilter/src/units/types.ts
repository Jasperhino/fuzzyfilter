/**
 * Unit System Types
 *
 * Defines units for value parsing with fuzzy matching support.
 * Units use i18n keys to resolve all symbols and names.
 *
 * @module fuzzyfilter/units/types
 */

import type { Match } from "../types/core";

/**
 * Definition of a unit for value parsing.
 *
 * @example
 * ```typescript
 * const kilogram: UnitDefinition = {
 *   id: 'kg',
 *   dimension: 'mass',
 *   toBase: 1,
 *   i18nKey: 'units.mass.kg',
 * };
 * ```
 */
export interface UnitDefinition {
  /**
   * Unique identifier for this unit.
   * Should be the canonical abbreviation.
   * @example 'kg', 'usd', 'm'
   */
  id: string;

  /**
   * Dimension/category this unit belongs to.
   * Used for filtering valid units per field.
   * @example 'mass', 'currency', 'length', 'time'
   */
  dimension: string;

  /**
   * Conversion factor to the base unit of this dimension.
   * The base unit has toBase = 1.
   *
   * @example
   * For mass with kg as base:
   * - kg: toBase = 1
   * - g: toBase = 0.001
   * - t: toBase = 1000
   * - lb: toBase = 0.453592
   */
  toBase: number;

  /**
   * i18n key for resolving symbols and names.
   * The translation should return an array of strings
   * containing all valid representations.
   *
   * @example
   * i18nKey: 'units.mass.kg'
   * Translation: ['kg', 'KG', 'kilogram', 'kilograms', 'kilo']
   */
  i18nKey: string;
}

/**
 * Configuration for creating a UnitRegistry.
 */
export interface UnitRegistryConfig {
  /**
   * All unit definitions.
   */
  units: UnitDefinition[];

  /**
   * Function to resolve i18n key to array of strings.
   * Should return all symbols/names for the unit.
   */
  getAliases: (i18nKey: string) => string[];
}

/**
 * Registry for units with fuzzy search support.
 */
export interface UnitRegistry {
  /**
   * Look up a unit by exact text match (case-insensitive).
   * Checks all symbols and names from i18n.
   */
  lookup(text: string): UnitDefinition | undefined;

  /**
   * Fuzzy search for units matching a query.
   *
   * @param query - Search query (e.g., "kilgoram")
   * @param dimension - Optional dimension filter (e.g., "mass")
   * @param limit - Max results (default: 10)
   * @returns Matched units with scores
   */
  search(query: string, dimension?: string, limit?: number): Match<UnitDefinition>[];

  /**
   * Get all units for a dimension.
   */
  getUnitsForDimension(dimension: string): UnitDefinition[];

  /**
   * Get all searchable terms for a unit (from i18n).
   */
  getUnitSearchTerms(unit: UnitDefinition): string[];

  /**
   * Convert a value between units.
   * Returns null if units are incompatible (different dimensions).
   *
   * @example
   * convert(1000, gramUnit, kilogramUnit) // returns 1
   * convert(1, kilogramUnit, poundUnit)   // returns ~2.205
   */
  convert(value: number, from: UnitDefinition, to: UnitDefinition): number | null;

  /**
   * Get all registered units.
   */
  getAllUnits(): UnitDefinition[];

  /**
   * Get all dimension names.
   */
  getDimensions(): string[];
}
