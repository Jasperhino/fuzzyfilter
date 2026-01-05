/**
 * i18n Utilities for FuzzyFilter
 * 
 * Provides helper functions for working with I18nProvider and translations.
 * 
 * @module fuzzyfilter/i18n
 */

export type { I18nProvider, OperatorTranslation, OperatorTranslations, WordSetTranslations, FuzzyFilterTranslations } from "../types/i18n.ts";
export { createDefaultEnglishProvider } from "./default-provider.ts";
export { createObjectProvider } from "./object-provider.ts";
export { createI18nextAdapter, createVueI18nAdapter } from "./adapters.ts";
