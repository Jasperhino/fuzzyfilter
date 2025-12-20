<script setup lang="ts">
/**
 * App - Split layout with table and API documentation
 *
 * Left side (2/3): FuzzyFilter table demo
 * Right side (1/3): API documentation
 */
import FilterCombobox from "@/components/FilterCombobox.vue"
import ApiDocs from "@/components/ApiDocs.vue"
</script>

<template>
  <div class="bg-background w-full h-screen overflow-hidden">
    <div class="grid grid-cols-1 lg:grid-cols-[2fr_1fr] h-full">
      <!-- Left: Table Demo -->
      <div class="flex flex-col p-4 sm:p-6 lg:p-8 xl:p-12 border-r border-border overflow-hidden">
        <div class="text-muted-foreground px-1.5 py-2 text-xs font-medium shrink-0">
          FuzzyFilter Combobox with Data Table (Vue)
        </div>
        <div class="bg-background text-foreground flex min-w-0 flex-1 flex-col items-stretch gap-6 border border-dashed p-4 sm:p-6 overflow-hidden">
          <FilterCombobox />
        </div>
      </div>

      <!-- Right: API Documentation -->
      <div class="p-4 sm:p-6 lg:p-8 bg-muted/20 lg:sticky lg:top-0 lg:h-screen lg:overflow-hidden">
        <div class="h-full">
          <ApiDocs />
        </div>
      </div>
    </div>
  </div>
</template>
