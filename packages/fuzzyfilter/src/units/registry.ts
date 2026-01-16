/**
 * Unit Registry Implementation
 *
 * Provides fuzzy search over units with i18n-resolved symbols/names.
 *
 * @module fuzzyfilter/units/registry
 */

import type { Match } from "../types/core";
import { createTrie, type Trie } from "../trie";
import type { UnitDefinition, UnitRegistry, UnitRegistryConfig } from "./types";

/**
 * Create a unit registry with fuzzy search support.
 *
 * @example
 * ```typescript
 * const registry = createUnitRegistry({
 *   units: [
 *     { id: 'kg', dimension: 'mass', toBase: 1, i18nKey: 'units.mass.kg' },
 *     { id: 't', dimension: 'mass', toBase: 1000, i18nKey: 'units.mass.t' },
 *   ],
 *   getAliases: (key) => translations[key] ?? [],
 * });
 *
 * const matches = registry.search('kilgoram'); // fuzzy matches 'kilogram'
 * ```
 */
export function createUnitRegistry(config: UnitRegistryConfig): UnitRegistry {
  const { units, getAliases } = config;

  // Index units by ID
  const unitsById = new Map<string, UnitDefinition>();

  // Index units by dimension
  const unitsByDimension = new Map<string, UnitDefinition[]>();

  // Trie for fuzzy search
  const trie: Trie<UnitDefinition> = createTrie();

  // Map from lowercase search term to unit
  const termToUnit = new Map<string, UnitDefinition>();

  // Cache search terms per unit
  const searchTermsCache = new Map<string, string[]>();

  // Initialize indexes
  for (const unit of units) {
    unitsById.set(unit.id, unit);

    // Group by dimension
    const dimUnits = unitsByDimension.get(unit.dimension) ?? [];
    dimUnits.push(unit);
    unitsByDimension.set(unit.dimension, dimUnits);

    // Get all search terms from i18n
    const terms = getAliases(unit.i18nKey);
    searchTermsCache.set(unit.id, terms);

    // Add each term to the trie and lookup map
    for (const term of terms) {
      const normalized = term.toLowerCase();
      trie.insert(normalized, unit);
      termToUnit.set(normalized, unit);
    }
  }

  function lookup(text: string): UnitDefinition | undefined {
    return termToUnit.get(text.toLowerCase());
  }

  function search(
    query: string,
    dimension?: string,
    limit = 10
  ): Match<UnitDefinition>[] {
    if (!query.trim()) {
      // Return all units (optionally filtered by dimension)
      let results = units;
      if (dimension) {
        results = unitsByDimension.get(dimension) ?? [];
      }
      return results.slice(0, limit).map((unit) => ({
        item: unit,
        score: 0,
        indexes: undefined,
      }));
    }

    // Fuzzy search via trie
    const results = trie.fuzzySearch(query, limit * 2); // Get extra to allow for dimension filtering

    // Filter by dimension if specified, dedupe by unit ID
    const seen = new Set<string>();
    const filtered: Match<UnitDefinition>[] = [];

    for (const result of results) {
      const unit = result.value;

      // Skip if wrong dimension
      if (dimension && unit.dimension !== dimension) {
        continue;
      }

      // Skip duplicates (same unit matched via different terms)
      if (seen.has(unit.id)) {
        continue;
      }
      seen.add(unit.id);

      filtered.push({
        item: unit,
        score: result.score,
        indexes: result.indexes ? Array.from(result.indexes) : undefined,
      });

      if (filtered.length >= limit) {
        break;
      }
    }

    return filtered;
  }

  function getUnitsForDimension(dimension: string): UnitDefinition[] {
    return unitsByDimension.get(dimension) ?? [];
  }

  function getUnitSearchTerms(unit: UnitDefinition): string[] {
    return searchTermsCache.get(unit.id) ?? [];
  }

  function convert(
    value: number,
    from: UnitDefinition,
    to: UnitDefinition
  ): number | null {
    // Can only convert within same dimension
    if (from.dimension !== to.dimension) {
      return null;
    }

    // Convert to base unit, then to target unit
    const baseValue = value * from.toBase;
    return baseValue / to.toBase;
  }

  function getAllUnits(): UnitDefinition[] {
    return [...units];
  }

  function getDimensions(): string[] {
    return [...unitsByDimension.keys()];
  }

  return {
    lookup,
    search,
    getUnitsForDimension,
    getUnitSearchTerms,
    convert,
    getAllUnits,
    getDimensions,
  };
}
