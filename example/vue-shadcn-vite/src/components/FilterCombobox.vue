<script setup lang="ts">
/**
 * FilterCombobox - Vue Component for FuzzyFilter
 * 
 * Demonstrates the vue-fuzzy-filter composable with a combobox interface.
 * Uses virtual scrolling to handle large datasets (10,000+ rows).
 */
import { ref, onMounted, computed } from "vue"
import { useVirtualizer } from "@tanstack/vue-virtual"
import { useFuzzyFilter } from "vue-fuzzy-filter"
import { createFuzzyFilter, getOperator, type CompiledFilter, type FilterSuggestion, type HypothesisValueType } from "fuzzyfilter"
import { TASK_SCHEMA, COLUMN_IDS, generateLargeDataset, type Task } from "@fuzzyfilter/sample-data"
import DataTypeIcon from "./DataTypeIcon.vue"
import ColumnInfoPopover from "./ColumnInfoPopover.vue"
import {
  FilterIcon,
  CheckIcon,
  XIcon,
  SearchIcon,
} from "lucide-operators-vue"
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
    // Extract raw values from arguments array for compileFilter
    const value = f.arguments?.map((arg: HypothesisValueType) => {
      if (arg.kind === "string") return arg.value
      if (arg.kind === "number") return arg.value
      if (arg.kind === "boolean") return arg.value
      if (arg.kind === "date") return arg.value
      return undefined
    }).filter((v: unknown) => v !== undefined)
    
    // Pass array for variadic operators, single value for others
    const compileValue = value && value.length === 1 ? value[0] : value
    const c = filter.compileFilter(f.column.id, f.operator, compileValue)
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
    // Extract raw values from arguments array for compileFilter
    const value = f.arguments?.map((arg: HypothesisValueType) => {
      if (arg.kind === "string") return arg.value
      if (arg.kind === "number") return arg.value
      if (arg.kind === "boolean") return arg.value
      if (arg.kind === "date") return arg.value
      return undefined
    }).filter((v: unknown) => v !== undefined)
    
    // Pass array for variadic operators, single value for others
    const compileValue = value && value.length === 1 ? value[0] : value
    const compiled = filter.compileFilter(f.column.id, f.operator, compileValue)
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


/**
 * Get score text color based on score value
 */
function getScoreColor(score: number): string {
  if (score >= 3000) return "text-emerald-600"
  if (score >= 1500) return "text-lime-600"
  if (score >= 500) return "text-amber-600"
  if (score >= -1000) return "text-orange-600"
  return "text-rose-600"
}

/**
 * Get the number of missing arguments for a suggestion
 */
function getMissingArgsCount(suggestion: FilterSuggestion): number {
  const opInfo = getOperator(suggestion.operator)
  const minArgs = opInfo.isVariadic ? (opInfo.minArguments ?? 1) : (opInfo.requiresArgument ? 1 : 0)
  const currentArgs = suggestion.parts.arguments?.length ?? 0
  return Math.max(0, minArgs - currentArgs)
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
  
  // Show all argument values
  if (suggestion.arguments && suggestion.arguments.length > 0) {
    const argValues = suggestion.arguments.map((arg) => {
      if (arg.kind === "string") return `"${arg.value}"`
      if (arg.kind === "number") return String(arg.value)
      if (arg.kind === "date") return arg.value.toISOString().split("T")[0]
      if (arg.kind === "boolean") return String(arg.value)
      return "?"
    })
    lines.push(`Arguments: [${argValues.join(", ")}]`)
    
    // Show if more arguments are needed
    const missingCount = getMissingArgsCount(suggestion)
    if (missingCount > 0) {
      lines.push(`Missing: ${missingCount} more value(s) needed`)
    }
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

// Get column by ID from schema
function getColumnById(columnId: string) {
  return TASK_SCHEMA.columns.find((c) => c.id === columnId)
}

// Column definitions for headers
const statusColumn = getColumnById(COLUMN_IDS.status)
const assigneeColumn = getColumnById(COLUMN_IDS.assignee)
const priorityColumn = getColumnById(COLUMN_IDS.priority)
const departmentColumn = getColumnById(COLUMN_IDS.department)
const createdColumn = getColumnById(COLUMN_IDS.created)
const isBlockedColumn = getColumnById(COLUMN_IDS.isBlocked)
const commentsColumn = getColumnById(COLUMN_IDS.comments)
</script>

<template>
  <div class="w-full flex flex-col gap-6 min-h-0 flex-1">
    <!-- Filter controls -->
    <div class="space-y-4">
      <!-- Applied filters -->
      <div v-if="appliedFilters.length > 0" class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-muted-foreground font-medium">Active filters:</span>
        <div
          v-for="f in appliedFilters"
          :key="f.id"
          class="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 h-auto bg-secondary text-secondary-foreground rounded-md text-xs"
        >
          <span class="font-medium text-foreground truncate">
            {{ f.parts.column.text }}
          </span>
          <span class="shrink-0 h-4 px-1 rounded inline-flex items-center font-medium bg-muted text-muted-foreground text-[10px]">
            {{ f.parts.operator.matchedAlias ?? f.parts.operator.text }}
          </span>
          <!-- Render existing arguments (no placeholders for applied filters) -->
          <span 
            v-for="(arg, i) in f.parts.arguments" 
            :key="i"
            class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground"
          >
            {{ arg.text }}
          </span>
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
          <!-- Column headers - matches item padding -->
          <div class="flex items-center w-full gap-2 pl-3 pr-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b border-border/50 whitespace-nowrap">
            <span class="flex-1">Suggestion</span>
            <span class="w-10 shrink-0">Score</span>
            <span class="w-14 shrink-0"># Results</span>
          </div>
          <div class="max-h-80 overflow-y-auto p-1">
            <div
              v-for="(suggestion, index) in suggestions"
              :key="suggestion.id"
              :data-testid="`suggestion-${suggestion.column.id}-${suggestion.operator}`"
              :class="cn(
                'flex items-center w-full gap-2 pl-2 pr-3 py-1.5 cursor-pointer rounded-md transition-colors text-xs',
                index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
              )"
              @click="handleSelect(index)"
            >
              <!-- Suggestion column - left aligned, grows to push score/results right -->
              <div class="flex items-center gap-1.5 min-w-0 flex-1">
                <span class="font-medium text-foreground truncate">
                  {{ suggestion.parts.column.text }}
                </span>
                <span class="shrink-0 h-4 px-1 rounded inline-flex items-center font-medium bg-muted text-muted-foreground text-[10px]">
                  {{ suggestion.parts.operator.matchedAlias ?? suggestion.parts.operator.text }}
                </span>
                <!-- Render existing arguments -->
                <span 
                  v-for="(arg, i) in suggestion.parts.arguments" 
                  :key="i"
                  class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground"
                >
                  {{ arg.text }}
                </span>
                <!-- Render placeholders for missing arguments -->
                <span 
                  v-for="i in getMissingArgsCount(suggestion)" 
                  :key="`missing-${i}`"
                  class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-dashed border-muted-foreground/40 text-muted-foreground/50"
                >
                  …
                </span>
              </div>
              
              <!-- Score column - left aligned, fixed width -->
              <span
                :class="cn('w-10 font-mono tabular-nums cursor-help shrink-0', getScoreColor(suggestion.score))"
                :title="getScoreTooltip(suggestion)"
              >
                {{ Math.round(suggestion.score) }}
              </span>
              
              <!-- Results column - left aligned, fixed width -->
              <span 
                class="w-14 text-muted-foreground tabular-nums shrink-0" 
                data-testid="result-count"
              >
                {{ suggestion.resultCount.toLocaleString() }}
              </span>
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
    <div class="overflow-hidden rounded-lg border border-border flex flex-col max-h-full">
      <div
        ref="scrollContainerRef"
        class="flex-1 overflow-auto min-h-0 isolate"
      >
        <table class="w-full">
          <thead class="sticky top-0 z-10 bg-muted">
            <tr class="border-b">
              <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
                <ColumnInfoPopover v-if="statusColumn" :column="statusColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="statusColumn.type" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">Status</span>
                  </div>
                </ColumnInfoPopover>
              </th>
              <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
                <ColumnInfoPopover v-if="assigneeColumn" :column="assigneeColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="assigneeColumn.type" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">Assignee</span>
                  </div>
                </ColumnInfoPopover>
              </th>
              <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
                <ColumnInfoPopover v-if="priorityColumn" :column="priorityColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="priorityColumn.type" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">Priority</span>
                  </div>
                </ColumnInfoPopover>
              </th>
              <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
                <ColumnInfoPopover v-if="departmentColumn" :column="departmentColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="departmentColumn.type" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">Dept</span>
                  </div>
                </ColumnInfoPopover>
              </th>
              <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
                <ColumnInfoPopover v-if="createdColumn" :column="createdColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="createdColumn.type" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">Created</span>
                  </div>
                </ColumnInfoPopover>
              </th>
              <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
                <ColumnInfoPopover v-if="isBlockedColumn" :column="isBlockedColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="isBlockedColumn.type" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">Blocked</span>
                  </div>
                </ColumnInfoPopover>
              </th>
              <th class="px-3 py-3 text-left font-normal">
                <ColumnInfoPopover v-if="commentsColumn" :column="commentsColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="commentsColumn.type" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">Comments</span>
                  </div>
                </ColumnInfoPopover>
              </th>
            </tr>
          </thead>
          <tbody>
            <!-- Empty state -->
            <tr v-if="filteredData.length === 0">
              <td colspan="7">
                <div class="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <FilterIcon class="size-10 mb-3 opacity-40" />
                  <p class="text-sm font-medium">No rows matching your filters</p>
                  <p class="text-xs mt-1">Try adjusting or removing some filters</p>
                </div>
              </td>
            </tr>
            <!-- Virtual scroll rows -->
            <template v-else>
              <!-- Spacer row to account for virtual scroll offset -->
              <tr :style="{ height: `${virtualizer.getVirtualItems()[0]?.start ?? 0}px` }" />
              <tr
                v-for="virtualRow in virtualizer.getVirtualItems()"
                :key="filteredData[virtualRow.index].id"
                :class="cn(
                  'border-b transition-colors h-12',
                  appliedFilters.length > 0 ? 'bg-primary/5' : '',
                  filteredData[virtualRow.index].id % 2 !== 0 ? 'bg-muted/30' : ''
                )"
              >
                <td class="px-3 py-2 whitespace-nowrap h-12">
                  <span :class="cn(
                    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                    statusVariants[filteredData[virtualRow.index].status]?.bg ?? 'bg-muted',
                    statusVariants[filteredData[virtualRow.index].status]?.text ?? 'text-muted-foreground'
                  )">
                    {{ filteredData[virtualRow.index].status }}
                  </span>
                </td>
                <td class="px-3 py-2 font-medium whitespace-nowrap h-12">{{ filteredData[virtualRow.index].assignee }}</td>
                <td class="px-3 py-2 whitespace-nowrap h-12">
                  <div class="flex items-center gap-1">
                    <div :class="cn('size-2 rounded-full', priorityColors[filteredData[virtualRow.index].priority - 1] ?? priorityColors[0])" />
                    <span class="text-sm tabular-nums">{{ filteredData[virtualRow.index].priority }}</span>
                  </div>
                </td>
                <td class="px-3 py-2 text-muted-foreground whitespace-nowrap h-12">{{ filteredData[virtualRow.index].department }}</td>
                <td class="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap h-12">{{ filteredData[virtualRow.index].created }}</td>
                <td class="px-3 py-2 text-center whitespace-nowrap h-12">
                  <XIcon v-if="filteredData[virtualRow.index].isBlocked" class="size-4 text-rose-500 mx-auto" />
                  <CheckIcon v-else class="size-4 text-emerald-500 mx-auto" />
                </td>
                <td class="px-3 py-2 text-muted-foreground text-sm h-12 max-w-xs" :title="filteredData[virtualRow.index].comments">
                  <span class="block truncate">
                    <template v-if="filteredData[virtualRow.index].comments">{{ filteredData[virtualRow.index].comments }}</template>
                    <span v-else class="text-muted-foreground/50 italic">No comments</span>
                  </span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <!-- Padding element to ensure proper scroll height -->
        <div v-if="filteredData.length > 0" :style="{ height: `${virtualizer.getTotalSize() - (virtualizer.getVirtualItems()[virtualizer.getVirtualItems().length - 1]?.end ?? 0)}px` }" />
      </div>
    </div>
  </div>
</template>
