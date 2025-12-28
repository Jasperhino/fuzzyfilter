<script setup lang="ts">
/**
 * NgramPanel - Shows n-gram generation from tokens
 */
import { computed } from "vue"
import type { Token } from "fuzzyfilter"
import { cn } from "@/lib/utils"

interface NgramWithMeta {
  text: string
  tokenCount: number
  totalTokens: number
  isFullQuery: boolean
}

interface Props {
  /** Tokens to generate n-grams from */
  tokens: Token[]
}

const props = defineProps<Props>()

/**
 * Generate n-grams from tokens (same logic as in fuzzy-filter.ts)
 */
function generateNgrams(tokens: Token[]): NgramWithMeta[] {
  const ngrams: NgramWithMeta[] = []
  const totalTokens = tokens.length

  // Individual tokens
  for (const t of tokens) {
    ngrams.push({
      text: t.normalized,
      tokenCount: 1,
      totalTokens,
      isFullQuery: totalTokens === 1,
    })
  }

  // N-grams (size 2 to all tokens)
  for (let n = 2; n <= tokens.length; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const slicedTokens = tokens.slice(i, i + n)
      const ngram = slicedTokens.map((t) => t.normalized).join(" ")
      ngrams.push({
        text: ngram,
        tokenCount: n,
        totalTokens,
        isFullQuery: n === totalTokens,
      })
    }
  }

  return ngrams
}

const ngrams = computed(() => generateNgrams(props.tokens))

const grouped = computed(() => {
  const map = new Map<number, NgramWithMeta[]>()
  for (const ng of ngrams.value) {
    const existing = map.get(ng.tokenCount) || []
    existing.push(ng)
    map.set(ng.tokenCount, existing)
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
})

function getGroupLabel(count: number): string {
  if (count === 1) return "Unigrams (single tokens)"
  if (count === 2) return "Bigrams (2 tokens)"
  if (count === 3) return "Trigrams (3 tokens)"
  return `${count}-grams`
}
</script>

<template>
  <div v-if="tokens.length === 0" class="text-sm text-muted-foreground italic">
    Type something to see n-gram generation...
  </div>

  <div v-else class="space-y-3">
    <!-- N-gram groups -->
    <div v-for="[count, ngs] in grouped" :key="count" class="space-y-1">
      <div class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {{ getGroupLabel(count) }}
      </div>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="(ng, i) in ngs"
          :key="i"
          :class="cn(
            'inline-flex items-center gap-2 border rounded-lg px-3 py-1.5',
            ng.isFullQuery
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-amber-500/10 border-amber-500/30'
          )"
        >
          <span
            :class="cn(
              'font-mono text-sm',
              ng.isFullQuery
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-amber-700 dark:text-amber-300'
            )"
          >
            "{{ ng.text }}"
          </span>
          <span
            v-if="ng.isFullQuery"
            class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
          >
            full query
          </span>
        </div>
      </div>
    </div>

    <!-- Explanation -->
    <div class="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
      <strong>Why n-grams?</strong> Multi-word phrases like "in progress" need to match
      as a unit. By generating all combinations, we can match "in progress" → "In Progress"
      while also trying individual tokens separately.
    </div>
  </div>
</template>

