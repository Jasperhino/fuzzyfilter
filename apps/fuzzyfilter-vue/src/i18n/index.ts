/**
 * i18n configuration for Vue app
 */
import { createI18n } from "vue-i18n";
import { en, es, fr, de } from "@fuzzyfilter/i18n-locales";

export const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: {
    en: {
      fuzzyfilter: en,
    },
    es: {
      fuzzyfilter: es,
    },
    fr: {
      fuzzyfilter: fr,
    },
    de: {
      fuzzyfilter: de,
    },
  },
});
