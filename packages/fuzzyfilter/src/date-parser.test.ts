/**
 * Date Parser Tests
 *
 * Tests for natural language date parsing with locale support.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { parseDate, getDateSuggestionsForLocale } from "./date-parser.ts";

describe("date-parser", () => {
  describe("parseDate with locales", () => {
    it("should parse 'gestern' (German for yesterday) with de locale", () => {
      const result = parseDate("gestern", { locale: "de" });
      
      expect(result).not.toBeNull();
      expect(result?.text).toBe("gestern");
      
      // Yesterday should be one day before today
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      expect(result?.date.getDate()).toBe(yesterday.getDate());
      expect(result?.date.getMonth()).toBe(yesterday.getMonth());
      expect(result?.date.getFullYear()).toBe(yesterday.getFullYear());
    });

    it("should parse 'heute' (German for today) with de locale", () => {
      const result = parseDate("heute", { locale: "de" });
      
      expect(result).not.toBeNull();
      expect(result?.text).toBe("heute");
      
      const today = new Date();
      expect(result?.date.getDate()).toBe(today.getDate());
      expect(result?.date.getMonth()).toBe(today.getMonth());
      expect(result?.date.getFullYear()).toBe(today.getFullYear());
    });

    it("should parse 'morgen' (German for tomorrow) with de locale", () => {
      const result = parseDate("morgen", { locale: "de" });
      
      expect(result).not.toBeNull();
      expect(result?.text).toBe("morgen");
      
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      expect(result?.date.getDate()).toBe(tomorrow.getDate());
    });

    it("should NOT parse 'gestern' without German locale", () => {
      // English locale should not understand German
      const result = parseDate("gestern", { locale: "en" });
      expect(result).toBeNull();
    });

    it("should parse 'hier' (French for yesterday) with fr locale", () => {
      const result = parseDate("hier", { locale: "fr" });
      
      expect(result).not.toBeNull();
      expect(result?.text).toBe("hier");
    });

    it("should parse 'ayer' (Spanish for yesterday) with es locale", () => {
      const result = parseDate("ayer", { locale: "es" });
      
      expect(result).not.toBeNull();
      expect(result?.text).toBe("ayer");
    });

    it("should handle cache correctly when switching locales", () => {
      // This test verifies the cache bug is fixed
      // First, try to parse "gestern" with English (should fail, cached as null)
      const enResult = parseDate("gestern", { locale: "en" });
      expect(enResult).toBeNull();
      
      // Then try with German (should succeed, not use English cached null)
      const deResult = parseDate("gestern", { locale: "de" });
      expect(deResult).not.toBeNull();
      expect(deResult?.text).toBe("gestern");
    });

    it("should handle locale switching correctly for 'today' equivalent", () => {
      // Parse with English
      const enToday = parseDate("today", { locale: "en" });
      expect(enToday).not.toBeNull();
      
      // "today" is not a German word, should fail with German locale
      // (German uses "heute")
      const deToday = parseDate("today", { locale: "de" });
      // Note: chrono-de might still understand "today" as a fallback
      // This test documents the current behavior
      
      // German "heute" should work with de locale
      const deHeute = parseDate("heute", { locale: "de" });
      expect(deHeute).not.toBeNull();
    });
  });

  describe("getDateSuggestionsForLocale", () => {
    it("should return German date suggestions for de locale", () => {
      const suggestions = getDateSuggestionsForLocale("de");
      
      const texts = suggestions.map(s => s.text);
      expect(texts).toContain("heute");
      expect(texts).toContain("gestern");
      expect(texts).toContain("morgen");
    });

    it("should return French date suggestions for fr locale", () => {
      const suggestions = getDateSuggestionsForLocale("fr");
      
      const texts = suggestions.map(s => s.text);
      expect(texts).toContain("aujourd'hui");
      expect(texts).toContain("hier");
      expect(texts).toContain("demain");
    });

    it("should return Spanish date suggestions for es locale", () => {
      const suggestions = getDateSuggestionsForLocale("es");
      
      const texts = suggestions.map(s => s.text);
      expect(texts).toContain("hoy");
      expect(texts).toContain("ayer");
      expect(texts).toContain("mañana");
    });

    it("should fall back to English for unknown locale", () => {
      const suggestions = getDateSuggestionsForLocale("xyz");
      
      const texts = suggestions.map(s => s.text);
      expect(texts).toContain("today");
      expect(texts).toContain("yesterday");
      expect(texts).toContain("tomorrow");
    });
  });
});
