<script setup lang="ts">
/**
 * MatchHighlight - Character-level match highlighting using matchedCharIndexes
 */
import { computed } from "vue"
import type { QueryMatch } from "fuzzyfilter"
import { cn } from "@/lib/utils"

interface Props {
  /** The query matches to visualize */
  queryMatches?: QueryMatch[]
  /** The original query string */
  query: string
}

const props = defineProps<Props>()

/**
 * Color classes for different match types
 */
const MATCH_COLORS = {
  column: {
    bg: "bg-blue-500/20",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-500/40",
    label: "Column",
  },
  operator: {
    bg: "bg-amber-500/20",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-500/40",
    label: "Operator",
  },
  value: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-500/40",
    label: "Value",
  },
} as const

/** Padding characters to show before/after matched region */
const MATCH_PADDING = 5

function getMatchColors(type: "column" | "operator" | "value") {
  return MATCH_COLORS[type]
}

const colorEntries = computed(() => Object.entries(MATCH_COLORS))

/**
 * Calculate the visible range for a target string based on matched indexes.
 * For values, we truncate to show only the matched portion with padding.
 */
function getVisibleRange(
  target: string,
  matchedIndexes: number[] | undefined,
  shouldTruncate: boolean
): { start: number; end: number; showStartEllipsis: boolean; showEndEllipsis: boolean } {
  // If no truncation needed or no indexes, show everything
  if (!shouldTruncate || !matchedIndexes || matchedIndexes.length === 0) {
    return { start: 0, end: target.length, showStartEllipsis: false, showEndEllipsis: false }
  }

  // Find min and max matched indexes
  const minIndex = Math.min(...matchedIndexes)
  const maxIndex = Math.max(...matchedIndexes)

  // Calculate visible range with padding
  const start = Math.max(0, minIndex - MATCH_PADDING)
  const end = Math.min(target.length, maxIndex + MATCH_PADDING + 1)

  return {
    start,
    end,
    showStartEllipsis: start > 0,
    showEndEllipsis: end < target.length,
  }
}

/**
 * Get visible portion data for a match
 */
function getVisiblePortion(match: QueryMatch) {
  const shouldTruncate = match.matchType === "value"
  const range = getVisibleRange(match.matchedTarget, match.matchedCharIndexes, shouldTruncate)
  const visibleChars = match.matchedTarget.slice(range.start, range.end).split("")
  const indexSet = new Set(match.matchedCharIndexes || [])
  
  return {
    ...range,
    visibleChars,
    indexSet,
    shouldTruncate,
  }
}

/**
 * Check if a match is truncated
 */
function isTruncated(match: QueryMatch): boolean {
  if (match.matchType !== "value" || !match.matchedCharIndexes || match.matchedCharIndexes.length === 0) {
    return false
  }
  const minIndex = Math.min(...match.matchedCharIndexes)
  const maxIndex = Math.max(...match.matchedCharIndexes)
  return match.matchedTarget.length > (maxIndex - minIndex + MATCH_PADDING * 2 + 1)
}
</script>

<template>
  <div v-if="!query" class="text-sm text-muted-foreground italic">
    Type something to see match highlighting...
  </div>

  <div v-else-if="!queryMatches || queryMatches.length === 0" class="text-sm text-muted-foreground italic">
    No matches found for this query.
  </div>

  <div v-else class="space-y-3">
    <!-- Legend -->
    <div class="flex flex-wrap gap-3 text-xs">
      <div v-for="[type, colors] in colorEntries" :key="type" class="flex items-center gap-1.5">
        <span :class="cn('size-3 rounded border', colors.bg, colors.border)" />
        <span class="text-muted-foreground">{{ colors.label }}</span>
      </div>
    </div>

    <!-- Match visualizations -->
    <div class="space-y-2">
      <div
        v-for="(match, i) in queryMatches"
        :key="i"
        :class="cn(
          'flex items-start gap-4 p-3 rounded-lg border',
          getMatchColors(match.matchType).bg,
          getMatchColors(match.matchType).border
        )"
      >
        <!-- Match type badge -->
        <div class="shrink-0">
          <span
            :class="cn(
              'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide',
              getMatchColors(match.matchType).bg,
              getMatchColors(match.matchType).text
            )"
          >
            {{ getMatchColors(match.matchType).label }}
          </span>
        </div>

        <!-- Match details -->
        <div class="flex-1 min-w-0 space-y-2">
          <!-- Input text -->
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground shrink-0">Input:</span>
            <span :class="cn('font-mono text-sm font-medium', getMatchColors(match.matchType).text)">
              "{{ match.inputText }}"
            </span>
            <span class="text-[10px] text-muted-foreground tabular-nums">
              (pos {{ match.inputRange.start }}-{{ match.inputRange.end }})
            </span>
          </div>

          <!-- Arrow -->
          <div class="flex items-center gap-2 text-muted-foreground">
            <span class="text-xs">↓ matches</span>
            <span class="text-[10px] tabular-nums">
              score: {{ Math.round(match.score) }}
            </span>
          </div>

          <!-- Target with character highlighting (with truncation for values) -->
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground shrink-0">Target:</span>
            <span 
              :class="cn(
                'text-sm font-mono',
                getVisiblePortion(match).shouldTruncate && 'max-w-[300px] inline-flex items-center'
              )"
            >
              <!-- Start ellipsis -->
              <span v-if="getVisiblePortion(match).showStartEllipsis" class="text-muted-foreground/40">…</span>
              <!-- Visible characters -->
              <span
                v-for="(char, j) in getVisiblePortion(match).visibleChars"
                :key="j"
                :class="cn(
                  'transition-colors',
                  getVisiblePortion(match).indexSet.has(getVisiblePortion(match).start + j)
                    ? `${getMatchColors(match.matchType).bg} ${getMatchColors(match.matchType).text} font-semibold`
                    : 'text-muted-foreground/60'
                )"
              >{{ char }}</span>
              <!-- End ellipsis -->
              <span v-if="getVisiblePortion(match).showEndEllipsis" class="text-muted-foreground/40">…</span>
            </span>
          </div>

          <!-- Character indexes -->
          <div
            v-if="match.matchedCharIndexes && match.matchedCharIndexes.length > 0"
            class="text-[10px] text-muted-foreground"
          >
            Matched chars at indexes: [{{ match.matchedCharIndexes.join(", ") }}]
            <span v-if="isTruncated(match)" class="ml-2 text-muted-foreground/60">
              (showing matched region of {{ match.matchedTarget.length }} char string)
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Explanation -->
    <div class="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
      <strong>Character highlighting:</strong> The highlighted characters in the target
      show exactly which positions matched. FuzzySort allows non-consecutive matches,
      enabling typo tolerance (e.g., "sta" matches "S<mark>ta</mark>tus").
    </div>
  </div>
</template>
