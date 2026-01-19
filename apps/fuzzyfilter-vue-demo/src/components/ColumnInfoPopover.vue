<script setup lang="ts">
/**
 * ColumnInfoPopover - Vue component for displaying column operator info
 *
 * Shows a popover on hover with available operators and argument types.
 * Uses the same arg notation and rendering style as the API reference.
 */
import { computed } from "vue"
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipProvider,
} from "radix-vue"
import DataTypeIcon from "./DataTypeIcon.vue"
import type { FieldSchema, OperatorOverload } from "@jasperhino/fuzzyfilter"
import { cn } from "@/lib/utils"

const props = defineProps<{
  /** The column definition to display info for */
  column: FieldSchema<unknown>
  /** The field key (for display) */
  fieldKey?: string
}>()

/** Get operators for this column type */
const operators = computed(() => {
  // Extract all operators from the column's operator configs
  const allOperators: Array<{ id: string; overloads: OperatorOverload<unknown, any>[] }> = []
  for (const opConfig of props.column.operators || []) {
    allOperators.push({
      id: opConfig.operatorId,
      overloads: opConfig.overloads,
    })
  }
  return allOperators
})

/**
 * Get the number of arguments for an operator overload
 */
function getArgCount(operator: { id: string; overloads: OperatorOverload<unknown, any>[] }): number {
  // Check if any overload has arguments
  const hasArgs = operator.overloads.some(overload => 
    overload.arguments && overload.arguments.length > 0
  )
  if (!hasArgs) return 0
  
  // Get max argument count across all overloads
  const maxArgs = Math.max(...operator.overloads.map(overload => 
    overload.arguments?.length || 0
  ))
  
  // Check if any overload has array arguments (variadic-like)
  const hasArrayArg = operator.overloads.some(overload =>
    overload.arguments?.some(arg => arg.isArray)
  )
  
  if (hasArrayArg) {
    if (operator.id === "between") return 2
    return -1 // Unlimited (in, nin)
  }
  return maxArgs
}
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <TooltipRoot>
      <TooltipTrigger
        class="cursor-help inline-flex items-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
        :aria-label="`Info about ${column.labelKey || props.fieldKey || 'column'} column`"
      >
        <slot />
      </TooltipTrigger>
      
      <TooltipPortal>
        <TooltipContent
          side="bottom"
          align="start"
          :side-offset="8"
          :class="cn(
            'z-50 w-[300px] bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-3',
            'animate-in fade-in-0 zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
            'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'
          )"
        >
          <div class="space-y-3">
            <!-- Header with column name and type -->
            <div class="flex items-center justify-between">
              <h2 class="flex items-center gap-2 font-semibold text-sm">
                <DataTypeIcon type="string" size="size-4" />
                <span>{{ column.labelKey }}</span>
              </h2>
              <DataTypeIcon type="string" as-badge badge-size="sm" />
            </div>

            <!-- Operators section -->
            <div class="space-y-1.5">
              <h4 class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Available Operators
              </h4>
              <div class="space-y-0.5 max-h-[200px] overflow-y-auto">
                <div
                  v-for="op in operators"
                  :key="op.id"
                  class="flex items-center gap-1.5 text-xs py-1 px-1.5 rounded hover:bg-muted/50"
                >
                  <!-- Operator label -->
                  <div class="flex items-center gap-1.5 flex-1 min-w-0">
                    <span class="shrink-0 text-[10px] h-4 px-1 rounded inline-flex items-center font-medium bg-muted text-muted-foreground">
                      {{ op.id }}
                    </span>
                    <span class="text-muted-foreground truncate">{{ op.id }}</span>
                  </div>

                  <!-- Argument placeholders -->
                  <div class="flex items-center gap-1 shrink-0">
                    <!-- No args -->
                    <span 
                      v-if="getArgCount(op) === 0" 
                      class="text-[10px] text-muted-foreground/60"
                    >
                      no args
                    </span>
                    
                    <!-- Single arg -->
                    <span 
                      v-else-if="getArgCount(op) === 1"
                      class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground"
                    >
                      arg 1
                    </span>
                    
                    <!-- Two args (between) -->
                    <template v-else-if="getArgCount(op) === 2">
                      <span class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground">
                        arg 1
                      </span>
                      <span class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground">
                        arg 2
                      </span>
                    </template>
                    
                    <!-- Variadic (in, nin) -->
                    <template v-else>
                      <span class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground">
                        arg 1
                      </span>
                      <span class="text-[10px] text-muted-foreground/60">…</span>
                      <span class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground">
                        arg n
                      </span>
                    </template>
                  </div>
                </div>
              </div>
            </div>

            <!-- Field description -->
            <div
              v-if="column.description || column.descriptionKey"
              class="text-[10px] text-muted-foreground"
            >
              {{ column.description || column.descriptionKey }}
            </div>
          </div>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
