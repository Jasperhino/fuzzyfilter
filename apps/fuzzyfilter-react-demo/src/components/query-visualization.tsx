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

import { tokenize, type QueryMatch, type FilterSuggestion, type TokenScoreInfo } from "@jasperhino/fuzzyfilter";

/**
 * Represents a token segment with its match and score information
 */
interface TokenSegment {
  /** The text of this segment */
  text: string;
  /** Match type if this segment matched something */
  matchType: "column" | "operator" | "value" | null;
  /** Argument index for value matches (0-based) */
  argIndex: number | null;
  /** Start position in the original query */
  start: number;
  /** End position in the original query */
  end: number;
  /** Whether this is a whitespace separator */
  isSeparator: boolean;
  /** Whether this separator is part of a value match (space within value) vs token separator */
  isValueSpace?: boolean;
  /** Token index in the original token array (for mapping to score info) */
  tokenIndex?: number;
}

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
  if (!matchType) return "—"; // Em dash for unmatched
  if (matchType === "column") return "column";
  if (matchType === "operator") return "operator";
  if (matchType === "value" && argIndex !== null) {
    return `arg ${argIndex + 1}`;
  }
  return "";
}

/**
 * Formats a score contribution for display
 * @param contribution - The weighted contribution value
 * @param isUnmatched - Whether this is an unmatched token (shows penalty)
 * @returns Formatted string like "+0.40" or "-0.20"
 */
function formatScoreContribution(contribution: number, isUnmatched: boolean): string {
  if (isUnmatched) {
    // Show coverage penalty
    return contribution.toFixed(2);
  }
  // Show positive contribution
  return `+${contribution.toFixed(2)}`;
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
  if (!query) return [];

  const result = tokenize(query);
  const tokens = result.tokens;
  const segments: TokenSegment[] = [];

  // If no matches, still return segments but mark them as unmatched
  const validMatches = (matches || []).filter(
    (m): m is QueryMatch => 
      m != null && 
      m.inputRange != null &&
      typeof m.inputRange.start === 'number' &&
      typeof m.inputRange.end === 'number' &&
      m.inputRange.start >= 0 &&
      m.inputRange.end >= m.inputRange.start
  );

  // Priority for match types: column > operator > value
  const matchTypePriority = { column: 0, operator: 1, value: 2 };

  // Sort matches by start position, then by priority (lower = higher priority)
  const sortedMatches = [...validMatches].sort((a, b) => {
    if (a.inputRange.start !== b.inputRange.start) {
      return a.inputRange.start - b.inputRange.start;
    }
    return matchTypePriority[a.matchType] - matchTypePriority[b.matchType];
  });

  // Create a map of position ranges to matches for quick lookup
  const matchMap = new Map<string, QueryMatch>();
  for (const match of sortedMatches) {
    const key = `${match.inputRange.start}-${match.inputRange.end}`;
    if (!matchMap.has(key)) {
      matchMap.set(key, match);
    }
  }

  // Build a set of position ranges that are assigned to non-value matches
  const nonValuePositions = new Set<string>();
  for (const [key, match] of matchMap.entries()) {
    if (match.matchType !== "value") {
      nonValuePositions.add(key);
    }
  }

  // Track arg indices by matchedTarget
  const matchedTargetToArgIndex = new Map<string, number>();
  let valueIdx = 0;

  // Build map: position key -> matchedTarget for value matches
  const positionToMatchedTarget = new Map<string, string>();
  for (const match of sortedMatches) {
    if (match.matchType === "value") {
      const key = `${match.inputRange.start}-${match.inputRange.end}`;
      if (!nonValuePositions.has(key)) {
        positionToMatchedTarget.set(key, match.matchedTarget);
        if (!matchedTargetToArgIndex.has(match.matchedTarget)) {
          matchedTargetToArgIndex.set(match.matchedTarget, valueIdx++);
        }
      }
    }
  }

  // Build valueIndexMap from position -> arg index via matchedTarget
  const valueIndexMap = new Map<string, number>();
  for (const [posKey, target] of positionToMatchedTarget) {
    const idx = matchedTargetToArgIndex.get(target);
    if (idx !== undefined) {
      valueIndexMap.set(posKey, idx);
    }
  }

  let lastEnd = 0;
  let tokenIndex = 0;

  for (const token of tokens) {
    // Add separator (whitespace) before this token if there's a gap
    if (token.start > lastEnd) {
      const separatorStart = lastEnd;
      const separatorEnd = token.start;
      
      let isValueSpace = false;
      for (const match of matchMap.values()) {
        if (
          match.inputRange.start < separatorEnd &&
          match.inputRange.end > separatorStart
        ) {
          isValueSpace = true;
          break;
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
      });
    }

    // Find if this token has a match
    let foundMatch: QueryMatch | undefined;
    let foundKey: string | undefined;

    for (const [key, match] of matchMap.entries()) {
      if (
        match.inputRange.start <= token.end &&
        match.inputRange.end >= token.start
      ) {
        foundMatch = match;
        foundKey = key;
        break;
      }
    }

    const valueIndex = foundKey ? valueIndexMap.get(foundKey) : undefined;

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
    });

    lastEnd = token.end;
    tokenIndex++;
  }

  // Add trailing whitespace if any
  if (lastEnd < query.length) {
    const separatorStart = lastEnd;
    const separatorEnd = query.length;
    
    let isValueSpace = false;
    for (const match of matchMap.values()) {
      if (
        match.inputRange.start < separatorEnd &&
        match.inputRange.end > separatorStart
      ) {
        isValueSpace = true;
        break;
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
    });
  }

  return segments;
}

/**
 * QueryVisualization component props
 */
interface QueryVisualizationProps {
  /** The current query string */
  query: string;
  /** Query matches from the highlighted suggestion */
  matches: QueryMatch[];
  /** The highlighted suggestion (for score explanation) */
  suggestion?: FilterSuggestion;
}

/**
 * QueryVisualization displays the parsed query structure with colored segments,
 * labels, and per-token score contributions.
 *
 * Features:
 * - Columnar layout with token, label, and score rows
 * - Colored segments (column=blue, operator=amber, value=emerald, unmatched=red)
 * - Per-token score contributions with coverage penalties for unmatched tokens
 * - Summary row showing coverage ratio and final score
 *
 * @param props - Component props
 */
export function QueryVisualization({
  query,
  matches,
  suggestion,
}: QueryVisualizationProps) {
  const segments = getTokenizedSegments(query || "", matches || []);
  const scoreExplanation = suggestion?.scoreExplanation;

  // Filter out empty segments
  const visibleSegments = segments.filter((seg) => seg.text.length > 0);

  // Get score info for a token by its index
  const getTokenScoreInfo = (tokenIndex: number | undefined): TokenScoreInfo | undefined => {
    if (tokenIndex === undefined || !scoreExplanation) return undefined;
    return scoreExplanation.tokenScores.find(ts => ts.tokenIndex === tokenIndex);
  };

  // Always render container with fixed height to prevent layout jumping
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 bg-muted/30 rounded-md border border-border/50 font-mono text-sm min-h-[6rem] min-w-0">
      {visibleSegments.length > 0 ? (
        <>
          {/* Grid layout: each segment gets its own column, rows for token/label/score */}
          <div 
            className="grid gap-y-0.5"
            style={{ gridTemplateColumns: `repeat(${visibleSegments.length}, auto)` }}
          >
            {/* Token row */}
            <div className="contents">
              {visibleSegments.map((segment, index) => {
                if (segment.isSeparator) {
                  const separatorChar = segment.isValueSpace ? "_" : "·";
                  const tooltip = segment.isValueSpace ? "space within value" : "token separator";
                  return (
                    <span
                      key={`sep-${index}`}
                      className="px-1 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-default select-none text-center"
                      title={tooltip}
                    >
                      {separatorChar}
                    </span>
                  );
                }

                // Get color class based on match type
                const colorClasses = {
                  column: "text-blue-600 dark:text-blue-400",
                  operator: "text-amber-600 dark:text-amber-400",
                  value: "text-emerald-600 dark:text-emerald-400",
                };

                const isUnmatched = segment.matchType === null;
                const textClass = isUnmatched
                  ? "text-red-500/70 dark:text-red-400/70"
                  : colorClasses[segment.matchType!];

                return (
                  <span 
                    key={`token-${index}`} 
                    className={`${textClass} text-center`}
                  >
                    {segment.text}
                  </span>
                );
              })}
            </div>

            {/* Labels row */}
            <div className="contents text-xs text-muted-foreground/70">
              {visibleSegments.map((segment, index) => {
                if (segment.isSeparator) {
                  return (
                    <span
                      key={`label-sep-${index}`}
                      className="px-1 select-none text-center"
                      aria-hidden="true"
                    >
                      &nbsp;
                    </span>
                  );
                }

                const label = getLabelForMatch(segment.matchType, segment.argIndex);
                const isUnmatched = segment.matchType === null;

                return (
                  <span
                    key={`label-${index}`}
                    className={`text-center text-xs ${isUnmatched ? "text-red-500/50 dark:text-red-400/50" : "text-muted-foreground/70"}`}
                  >
                    {label}
                  </span>
                );
              })}
            </div>

            {/* Score row */}
            {scoreExplanation && (
              <div className="contents text-xs">
                {visibleSegments.map((segment, index) => {
                  if (segment.isSeparator) {
                    return (
                      <span
                        key={`score-sep-${index}`}
                        className="px-1 select-none text-center"
                        aria-hidden="true"
                      >
                        &nbsp;
                      </span>
                    );
                  }

                  const scoreInfo = getTokenScoreInfo(segment.tokenIndex);
                  const isUnmatched = segment.matchType === null;
                  
                  // Calculate display score
                  let scoreDisplay = "";
                  let scoreClass = "text-muted-foreground/50";
                  
                  if (scoreInfo) {
                    scoreDisplay = formatScoreContribution(scoreInfo.weightedContribution, isUnmatched);
                    scoreClass = isUnmatched
                      ? "text-red-500/70 dark:text-red-400/70"
                      : "text-emerald-600/70 dark:text-emerald-400/70";
                  }

                  return (
                    <span
                      key={`score-${index}`}
                      className={`text-center text-xs ${scoreClass}`}
                      title={scoreInfo ? `Quality: ${scoreInfo.fuzzyQuality.toFixed(2)}` : undefined}
                    >
                      {scoreDisplay}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Summary row */}
          {scoreExplanation && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60 mt-1 pt-1 border-t border-border/30">
              <span>
                Coverage: {scoreExplanation.explainedTokens}/{scoreExplanation.totalTokens} = {(scoreExplanation.coverageRatio * 100).toFixed(0)}%
              </span>
              <span className="text-muted-foreground/30">│</span>
              <span>
                Components: {scoreExplanation.componentSum.toFixed(2)}
              </span>
              <span className="text-muted-foreground/30">│</span>
              <span className="font-medium text-foreground/70">
                Score: {scoreExplanation.finalScore.toFixed(2)}
              </span>
            </div>
          )}
        </>
      ) : (
        // Empty state - invisible but maintains height
        <div className="h-12" aria-hidden="true" />
      )}
    </div>
  );
}

export default QueryVisualization;
