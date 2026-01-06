import { useTranslation } from "react-i18next";
import { FilterCombobox } from "@/components/filter-combobox";
import { ApiDocs } from "@/components/api-docs";
import { LanguageSelector } from "@/components/language-selector";

/**
 * ComponentExample - Split layout with table and API documentation
 *
 * Left side (2/3): FuzzyFilter table demo
 * Right side (1/3): API documentation
 */
export function ComponentExample() {
  const { t } = useTranslation();

  return (
    <div className="bg-background w-full h-screen overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] h-full">
        {/* Left: Table Demo */}
        <div className="flex flex-col p-4 sm:p-6 lg:p-8 xl:p-12 border-r border-border overflow-hidden">
          <div className="flex items-center justify-between shrink-0 mb-2">
            <div className="text-muted-foreground px-1.5 py-2 text-xs font-medium">
              {t("ui.title")}
            </div>
            <LanguageSelector />
          </div>
          <div className="bg-background text-foreground flex min-w-0 flex-1 flex-col items-stretch gap-6 border border-dashed p-4 sm:p-6 overflow-hidden">
            <FilterCombobox />
          </div>
        </div>

        {/* Right: API Documentation */}
        <div className="p-4 sm:p-6 lg:p-8 bg-muted/20 lg:sticky lg:top-0 lg:h-screen lg:overflow-hidden">
          <div className="h-full">
            <ApiDocs />
          </div>
        </div>
      </div>
    </div>
  );
}
