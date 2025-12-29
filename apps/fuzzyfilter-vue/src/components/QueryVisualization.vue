<script setup lang="ts">
/**
 * QueryVisualization Component
 *
 * Displays the parsed query structure above the combobox input,
 * showing colored segments with labels indicating token types.
 */
import { computed } from "vue"
import { tokenize, type QueryMatch, type FilterSuggestion } from "fuzzyfilter"

/**
 * Represents a token segment with its match information
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
}

/**
 * Component props
 */
const props = defineProps<{
  /** The current query string */
  query: string
  /** Query matches from the highlighted suggestion */
  matches: QueryMatch[]
  /** The highlighted suggestion (optional, for additional context) */
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
  if (!matchType) return ""
  if (matchType === "column") return "column"
  if (matchType === "operator") return "operator"
  if (matchType === "value" && argIndex !== null) {
    return `arg ${argIndex + 1}`
  }
  return ""
}

/**
 * Gets tokenized segments from query and matches
 * @param query - The user's query string
 * @param matches - Array of query matches from the suggestion
 * @returns Array of token segments with match information
 */
function getTokenizedSegments(
  query: string,
  matches: QueryMatch[]
): TokenSegment[] {
  if (!query) return []

  // If no matches, return empty segments (component will handle empty state)
  if (!matches || matches.length === 0) return []

  const result = tokenize(query)
  const tokens = result.tokens
  const segments: TokenSegment[] = []

  // Filter out any undefined/null matches and ensure they have valid inputRange
  // More defensive: check for inputRange existence and valid properties
  const validMatches = matches.filter(
    (m): m is QueryMatch => 
      m != null && 
      m.inputRange != null &&
      typeof m.inputRange.start === 'number' &&
      typeof m.inputRange.end === 'number' &&
      m.inputRange.start >= 0 &&
      m.inputRange.end >= m.inputRange.start
  )

  if (validMatches.length === 0) return []

  // Priority for match types: column > operator > value
  const matchTypePriority = { column: 0, operator: 1, value: 2 }

  // Sort matches by start position, then by priority (lower = higher priority)
  const sortedMatches = [...validMatches].sort((a, b) => {
    if (a.inputRange.start !== b.inputRange.start) {
      return a.inputRange.start - b.inputRange.start
    }
    return matchTypePriority[a.matchType] - matchTypePriority[b.matchType]
  })

  // Create a map of position ranges to matches for quick lookup
  // When there are overlaps, the first match (higher priority) wins
  const matchMap = new Map<string, QueryMatch>()
  for (const match of sortedMatches) {
    const key = `${match.inputRange.start}-${match.inputRange.end}`
    // Only set if not already present (first = highest priority)
    if (!matchMap.has(key)) {
      matchMap.set(key, match)
    }
  }

  // Build a set of position ranges that are assigned to non-value matches
  // This helps us correctly count only the value matches that are actually used
  const nonValuePositions = new Set<string>()
  for (const [key, match] of matchMap.entries()) {
    if (match.matchType !== "value") {
      nonValuePositions.add(key)
    }
  }

  // Track arg indices by matchedTarget (the value being matched)
  // This ensures all tokens matching the same value share the same arg index
  const matchedTargetToArgIndex = new Map<string, number>()
  let valueIdx = 0

  // Build map: position key -> matchedTarget for value matches
  const positionToMatchedTarget = new Map<string, string>()
  for (const match of sortedMatches) {
    if (match.matchType === "value") {
      const key = `${match.inputRange.start}-${match.inputRange.end}`
      if (!nonValuePositions.has(key)) {
        positionToMatchedTarget.set(key, match.matchedTarget)
        // Assign arg index if we haven't seen this matchedTarget yet
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

  for (const token of tokens) {
    // Add separator (whitespace) before this token if there's a gap
    if (token.start > lastEnd) {
      const separatorStart = lastEnd
      const separatorEnd = token.start
      
      // Check if this separator falls within any match's range (space within value)
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
    // Check for matches that overlap with this token's range
    let foundMatch: QueryMatch | undefined
    let foundKey: string | undefined

    for (const [key, match] of matchMap.entries()) {
      // Check if match overlaps with token
      if (
        match.inputRange.start <= token.end &&
        match.inputRange.end >= token.start
      ) {
        foundMatch = match
        foundKey = key
        break
      }
    }

    // Get the value index for this position if it's a value match
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
    })

    lastEnd = token.end
  }

  // Add trailing whitespace if any
  if (lastEnd < query.length) {
    const separatorStart = lastEnd
    const separatorEnd = query.length
    
    // Check if this separator falls within any match's range (space within value)
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
 * Get color class for a match type
 */
function getColorClass(matchType: "column" | "operator" | "value" | null): string {
  const colorClasses = {
    column: "text-blue-600 dark:text-blue-400",
    operator: "text-amber-600 dark:text-amber-400",
    value: "text-emerald-600 dark:text-emerald-400",
  }
  return matchType ? colorClasses[matchType] : "text-muted-foreground"
}
</script>

<template>
  <!-- Always render container with fixed height to prevent layout jumping -->
  <!-- Use min-h-[3.5rem] (h-14) to ensure consistent height -->
  <div
    class="flex flex-col gap-0.5 px-3 py-2 bg-muted/30 rounded-md border border-border/50 font-mono text-base min-h-[3.5rem] min-w-0"
  >
    <template v-if="visibleSegments.length > 0">
      <!-- Token row with separators -->
      <div class="flex items-center gap-0">
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
      <div class="flex items-center gap-0 text-xs text-muted-foreground/70">
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
            class="text-center truncate"
            :style="{ width: `${segment.text.length}ch` }"
          >
            {{ getLabelForMatch(segment.matchType, segment.argIndex) }}
          </span>
        </template>
      </div>
    </template>
    <template v-else>
      <!-- Empty state - invisible but maintains height -->
      <div class="h-8" aria-hidden="true" />
    </template>
  </div>
</template>
