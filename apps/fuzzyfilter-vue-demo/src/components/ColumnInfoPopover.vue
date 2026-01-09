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
import {
  getAllOperators,
  DataType,
  type OperatorDefinition,
  type AnyColumnDefinition,
} from "@jasperhino/fuzzyfilter"
import { cn } from "@/lib/utils"

const props = defineProps<{
  /** The column definition to display info for */
  column: AnyColumnDefinition
}>()

/** Get operators for this column type */
const operators = computed(() => getAllOperators())

/**
 * Get the number of arguments for an operator (matching API reference)
 */
function getArgCount(operator: OperatorDefinition): number {
  // Derive from patterns
  const hasArgs = operator.patterns.some(p => /\{[^}]*\}/.test(p))
  if (!hasArgs) return 0
  
  // Check if variadic (has patterns with 2+ args)
  const isVariadic = operator.patterns.some(p => (p.match(/\{[^}]*\}/g) || []).length >= 2)
  if (isVariadic) {
    if (operator.id === "between") return 2
    return -1 // Unlimited (in, nin)
  }
  return 1
}
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <TooltipRoot>
      <TooltipTrigger
        class="cursor-help inline-flex items-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
        :aria-label="`Info about ${column.labelKey || column.id} column`"
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
                <DataTypeIcon :type="column.type || 'string'" size="size-4" />
                <span>{{ column.labelKey || column.id }}</span>
              </h2>
              <DataTypeIcon :type="column.type || 'string'" as-badge badge-size="sm" />
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

            <!-- Enum values -->
            <div
              v-if="column.type === 'enum' && 'values' in column"
              class="space-y-1"
            >
              <h4 class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Allowed Values
              </h4>
              <div class="flex flex-wrap gap-1">
                <code
                  v-for="value in (column.values as string[]).slice(0, 6)"
                  :key="value"
                  class="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono"
                >
                  {{ value }}
                </code>
                <span
                  v-if="(column.values as string[]).length > 6"
                  class="text-[10px] text-muted-foreground"
                >
                  +{{ (column.values as string[]).length - 6 }} more
                </span>
              </div>
            </div>

            <!-- Number range -->
            <div
              v-if="column.type === 'number' && 'min' in column && 'max' in column"
              class="text-[10px] text-muted-foreground"
            >
              Range: {{ column.min }} – {{ column.max }}
              <template v-if="'isInteger' in column && column.isInteger"> (integers only)</template>
            </div>

            <!-- Boolean labels -->
            <div
              v-if="column.type === 'boolean'"
              class="text-[10px] text-muted-foreground"
            >
              <template v-if="'trueLabel' in column">True: {{ column.trueLabel }}</template>
              <template v-if="'falseLabel' in column"> · False: {{ column.falseLabel }}</template>
            </div>
          </div>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
