<script setup lang="ts">
/**
 * AlgorithmExplainer - Interactive visualization of the FuzzyFilter algorithm
 * 
 * This page demonstrates how FuzzyFilter generates suggestions in real-time,
 * with detailed visualizations of tokenization, n-gram generation, fuzzy matching,
 * and scoring with colored highlighting.
 */
import { ref, computed, onMounted, watch } from "vue"
import { useFuzzyFilter } from "vue-fuzzy-filter"
import {
  createFuzzyFilter,
  tokenize,
  getOperator,
  type FilterSuggestion,
  type Token,
} from "fuzzyfilter"
import {
  TASK_SCHEMA,
  generateLargeDataset,
} from "@fuzzyfilter/sample-data"
import {
  AlgorithmStep,
  TokenPanel,
  NgramPanel,
  MatchHighlight,
  ScoreBreakdown,
} from "./algorithm-viz"
import {
  SparklesIcon,
  ZapIcon,
  TargetIcon,
  CalculatorIcon,
  ListOrderedIcon,
  SearchIcon,
  TrophyIcon,
  ChevronRightIcon,
} from "lucide-operators-vue"
import { cn } from "@/lib/utils"

// Generate a smaller dataset for the explainer
const DATASET = generateLargeDataset(1000, 42)

// Create filter instance - get multiple suggestions
const filter = createFuzzyFilter({ maxSuggestions: 10 })

// Initialize on mount
onMounted(() => {
  filter.setSchema(TASK_SCHEMA)
  filter.indexData(DATASET)
})

// Use the composable
const {
  query,
  suggestions,
} = useFuzzyFilter(filter, {
  debounceMs: 50,
})

// Track selected suggestion index (null = auto-select top)
const selectedIndex = ref<number | null>(null)

// Get the selected suggestion (or top suggestion if none selected)
const selectedSuggestion = computed(() => {
  if (suggestions.value.length === 0) return undefined
  if (selectedIndex.value !== null && selectedIndex.value < suggestions.value.length) {
    return suggestions.value[selectedIndex.value]
  }
  return suggestions.value[0]
})

// Reset selection when query changes
watch(query, () => {
  selectedIndex.value = null
})

// Tokenize the query for visualization
const tokens = computed<Token[]>(() => {
  if (!query.value.trim()) return []
  const result = tokenize(query.value)
  return result.tokens
})

// Set query from example
function setExample(example: string) {
  query.value = example
}

// Select a suggestion
function selectSuggestion(index: number) {
  selectedIndex.value = index
}

// Check if a suggestion is selected
function isSelected(index: number): boolean {
  if (selectedIndex.value === null) return index === 0
  return selectedIndex.value === index
}

// Example queries
const examples = ["sta", "status eq", "in progress", "alice", "priority > 3", "last week"]

/**
 * Get score color class
 */
function getScoreColor(score: number): string {
  if (score >= 3000) return "text-emerald-600"
  if (score >= 1500) return "text-lime-600"
  if (score >= 500) return "text-amber-600"
  if (score >= -1000) return "text-orange-600"
  return "text-rose-600"
}

/**
 * Get missing args count for a suggestion
 */
function getMissingArgsCount(suggestion: FilterSuggestion): number {
  const opInfo = getOperator(suggestion.operator)
  const minArgs = opInfo.isVariadic ? (opInfo.minArguments ?? 1) : (opInfo.requiresArgument ? 1 : 0)
  const currentArgs = suggestion.parts.arguments?.length ?? 0
  return Math.max(0, minArgs - currentArgs)
}
</script>

<template>
  <div class="bg-background min-h-screen">
    <div class="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <!-- Header -->
      <div class="space-y-2">
        <h1 class="text-2xl font-bold flex items-center gap-3">
          <SparklesIcon class="size-7 text-primary" />
          Algorithm Explainer
        </h1>
        <p class="text-muted-foreground max-w-2xl">
          Type a query below to see how FuzzyFilter generates the top suggestion.
          Each step of the algorithm is visualized in real-time.
        </p>
      </div>

      <!-- Query Input Section -->
      <div class="space-y-4">
        <!-- Input -->
        <div class="space-y-2">
          <label class="text-sm font-medium">Query Input</label>
          <div class="relative max-w-xl">
            <SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              v-model="query"
              type="text"
              placeholder="Try: sta, status eq, in progress, alice, priority > 3..."
              class="w-full pl-10 pr-4 py-3 text-base border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            />
          </div>
        </div>

        <!-- Quick examples -->
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-xs font-medium text-muted-foreground">Try:</span>
          <button
            v-for="ex in examples"
            :key="ex"
            @click="setExample(ex)"
            class="text-xs px-2.5 py-1 bg-muted hover:bg-muted/80 rounded-md transition-colors font-medium"
          >
            {{ ex }}
          </button>
        </div>
      </div>

      <!-- Suggestions List + Selected Suggestion -->
      <div
        v-if="suggestions.length > 0"
        class="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4"
      >
        <!-- Suggestions list (stays visible) -->
        <div class="space-y-2">
          <div class="text-sm font-medium text-muted-foreground px-1">
            Suggestions ({{ suggestions.length }})
          </div>
          <div class="space-y-1.5 max-h-80 overflow-y-auto">
            <button
              v-for="(suggestion, index) in suggestions"
              :key="suggestion.id"
              @click="selectSuggestion(index)"
              :class="cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg transition-colors',
                isSelected(index)
                  ? 'bg-primary/10 border border-primary/30'
                  : 'bg-muted/50 hover:bg-muted border border-transparent'
              )"
            >
              <span class="text-xs text-muted-foreground w-5 shrink-0 tabular-nums">
                #{{ index + 1 }}
              </span>
              <div class="flex items-center gap-1.5 flex-1 min-w-0">
                <span class="font-medium text-foreground text-sm truncate">
                  {{ suggestion.parts.column.text }}
                </span>
                <span class="shrink-0 text-[10px] h-4 px-1 rounded inline-flex items-center font-medium bg-muted text-muted-foreground">
                  {{ suggestion.parts.operator.matchedAlias ?? suggestion.parts.operator.text }}
                </span>
                <span
                  v-for="(arg, i) in suggestion.parts.arguments"
                  :key="i"
                  class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground"
                >
                  {{ arg.text }}
                </span>
                <span
                  v-for="k in getMissingArgsCount(suggestion)"
                  :key="`missing-${k}`"
                  class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-dashed border-muted-foreground/40 text-muted-foreground/50"
                >
                  …
                </span>
              </div>
              <span :class="cn('text-xs font-mono tabular-nums shrink-0', getScoreColor(suggestion.score))">
                {{ Math.round(suggestion.score) }}
              </span>
              <ChevronRightIcon :class="cn(
                'size-4 shrink-0 transition-colors',
                isSelected(index) ? 'text-primary' : 'text-muted-foreground/50'
              )" />
            </button>
          </div>
          <div class="text-xs text-muted-foreground px-1">
            Click a suggestion to see how it was generated
          </div>
        </div>

        <!-- Selected suggestion details (compact) -->
        <div
          v-if="selectedSuggestion"
          class="p-5 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/30 rounded-xl space-y-4"
        >
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <TrophyIcon class="size-5 text-amber-500" />
              <span class="text-sm font-semibold text-foreground">Selected Suggestion</span>
            </div>
            <code class="px-2 py-0.5 bg-muted rounded text-foreground font-mono text-sm">
              {{ query }}
            </code>
          </div>
          
          <!-- Filter display -->
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-foreground text-base">
              {{ selectedSuggestion.parts.column.text }}
            </span>
            <span class="shrink-0 text-xs h-5 px-1.5 rounded inline-flex items-center font-medium bg-muted text-muted-foreground">
              {{ selectedSuggestion.parts.operator.matchedAlias ?? selectedSuggestion.parts.operator.text }}
            </span>
            <span
              v-for="(arg, j) in selectedSuggestion.parts.arguments"
              :key="j"
              class="shrink-0 text-xs h-5 px-2 rounded inline-flex items-center border border-border text-muted-foreground"
            >
              {{ arg.text }}
            </span>
            <span
              v-for="k in getMissingArgsCount(selectedSuggestion)"
              :key="`missing-${k}`"
              class="shrink-0 text-xs h-5 px-2 rounded inline-flex items-center border border-dashed border-muted-foreground/40 text-muted-foreground/50"
            >
              …
            </span>
          </div>
          
          <!-- Stats row - compact -->
          <div class="flex items-center gap-4 pt-2 border-t border-border/50 text-sm">
            <div class="flex items-center gap-1.5">
              <span class="text-muted-foreground">Score:</span>
              <span :class="cn('font-bold tabular-nums', getScoreColor(selectedSuggestion.score))">
                {{ Math.round(selectedSuggestion.score).toLocaleString() }}
              </span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-muted-foreground">Rows:</span>
              <span class="font-bold text-primary tabular-nums">
                {{ selectedSuggestion.resultCount.toLocaleString() }}
              </span>
              <span class="text-muted-foreground">
                / {{ DATASET.length.toLocaleString() }} ({{ ((selectedSuggestion.resultCount / DATASET.length) * 100).toFixed(1) }}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else-if="query"
        class="p-5 bg-muted/50 border border-border rounded-xl text-center text-muted-foreground"
      >
        No suggestions found for this query
      </div>

      <div
        v-else
        class="p-5 bg-muted/30 border border-dashed border-border rounded-xl text-center text-muted-foreground"
      >
        Start typing to see algorithm analysis...
      </div>

      <!-- Algorithm Steps -->
      <div class="space-y-4">
        <h2 class="text-lg font-semibold flex items-center gap-2">
          How This Suggestion Was Generated
        </h2>

        <!-- Step 1: Tokenization -->
        <AlgorithmStep
          :step="1"
          title="Tokenization"
          description="Split input into tokens with positions"
          :is-active="tokens.length > 0"
        >
          <div class="flex items-start gap-3 mb-3">
            <ZapIcon class="size-5 text-blue-500 shrink-0 mt-0.5" />
            <div class="text-sm text-muted-foreground">
              The input string is split on whitespace boundaries. Each token preserves 
              its original position for later highlighting and a normalized (lowercase) 
              form for matching.
            </div>
          </div>
          <TokenPanel :query="query" :tokens="tokens" />
        </AlgorithmStep>

        <!-- Step 2: N-gram Generation -->
        <AlgorithmStep
          :step="2"
          title="N-gram Generation"
          description="Create token combinations for phrase matching"
          :is-active="tokens.length > 1"
        >
          <div class="flex items-start gap-3 mb-3">
            <ListOrderedIcon class="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div class="text-sm text-muted-foreground">
              All token combinations (n-grams) are generated to enable multi-word 
              matching. This allows "in progress" to match as a unit while also 
              trying individual tokens.
            </div>
          </div>
          <NgramPanel :tokens="tokens" />
        </AlgorithmStep>

        <!-- Step 3: Fuzzy Matching -->
        <AlgorithmStep
          :step="3"
          title="Fuzzy Matching"
          description="Match tokens against columns, operators, and values"
          :is-active="!!selectedSuggestion?.queryMatches?.length"
        >
          <div class="flex items-start gap-3 mb-3">
            <TargetIcon class="size-5 text-emerald-500 shrink-0 mt-0.5" />
            <div class="text-sm text-muted-foreground">
              Each n-gram is searched against three tries: columns, operators, and values.
              FuzzySort enables typo-tolerant matching. The highlighted characters show 
              exactly which positions matched. All query tokens that contributed to this 
              suggestion are shown below.
            </div>
          </div>
          <MatchHighlight 
            :query="query" 
            :query-matches="selectedSuggestion?.queryMatches" 
          />
        </AlgorithmStep>

        <!-- Step 4: Score Calculation -->
        <AlgorithmStep
          :step="4"
          title="Score Calculation"
          description="Compute final score from multiple components"
          :is-active="!!selectedSuggestion"
        >
          <div class="flex items-start gap-3 mb-3">
            <CalculatorIcon class="size-5 text-violet-500 shrink-0 mt-0.5" />
            <div class="text-sm text-muted-foreground">
              The final score combines the raw fuzzysort match score with bonuses 
              for query coverage, target completeness, and full query usage. The 
              highest scoring suggestion wins.
            </div>
          </div>
          <ScoreBreakdown :suggestion="selectedSuggestion" />
        </AlgorithmStep>

        <!-- Step 5: Result Counting -->
        <AlgorithmStep
          :step="5"
          title="Result Counting"
          description="Count matching rows for the suggestion"
          :is-active="!!selectedSuggestion"
        >
          <div class="flex items-start gap-3">
            <SparklesIcon class="size-5 text-cyan-500 shrink-0 mt-0.5" />
            <div class="text-sm text-muted-foreground">
              Each suggestion shows a <strong>result count</strong> — how many rows would match if applied.
              This is computed by evaluating the filter predicate against indexed data.
              For large datasets, bitmap indexes enable O(1) count operations.
            </div>
          </div>
        </AlgorithmStep>
      </div>
    </div>
  </div>
</template>
