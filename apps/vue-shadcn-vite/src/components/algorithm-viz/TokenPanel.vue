<script setup lang="ts">
/**
 * TokenPanel - Shows how input is tokenized
 */
import type { Token } from "fuzzyfilter"

interface Props {
  /** Original query string */
  query: string
  /** Tokenized result */
  tokens: Token[]
}

defineProps<Props>()
</script>

<template>
  <div v-if="!query" class="text-sm text-muted-foreground italic">
    Type something to see tokenization...
  </div>

  <div v-else class="space-y-3">
    <!-- Original input -->
    <div class="space-y-1">
      <div class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Input String
      </div>
      <div class="font-mono text-sm bg-muted/50 px-3 py-2 rounded border border-border">
        "{{ query }}"
      </div>
    </div>

    <!-- Tokens -->
    <div class="space-y-1">
      <div class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Tokens ({{ tokens.length }})
      </div>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="(token, i) in tokens"
          :key="i"
          class="inline-flex flex-col items-center gap-1 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2"
        >
          <span class="font-mono text-sm font-medium text-blue-700 dark:text-blue-300">
            "{{ token.text }}"
          </span>
          <span class="text-[10px] text-muted-foreground tabular-nums">
            pos {{ token.start }}-{{ token.end }}
          </span>
        </div>
      </div>
    </div>

    <!-- Explanation -->
    <div class="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
      <strong>How it works:</strong> The input is split on whitespace boundaries.
      Each token preserves its original position (start/end) for later highlighting.
      The normalized form (lowercase) is used for matching.
    </div>
  </div>
</template>

