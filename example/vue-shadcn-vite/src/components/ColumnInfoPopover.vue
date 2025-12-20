<script setup lang="ts">
/**
 * ColumnInfoPopover - Vue component for displaying column operator info
 *
 * Shows a tooltip on hover with available operators and argument types.
 * Uses radix-vue's TooltipRoot for hover behavior.
 */
import { computed } from "vue"
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipProvider,
} from "radix-vue"
import { InfoIcon } from "lucide-operators-vue"
import DataTypeIcon from "./DataTypeIcon.vue"
import {
  getOperatorsForType,
  DataType,
  type OperatorInfo,
  type AnyColumnDefinition,
} from "fuzzyfilter"
import { cn } from "@/lib/utils"

const props = defineProps<{
  /** The column definition to display info for */
  column: AnyColumnDefinition
}>()

/** Get operators for this column type */
const operators = computed(() => getOperatorsForType(props.column.type as DataType))

/**
 * Gets a human-readable description of the argument type for an operator
 */
function getArgumentTypeLabel(operator: OperatorInfo, columnType: DataType): string {
  if (!operator.requiresArgument) {
    return "No argument"
  }

  if (operator.isVariadic) {
    switch (columnType) {
      case DataType.NUMBER:
        return "number, number, ..."
      case DataType.DATE:
        return "date, date, ..."
      case DataType.STRING:
      case DataType.ENUM:
        return "value, value, ..."
      default:
        return "value, value, ..."
    }
  }

  switch (columnType) {
    case DataType.STRING:
      return "text"
    case DataType.NUMBER:
      return "number"
    case DataType.DATE:
      return "date / natural language"
    case DataType.BOOLEAN:
      return "true / false"
    case DataType.ENUM:
      return "enum value"
    case DataType.ARRAY:
      return "value"
    default:
      return "value"
  }
}
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <TooltipRoot>
      <TooltipTrigger
        class="ml-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-help inline-flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
        :aria-label="`Info about ${column.name} column`"
      >
        <InfoIcon class="size-3" />
      </TooltipTrigger>
      
      <TooltipPortal>
        <TooltipContent
          side="top"
          align="start"
          :side-offset="8"
          :class="cn(
            'z-50 w-[280px] bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-3',
            'animate-in fade-in-0 zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
            'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'
          )"
        >
          <div class="space-y-3">
            <!-- Header with column name and type -->
            <div class="flex items-center justify-between">
              <h2 class="flex items-center gap-2 font-semibold text-sm">
                <DataTypeIcon :type="column.type" size="size-4" />
                <span>{{ column.name }}</span>
              </h2>
              <DataTypeIcon :type="column.type" as-badge badge-size="sm" />
            </div>

            <!-- Operators section -->
            <div class="space-y-1.5">
              <h4 class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Available Operators
              </h4>
              <div class="space-y-1 max-h-[200px] overflow-y-auto">
                <div
                  v-for="op in operators"
                  :key="op.id"
                  class="flex items-center justify-between gap-2 text-xs py-1 px-1.5 rounded hover:bg-muted/50"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <code
                      v-if="op.symbol"
                      class="font-mono text-[11px] text-primary w-5 shrink-0 text-center"
                    >
                      {{ op.symbol }}
                    </code>
                    <span class="font-medium truncate">{{ op.id }}</span>
                  </div>
                  <span class="text-[10px] text-muted-foreground shrink-0">
                    {{ getArgumentTypeLabel(op, column.type as DataType) }}
                  </span>
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
