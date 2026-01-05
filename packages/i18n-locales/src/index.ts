/**
 * Locale translations for FuzzyFilter
 * 
 * This package provides English, Spanish, French, and other translations
 * for use with FuzzyFilter. All locales can be imported from this single package.
 * 
 * @example Using with React and i18next
 * ```typescript
 * import i18n from "i18next";
 * import { en, es, fr, de } from "@fuzzyfilter/i18n-locales";
 * 
 * i18n.init({
 *   resources: {
 *     en: { fuzzyfilter: en },
 *     es: { fuzzyfilter: es },
 *     fr: { fuzzyfilter: fr },
 *     de: { fuzzyfilter: de },
 *   },
 * });
 * ```
 * 
 * @example Using with Vue and vue-i18n
 * ```typescript
 * import { createI18n } from "vue-i18n";
 * import { en, es, fr, de } from "@fuzzyfilter/i18n-locales";
 * 
 * const i18n = createI18n({
 *   messages: {
 *     en: { fuzzyfilter: en },
 *     es: { fuzzyfilter: es },
 *     fr: { fuzzyfilter: fr },
 *     de: { fuzzyfilter: de },
 *   },
 * });
 * ```
 */

export { en } from "./en.ts";
export { es } from "./es.ts";
export { fr } from "./fr.ts";
export { de } from "./de.ts";
