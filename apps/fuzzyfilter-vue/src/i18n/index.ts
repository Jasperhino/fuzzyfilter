/**
 * i18n configuration for Vue app
 * 
 * This configuration sets up two namespaces:
 * - `fuzzyfilter`: Translations for the FuzzyFilter library (operators, word sets)
 * - `app`: App-specific translations (UI strings, column names, values)
 */
import { createI18n } from "vue-i18n";
import { en as fuzzyfilterEn, es as fuzzyfilterEs, fr as fuzzyfilterFr, de as fuzzyfilterDe } from "@fuzzyfilter/i18n-locales";

// Import app-specific translations
import appEn from "./locales/en.json";
import appDe from "./locales/de.json";
import appFr from "./locales/fr.json";
import appEs from "./locales/es.json";

export const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: {
    en: {
      fuzzyfilter: fuzzyfilterEn,
      app: appEn,
    },
    es: {
      fuzzyfilter: fuzzyfilterEs,
      app: appEs,
    },
    fr: {
      fuzzyfilter: fuzzyfilterFr,
      app: appFr,
    },
    de: {
      fuzzyfilter: fuzzyfilterDe,
      app: appDe,
    },
  },
});
