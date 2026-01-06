/**
 * Language Selector Component
 * 
 * A dropdown component for selecting the application language.
 * Uses shadcn Select component and react-i18next for language switching.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Available language codes */
const LANGUAGE_CODES = ["en", "es", "fr", "de"] as const;

/**
 * LanguageSelector component
 * 
 * Provides a dropdown to switch between available languages.
 * The language change is handled by react-i18next.
 */
export function LanguageSelector() {
  const { t, i18n } = useTranslation();

  /**
   * Get the current language's display label using the translation function.
   * Handles cases where i18n.language might be "de-DE" instead of "de".
   */
  const currentLanguageLabel = React.useMemo(() => {
    // Try exact match first
    if (LANGUAGE_CODES.includes(i18n.language as typeof LANGUAGE_CODES[number])) {
      return t(`languages.${i18n.language}`);
    }
    
    // Handle regional variants like "de-DE" -> "de"
    const prefixMatch = LANGUAGE_CODES.find(code => i18n.language.startsWith(code));
    if (prefixMatch) {
      return t(`languages.${prefixMatch}`);
    }
    
    return t("ui.selectLanguage");
  }, [i18n.language, t]);

  const handleLanguageChange = React.useCallback(
    (value: string | null) => {
      if (value) {
        i18n.changeLanguage(value);
      }
    },
    [i18n]
  );

  return (
    <Select
      value={i18n.language}
      onValueChange={handleLanguageChange}
    >
      <SelectTrigger className="w-[140px]">
        <SelectValue>
          {currentLanguageLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {LANGUAGE_CODES.map((code) => (
          <SelectItem key={code} value={code}>
            {t(`languages.${code}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
