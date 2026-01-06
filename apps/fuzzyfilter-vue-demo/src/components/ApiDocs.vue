<script setup lang="ts">
/**
 * API Documentation Panel
 *
 * Displays dynamically generated documentation for the FuzzyFilter composable
 * and all available operators. All operator data is fetched dynamically
 * from the fuzzyfilter registry.
 */

import { ref, computed } from "vue"
import {
  getOperatorsForType,
  getOperatorsByCategory,
  getAllCategories,
  DataType,
  type OperatorInfo,
} from "@jasperhino/fuzzyfilter"
import {
  BookOpenIcon,
  CodeIcon,
  ListIcon,
  LayersIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-vue-next"
import { cn } from "@/lib/utils"
import DataTypeIcon from "./DataTypeIcon.vue"

/**
 * Get the number of arguments for an operator
 */
function getArgCount(operator: OperatorInfo): number {
  if (!operator.requiresArgument) return 0
  if (operator.id === "between") return 2
  if (operator.isVariadic) return -1 // Unlimited (in, nin)
  return 1
}

/**
 * Operators grouped by category - dynamically from the registry
 */
const operatorGroups = computed(() => getOperatorsByCategory())

/**
 * All operator categories in display order
 */
const categories = computed(() => getAllCategories())

/**
 * Total number of operators
 */
const operatorCount = computed(() =>
  Object.values(operatorGroups.value).reduce((sum, ops) => sum + ops.length, 0)
)

/**
 * Data types for the "Operators By Type" section
 */
const DATA_TYPES = [
  { type: DataType.STRING, label: "String" },
  { type: DataType.NUMBER, label: "Number" },
  { type: DataType.DATE, label: "Date" },
  { type: DataType.BOOLEAN, label: "Boolean" },
  { type: DataType.ENUM, label: "Enum" },
] as const

/**
 * Active data type tab
 */
const activeDataType = ref<string>(DataType.STRING)

/**
 * Operators for the active data type
 */
const operatorsForActiveType = computed(() => {
  return getOperatorsForType(activeDataType.value as any)
})

/**
 * Expanded operators state
 */
const expandedOperators = ref<Set<string>>(new Set())

/**
 * Toggle operator expansion
 */
function toggleOperator(id: string) {
  if (expandedOperators.value.has(id)) {
    expandedOperators.value.delete(id)
  } else {
    expandedOperators.value.add(id)
  }
  expandedOperators.value = new Set(expandedOperators.value)
}

/**
 * Hook section expanded
 */
const isHookExpanded = ref(true)

/**
 * Hook return properties
 */
const returnProps = [
  { name: "query", type: "Ref<string>", desc: "Current query (v-model)" },
  { name: "suggestions", type: "Ref<FilterSuggestion[]>", desc: "Current suggestions" },
  { name: "isLoading", type: "Ref<boolean>", desc: "Loading state" },
  { name: "error", type: "Ref<Error | null>", desc: "Error state" },
  { name: "selectedIndex", type: "Ref<number>", desc: "Selected suggestion index" },
  { name: "selectedSuggestion", type: "ComputedRef<FilterSuggestion | null>", desc: "Currently selected" },
  { name: "setQuery", type: "(query: string) => void", desc: "Update query" },
  { name: "selectSuggestion", type: "(index: number) => void", desc: "Select by index" },
  { name: "navigateSuggestions", type: "(dir: 'up' | 'down') => void", desc: "Navigate up/down" },
  { name: "applySuggestion", type: "() => void", desc: "Apply selected" },
  { name: "reset", type: "() => void", desc: "Reset all state" },
]

/**
 * Hook options
 */
const options = [
  { name: "debounceMs", type: "number", desc: "Debounce delay (default: 150)" },
  { name: "initialQuery", type: "string", desc: "Initial query string" },
  { name: "onApply", type: "(suggestion) => void", desc: "Callback on apply" },
  { name: "filterContext", type: "Ref<CompiledFilter[]>", desc: "For stacked counts" },
]

</script>

<template>
  <div class="h-full flex flex-col bg-background border border-border rounded-lg overflow-hidden">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-border bg-muted/30 shrink-0">
      <div class="flex items-center gap-2">
        <BookOpenIcon class="size-4 text-primary" />
        <h2 class="font-semibold text-sm">API Reference</h2>
      </div>
      <p class="text-xs text-muted-foreground mt-1">
        fuzzyfilter-vue documentation
      </p>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <div class="p-4 space-y-6">
        <!-- Composable Documentation -->
        <div class="space-y-3">
          <button
            @click="isHookExpanded = !isHookExpanded"
            class="flex items-center gap-2 w-full text-left"
          >
            <span class="text-muted-foreground">
              <ChevronDownIcon v-if="isHookExpanded" class="size-4" />
              <ChevronRightIcon v-else class="size-4" />
            </span>
            <CodeIcon class="size-4 text-primary" />
            <span class="font-semibold text-sm">useFuzzyFilter()</span>
          </button>

          <div v-if="isHookExpanded" class="space-y-4 pl-6">
            <!-- Options -->
            <div>
              <h4 class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Options
              </h4>
              <div class="space-y-1">
                <div v-for="opt in options" :key="opt.name" class="flex items-start gap-2 text-xs">
                  <code class="font-mono text-primary shrink-0">{{ opt.name }}</code>
                  <span class="text-muted-foreground">—</span>
                  <span class="text-muted-foreground">{{ opt.desc }}</span>
                </div>
              </div>
            </div>

            <!-- Returns -->
            <div>
              <h4 class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Returns
              </h4>
              <div class="space-y-1">
                <div v-for="prop in returnProps" :key="prop.name" class="flex items-start gap-2 text-xs">
                  <code class="font-mono text-primary shrink-0">{{ prop.name }}</code>
                  <span class="text-muted-foreground">—</span>
                  <span class="text-muted-foreground">{{ prop.desc }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Operators -->
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <ListIcon class="size-4 text-primary" />
            <span class="font-semibold text-sm">Operators</span>
            <span class="text-xs text-muted-foreground">
              ({{ operatorCount }} total)
            </span>
          </div>

          <template v-for="category in categories" :key="category">
            <div v-if="operatorGroups[category].length > 0">
              <h4 class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1 px-3">
                {{ category }}
              </h4>
              <div class="border border-border rounded-md overflow-hidden">
                <div
                  v-for="operator in operatorGroups[category]"
                  :key="operator.id"
                  class="border-b border-border/50 last:border-0"
                >
                  <!-- Operator Header -->
                  <button
                    @click="toggleOperator(operator.id)"
                    class="w-full h-10 flex items-center gap-1.5 px-3 hover:bg-muted/50 transition-colors text-left"
                  >
                    <span class="text-muted-foreground shrink-0">
                      <ChevronDownIcon v-if="expandedOperators.has(operator.id)" class="size-3.5" />
                      <ChevronRightIcon v-else class="size-3.5" />
                    </span>

                    <!-- Operator label -->
                    <span class="text-xs text-foreground truncate flex-1 min-w-0">
                      {{ operator.label }}
                    </span>

                    <!-- Argument placeholders -->
                    <div class="flex items-center gap-1 shrink-0">
                      <!-- No args -->
                      <span 
                        v-if="getArgCount(operator) === 0" 
                        class="text-[10px] text-muted-foreground/60"
                      >
                        no args
                      </span>
                      
                      <!-- Single arg -->
                      <span 
                        v-else-if="getArgCount(operator) === 1"
                        class="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground"
                      >
                        arg 1
                      </span>
                      
                      <!-- Two args (between) -->
                      <template v-else-if="getArgCount(operator) === 2">
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
                  </button>

                  <!-- Operator Details -->
                  <div
                    v-if="expandedOperators.has(operator.id)"
                    class="px-3 pb-3 pt-1 space-y-2 text-xs bg-muted/30"
                  >
                    <!-- Aliases -->
                    <div v-if="operator.aliases.length > 0">
                      <span class="text-muted-foreground text-[10px] uppercase tracking-wider font-medium">
                        Aliases
                      </span>
                      <div class="flex flex-wrap gap-1 mt-1">
                        <span
                          v-for="alias in operator.aliases"
                          :key="alias"
                          class="shrink-0 text-[10px] h-4 px-1 rounded inline-flex items-center font-medium bg-muted text-muted-foreground"
                        >
                          {{ alias }}
                        </span>
                      </div>
                    </div>

                    <!-- Supported Types -->
                    <div>
                      <span class="text-muted-foreground text-[10px] uppercase tracking-wider font-medium">
                        Types
                      </span>
                      <div class="flex flex-wrap gap-1 mt-1">
                        <DataTypeIcon
                          v-for="type in operator.supportedTypes"
                          :key="type"
                          :type="type"
                          :as-badge="true"
                        />
                      </div>
                    </div>

                    <!-- Properties -->
                    <div v-if="operator.isVariadic" class="flex flex-wrap gap-2">
                      <span class="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-medium">
                        variadic
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Operators By DataType -->
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <LayersIcon class="size-4 text-primary" />
            <span class="font-semibold text-sm">Operators By Type</span>
          </div>

          <div class="border border-border rounded-md overflow-hidden">
            <!-- Tabs List -->
            <div class="flex gap-0.5 px-1 py-1 bg-muted/50 border-b border-border">
              <button
                v-for="{ type, label } in DATA_TYPES"
                :key="type"
                @click="activeDataType = type"
                :class="cn(
                  'flex h-7 items-center justify-center px-2.5 text-[11px] font-medium text-muted-foreground outline-none select-none rounded-sm transition-colors hover:text-foreground',
                  activeDataType === type && 'bg-background text-foreground shadow-sm'
                )"
              >
                {{ label }}
              </button>
            </div>

            <!-- Tab Content -->
            <div class="p-2">
              <div class="flex flex-wrap gap-1.5">
                <div
                  v-for="op in operatorsForActiveType"
                  :key="op.id"
                  class="px-2 py-1 rounded-md bg-muted/50 text-xs text-muted-foreground"
                >
                  {{ op.label }}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>
