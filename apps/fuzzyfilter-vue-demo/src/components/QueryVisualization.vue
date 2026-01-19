<script setup lang="ts">
/**
 * QueryVisualization Component
 *
 * Displays the parsed query structure above the combobox input,
 * showing colored segments with labels and score contributions.
 * 
 * Layout (columnar, 3 rows per token):
 * ┌──────────┬────┬──────────┬────┬────────┐
 * │ priority │  · │    lt    │  · │   3    │  ← Token row
 * ├──────────┼────┼──────────┼────┼────────┤
 * │  column  │    │ operator │    │ arg 1  │  ← Label row
 * ├──────────┼────┼──────────┼────┼────────┤
 * │  +0.40   │    │  +0.20   │    │ +0.40  │  ← Score row
 * └──────────┴────┴──────────┴────┴────────┘
 * Coverage: 3/3 = 100% │ Final Score: 1.0
 */
import { computed } from "vue"
import { tokenize, type FilterSuggestion } from "@jasperhino/fuzzyfilter"

// Local type definitions for components not yet exported from fuzzyfilter
interface QueryMatch {
  inputRange: { start: number; end: number };
  matchType: "column" | "operator" | "value" | null;
  [key: string]: any;
}

interface TokenScoreInfo {
  tokenIndex: number;
  weightedContribution: number;
  fuzzyQuality: number;
}

/**
 * Represents a token segment with its match and score information
 */
interface TokenSegment {
  /** The text of this segment */
  text: string
  /** Match type if this segment matched something */
  matchType: "column" | "operator" | "value" | null
  /** Argument index for value matches (0-based) */
  argIndex: number | null
  /** Start position in the original query */
  start: number
  /** End position in the original query */
  end: number
  /** Whether this is a whitespace separator */
  isSeparator: boolean
  /** Whether this separator is part of a value match (space within value) vs token separator */
  isValueSpace?: boolean
  /** Token index in the original token array (for mapping to score info) */
  tokenIndex?: number
}

/**
 * Component props
 */
const props = defineProps<{
  /** The current query string */
  query: string
  /** Query matches from the highlighted suggestion */
  matches: QueryMatch[]
  /** The highlighted suggestion (for score explanation) */
  suggestion?: FilterSuggestion
}>()

/**
 * Gets the label for a match type
 * @param matchType - The type of match
 * @param argIndex - The argument index (0-based) for value matches
 * @returns Human-readable label
 */
function getLabelForMatch(
  matchType: "column" | "operator" | "value" | null,
  argIndex: number | null
): string {
  if (!matchType) return "—" // Em dash for unmatched
  if (matchType === "column") return "column"
  if (matchType === "operator") return "operator"
  if (matchType === "value" && argIndex !== null) {
    return `arg ${argIndex + 1}`
  }
  return ""
}

/**
 * Formats a score as .333 (no leading zero, 3 digits)
 */
function formatScore(score: number): string {
  const s = score.toFixed(3)
  const formatted = s.startsWith("0") ? s.substring(1) : (s.startsWith("-0") ? "-" + s.substring(2) : s)
  return formatted
}

/**
 * Formats a score contribution for display
 */
function formatScoreContribution(contribution: number, isUnmatched: boolean): string {
  const formatted = formatScore(contribution)
  
  if (isUnmatched) {
    // Show coverage penalty
    return formatted
  }
  // Show positive contribution
  return `+${formatted}`
}

/**
 * Gets tokenized segments from query and matches, with token indices for score lookup
 * @param query - The user's query string
 * @param matches - Array of query matches from the suggestion
 * @returns Array of token segments with match information
 */
function getTokenizedSegments(
  query: string,
  matches: QueryMatch[]
): TokenSegment[] {
  if (!query) return []

  const result = tokenize(query)
  const tokens = result.tokens
  const segments: TokenSegment[] = []

  // If no matches, still return segments but mark them as unmatched
  const validMatches = (matches || []).filter(
    (m): m is QueryMatch => 
      m != null && 
      m.inputRange != null &&
      typeof m.inputRange.start === 'number' &&
      typeof m.inputRange.end === 'number' &&
      m.inputRange.start >= 0 &&
      m.inputRange.end >= m.inputRange.start
  )

  // Priority for match types: column > operator > value
  const matchTypePriority = { column: 0, operator: 1, value: 2 }

  // Sort matches by start position, then by priority (lower = higher priority)
  const sortedMatches = [...validMatches].sort((a, b) => {
    if (a.inputRange.start !== b.inputRange.start) {
      return a.inputRange.start - b.inputRange.start
    }
    const getPriority = (matchType: "column" | "operator" | "value" | null): number => {
      if (matchType === null) return 999
      return matchTypePriority[matchType]
    }
    return getPriority(a.matchType) - getPriority(b.matchType)
  })

  // Create a map of position ranges to matches for quick lookup
  const matchMap = new Map<string, QueryMatch>()
  for (const match of sortedMatches) {
    const key = `${match.inputRange.start}-${match.inputRange.end}`
    if (!matchMap.has(key)) {
      matchMap.set(key, match)
    }
  }

  // Build a set of position ranges that are assigned to non-value matches
  const nonValuePositions = new Set<string>()
  for (const [key, match] of matchMap.entries()) {
    if (match.matchType !== "value") {
      nonValuePositions.add(key)
    }
  }

  // Track arg indices by matchedTarget
  const matchedTargetToArgIndex = new Map<string, number>()
  let valueIdx = 0

  // Build map: position key -> matchedTarget for value matches
  const positionToMatchedTarget = new Map<string, string>()
  for (const match of sortedMatches) {
    if (match.matchType === "value") {
      const key = `${match.inputRange.start}-${match.inputRange.end}`
      if (!nonValuePositions.has(key)) {
        positionToMatchedTarget.set(key, match.matchedTarget)
        if (!matchedTargetToArgIndex.has(match.matchedTarget)) {
          matchedTargetToArgIndex.set(match.matchedTarget, valueIdx++)
        }
      }
    }
  }

  // Build valueIndexMap from position -> arg index via matchedTarget
  const valueIndexMap = new Map<string, number>()
  for (const [posKey, target] of positionToMatchedTarget) {
    const idx = matchedTargetToArgIndex.get(target)
    if (idx !== undefined) {
      valueIndexMap.set(posKey, idx)
    }
  }

  let lastEnd = 0
  let tokenIndex = 0

  for (const token of tokens) {
    // Add separator (whitespace) before this token if there's a gap
    if (token.start > lastEnd) {
      const separatorStart = lastEnd
      const separatorEnd = token.start
      
      let isValueSpace = false
      for (const match of matchMap.values()) {
        if (
          match.inputRange.start < separatorEnd &&
          match.inputRange.end > separatorStart
        ) {
          isValueSpace = true
          break
        }
      }
      
      segments.push({
        text: query.slice(lastEnd, token.start),
        matchType: null,
        argIndex: null,
        start: lastEnd,
        end: token.start,
        isSeparator: true,
        isValueSpace,
      })
    }

    // Find if this token has a match
    let foundMatch: QueryMatch | undefined
    let foundKey: string | undefined

    for (const [key, match] of matchMap.entries()) {
      if (
        match.inputRange.start <= token.end &&
        match.inputRange.end >= token.start
      ) {
        foundMatch = match
        foundKey = key
        break
      }
    }

    const valueIndex = foundKey ? valueIndexMap.get(foundKey) : undefined

    segments.push({
      text: token.text,
      matchType: foundMatch?.matchType ?? null,
      argIndex:
        foundMatch?.matchType === "value" && valueIndex !== undefined
          ? valueIndex
          : null,
      start: token.start,
      end: token.end,
      isSeparator: false,
      tokenIndex: tokenIndex,
    })

    lastEnd = token.end
    tokenIndex++
  }

  // Add trailing whitespace if any
  if (lastEnd < query.length) {
    const separatorStart = lastEnd
    const separatorEnd = query.length
    
    let isValueSpace = false
    for (const match of matchMap.values()) {
      if (
        match.inputRange.start < separatorEnd &&
        match.inputRange.end > separatorStart
      ) {
        isValueSpace = true
        break
      }
    }
    
    segments.push({
      text: query.slice(lastEnd),
      matchType: null,
      argIndex: null,
      start: lastEnd,
      end: query.length,
      isSeparator: true,
      isValueSpace,
    })
  }

  return segments
}

/**
 * Computed segments from query and matches
 */
const segments = computed(() => {
  return getTokenizedSegments(props.query || "", props.matches || [])
})

/**
 * Visible segments (non-empty)
 */
const visibleSegments = computed(() => {
  return segments.value.filter((seg) => seg.text.length > 0)
})

/**
 * Score breakdown from suggestion
 */
const scoreBreakdown = computed(() => {
  return props.suggestion?.scoreBreakdown
})

/**
 * Get color class for a match type
 */
function getColorClass(matchType: "column" | "operator" | "value" | null): string {
  if (matchType === null) {
    return "text-red-500/70 dark:text-red-400/70"
  }
  const colorClasses = {
    column: "text-blue-600 dark:text-blue-400",
    operator: "text-amber-600 dark:text-amber-400",
    value: "text-emerald-600 dark:text-emerald-400",
  }
  return colorClasses[matchType]
}

/**
 * Get score info for a token by its index
 */
function getTokenScoreInfo(tokenIndex: number | undefined): any {
  // Note: TokenScoreInfo and scoreExplanation are not currently part of the FilterSuggestion API
  // This is a placeholder for future implementation
  if (tokenIndex === undefined || !scoreBreakdown.value) return undefined
  // scoreBreakdown doesn't have tokenScores, so return undefined for now
  return undefined
}

/**
 * Get score display and class for a segment
 */
function getScoreDisplay(segment: TokenSegment): { text: string; class: string; title?: string } {
  const scoreInfo = getTokenScoreInfo(segment.tokenIndex)
  const isUnmatched = segment.matchType === null
  
  if (!scoreInfo) {
    return { text: "", class: "text-muted-foreground/50" }
  }
  
  const scoreText = formatScoreContribution(scoreInfo.weightedContribution, isUnmatched)
  const scoreClass = isUnmatched
    ? "text-red-500/70 dark:text-red-400/70"
    : "text-emerald-600/70 dark:text-emerald-400/70"
  
  return { 
    text: scoreText, 
    class: scoreClass,
    title: `Quality: ${scoreInfo.fuzzyQuality.toFixed(2)}`
  }
}

</script>

<template>
  <!-- Always render container with fixed height to prevent layout jumping -->
  <div
    class="flex flex-col gap-0.5 px-3 py-2 bg-muted/30 rounded-md border border-border/50 font-mono text-sm min-h-[6rem] min-w-0"
  >
    <template v-if="visibleSegments.length > 0">
      <!-- Grid layout: each segment gets its own column, rows for token/label/score -->
      <div 
        class="grid gap-y-0.5 justify-start"
        :style="{ gridTemplateColumns: `repeat(${visibleSegments.length}, auto)` }"
      >
        <!-- Token row -->
        <div class="contents">
          <template v-for="(segment, index) in visibleSegments" :key="index">
            <!-- Separator: dot (·) for token separator, underscore (_) for space within value -->
            <span
              v-if="segment.isSeparator"
              class="px-1 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-default select-none"
              :title="segment.isValueSpace ? 'space within value' : 'token separator'"
            >
              {{ segment.isValueSpace ? '_' : '·' }}
            </span>
            <!-- Token text -->
            <span v-else :class="getColorClass(segment.matchType)">
              {{ segment.text }}
            </span>
          </template>
        </div>

        <!-- Labels row -->
        <div class="contents">
          <template v-for="(segment, index) in visibleSegments" :key="`label-${index}`">
            <!-- Empty space for separator alignment -->
            <span
              v-if="segment.isSeparator"
              class="px-1 select-none"
              aria-hidden="true"
            >
              &nbsp;
            </span>
            <!-- Label aligned with token above -->
            <span
              v-else
              class="text-xs"
              :class="segment.matchType === null ? 'text-red-500/50 dark:text-red-400/50' : 'text-muted-foreground/70'"
            >
              {{ getLabelForMatch(segment.matchType, segment.argIndex) }}
            </span>
          </template>
        </div>

        <!-- Score row -->
        <template v-if="scoreBreakdown">
          <div class="contents">
            <template v-for="(segment, index) in visibleSegments" :key="`score-${index}`">
              <!-- Empty space for separator alignment -->
              <span
                v-if="segment.isSeparator"
                class="px-1 select-none"
                aria-hidden="true"
              >
                &nbsp;
              </span>
              <!-- Score aligned with token above -->
              <span
                v-else
                class="text-xs"
                :class="getScoreDisplay(segment).class"
                :title="getScoreDisplay(segment).title"
              >
                {{ getScoreDisplay(segment).text }}
              </span>
            </template>
          </div>
        </template>
      </div>

      <!-- Summary row -->
      <div 
        v-if="scoreBreakdown" 
        class="flex items-center justify-start gap-2 text-xs text-muted-foreground/60 mt-1 pt-1 border-t border-border/30"
      >
        <span>
          Field: {{ formatScore(scoreBreakdown.field) }}
        </span>
        <span class="text-muted-foreground/30">│</span>
        <span>
          Operator: {{ formatScore(scoreBreakdown.operator) }}
        </span>
        <span class="text-muted-foreground/30">│</span>
        <span>
          Value: {{ formatScore(scoreBreakdown.valueParse) }}
        </span>
        <span class="text-muted-foreground/30">│</span>
        <span class="font-medium text-foreground/70">
          Final: {{ formatScore(scoreBreakdown.final) }}
        </span>
      </div>
    </template>
    <template v-else>
      <!-- Empty state - invisible but maintains height -->
      <div class="h-12" aria-hidden="true" />
    </template>
  </div>
</template>
