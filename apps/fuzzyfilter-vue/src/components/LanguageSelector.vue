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

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
] as const;

const { locale } = useI18n();

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
      <SelectValue placeholder="Select language" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem
        v-for="lang in LANGUAGES"
        :key="lang.code"
        :value="lang.code"
        :text="lang.label"
      >
        {{ lang.label }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
