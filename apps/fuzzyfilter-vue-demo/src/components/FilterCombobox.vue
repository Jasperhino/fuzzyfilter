<script setup lang="ts">
/**
 * FilterCombobox - Vue Component for FuzzyFilter
 * 
 * Demonstrates the fuzzyfilter-vue composable with a combobox interface.
 * Uses virtual scrolling to handle large datasets (10,000+ rows).
 */
import { ref, onMounted, computed, watch } from "vue"
import { useVirtualizer } from "@tanstack/vue-virtual"
import { useFuzzyFilter } from "fuzzyfilter-vue"
import { createFuzzyFilter, createOperator, getOperator, defaultFuzzyFilterOperators, type CompiledFilter, type FilterSuggestion, type HypothesisValueType, type QueryMatch, type OperatorDefinition, createVueI18nProvider } from "@jasperhino/fuzzyfilter"
import { isOperatorVariadic, operatorRequiresArgument, getMinArguments } from "@/lib/operator-helpers"
import { TASK_SCHEMA, COLUMN_IDS, LARGE_DATASET, generateSingleTaskAsync, Amount, type Task as TaskRow } from "@fuzzyfilter/sample-data"
import { useI18n } from "vue-i18n"
import { i18n } from "@/i18n"
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

// Use pre-generated dataset (10,000 rows with seed 42)
// This avoids loading faker.js at runtime, significantly improving LCP
const INITIAL_DATASET = LARGE_DATASET

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
  column: keyof TaskRow | null
  direction: SortDirection
}

// Get i18n composer for reactive locale access
const i18nComposer = useI18n()
const { locale, t } = i18nComposer

// Create a type-safe custom operator using createOperator
// The {:amount} syntax infers types from the pattern - no manual casting needed!
const greaterAmountOp = createOperator<{ amount: Amount }>()({
  id: "greater",
  patterns: ["t(operators.greater) {:amount}"],
  predicate: (operand: Amount, { amount }) => operand.toKg() > amount.toKg(),
})

// Create filter instance with i18n
// Set benchmark: true to enable telemetry spans (accessible via filter.getTelemetry())
const filter = createFuzzyFilter({ 
  maxSuggestions: 12,
  columns: TASK_SCHEMA.columns,
  operators: [
    ...defaultFuzzyFilterOperators,
    // Cast to OperatorDefinition - type safety is enforced at createOperator() call site
    greaterAmountOp as unknown as OperatorDefinition,
  ],
  i18n: createVueI18nProvider(i18n as any),
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
  // Set VITE_AXIOM_API_KEY and VITE_AXIOM_DATASET environment variables to enable
  attachAxiomExporter(filter.getTelemetry())
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
    
    // Check if operator is variadic (in, nin, between) - always pass array for these
    const opInfo = getOperator(f.operator)
    const compileValue = isOperatorVariadic(opInfo)
      ? value  // Always pass array for variadic operators
      : (value && value.length === 1 ? value[0] : value)  // Unwrap single values for non-variadic
    const c = filter.compileFilter(f.column.id, f.operator, compileValue)
    if (c) compiled.push(c)
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
const selectedRowId = ref<number | null>(null)

// Sorting state for table columns
const sortState = ref<SortState>({
  column: null,
  direction: "asc",
})

/**
 * Handle column header click to toggle sorting
 * @param columnId - The column to sort by
 */
function handleSort(columnId: keyof TaskRow) {
  const current = sortState.value
  if (current.column === columnId) {
    // Toggle direction if same column, or clear if already desc
    if (current.direction === "asc") {
      sortState.value = { column: columnId, direction: "desc" }
    } else {
      // Clear sorting
      sortState.value = { column: null, direction: "asc" }
    }
  } else {
    // New column, start with ascending
    sortState.value = { column: columnId, direction: "asc" }
  }
}

// Add a new random row using faker (lazy-loaded)
// Uses Date.now() for the created timestamp to show when the row was actually created
async function handleAddRow() {
  const currentData = getData() as TaskRow[]
  const newId = currentData.length > 0 
    ? Math.max(...currentData.map(r => r.id)) + 1 
    : 1
  const newTask = await generateSingleTaskAsync(newId)
  // Override the created timestamp with the current time (second precision)
  newTask.created = new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
  hookAddRow(newTask)
  dataVersion.value++
}

// Delete the selected row by finding its actual index in the original data
function handleDeleteRow() {
  if (selectedRowId.value === null) return
  
  // Find the actual index in the original data array using the row's ID
  const originalData = getData() as TaskRow[]
  const originalIndex = originalData.findIndex(row => row.id === selectedRowId.value)
  
  if (originalIndex !== -1) {
    hookDeleteRow(originalIndex)
    dataVersion.value++
  }
  selectedRowId.value = null
}

// Handle row click for selection - receives the row ID
function handleRowClick(rowId: number) {
  selectedRowId.value = selectedRowId.value === rowId ? null : rowId
}

// Refetch suggestions when language changes
// This ensures suggestions update with new translations immediately
const prevLocaleRef = ref(locale.value)
watch(
  () => locale.value,
  (newLocale) => {
    // When language changes, trigger a refetch by updating the query
    // This causes the composable to refetch suggestions with the new translations
    if (newLocale !== prevLocaleRef.value) {
      prevLocaleRef.value = newLocale
      const currentQuery = query.value.trim()
      
      // Force a refetch by temporarily changing the query
      // For empty queries, set a temporary value then clear it
      // For non-empty queries, clear then restore
      if (currentQuery) {
        setQuery("")
        setTimeout(() => {
          setQuery(currentQuery)
        }, 10)
      } else {
        // For empty queries, use a temporary marker to force a refetch
        setQuery("\x00") // Null character - triggers change detection
        setTimeout(() => {
          setQuery("")
        }, 10)
      }
    }
  }
)

// Applied filters state - use the same ref for both display and context
const appliedFilters = appliedFiltersForContext
const isOpen = ref(false)

// Track hovered suggestion index for input highlighting
const hoveredIndex = ref<number | null>(null)

// Virtual scroll container ref
const scrollContainerRef = ref<HTMLDivElement | null>(null)

/**
 * Compare two values for sorting based on their type
 * Handles strings, numbers, booleans, and dates
 */
function compareValues(a: unknown, b: unknown, direction: SortDirection): number {
  const multiplier = direction === "asc" ? 1 : -1

  // Handle null/undefined
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  // Handle booleans (true comes before false in ascending)
  if (typeof a === "boolean" && typeof b === "boolean") {
    return (a === b ? 0 : a ? -1 : 1) * multiplier
  }

  // Handle numbers
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * multiplier
  }

  // Handle strings (including dates in YYYY-MM-DD format)
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b) * multiplier
  }

  // Fallback: convert to string and compare
  return String(a).localeCompare(String(b)) * multiplier
}

// Filtered and sorted data
const filteredData = computed(() => {
  // Access dataVersion to create reactive dependency
  void dataVersion.value
  const currentData = getData() as TaskRow[]
  
  // Step 1: Apply filters
  let result: TaskRow[]
  if (appliedFilters.value.length === 0) {
    result = [...currentData] // Clone to avoid mutating original
  } else {
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
      
      // Check if operator is variadic (in, nin, between) - always pass array for these
      const opInfo = getOperator(f.operator)
      const compileValue = isOperatorVariadic(opInfo)
        ? value  // Always pass array for variadic operators
        : (value && value.length === 1 ? value[0] : value)  // Unwrap single values for non-variadic
      const compiled = filter.compileFilter(f.column.id, f.operator, compileValue)
      if (compiled) {
        compiledFilters.push(compiled)
      }
    }
    
    result = currentData.filter((row) =>
      compiledFilters.every((cf) => cf.predicate(row))
    )
  }

  // Step 2: Apply sorting
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
      // Add to applied filters (avoid duplicates)
      if (!appliedFilters.value.some((f) => f.id === suggestion.id)) {
        appliedFilters.value = [...appliedFilters.value, suggestion]
      }
      // Clear the combobox input and close dropdown
      query.value = ""
      isOpen.value = false
      // Reset hover state
      hoveredIndex.value = null
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
  // Score is now 0-1 range
  if (score >= 0.8) return "text-emerald-600"
  if (score >= 0.6) return "text-lime-600"
  if (score >= 0.4) return "text-amber-600"
  if (score >= 0.2) return "text-orange-600"
  return "text-rose-600"
}

/**
 * Get the number of missing arguments for a suggestion
 */
function getMissingArgsCount(suggestion: FilterSuggestion): number {
  const opInfo = getOperator(suggestion.operator)
  const minArgs = isOperatorVariadic(opInfo) ? (getMinArguments(opInfo) || 1) : (operatorRequiresArgument(opInfo) ? 1 : 0)
  const currentArgs = suggestion.parts.arguments?.length ?? 0
  return Math.max(0, minArgs - currentArgs)
}

// Get score tooltip
function getScoreTooltip(suggestion: FilterSuggestion): string {
  const { score, category, scoreBreakdown } = suggestion
  const lines = [
    `Final Score: ${score.toFixed(4)}`,
    `Category: ${category}`,
    "",
  ]
  
  if (scoreBreakdown) {
    lines.push(
      "── Score Breakdown ──",
      `Raw Match: ${scoreBreakdown.rawScore.toFixed(4)}`,
      `Adjusted Score: ${scoreBreakdown.adjustedScore.toFixed(4)} (${scoreBreakdown.tokenCount}/${scoreBreakdown.totalTokens} tokens)`,
    )
  }
  
  lines.push(
    "",
    "── Match Info ──",
    `Column: ${suggestion.column.id}`,
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
  
  // Show query match info for highlighting
  if (suggestion.queryMatches && suggestion.queryMatches.length > 0) {
    lines.push(
      "",
      "── Query Matches ──",
    )
    for (const match of suggestion.queryMatches) {
      lines.push(
        `${match.matchType}: "${match.inputText}" → "${match.matchedTarget}" (pos ${match.inputRange.start}-${match.inputRange.end})`
      )
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

/**
 * Maps enum data values to translation keys
 */
const STATUS_TRANSLATION_KEYS: Record<string, string> = {
  "Open": "app.values.status.open",
  "In Progress": "app.values.status.inProgress",
  "Closed": "app.values.status.closed",
  "Blocked": "app.values.status.blocked",
}

const DEPARTMENT_TRANSLATION_KEYS: Record<string, string> = {
  "Engineering": "app.values.department.engineering",
  "Design": "app.values.department.design",
  "Product": "app.values.department.product",
}

/**
 * Get translated status text
 */
function translateStatus(status: string): string {
  const key = STATUS_TRANSLATION_KEYS[status]
  return key ? t(key) : status
}

/**
 * Get translated department text
 */
function translateDepartment(department: string): string {
  const key = DEPARTMENT_TRANSLATION_KEYS[department]
  return key ? t(key) : department
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

/**
 * Helper to convert QueryMatch array into renderable segments for highlighting.
 * Segments are sorted by position and gaps are filled with unmatched text.
 */
interface HighlightSegment {
  text: string
  matchType: "column" | "operator" | "value" | null
}

function getHighlightSegments(queryText: string, matches: QueryMatch[]): HighlightSegment[] {
  if (!matches.length || !queryText) {
    return [{ text: queryText, matchType: null }]
  }

  // Priority for match types when there are overlaps: column > operator > value
  const matchTypePriority = { column: 0, operator: 1, value: 2 }

  // Sort matches by start position, then by priority (lower = higher priority)
  const sorted = [...matches].sort((a, b) => {
    if (a.inputRange.start !== b.inputRange.start) {
      return a.inputRange.start - b.inputRange.start
    }
    return matchTypePriority[a.matchType] - matchTypePriority[b.matchType]
  })

  const segments: HighlightSegment[] = []
  let currentPos = 0

  for (const match of sorted) {
    // Skip matches that are entirely within already processed text (overlapping)
    if (match.inputRange.end <= currentPos) {
      continue
    }

    // Adjust start if match overlaps with already processed text
    const effectiveStart = Math.max(match.inputRange.start, currentPos)

    // Add unmatched text before this match
    if (effectiveStart > currentPos) {
      segments.push({
        text: queryText.slice(currentPos, effectiveStart),
        matchType: null,
      })
    }

    // Add the matched segment
    segments.push({
      text: queryText.slice(effectiveStart, match.inputRange.end),
      matchType: match.matchType,
    })

    currentPos = match.inputRange.end
  }

  // Add any remaining text after last match
  if (currentPos < queryText.length) {
    segments.push({
      text: queryText.slice(currentPos),
      matchType: null,
    })
  }

  return segments
}

// Computed property for highlighted query segments based on the first suggestion
const highlightedQuerySegments = computed(() => {
  if (!query.value || suggestions.value.length === 0) {
    return []
  }
  
  const firstSuggestion = suggestions.value[0]
  if (!firstSuggestion?.queryMatches || firstSuggestion.queryMatches.length === 0) {
    return []
  }
  
  return getHighlightSegments(query.value, firstSuggestion.queryMatches)
})

// Get CSS class for match type
function getMatchTypeClass(matchType: "column" | "operator" | "value" | null): string {
  const colorClasses = {
    column: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
    operator: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
    value: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  }
  return matchType ? `px-0.5 rounded ${colorClasses[matchType]}` : "text-muted-foreground"
}

/**
 * Segment for highlighted text rendering
 */
interface TextHighlightSegment {
  text: string
  highlighted: boolean
}

/**
 * Get segments for highlighted text based on matched character indexes.
 * Used to show which characters in a suggestion matched the user's query.
 * 
 * @param text - The text to render
 * @param matchedIndexes - Array of character indexes to highlight
 */
function getTextHighlightSegments(text: string, matchedIndexes?: number[]): TextHighlightSegment[] {
  if (!matchedIndexes || matchedIndexes.length === 0) {
    return [{ text, highlighted: false }]
  }

  // Create a set for O(1) lookup
  const indexSet = new Set(matchedIndexes)
  
  // Group consecutive characters into segments
  const segments: TextHighlightSegment[] = []
  let currentSegment = { text: "", highlighted: indexSet.has(0) }
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    const isHighlighted = indexSet.has(i)
    if (isHighlighted === currentSegment.highlighted) {
      currentSegment.text += char
    } else {
      if (currentSegment.text) {
        segments.push(currentSegment)
      }
      currentSegment = { text: char, highlighted: isHighlighted }
    }
  }
  if (currentSegment.text) {
    segments.push(currentSegment)
  }

  return segments
}

/**
 * Find the query match for a specific match type from a suggestion
 */
function getMatchForType(suggestion: FilterSuggestion, matchType: "column" | "operator" | "value", valueIndex?: number): QueryMatch | undefined {
  if (!suggestion.queryMatches) return undefined
  
  if (matchType === "value") {
    // Get the nth value match
    const valueMatches = suggestion.queryMatches.filter(m => m.matchType === "value")
    return valueIndex !== undefined ? valueMatches[valueIndex] : valueMatches[0]
  }
  
  return suggestion.queryMatches.find(m => m.matchType === matchType)
}

/**
 * Get the query match for a specific argument value
 * For multiple arguments (in/not in), match by index first, then fall back to string matching
 */
function getArgMatch(suggestion: FilterSuggestion, argText: string, argIndex: number): QueryMatch | undefined {
  if (!suggestion.queryMatches) return undefined
  const valueMatches = suggestion.queryMatches.filter(m => m.matchType === "value")
  
  // Try to match by index first (for in/not in operators with multiple args)
  if (argIndex < valueMatches.length) {
    const indexMatch = valueMatches[argIndex]
    // Verify it matches the text (safety check)
    if (indexMatch && indexMatch.matchedTarget === argText) {
      return indexMatch
    }
  }
  
  // Fall back to string matching (for single args or when index doesn't match)
  return valueMatches.find(m => m.matchedTarget === argText)
}

// Check if query is in sync with suggestions (after debounce)
const isQueryInSync = computed(() => query.value === suggestionsQuery.value)

// Get the highlighted suggestion: hovered > selected > first
const highlightedSuggestion = computed(() => {
  if (!isQueryInSync.value || suggestions.value.length === 0) return null
  if (hoveredIndex.value !== null) return suggestions.value[hoveredIndex.value]
  return suggestions.value[selectedIndex.value] ?? suggestions.value[0]
})

// Computed property for the query matches from the highlighted suggestion
const inputQueryMatches = computed(() => {
  return highlightedSuggestion.value?.queryMatches ?? []
})

// Get column by ID from schema
function getColumnById(columnId: string) {
  return TASK_SCHEMA.columns.find((c) => c.id === columnId)
}

// Get row by virtual index (with non-null assertion for type safety)
function getRow(index: number) {
  return filteredData.value[index]!
}

// Column definitions for headers
const statusColumn = getColumnById(COLUMN_IDS.status)
const assigneeColumn = getColumnById(COLUMN_IDS.assignee)
const priorityColumn = getColumnById(COLUMN_IDS.priority)
const departmentColumn = getColumnById(COLUMN_IDS.department)
const dueDateColumn = getColumnById(COLUMN_IDS.dueDate)
const createdColumn = getColumnById(COLUMN_IDS.created)
const isBlockedColumn = getColumnById(COLUMN_IDS.isBlocked)
const commentsColumn = getColumnById(COLUMN_IDS.comments)
const amountColumn = getColumnById(COLUMN_IDS.amount)
</script>

<template>
  <div class="w-full flex flex-col gap-6 min-h-0 flex-1">
    <!-- Filter controls -->
    <div class="space-y-4">
      <!-- Query visualization above combobox - always render to prevent layout jumping -->
      <QueryVisualization
        :query="query"
        :matches="inputQueryMatches"
        :suggestion="highlightedSuggestion ?? undefined"
      />

      <!-- Combobox -->
      <div class="relative">
        <div class="flex items-center gap-2 px-3 py-2 bg-background rounded-lg border border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 transition-all relative">
          <SearchIcon class="size-4 text-muted-foreground shrink-0" />
          <input
            v-model="query"
            type="text"
            :placeholder="t('app.ui.filterPlaceholder')"
            class="flex-1 w-full bg-transparent placeholder:text-muted-foreground outline-none text-sm text-foreground"
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
            <span class="flex-1">{{ t("app.ui.suggestion") }}</span>
            <span class="w-10 shrink-0">{{ t("app.ui.score") }}</span>
            <span class="w-14 shrink-0">{{ t("app.ui.results") }}</span>
            <!-- Indexing indicator -->
            <span v-if="isIndexing" class="flex items-center gap-1 text-primary shrink-0">
              <Loader2Icon class="size-3 animate-spin" />
              <span>{{ indexProgress ? `${indexProgress.percentage}%` : '' }}</span>
            </span>
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
              @mouseenter="hoveredIndex = index"
              @mouseleave="hoveredIndex = null"
            >
              <!-- Suggestion column - left aligned, grows to push score/results right -->
              <div class="flex items-center gap-1.5 min-w-0 flex-1">
                <span class="font-medium text-foreground truncate whitespace-pre">
                  <template v-for="(seg, segIdx) in getTextHighlightSegments(suggestion.parts.column.text, getMatchForType(suggestion, 'column')?.matchedCharIndexes)" :key="segIdx"><span v-if="seg.highlighted" class="font-bold">{{ seg.text }}</span><span v-else>{{ seg.text }}</span></template>
                </span>
                <span class="shrink-0 h-4 px-1 rounded inline-flex items-center bg-muted text-muted-foreground text-[10px] whitespace-pre">
                  <template v-for="(seg, segIdx) in getTextHighlightSegments(suggestion.parts.operator.matchedAlias ?? suggestion.parts.operator.text, getMatchForType(suggestion, 'operator')?.matchedCharIndexes)" :key="segIdx"><span v-if="seg.highlighted" class="font-bold">{{ seg.text }}</span><span v-else>{{ seg.text }}</span></template>
                </span>
                <!-- Render existing arguments - use character-level highlighting -->
                <span 
                  v-for="(arg, i) in suggestion.parts.arguments" 
                  :key="i"
                  class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground max-w-[200px] truncate"
                  :title="arg.displayText ? arg.text : undefined"
                >
                  <span class="whitespace-pre"><template v-for="(seg, segIdx) in getTextHighlightSegments(arg.displayText ?? arg.text, arg.displayMatchedIndexes ?? getArgMatch(suggestion, arg.text, i)?.matchedCharIndexes)" :key="segIdx"><span v-if="seg.highlighted" class="font-bold">{{ seg.text }}</span><span v-else>{{ seg.text }}</span></template></span>
                  <!-- Show original parsed text (e.g., "gestern") when available - fully highlighted since it's the matched input -->
                  <span v-if="arg.originalText" class="ml-1"><span class="text-muted-foreground/60">(</span><span class="font-bold">{{ arg.originalText }}</span><span class="text-muted-foreground/60">)</span></span>
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
                {{ suggestion.score.toFixed(4) }}
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
    </div>

    <!-- Active filters -->
    <div v-if="appliedFilters.length > 0" class="flex flex-wrap items-center gap-2">
      <span class="text-xs text-muted-foreground font-medium">{{ t("app.ui.activeFilters") }}</span>
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
        <!-- Render existing arguments (no placeholders for applied filters), use displayText with ellipsis for long values -->
        <span 
          v-for="(arg, i) in f.parts.arguments" 
          :key="i"
          class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground"
          :title="arg.displayText ? arg.text : undefined"
        >
          {{ arg.displayText ?? arg.text }}<span v-if="arg.originalText" class="ml-1"><span class="text-muted-foreground/60">(</span><span class="font-bold">{{ arg.originalText }}</span><span class="text-muted-foreground/60">)</span></span>
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
        {{ t("app.ui.clearAll") }}
      </button>
    </div>

    <!-- Menu bar with actions and summary -->
    <div class="flex items-center justify-between mb-2">
      <!-- Action buttons -->
      <div class="flex items-center gap-2">
        <button
          @click="handleAddRow"
          class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          :title="t('app.ui.addRow')"
        >
          <PlusIcon class="size-4" />
          {{ t('app.ui.addRow') }}
        </button>
        
        <button
          v-if="selectedRowId !== null"
          @click="handleDeleteRow"
          class="inline-flex items-center justify-center size-8 rounded-md bg-destructive hover:bg-destructive/90 transition-colors focus:outline-none focus:ring-2 focus:ring-destructive focus:ring-offset-2 animate-in fade-in zoom-in-95 duration-200"
          :title="t('app.ui.deleteRow')"
        >
          <Trash2Icon class="size-4 text-white" />
        </button>
      </div>

      <!-- Filter summary -->
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
                v-if="createdColumn"
                type="button"
                @click="handleSort('created')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <ColumnInfoPopover :column="createdColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="createdColumn.type || 'date'" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">{{ t("app.table.headers.created") }}</span>
                  </div>
                </ColumnInfoPopover>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'created' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'created' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <button
                v-if="amountColumn"
                type="button"
                @click="handleSort('amount')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <ColumnInfoPopover :column="amountColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="amountColumn.type || 'number'" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">{{ t("app.table.headers.amount") }}</span>
                  </div>
                </ColumnInfoPopover>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'amount' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'amount' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <button
                v-if="assigneeColumn"
                type="button"
                @click="handleSort('assignee')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <ColumnInfoPopover :column="assigneeColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="assigneeColumn.type || 'string'" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">{{ t("app.table.headers.assignee") }}</span>
                  </div>
                </ColumnInfoPopover>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'assignee' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'assignee' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <button
                v-if="departmentColumn"
                type="button"
                @click="handleSort('department')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <ColumnInfoPopover :column="departmentColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="departmentColumn.type || 'string'" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">{{ t("app.table.headers.department") }}</span>
                  </div>
                </ColumnInfoPopover>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'department' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'department' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <button
                v-if="priorityColumn"
                type="button"
                @click="handleSort('priority')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <ColumnInfoPopover :column="priorityColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="priorityColumn.type || 'number'" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">{{ t("app.table.headers.priority") }}</span>
                  </div>
                </ColumnInfoPopover>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'priority' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'priority' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <button
                v-if="statusColumn"
                type="button"
                @click="handleSort('status')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <ColumnInfoPopover :column="statusColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="statusColumn.type || 'string'" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">{{ t("app.table.headers.status") }}</span>
                  </div>
                </ColumnInfoPopover>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'status' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'status' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <button
                v-if="dueDateColumn"
                type="button"
                @click="handleSort('dueDate')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <ColumnInfoPopover :column="dueDateColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="dueDateColumn.type || 'date'" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">{{ t("app.table.headers.dueDate") }}</span>
                  </div>
                </ColumnInfoPopover>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'dueDate' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'dueDate' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal whitespace-nowrap">
              <button
                v-if="isBlockedColumn"
                type="button"
                @click="handleSort('isBlocked')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <ColumnInfoPopover :column="isBlockedColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="isBlockedColumn.type ?? 'boolean'" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">{{ t("app.table.headers.isBlocked") }}</span>
                  </div>
                </ColumnInfoPopover>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'isBlocked' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'isBlocked' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
            <th class="px-3 py-3 text-left font-normal">
              <button
                v-if="commentsColumn"
                type="button"
                @click="handleSort('comments')"
                class="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
              >
                <ColumnInfoPopover :column="commentsColumn">
                  <div class="flex items-center gap-1">
                    <DataTypeIcon :type="commentsColumn.type || 'string'" size="size-3" class="shrink-0" />
                    <span class="font-medium text-muted-foreground text-sm">{{ t("app.table.headers.comments") }}</span>
                  </div>
                </ColumnInfoPopover>
                <span class="shrink-0">
                  <ArrowUpIcon v-if="sortState.column === 'comments' && sortState.direction === 'asc'" class="size-3.5 text-foreground" />
                  <ArrowDownIcon v-else-if="sortState.column === 'comments' && sortState.direction === 'desc'" class="size-3.5 text-foreground" />
                  <ChevronsUpDownIcon v-else class="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- Empty state -->
          <tr v-if="filteredData.length === 0">
            <td colspan="9">
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
              :key="getRow(virtualRow.index).id"
              :class="cn(
                'border-b transition-all h-12 cursor-pointer',
                selectedRowId === getRow(virtualRow.index).id 
                  ? 'border-l-4 border-l-primary' 
                  : 'border-l-2 border-l-transparent hover:border-l-primary/40'
              )"
              @click="handleRowClick(getRow(virtualRow.index).id)"
            >
              <td class="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap h-12 text-xs">{{ getRow(virtualRow.index).created }}</td>
              <td class="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap h-12">
                {{ getRow(virtualRow.index).amount ? `${getRow(virtualRow.index).amount.value.toLocaleString()} ${getRow(virtualRow.index).amount.unit}` : '-' }}
              </td>
              <td class="px-3 py-2 font-medium whitespace-nowrap h-12">{{ getRow(virtualRow.index).assignee }}</td>
              <td class="px-3 py-2 text-muted-foreground whitespace-nowrap h-12">{{ translateDepartment(getRow(virtualRow.index).department) }}</td>
              <td class="px-3 py-2 whitespace-nowrap h-12">
                <div class="flex items-center gap-1">
                  <div :class="cn('size-2 rounded-full', priorityColors[getRow(virtualRow.index).priority - 1] ?? priorityColors[0])" />
                  <span class="text-sm tabular-nums">{{ getRow(virtualRow.index).priority }}</span>
                </div>
              </td>
              <td class="px-3 py-2 whitespace-nowrap h-12">
                <span :class="cn(
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                  statusVariants[getRow(virtualRow.index).status]?.bg ?? 'bg-muted',
                  statusVariants[getRow(virtualRow.index).status]?.text ?? 'text-muted-foreground'
                )">
                  {{ translateStatus(getRow(virtualRow.index).status) }}
                </span>
              </td>
              <td class="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap h-12">{{ getRow(virtualRow.index).dueDate }}</td>
              <td class="px-3 py-2 text-center whitespace-nowrap h-12">
                <XIcon v-if="getRow(virtualRow.index).isBlocked" class="size-4 text-rose-500 mx-auto" />
                <CheckIcon v-else class="size-4 text-emerald-500 mx-auto" />
              </td>
              <td class="px-3 py-2 text-muted-foreground text-sm h-12 max-w-xs" :title="getRow(virtualRow.index).comments">
                <span class="block truncate">
                  <template v-if="getRow(virtualRow.index).comments">{{ getRow(virtualRow.index).comments }}</template>
                  <span v-else class="text-muted-foreground/50 italic">{{ t("app.ui.noComments") }}</span>
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
