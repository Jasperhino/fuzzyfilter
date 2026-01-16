import { describe, test, expect } from "bun:test";
import { createUnitRegistry } from "./registry";
import type { UnitDefinition } from "./types";

// Test unit definitions
const testUnits: UnitDefinition[] = [
  { id: "kg", dimension: "mass", toBase: 1, i18nKey: "units.mass.kg" },
  { id: "g", dimension: "mass", toBase: 0.001, i18nKey: "units.mass.g" },
  { id: "t", dimension: "mass", toBase: 1000, i18nKey: "units.mass.t" },
  { id: "lb", dimension: "mass", toBase: 0.453592, i18nKey: "units.mass.lb" },
  { id: "m", dimension: "length", toBase: 1, i18nKey: "units.length.m" },
  { id: "km", dimension: "length", toBase: 1000, i18nKey: "units.length.km" },
  { id: "usd", dimension: "currency", toBase: 1, i18nKey: "units.currency.usd" },
];

// Mock translations
const translations: Record<string, string[]> = {
  "units.mass.kg": ["kg", "KG", "kilogram", "kilograms", "kilo", "kilos"],
  "units.mass.g": ["g", "gram", "grams"],
  "units.mass.t": ["t", "ton", "tons", "tonne", "tonnes", "metric ton"],
  "units.mass.lb": ["lb", "lbs", "pound", "pounds"],
  "units.length.m": ["m", "meter", "meters", "metre", "metres"],
  "units.length.km": ["km", "kilometer", "kilometers", "kilometre"],
  "units.currency.usd": ["$", "USD", "dollar", "dollars", "US dollar"],
};

function getAliases(key: string): string[] {
  return translations[key] ?? [];
}

describe("createUnitRegistry", () => {
  const registry = createUnitRegistry({
    units: testUnits,
    getAliases,
  });

  describe("lookup", () => {
    test("finds unit by symbol (case-insensitive)", () => {
      expect(registry.lookup("kg")?.id).toBe("kg");
      expect(registry.lookup("KG")?.id).toBe("kg");
      expect(registry.lookup("Kg")?.id).toBe("kg");
    });

    test("finds unit by full name", () => {
      expect(registry.lookup("kilogram")?.id).toBe("kg");
      expect(registry.lookup("kilograms")?.id).toBe("kg");
      expect(registry.lookup("kilo")?.id).toBe("kg");
    });

    test("returns undefined for unknown unit", () => {
      expect(registry.lookup("xyz")).toBeUndefined();
      expect(registry.lookup("")).toBeUndefined();
    });

    test("finds different units correctly", () => {
      expect(registry.lookup("ton")?.id).toBe("t");
      expect(registry.lookup("pound")?.id).toBe("lb");
      expect(registry.lookup("meter")?.id).toBe("m");
    });
  });

  describe("search", () => {
    test("exact match scores highest", () => {
      const results = registry.search("kg");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.id).toBe("kg");
      expect(results[0].score).toBeGreaterThan(0.5);
    });

    test("fuzzy matches with missing letter", () => {
      // "kilogram" missing 'o' -> "kilgram" (score ~0.35)
      const results = registry.search("kilgram");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.id).toBe("kg");
    });

    test("fuzzy matches prefix", () => {
      // "kilog" - prefix of kilogram
      const results = registry.search("kilog");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.id).toBe("kg");
      expect(results[0].score).toBeGreaterThan(0.9);
    });

    test("fuzzy matches partial input", () => {
      const results = registry.search("kilo");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.id).toBe("kg");
    });

    test("filters by dimension", () => {
      const massResults = registry.search("", "mass");
      expect(massResults.every((r) => r.item.dimension === "mass")).toBe(true);
      expect(massResults.length).toBe(4); // kg, g, t, lb

      const lengthResults = registry.search("", "length");
      expect(lengthResults.every((r) => r.item.dimension === "length")).toBe(true);
      expect(lengthResults.length).toBe(2); // m, km
    });

    test("respects limit parameter", () => {
      const results = registry.search("", undefined, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    test("deduplicates results from multiple terms", () => {
      // 'kg' and 'kilogram' both map to the same unit
      const results = registry.search("k");
      const kgCount = results.filter((r) => r.item.id === "kg").length;
      expect(kgCount).toBeLessThanOrEqual(1);
    });

    test("empty query returns all units", () => {
      const results = registry.search("");
      expect(results.length).toBe(testUnits.length);
    });
  });

  describe("getUnitsForDimension", () => {
    test("returns units for mass dimension", () => {
      const massUnits = registry.getUnitsForDimension("mass");
      expect(massUnits.length).toBe(4);
      expect(massUnits.map((u) => u.id).sort()).toEqual(["g", "kg", "lb", "t"]);
    });

    test("returns units for length dimension", () => {
      const lengthUnits = registry.getUnitsForDimension("length");
      expect(lengthUnits.length).toBe(2);
      expect(lengthUnits.map((u) => u.id).sort()).toEqual(["km", "m"]);
    });

    test("returns empty array for unknown dimension", () => {
      const unknownUnits = registry.getUnitsForDimension("unknown");
      expect(unknownUnits).toEqual([]);
    });
  });

  describe("getUnitSearchTerms", () => {
    test("returns all search terms for a unit", () => {
      const kgUnit = registry.lookup("kg")!;
      const terms = registry.getUnitSearchTerms(kgUnit);
      expect(terms).toContain("kg");
      expect(terms).toContain("kilogram");
      expect(terms).toContain("kilos");
    });
  });

  describe("convert", () => {
    test("converts within same dimension", () => {
      const kg = registry.lookup("kg")!;
      const g = registry.lookup("g")!;
      const t = registry.lookup("t")!;

      // 1 kg = 1000 g
      expect(registry.convert(1, kg, g)).toBe(1000);

      // 1000 g = 1 kg
      expect(registry.convert(1000, g, kg)).toBe(1);

      // 1 t = 1000 kg
      expect(registry.convert(1, t, kg)).toBe(1000);

      // 2.5 kg = 2500 g
      expect(registry.convert(2.5, kg, g)).toBe(2500);
    });

    test("converts to pounds approximately", () => {
      const kg = registry.lookup("kg")!;
      const lb = registry.lookup("lb")!;

      // 1 kg ≈ 2.205 lb
      const result = registry.convert(1, kg, lb);
      expect(result).toBeCloseTo(2.205, 2);
    });

    test("returns null for different dimensions", () => {
      const kg = registry.lookup("kg")!;
      const m = registry.lookup("m")!;

      expect(registry.convert(1, kg, m)).toBeNull();
    });

    test("identity conversion returns same value", () => {
      const kg = registry.lookup("kg")!;
      expect(registry.convert(42, kg, kg)).toBe(42);
    });
  });

  describe("getAllUnits", () => {
    test("returns all registered units", () => {
      const allUnits = registry.getAllUnits();
      expect(allUnits.length).toBe(testUnits.length);
    });
  });

  describe("getDimensions", () => {
    test("returns all dimension names", () => {
      const dimensions = registry.getDimensions();
      expect(dimensions.sort()).toEqual(["currency", "length", "mass"]);
    });
  });
});
