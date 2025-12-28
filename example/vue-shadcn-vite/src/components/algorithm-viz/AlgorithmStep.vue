<script setup lang="ts">
/**
 * AlgorithmStep - Collapsible container for algorithm explanation steps
 */
import { ref } from "vue"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-operators-vue"
import { cn } from "@/lib/utils"

interface Props {
  /** Step number for ordering */
  step: number
  /** Step title */
  title: string
  /** Optional description */
  description?: string
  /** Whether the step is initially expanded */
  defaultExpanded?: boolean
  /** Whether this step is currently active/highlighted */
  isActive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  defaultExpanded: true,
  isActive: false,
})

const isExpanded = ref(props.defaultExpanded)

function toggle() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div
    :class="cn(
      'border rounded-lg overflow-hidden transition-colors',
      props.isActive ? 'border-primary/50 bg-primary/5' : 'border-border'
    )"
  >
    <button
      @click="toggle"
      class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
    >
      <span
        :class="cn(
          'flex items-center justify-center size-6 rounded-full text-xs font-bold',
          props.isActive
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        )"
      >
        {{ props.step }}
      </span>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm">{{ props.title }}</div>
        <div v-if="props.description" class="text-xs text-muted-foreground truncate">
          {{ props.description }}
        </div>
      </div>
      <ChevronDownIcon v-if="isExpanded" class="size-4 text-muted-foreground shrink-0" />
      <ChevronRightIcon v-else class="size-4 text-muted-foreground shrink-0" />
    </button>
    <div v-if="isExpanded" class="px-4 pb-4 pt-2 border-t border-border/50">
      <slot />
    </div>
  </div>
</template>

