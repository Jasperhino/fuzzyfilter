<script setup lang="ts">
/**
 * ScoreBreakdown - Visual breakdown of suggestion scoring
 * 
 * Formula: score = rawScore + coverageBonus + completenessBonus + fullQueryBonus + exactMatchBonus
 */
import { computed } from "vue"
import type { FilterSuggestion } from "fuzzyfilter"
import { cn } from "@/lib/utils"

interface Props {
  /** The suggestion to show breakdown for */
  suggestion?: FilterSuggestion
}

const props = defineProps<Props>()

const breakdown = computed(() => props.suggestion?.scoreBreakdown)
const finalScore = computed(() => props.suggestion?.score ?? 0)
const exactMatchBonus = computed(() => breakdown.value?.exactMatchBonus ?? 0)

/**
 * Get score color based on value thresholds
 */
function getScoreColor(score: number): string {
  if (score >= 3000) return "text-emerald-600"
  if (score >= 1500) return "text-lime-600"
  if (score >= 500) return "text-amber-600"
  if (score >= -1000) return "text-orange-600"
  return "text-rose-600"
}
</script>

<template>
  <div v-if="!suggestion" class="text-sm text-muted-foreground italic">
    Select a suggestion to see score breakdown...
  </div>

  <div v-else class="space-y-4">
    <template v-if="breakdown">
      <!-- Score components -->
      <div class="space-y-2">
        <!-- Raw Match -->
        <div class="flex items-center gap-3">
          <div class="w-28 shrink-0">
            <div class="text-xs text-muted-foreground">Raw Match</div>
            <div class="text-[10px] text-muted-foreground/70 font-mono">fuzzysort()</div>
          </div>
          <div class="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              :class="cn('h-full rounded-full transition-all', breakdown.rawScore === 0 ? 'bg-emerald-500' : 'bg-blue-500')"
              :style="{ width: `${Math.min(100, Math.max(0, (Math.abs(breakdown.rawScore) / 1000) * 100))}%` }"
            />
          </div>
          <span
            :class="cn(
              'w-14 text-right font-mono tabular-nums text-xs font-medium shrink-0',
              breakdown.rawScore < 0 ? 'text-rose-600' : breakdown.rawScore > 0 ? 'text-emerald-600' : 'text-muted-foreground'
            )"
          >
            {{ breakdown.rawScore >= 0 ? '+' : '' }}{{ breakdown.rawScore.toLocaleString() }}
          </span>
        </div>

        <!-- Coverage -->
        <div class="flex items-center gap-3">
          <div class="w-28 shrink-0">
            <div class="text-xs text-muted-foreground">Coverage</div>
            <div class="text-[10px] text-muted-foreground/70 font-mono">{{ breakdown.tokenCount }}/{{ breakdown.totalTokens }} × 2000</div>
          </div>
          <div class="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all bg-violet-500"
              :style="{ width: `${Math.min(100, (breakdown.coverageBonus / 2000) * 100)}%` }"
            />
          </div>
          <span class="w-14 text-right font-mono tabular-nums text-xs font-medium shrink-0 text-emerald-600">
            +{{ breakdown.coverageBonus.toLocaleString() }}
          </span>
        </div>

        <!-- Completeness -->
        <div class="flex items-center gap-3">
          <div class="w-28 shrink-0">
            <div class="text-xs text-muted-foreground">Completeness</div>
            <div class="text-[10px] text-muted-foreground/70 font-mono">len/target × 1000</div>
          </div>
          <div class="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all bg-cyan-500"
              :style="{ width: `${Math.min(100, (breakdown.completenessBonus / 1000) * 100)}%` }"
            />
          </div>
          <span class="w-14 text-right font-mono tabular-nums text-xs font-medium shrink-0 text-emerald-600">
            +{{ breakdown.completenessBonus.toLocaleString() }}
          </span>
        </div>

        <!-- Full Query -->
        <div class="flex items-center gap-3">
          <div class="w-28 shrink-0">
            <div class="text-xs text-muted-foreground">Full Query</div>
            <div class="text-[10px] text-muted-foreground/70 font-mono">{{ breakdown.fullQueryBonus > 0 ? 'all tokens' : 'partial' }}</div>
          </div>
          <div class="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all bg-amber-500"
              :style="{ width: `${Math.min(100, (breakdown.fullQueryBonus / 500) * 100)}%` }"
            />
          </div>
          <span
            :class="cn(
              'w-14 text-right font-mono tabular-nums text-xs font-medium shrink-0',
              breakdown.fullQueryBonus > 0 ? 'text-emerald-600' : 'text-muted-foreground'
            )"
          >
            +{{ breakdown.fullQueryBonus.toLocaleString() }}
          </span>
        </div>

        <!-- Exact Match (only if present) -->
        <div v-if="exactMatchBonus > 0" class="flex items-center gap-3">
          <div class="w-28 shrink-0">
            <div class="text-xs text-muted-foreground">Exact Match</div>
            <div class="text-[10px] text-muted-foreground/70 font-mono">case-insensitive</div>
          </div>
          <div class="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all bg-emerald-500"
              :style="{ width: `${Math.min(100, (exactMatchBonus / 3000) * 100)}%` }"
            />
          </div>
          <span class="w-14 text-right font-mono tabular-nums text-xs font-medium shrink-0 text-emerald-600">
            +{{ exactMatchBonus.toLocaleString() }}
          </span>
        </div>
      </div>

      <!-- Formula display -->
      <div class="p-3 bg-muted/30 rounded-lg border border-border/50 space-y-2">
        <div class="text-xs font-medium text-muted-foreground">Formula</div>
        <div class="font-mono text-xs flex flex-wrap items-center gap-1">
          <span :class="cn('font-bold', getScoreColor(finalScore))">
            {{ Math.round(finalScore) }}
          </span>
          <span class="text-muted-foreground">=</span>
          <span :class="breakdown.rawScore < 0 ? 'text-rose-600' : 'text-foreground'">
            {{ breakdown.rawScore }}
          </span>
          <span class="text-muted-foreground">+</span>
          <span class="text-violet-600">{{ breakdown.coverageBonus }}</span>
          <span class="text-muted-foreground">+</span>
          <span class="text-cyan-600">{{ breakdown.completenessBonus }}</span>
          <span class="text-muted-foreground">+</span>
          <span class="text-amber-600">{{ breakdown.fullQueryBonus }}</span>
          <template v-if="exactMatchBonus > 0">
            <span class="text-muted-foreground">+</span>
            <span class="text-emerald-600">{{ exactMatchBonus }}</span>
          </template>
        </div>
        <div class="text-[10px] text-muted-foreground leading-relaxed">
          raw + coverage + completeness + fullQuery{{ exactMatchBonus > 0 ? ' + exactMatch' : '' }}
        </div>
      </div>
    </template>

    <div v-else class="space-y-3">
      <!-- Full parse formula explanation -->
      <div class="p-3 bg-muted/50 rounded-lg border border-border">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium">Final Score</span>
          <span :class="cn('text-xl font-bold font-mono tabular-nums', getScoreColor(finalScore))">
            {{ Math.round(finalScore).toLocaleString() }}
          </span>
        </div>
        <div class="text-xs text-muted-foreground space-y-1">
          <div>This suggestion used the <strong>Full Parse</strong> strategy:</div>
          <div class="font-mono bg-muted/50 rounded px-2 py-1">
            8000 + colBonus + opBonus + valBonus + valCoverage
          </div>
        </div>
      </div>

      <!-- Component explanations -->
      <div class="text-xs text-muted-foreground space-y-1 px-1">
        <div><strong>Base:</strong> 8000 (complete filter bonus)</div>
        <div><strong>Column/Op/Val bonus:</strong> +500 each if score ≥ -100, otherwise max(0, 500 + score)</div>
        <div><strong>Value Coverage:</strong> (matched values / value tokens) × 1000</div>
      </div>
    </div>
  </div>
</template>

