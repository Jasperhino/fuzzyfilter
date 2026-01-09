import { useTranslation } from "react-i18next";
import { FilterCombobox } from "@/components/filter-combobox";
import { LanguageSelector } from "@/components/language-selector";

/**
 * ComponentExample - Full-width layout with table demo
 */
export function ComponentExample() {
  const { t } = useTranslation();

  return (
    <div className="bg-background w-full h-screen overflow-hidden">
      <div className="flex flex-col p-4 sm:p-6 lg:p-8 xl:p-12 h-full overflow-hidden">
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
    </div>
  );
}
