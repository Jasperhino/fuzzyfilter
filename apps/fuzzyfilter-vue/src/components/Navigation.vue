<script setup lang="ts">
/**
 * Navigation Component
 * 
 * Tab-style navigation between Demo and Algorithm Explainer pages.
 */
import { computed } from "vue"
import { useRoute } from "vue-router"
import { LayoutGridIcon, BrainCircuitIcon } from "lucide-operators-vue"
import { cn } from "@/lib/utils"

const route = useRoute()
const isExplainer = computed(() => route.path === "/explainer")
</script>

<template>
  <nav class="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
    <div class="flex items-center gap-1 px-4 py-2">
      <router-link
        to="/"
        :class="cn(
          'inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
          !isExplainer
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )"
      >
        <LayoutGridIcon class="size-4" />
        Demo
      </router-link>
      <router-link
        to="/explainer"
        :class="cn(
          'inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
          isExplainer
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )"
      >
        <BrainCircuitIcon class="size-4" />
        Algorithm Explainer
      </router-link>
      <div class="flex-1" />
      <span class="text-xs text-muted-foreground font-mono">
        fuzzyfilter
      </span>
    </div>
  </nav>
</template>

