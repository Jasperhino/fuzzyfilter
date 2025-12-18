<script setup lang="ts">
import FilterCombobox from "@/components/FilterCombobox.vue"
</script>

<template>
  <div class="bg-background w-full">
    <div class="mx-auto grid min-h-screen w-full max-w-4xl min-w-0 content-center items-start gap-8 p-4 pt-2 sm:gap-12 sm:p-6 md:grid-cols-1 md:gap-8 lg:p-12">
      <div class="mx-auto flex w-full max-w-none min-w-0 flex-col gap-1 self-stretch">
        <div class="text-muted-foreground px-1.5 py-2 text-xs font-medium">
          FuzzyFilter Combobox with Data Table (Vue)
        </div>
        <div class="bg-background text-foreground flex min-w-0 flex-1 flex-col items-stretch gap-6 border border-dashed p-4 sm:p-6">
          <FilterCombobox />
        </div>
      </div>
    </div>
  </div>
</template>
