/**
 * i18n configuration for React app
 * 
 * This configuration sets up two namespaces:
 * - `fuzzyfilter`: Translations for the FuzzyFilter library (operators, word sets)
 * - `app`: App-specific translations (UI strings, column names, values)
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en as fuzzyfilterEn, es as fuzzyfilterEs, fr as fuzzyfilterFr, de as fuzzyfilterDe } from "@fuzzyfilter/i18n-locales";

// Import app-specific translations
import appEn from "./locales/en.json";
import appDe from "./locales/de.json";
import appFr from "./locales/fr.json";
import appEs from "./locales/es.json";

i18n
  .use(initReactI18next)
  .init({
    resources: {
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
    lng: "en",
    fallbackLng: "en",
    defaultNS: "app",
    ns: ["fuzzyfilter", "app"],
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
