<script setup lang="ts">
/**
 * FilterCombobox - Vue Component for FuzzyFilter
 * 
 * Demonstrates the vue-fuzzy-filter composable with a combobox interface.
 * Uses virtual scrolling to handle large datasets (10,000+ rows).
 */
import { ref, onMounted, computed, watch, nextTick } from "vue"
import { useVirtualizer } from "@tanstack/vue-virtual"
import { useFuzzyFilter } from "vue-fuzzy-filter"
import { createFuzzyFilter, type CompiledFilter, type FilterSuggestion, type AnyColumnDefinition } from "fuzzyfilter"
import { TASK_SCHEMA, generateLargeDataset, type Task } from "@fuzzyfilter/sample-data"
import {
  FilterIcon,
  HashIcon,
  CalendarIcon,
  ToggleLeftIcon,
  ListIcon,
  TypeIcon,
  CheckIcon,
  XIcon,
  AlertCircleIcon,
  SearchIcon,
} from "lucide-vue-next"
import { cn } from "@/lib/utils"

// Generate 10,000 rows with a fixed seed for consistency
const LARGE_DATASET = generateLargeDataset(10000, 42)

// Row height for virtual scroll
const ROW_HEIGHT = 48

// Create filter instance
const filter = createFuzzyFilter({ maxSuggestions: 12 })

// Initialize schema and data
onMounted(() => {
  filter.setSchema(TASK_SCHEMA)
  filter.indexData(LARGE_DATASET)
})

// Compile applied filters for context (reactive) - defined before composable
const appliedFiltersForContext = ref<FilterSuggestion[]>([])

const compiledFiltersForContext = computed(() => {
  const compiled: CompiledFilter[] = []
  for (const f of appliedFiltersForContext.value) {
    let value: unknown = undefined
    if (f.value) {
      if (f.value.kind === "string") value = f.value.value
      else if (f.value.kind === "number") value = f.value.value
      else if (f.value.kind === "boolean") value = f.value.value
      else if (f.value.kind === "date") value = f.value.value
      else if (f.value.kind === "dateRange") value = [f.value.start, f.value.end]
    }
    const c = filter.compileFilter(f.column.id, f.operator, value)
    if (c) compiled.push(c)
  }
  return compiled
})

// Use the composable with filter context for stacked counts
const {
  query,
  suggestions,
  selectedIndex,
  navigateSuggestions,
  selectSuggestion,
} = useFuzzyFilter(filter, {
  debounceMs: 150,
  filterContext: compiledFiltersForContext,
})

// Applied filters state - use the same ref for both display and context
const appliedFilters = appliedFiltersForContext
const isOpen = ref(false)

// Virtual scroll container ref
const scrollContainerRef = ref<HTMLDivElement | null>(null)

// Filtered data
const filteredData = computed(() => {
  if (appliedFilters.value.length === 0) return LARGE_DATASET
  
  const compiledFilters: CompiledFilter[] = []
  for (const f of appliedFilters.value) {
    let value: unknown = undefined
    if (f.value) {
      if (f.value.kind === "string") value = f.value.value
      else if (f.value.kind === "number") value = f.value.value
      else if (f.value.kind === "boolean") value = f.value.value
      else if (f.value.kind === "date") value = f.value.value
      else if (f.value.kind === "dateRange") value = [f.value.start, f.value.end]
    }
    const compiled = filter.compileFilter(f.column.id, f.operator, value)
    if (compiled) {
      compiledFilters.push(compiled)
    }
  }
  
  return LARGE_DATASET.filter((row) =>
    compiledFilters.every((cf) => cf.predicate(row))
  )
})

// Set up virtualizer
const virtualizer = useVirtualizer({
  get count() {
    return filteredData.value.length
  },
  getScrollElement: () => scrollContainerRef.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: 10,
})

// Handle selection
function handleSelect(index: number) {
  selectSuggestion(index)
  const suggestion = suggestions.value[index]
  if (suggestion) {
    if (suggestion.isComplete) {
      // Add to applied filters (avoid duplicates)
      if (!appliedFilters.value.some((f) => f.id === suggestion.id)) {
        appliedFilters.value = [...appliedFilters.value, suggestion]
      }
      query.value = ""
      isOpen.value = false
    } else {
      // Continue typing with the completion text
      query.value = suggestion.completionText
    }
  }
}

// Remove a filter
function removeFilter(id: string) {
  appliedFilters.value = appliedFilters.value.filter((f) => f.id !== id)
}

// Clear all filters
function clearAllFilters() {
  appliedFilters.value = []
}

// Handle input focus
function handleFocus() {
  isOpen.value = true
}

// Handle input blur (with delay for click events)
function handleBlur() {
  setTimeout(() => {
    isOpen.value = false
  }, 200)
}

// Handle keyboard events
function handleKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault()
      navigateSuggestions("down")
      break
    case "ArrowUp":
      event.preventDefault()
      navigateSuggestions("up")
      break
    case "Enter":
      event.preventDefault()
      if (suggestions.value[selectedIndex.value]) {
        handleSelect(selectedIndex.value)
      }
      break
    case "Escape":
      isOpen.value = false
      break
  }
}

// Get icon component for column type
function getColumnTypeIcon(type: AnyColumnDefinition["type"]) {
  switch (type) {
    case "string": return TypeIcon
    case "number": return HashIcon
    case "date": return CalendarIcon
    case "boolean": return ToggleLeftIcon
    case "enum": return ListIcon
    default: return FilterIcon
  }
}

// Get operator badge variant
function getOperatorVariant(operator: string): string {
  if (["eq", "eqIgnoreCase"].includes(operator)) return "bg-primary text-primary-foreground"
  if (["neq", "neqIgnoreCase", "nin", "notContains"].includes(operator)) return "bg-secondary text-secondary-foreground"
  return "bg-muted text-muted-foreground border border-border"
}

// Get score color
function getScoreColor(score: number): string {
  if (score >= 3000) return "bg-emerald-500/20 text-emerald-600"
  if (score >= 1500) return "bg-lime-500/20 text-lime-600"
  if (score >= 500) return "bg-amber-500/20 text-amber-600"
  if (score >= -1000) return "bg-orange-500/20 text-orange-600"
  return "bg-rose-500/20 text-rose-600"
}

// Get score tooltip
function getScoreTooltip(suggestion: FilterSuggestion): string {
  const { score, category, scoreBreakdown } = suggestion
  const lines = [
    `Final Score: ${Math.round(score)}`,
    `Category: ${category}`,
    "",
  ]
  
  if (scoreBreakdown) {
    lines.push(
      "── Score Breakdown ──",
      `Raw Match: ${Math.round(scoreBreakdown.rawScore)}`,
      `Coverage: +${scoreBreakdown.coverageBonus} (${scoreBreakdown.tokenCount}/${scoreBreakdown.totalTokens} tokens)`,
      `Completeness: +${scoreBreakdown.completenessBonus}`,
      `Full Query: +${scoreBreakdown.fullQueryBonus}`,
    )
  }
  
  lines.push(
    "",
    "── Match Info ──",
    `Column: ${suggestion.column.name}`,
    `Operator: ${suggestion.operator}`,
  )
  
  if (suggestion.value?.kind === "string") {
    lines.push(`Value: "${suggestion.value.value}"`)
  }
  
  return lines.join("\n")
}

// Status badge variants
const statusVariants: Record<string, { bg: string; text: string }> = {
  "Open": { bg: "bg-emerald-500/15", text: "text-emerald-600" },
  "In Progress": { bg: "bg-amber-500/15", text: "text-amber-600" },
  "Closed": { bg: "bg-slate-500/15", text: "text-slate-500" },
  "Blocked": { bg: "bg-rose-500/15", text: "text-rose-600" },
}

// Priority colors
const priorityColors = [
  "bg-slate-300",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-orange-500",
  "bg-rose-500",
]

// Format number with locale
function formatNumber(num: number): string {
  return num.toLocaleString()
}
</script>

<template>
  <div class="w-full space-y-6">
    <!-- Filter controls -->
    <div class="space-y-4">
      <!-- Applied filters -->
      <div v-if="appliedFilters.length > 0" class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-muted-foreground font-medium">Active filters:</span>
        <div
          v-for="f in appliedFilters"
          :key="f.id"
          class="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 h-auto bg-secondary text-secondary-foreground rounded-md text-xs font-medium"
        >
          <span>{{ f.label }}</span>
          <button
            @click="removeFilter(f.id)"
            class="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
          >
            <XIcon class="size-3" />
          </button>
        </div>
        <button
          @click="clearAllFilters"
          class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Clear all
        </button>
      </div>

      <!-- Combobox -->
      <div class="relative">
        <div class="flex items-center gap-2 px-3 py-2 bg-background rounded-lg border border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 transition-all">
          <SearchIcon class="size-4 text-muted-foreground shrink-0" />
          <input
            v-model="query"
            type="text"
            placeholder="Filter by column, operator, or value..."
            class="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none text-sm"
            @focus="handleFocus"
            @blur="handleBlur"
            @keydown="handleKeydown"
          />
          <button
            v-if="query.length > 0"
            @click="query = ''"
            class="p-0.5 rounded-full hover:bg-muted transition-colors"
          >
            <XIcon class="size-4 text-muted-foreground" />
          </button>
        </div>

        <!-- Suggestions Dropdown -->
        <div
          v-if="isOpen && suggestions.length > 0"
          class="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
        >
          <div class="px-2 py-1.5 border-b border-border">
            <span class="text-xs font-medium text-muted-foreground">Suggestions</span>
          </div>
          <div class="max-h-80 overflow-y-auto p-1">
            <div
              v-for="(suggestion, index) in suggestions"
              :key="suggestion.id"
              :data-testid="`suggestion-${suggestion.column.id}-${suggestion.operator}`"
              :class="cn(
                'flex items-center justify-between px-2 py-2 cursor-pointer rounded-md transition-colors',
                index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
              )"
              @click="handleSelect(index)"
            >
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <component :is="getColumnTypeIcon(suggestion.column.type)" class="size-3.5 text-muted-foreground shrink-0" />
                <span class="font-medium text-foreground truncate text-sm">
                  {{ suggestion.parts.column.text }}
                </span>
                <span :class="cn('shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center font-medium', getOperatorVariant(suggestion.operator))">
                  {{ suggestion.parts.operator.symbol || suggestion.parts.operator.text }}
                </span>
                <span v-if="suggestion.parts.argument" class="text-muted-foreground truncate text-sm">
                  {{ suggestion.parts.argument.text }}
                </span>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span
                  :class="cn('text-[10px] px-1.5 py-0.5 rounded font-mono tabular-nums cursor-help', getScoreColor(suggestion.score))"
                  :title="getScoreTooltip(suggestion)"
                >
                  {{ Math.round(suggestion.score) }}
                </span>
                <span class="text-xs text-muted-foreground tabular-nums" data-testid="result-count">
                  {{ suggestion.resultCount }} {{ suggestion.resultCount === 1 ? 'result' : 'results' }}
                </span>
                <span v-if="!suggestion.isComplete" class="text-[10px] text-muted-foreground/60">...</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Help text -->
      <p class="text-xs text-muted-foreground">
        Try typing: <code class="bg-muted px-1 rounded">status</code>,
        <code class="bg-muted px-1 rounded">neq</code>,
        <code class="bg-muted px-1 rounded">Alice</code>, or
        <code class="bg-muted px-1 rounded">Engineering</code>
      </p>
    </div>

    <!-- Results summary -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium">
        Tasks
        <span class="text-muted-foreground font-normal">
          ({{ formatNumber(filteredData.length) }} of {{ formatNumber(LARGE_DATASET.length) }})
        </span>
      </h3>
      <span v-if="appliedFilters.length > 0" class="text-xs text-muted-foreground">
        {{ appliedFilters.length }} filter{{ appliedFilters.length !== 1 ? 's' : '' }} applied
      </span>
    </div>

    <!-- Virtual data table -->
    <div v-if="filteredData.length === 0" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <AlertCircleIcon class="size-8 mb-2 opacity-50" />
      <p class="text-sm font-medium">No results found</p>
      <p class="text-xs">Try adjusting your filters</p>
    </div>

    <div v-else class="overflow-hidden rounded-lg border border-border">
      <!-- Fixed header -->
      <div class="flex items-center border-b bg-muted/50 sticky top-0 z-10">
        <div class="px-4 py-3 w-[140px] shrink-0 text-left font-medium text-muted-foreground text-sm">Status</div>
        <div class="px-4 py-3 w-[180px] shrink-0 text-left font-medium text-muted-foreground text-sm">Assignee</div>
        <div class="px-4 py-3 w-[100px] shrink-0 text-left font-medium text-muted-foreground text-sm">Priority</div>
        <div class="px-4 py-3 w-[140px] shrink-0 text-left font-medium text-muted-foreground text-sm">Department</div>
        <div class="px-4 py-3 w-[120px] shrink-0 text-left font-medium text-muted-foreground text-sm">Created</div>
        <div class="px-4 py-3 w-[80px] shrink-0 text-center font-medium text-muted-foreground text-sm">Blocked</div>
      </div>

      <!-- Virtualized body -->
      <div
        ref="scrollContainerRef"
        class="h-[500px] overflow-auto"
      >
        <div
          :style="{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }"
        >
          <div
            v-for="virtualRow in virtualizer.getVirtualItems()"
            :key="filteredData[virtualRow.index].id"
            :style="{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }"
            :class="cn(
              'flex items-center border-b transition-colors',
              appliedFilters.length > 0 ? 'bg-primary/5' : '',
              filteredData[virtualRow.index].id % 2 !== 0 ? 'bg-muted/30' : ''
            )"
          >
            <div class="px-4 py-3 w-[140px] shrink-0">
              <span :class="cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                statusVariants[filteredData[virtualRow.index].status]?.bg ?? 'bg-muted',
                statusVariants[filteredData[virtualRow.index].status]?.text ?? 'text-muted-foreground'
              )">
                {{ filteredData[virtualRow.index].status }}
              </span>
            </div>
            <div class="px-4 py-3 w-[180px] shrink-0 font-medium truncate">{{ filteredData[virtualRow.index].assignee }}</div>
            <div class="px-4 py-3 w-[100px] shrink-0">
              <div class="flex items-center gap-1">
                <div :class="cn('size-2 rounded-full', priorityColors[filteredData[virtualRow.index].priority - 1] ?? priorityColors[0])" />
                <span class="text-sm tabular-nums">{{ filteredData[virtualRow.index].priority }}</span>
              </div>
            </div>
            <div class="px-4 py-3 w-[140px] shrink-0 text-muted-foreground">{{ filteredData[virtualRow.index].department }}</div>
            <div class="px-4 py-3 w-[120px] shrink-0 text-muted-foreground tabular-nums">{{ filteredData[virtualRow.index].createdAt }}</div>
            <div class="px-4 py-3 w-[80px] shrink-0 text-center">
              <XIcon v-if="filteredData[virtualRow.index].isBlocked" class="size-4 text-rose-500 mx-auto" />
              <CheckIcon v-else class="size-4 text-emerald-500 mx-auto" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
