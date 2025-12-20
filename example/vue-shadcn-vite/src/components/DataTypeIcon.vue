<script setup lang="ts">
/**
 * DataTypeIcon - Vue component for displaying data type icons and badges
 *
 * Reusable icons for data types used in table headers and API docs.
 */
import { computed } from "vue"
import {
  HashIcon,
  CalendarIcon,
  ToggleLeftIcon,
  ListIcon,
  TypeIcon,
  LayersIcon,
} from "lucide-operators-vue"
import { cn } from "@/lib/utils"
import type { DataType } from "fuzzyfilter"

const props = withDefaults(
  defineProps<{
    /** The data type to display */
    type: string | DataType
    /** Size class for the icon */
    size?: string
    /** Whether to show as badge with label */
    asBadge?: boolean
    /** Badge size variant */
    badgeSize?: "sm" | "default"
  }>(),
  {
    size: "size-3",
    asBadge: false,
    badgeSize: "default",
  }
)

/** Configuration for each data type */
const typeConfig: Record<string, { icon: typeof TypeIcon; color: string; label: string }> = {
  string: {
    icon: TypeIcon,
    color: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    label: "String",
  },
  number: {
    icon: HashIcon,
    color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    label: "Number",
  },
  date: {
    icon: CalendarIcon,
    color: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    label: "Date",
  },
  boolean: {
    icon: ToggleLeftIcon,
    color: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    label: "Boolean",
  },
  enum: {
    icon: ListIcon,
    color: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
    label: "Enum",
  },
  array: {
    icon: LayersIcon,
    color: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
    label: "Array",
  },
}

const config = computed(() => typeConfig[props.type] ?? typeConfig.string)

const badgeSizeClasses = computed(() => 
  props.badgeSize === "sm" ? "text-[9px] px-1 py-0.5" : "text-[10px] px-1.5 py-0.5"
)

const iconSizeClass = computed(() =>
  props.badgeSize === "sm" ? "size-2" : "size-2.5"
)
</script>

<template>
  <!-- Badge variant -->
  <span
    v-if="asBadge"
    :class="cn(
      'inline-flex items-center gap-1 rounded font-medium',
      badgeSizeClasses,
      config.color
    )"
  >
    <component :is="config.icon" :class="iconSizeClass" aria-hidden="true" />
    {{ config.label }}
  </span>
  
  <!-- Icon only variant -->
  <component
    v-else
    :is="config.icon"
    :class="cn(size, config.color.split(' ').pop())"
    aria-hidden="true"
  />
</template>
