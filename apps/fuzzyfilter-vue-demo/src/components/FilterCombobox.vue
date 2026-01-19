<script setup lang="ts">
/**
 * FilterCombobox - Vue Component for FuzzyFilter
 * 
 * Demonstrates the fuzzyfilter-vue composable with a combobox interface.
 * Uses virtual scrolling to handle large datasets (10,000+ rows).
 * 
 * NOW USING: Playground DataModel (industrial processing data)
 */
import { ref, onMounted, computed, watch, nextTick } from "vue"
import { useVirtualizer } from "@tanstack/vue-virtual"
import { useFuzzyFilter } from "fuzzyfilter-vue"
import { FuzzyFilter, type CompiledFilter, type FilterSuggestion, type HypothesisValueType, type QueryMatch } from "@jasperhino/fuzzyfilter"
import { useI18n } from "vue-i18n"
import DataTypeIcon from "./DataTypeIcon.vue"
import ColumnInfoPopover from "./ColumnInfoPopover.vue"
import QueryVisualization from "./QueryVisualization.vue"
import {
  FilterIcon,
  CheckIcon,
  XIcon,
  SearchIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  ChevronsUpDownIcon,
} from "lucide-vue-next"
import { cn } from "@/lib/utils"
import { attachAxiomExporter } from "@/lib/axiom-telemetry"
import { 
  createPlaygroundFilterConfig, 
  PLAYGROUND_COLUMN_IDS,
  PLAYGROUND_DATASET,
  generateSingleRow,
  type PlaygroundDataRow,
  type MaterialContainer,
} from "@/config"

// Use pre-generated playground dataset (10,000 rows with seed 42)
const INITIAL_DATASET = PLAYGROUND_DATASET

// Version counter to trigger reactivity when data changes
const dataVersion = ref(0)

// Row height for virtual scroll
const ROW_HEIGHT = 48

/**
 * Sort direction type for column sorting
 */
type SortDirection = "asc" | "desc"

/**
 * Sorting state for the data table
 */
interface SortState {
  column: keyof PlaygroundDataRow | null
  direction: SortDirection
}

// Get i18n composer for reactive locale access
const i18nComposer = useI18n()
const { locale, t } = i18nComposer

// Create filter instance using new field-centric API
const filterConfig = createPlaygroundFilterConfig()
const filter = new FuzzyFilter({
  ...filterConfig,
  maxSuggestions: 12,
  benchmark: true, // Enable to see telemetry spans via window.__filter.getTelemetry()
})

// Expose filter globally for debugging
// Access in console: window.__filter.getTelemetry()?.getSpans()
;(window as unknown as { __filter: typeof filter }).__filter = filter

// Initialize data
onMounted(() => {
  filter.indexData(INITIAL_DATASET)
  
  // Trigger reactivity update so filteredData re-evaluates
  dataVersion.value++
  
  // Attach Axiom telemetry exporter if configured
  attachAxiomExporter(filter.getTelemetry())
})

// Applied filters state
const appliedFilters = ref<FilterSuggestion[]>([])
const appliedFiltersForContext = appliedFilters

const compiledFiltersForContext = computed(() => {
  const compiled: CompiledFilter[] = []
  for (const f of appliedFilters.value) {
    // Compile using fromOverload for new API
    if (f.overloadIds?.[0]) {
      const c = filter.compileFromOverload(f.overloadIds[0], f.args || {})
      if (c) compiled.push(c)
    }
  }
  return compiled
})

// Use the composable with filter context for stacked counts
const {
  query,
  suggestionsQuery,
  suggestions,
  selectedIndex,
  navigateSuggestions,
  selectSuggestion,
  setQuery,
  isIndexing,
  indexProgress,
  addRow: hookAddRow,
  deleteRow: hookDeleteRow,
  getData,
} = useFuzzyFilter(filter, {
  debounceMs: 150,
  filterContext: compiledFiltersForContext,
})

// Selected row for deletion - stores the row ID (not display index)
const selectedRowId = ref<string | null>(null)

// Sorting state for table columns
const sortState = ref<SortState>({
  column: null,
  direction: "asc",
})

/**
 * Handle column header click to toggle sorting
 */
function handleSort(columnId: keyof PlaygroundDataRow) {
  const current = sortState.value
  if (current.column === columnId) {
    if (current.direction === "asc") {
      sortState.value = { column: columnId, direction: "desc" }
    } else {
      sortState.value = { column: null, direction: "asc" }
    }
  } else {
    sortState.value = { column: columnId, direction: "asc" }
  }
}

// Add a new random row
function handleAddRow() {
  const newRow = generateSingleRow()
  hookAddRow(newRow)
  dataVersion.value++
}

// Delete the selected row by finding its actual index in the original data
function handleDeleteRow() {
  if (selectedRowId.value === null) return
  
  const originalData = getData() as PlaygroundDataRow[]
  const originalIndex = originalData.findIndex(row => row.id === selectedRowId.value)
  
  if (originalIndex !== -1) {
    hookDeleteRow(originalIndex)
    dataVersion.value++
  }
  selectedRowId.value = null
}

// Handle row click for selection
function handleRowClick(rowId: string) {
  selectedRowId.value = selectedRowId.value === rowId ? null : rowId
}

// Refetch suggestions when language changes
const prevLocaleRef = ref(locale.value)
watch(
  () => locale.value,
  (newLocale) => {
    if (newLocale !== prevLocaleRef.value) {
      prevLocaleRef.value = newLocale
      
      // Update filter locale to rebuild argument value trie with new translations
      filter.setLocale(newLocale)
      
      const currentQuery = query.value.trim()
      
      if (currentQuery) {
        setQuery("")
        setTimeout(() => {
          setQuery(currentQuery)
        }, 10)
      } else {
        setQuery("\x00")
        setTimeout(() => {
          setQuery("")
        }, 10)
      }
    }
  }
)

// Virtual scroll container ref
const isOpen = ref(false)

// Track hovered suggestion index for input highlighting
const hoveredIndex = ref<number | null>(null)

// Cursor position for tab completion
const cursorPosition = ref(0)

// DOM refs
const scrollContainerRef = ref<HTMLDivElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

/**
 * Compare two values for sorting based on their type
 */
function compareValues(a: unknown, b: unknown, direction: SortDirection): number {
  const multiplier = direction === "asc" ? 1 : -1

  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  if (typeof a === "boolean" && typeof b === "boolean") {
    return (a === b ? 0 : a ? -1 : 1) * multiplier
  }

  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * multiplier
  }

  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b) * multiplier
  }

  if (a instanceof Date && b instanceof Date) {
    return (a.getTime() - b.getTime()) * multiplier
  }

  return String(a).localeCompare(String(b)) * multiplier
}

/**
 * Formats a score as .333 (no leading zero, 3 digits)
 */
function formatScore(score: number): string {
  const s = score.toFixed(3)
  return s.startsWith("0") ? s.substring(1) : s
}

// Filtered and sorted data
const filteredData = computed(() => {
  void dataVersion.value
  const currentData = getData() as PlaygroundDataRow[]
  
  let result: PlaygroundDataRow[]
  if (appliedFilters.value.length === 0) {
    result = [...currentData]
  } else {
    result = currentData.filter((row) =>
      compiledFiltersForContext.value.every((cf) => cf.predicate(row))
    )
  }

  if (sortState.value.column) {
    const { column, direction } = sortState.value
    result.sort((a, b) => compareValues(a[column], b[column], direction))
  }

  return result
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
      if (!appliedFilters.value.some((f) => f.label === suggestion.label)) {
        appliedFilters.value = [...appliedFilters.value, suggestion]
      }
      query.value = ""
      isOpen.value = false
      hoveredIndex.value = null
    } else {
      query.value = suggestion.completionText
    }
  }
}

// Remove a filter
function removeFilter(label: string) {
  appliedFilters.value = appliedFilters.value.filter((f) => f.label !== label)
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

// Check if query is in sync with suggestions
const isQueryInSync = computed(() => query.value === suggestionsQuery.value)

// Highlighted suggestion (for ghost text and visualization)
const highlightedSuggestion = computed(() => {
  if (!isQueryInSync.value || suggestions.value.length === 0) return null
  if (hoveredIndex.value !== null) return suggestions.value[hoveredIndex.value]
  return suggestions.value[selectedIndex.value] ?? suggestions.value[0]
})

// Ghost text logic for input
const ghostText = computed(() => {
  if (!query.value || !highlightedSuggestion.value?.tabCompletion) return ""
  
  const tab = highlightedSuggestion.value.tabCompletion
  
  // Only show if the completion is at the end of the query and 
  // matches exactly what we have so far in that range
  if (tab.range.end === query.value.length) {
    const originalInQuery = query.value.slice(tab.range.start, tab.range.end)
    if (originalInQuery === tab.original) {
      return tab.completion.slice(tab.original.length)
    }
  }
  
  return ""
})

// Apply tab completion
function applyTabCompletion(tab: import("@jasperhino/fuzzyfilter").TabCompletion) {
  const before = query.value.slice(0, tab.range.start)
  const after = query.value.slice(tab.range.end)
  query.value = before + tab.completion + after
  
  // Maintain cursor position at end of completion
  nextTick(() => {
    if (inputRef.value) {
      const newPos = tab.range.start + tab.completion.length
      inputRef.value.setSelectionRange(newPos, newPos)
      cursorPosition.value = newPos
    }
  })
}

// Handle keyboard events
function handleKeydown(event: KeyboardEvent) {
  // Update cursor position after keydown
  setTimeout(() => {
    if (inputRef.value) {
      cursorPosition.value = inputRef.value.selectionStart ?? 0
    }
  }, 0)

  // Handle Tab or ArrowRight (at end) to accept ghost text
  if (event.key === "Tab" || (event.key === "ArrowRight" && cursorPosition.value === query.value.length)) {
    if (ghostText.value && highlightedSuggestion.value?.tabCompletion) {
      event.preventDefault()
      applyTabCompletion(highlightedSuggestion.value.tabCompletion)
      return
    }
  }

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
  if (score >= 0.8) return "text-emerald-600"
  if (score >= 0.6) return "text-lime-600"
  if (score >= 0.4) return "text-amber-600"
  if (score >= 0.2) return "text-orange-600"
  return "text-rose-600"
}

// Processing type badge variants
const processingTypeVariants: Record<string, { bg: string; text: string }> = {
  "biochar": { bg: "bg-emerald-500/15", text: "text-emerald-600" },
  "biomass": { bg: "bg-amber-500/15", text: "text-amber-600" },
  "pyrolysis": { bg: "bg-rose-500/15", text: "text-rose-600" },
}

// Format number with locale
function formatNumber(num: number): string {
  return num.toLocaleString()
}

// Format date to readable string
function formatDate(date: Date): string {
  return date.toLocaleDateString(locale.value, { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  })
}

// Format timeframe
function formatTimeframe(timeframe: { start: Date; end: Date }): string {
  return `${formatDate(timeframe.start)} - ${formatDate(timeframe.end)}`
}

// Format amount
function formatAmount(amount: { value: number; unit: string }): string {
  return `${amount.value.toLocaleString()} ${amount.unit}`
}

// Format contents (material containers)
function formatContents(contents: MaterialContainer[]): string {
  return contents.map(c => `${c.materialName}: ${c.weightInKg}kg`).join(', ')
}

/**
 * Helper to convert QueryMatch array into renderable segments for highlighting.
 */
interface HighlightSegment {
  text: string
  matchType: "column" | "operator" | "value" | null
}

function getHighlightSegments(queryText: string, matches: QueryMatch[]): HighlightSegment[] {
  if (!matches.length || !queryText) {
    return [{ text: queryText, matchType: null }]
  }

  const matchTypePriority = { column: 0, operator: 1, value: 2 }

  const sorted = [...matches].sort((a, b) => {
    if (a.inputRange.start !== b.inputRange.start) {
      return a.inputRange.start - b.inputRange.start
    }
    return matchTypePriority[a.matchType] - matchTypePriority[b.matchType]
  })

  const segments: HighlightSegment[] = []
  let currentPos = 0

  for (const match of sorted) {
    if (match.inputRange.end <= currentPos) continue

    const effectiveStart = Math.max(match.inputRange.start, currentPos)

    if (effectiveStart > currentPos) {
      segments.push({
        text: queryText.slice(currentPos, effectiveStart),
        matchType: null,
      })
    }

    segments.push({
      text: queryText.slice(effectiveStart, match.inputRange.end),
      matchType: match.matchType,
    })

    currentPos = match.inputRange.end
  }

  if (currentPos < queryText.length) {
    segments.push({
      text: queryText.slice(currentPos),
      matchType: null,
    })
  }

  return segments
}

// Query matches from the highlighted suggestion
const inputQueryMatches = computed(() => {
  return highlightedSuggestion.value?.matches ?? []
})

// Get row by virtual index
function getRow(index: number) {
  return filteredData.value[index]!
}
</script>

<template>
  <div class="w-full flex flex-col gap-6 min-h-0 flex-1">
    <!-- Filter controls -->
    <div class="space-y-4">
      <!-- Query visualization above combobox -->
      <QueryVisualization
        :query="query"
        :matches="inputQueryMatches"
        :suggestion="highlightedSuggestion ?? undefined"
      />

      <!-- Combobox -->
      <div class="relative">
        <div class="flex items-center gap-2 px-3 py-2 bg-background rounded-lg border border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 transition-all relative">
          <SearchIcon class="size-4 text-muted-foreground shrink-0" />
          <div class="flex-1 relative flex items-center min-w-0">
            <!-- Ghost Text Overlay -->
            <div 
              v-if="ghostText"
              class="absolute inset-0 pointer-events-none flex items-center text-sm"
            >
              <span class="opacity-0 whitespace-pre">{{ query }}</span>
              <span class="text-muted-foreground/40 whitespace-pre">{{ ghostText }}</span>
            </div>
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              :placeholder="t('app.ui.filterPlaceholder')"
              class="flex-1 w-full bg-transparent placeholder:text-muted-foreground outline-none text-sm text-foreground relative z-10"
              @focus="handleFocus"
              @blur="handleBlur"
              @keydown="handleKeydown"
            />
          </div>
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
          <div class="flex items-center w-full gap-2 pl-3 pr-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b border-border/50 whitespace-nowrap">
            <span class="flex-1">{{ t("app.ui.suggestion") }}</span>
            <span class="w-10 shrink-0">{{ t("app.ui.score") }}</span>
            <span class="w-14 shrink-0">{{ t("app.ui.results") }}</span>
            <span v-if="isIndexing" class="flex items-center gap-1 text-primary shrink-0">
              <Loader2Icon class="size-3 animate-spin" />
              <span>{{ indexProgress ? `${indexProgress.percentage}%` : '' }}</span>
            </span>
          </div>
          <div class="max-h-80 overflow-y-auto p-1">
            <div
              v-for="(suggestion, index) in suggestions"
              :key="`${index}-${suggestion.label}`"
              :data-testid="`suggestion-${suggestion.fieldKey}-${suggestion.operatorId}`"
              :class="cn(
                'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
                index === selectedIndex ? 'bg-accent' : 'hover:bg-muted'
              )"
              @click="handleSelect(index)"
              @mouseenter="hoveredIndex = index"
              @mouseleave="hoveredIndex = null"
            >
              <div class="flex-1 flex items-center gap-1.5 min-w-0">
                <CheckIcon v-if="suggestion.isComplete" class="size-3.5 text-emerald-500 shrink-0" />
                <span class="text-sm truncate">{{ suggestion.label }}</span>
              </div>
              <span :class="cn('text-xs tabular-nums w-10 text-right shrink-0', getScoreColor(suggestion.score))">
                {{ formatScore(suggestion.score) }}
              </span>
              <span class="text-xs tabular-nums text-muted-foreground w-14 text-right shrink-0">
                {{ formatNumber(suggestion.resultCount ?? 0) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Applied filters -->
    <div v-if="appliedFilters.length > 0" class="flex items-center gap-2 flex-wrap">
      <div
        v-for="filter in appliedFilters"
        :key="filter.label"
        class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 text-primary text-sm"
      >
        <span>{{ filter.label }}</span>
        <button
          @click="removeFilter(filter.label)"
          class="p-0.5 rounded-full hover:bg-primary/20 transition-colors"
        >
          <XIcon class="size-3" />
        </button>
      </div>
      <button
        @click="clearAllFilters"
        class="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {{ t("app.ui.clearAll") }}
      </button>
    </div>

    <!-- Table controls -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <button
          @click="handleAddRow"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <PlusIcon class="size-4" />
          {{ t("app.ui.addRow") }}
        </button>
        <button
          v-if="selectedRowId !== null"
          @click="handleDeleteRow"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
        >
          <Trash2Icon class="size-4" />
          {{ t("app.ui.deleteRow") }}
        </button>
      </div>
      <span class="text-xs text-muted-foreground" data-testid="filter-summary">
        {{
          appliedFilters.length > 0
            ? t("app.ui.filterSummary", {
                filterCount: appliedFilters.length,
                filteredCount: formatNumber(filteredData.length),
                totalCount: formatNumber(getData().length),
              })
            : t("app.ui.itemCount", {
                filteredCount: formatNumber(filteredData.length),
                totalCount: formatNumber(getData().length),
              })
        }}
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
              <button
                type="button"
                @click="handleSort('processing_type')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <span class="font-medium text-muted-foreground text-sm">Processing Type</span>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'processing_type' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'processing_type' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <button
                type="button"
                @click="handleSort('date')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <span class="font-medium text-muted-foreground text-sm">Date</span>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'date' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'date' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <button
                type="button"
                @click="handleSort('count')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <span class="font-medium text-muted-foreground text-sm">Count</span>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'count' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'count' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <button
                type="button"
                @click="handleSort('amount')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <span class="font-medium text-muted-foreground text-sm">Amount</span>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'amount' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'amount' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <span class="font-medium text-muted-foreground text-sm">Timeframe</span>
            </th>
            <th class="px-3 py-3 text-left font-normal">
              <span class="font-medium text-muted-foreground text-sm">Contents</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- Empty state -->
          <tr v-if="filteredData.length === 0">
            <td colspan="6">
              <div class="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <FilterIcon class="size-10 mb-3 opacity-40" />
                <p class="text-sm font-medium">{{ t("app.ui.noRowsTitle") }}</p>
                <p class="text-xs mt-1">{{ t("app.ui.noRowsHint") }}</p>
              </div>
            </td>
          </tr>
          <!-- Virtual scroll rows -->
          <template v-else>
            <!-- Spacer row to account for virtual scroll offset -->
            <tr :style="{ height: `${virtualizer.getVirtualItems()[0]?.start ?? 0}px` }" />
            <tr
              v-for="virtualRow in virtualizer.getVirtualItems()"
              :key="`virtual-${virtualRow.index}`"
              :class="cn(
                'border-b transition-all h-12 cursor-pointer',
                selectedRowId === getRow(virtualRow.index).id 
                  ? 'border-l-4 border-l-primary' 
                  : 'border-l-2 border-l-transparent hover:border-l-primary/40'
              )"
              @click="handleRowClick(getRow(virtualRow.index).id)"
            >
              <td class="px-3 py-2 whitespace-nowrap h-12">
                <span :class="cn(
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                  processingTypeVariants[getRow(virtualRow.index).processing_type]?.bg ?? 'bg-muted',
                  processingTypeVariants[getRow(virtualRow.index).processing_type]?.text ?? 'text-muted-foreground'
                )">
                  {{ getRow(virtualRow.index).processing_type }}
                </span>
              </td>
              <td class="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap h-12 text-sm">
                {{ formatDate(getRow(virtualRow.index).date) }}
              </td>
              <td class="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap h-12 text-sm">
                {{ formatNumber(getRow(virtualRow.index).count) }}
              </td>
              <td class="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap h-12 text-sm">
                {{ formatAmount(getRow(virtualRow.index).amount) }}
              </td>
              <td class="px-3 py-2 text-muted-foreground whitespace-nowrap h-12 text-xs">
                {{ formatTimeframe(getRow(virtualRow.index).timeframe) }}
              </td>
              <td class="px-3 py-2 text-muted-foreground text-xs h-12 max-w-xs" :title="formatContents(getRow(virtualRow.index).contents)">
                <span class="block truncate">
                  {{ formatContents(getRow(virtualRow.index).contents) }}
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
