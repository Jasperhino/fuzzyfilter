<script setup lang="ts">
/**
 * Language Selector Component
 * 
 * A dropdown component for selecting the application language.
 * Uses shadcn-vue style Select component and vue-i18n for language switching.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Available language codes */
const LANGUAGE_CODES = ["en", "es", "fr", "de"] as const;

const { t, locale } = useI18n();

const currentLocale = computed({
  get: () => locale.value,
  set: (value: string) => {
    locale.value = value;
  },
});
</script>

<template>
  <Select v-model="currentLocale">
    <SelectTrigger class="w-[140px]">
      <SelectValue :placeholder="t('app.ui.selectLanguage')" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem
        v-for="code in LANGUAGE_CODES"
        :key="code"
        :value="code"
        :text="t(`app.languages.${code}`)"
      >
        {{ t(`app.languages.${code}`) }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
