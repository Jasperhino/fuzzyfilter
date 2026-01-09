<script setup lang="ts">
/**
 * DemoPage - Full-width layout with table demo
 */
import FilterCombobox from "@/components/FilterCombobox.vue"
import LanguageSelector from "@/components/LanguageSelector.vue"
</script>

<template>
  <div class="bg-background w-full h-screen overflow-hidden">
    <div class="flex flex-col p-4 sm:p-6 lg:p-8 xl:p-12 h-full overflow-hidden">
      <div class="flex items-center justify-between shrink-0 mb-2">
        <div class="text-muted-foreground px-1.5 py-2 text-xs font-medium">
          FuzzyFilter Combobox with Data Table (Vue)
        </div>
        <LanguageSelector />
      </div>
      <div class="bg-background text-foreground flex min-w-0 flex-1 flex-col items-stretch gap-6 border border-dashed p-4 sm:p-6 overflow-hidden">
        <FilterCombobox />
      </div>
    </div>
  </div>
</template>

