/**
 * Filter Combobox Component
 *
 * A combobox for filtering data with fuzzy matching and intelligent suggestions.
 * Uses virtual scrolling to handle large datasets (10,000+ rows).
 * Now using the useFuzzyFilter hook for state management.
 */

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  createFuzzyFilter,
  getOperator,
  type FuzzyFilter,
  type FilterSuggestion,
  type CompiledFilter,
  type HypothesisValueType,
  type QueryMatch,
  createI18nextProvider,
} from "@jasperhino/fuzzyfilter";
import { useFuzzyFilter } from "fuzzyfilter-react";
import { useTranslation } from "react-i18next";
import {
  TASK_SCHEMA,
  LARGE_DATASET,
  generateSingleTaskAsync,
  COLUMN_IDS,
  type Task as TaskRow,
} from "@fuzzyfilter/sample-data";
import { ColumnHeader } from "./column-info-popover";
import { QueryVisualization } from "./query-visualization";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
} from "@/components/ui/combobox";
import {
  FilterIcon,
  CheckIcon,
  XIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  ChevronsUpDownIcon,
} from "lucide-operators-react";
import { attachAxiomExporter } from "@/lib/axiom-telemetry";

// Use pre-generated dataset (10,000 rows with seed 42)
// This avoids loading faker.js at runtime, significantly improving LCP
const INITIAL_DATASET = LARGE_DATASET;

// Row height for virtual scroll calculations
const ROW_HEIGHT = 48;

/**
 * Sort direction type for column sorting
 */
type SortDirection = "asc" | "desc";

/**
 * Sorting state for the data table
 */
interface SortState {
  column: keyof TaskRow | null;
  direction: SortDirection;
}

/**
 * Helper to convert QueryMatch array into renderable segments for highlighting.
 * Segments are sorted by position and gaps are filled with unmatched text.
 */
function getHighlightSegments(
  query: string,
  matches: QueryMatch[]
): Array<{ text: string; matchType: "column" | "operator" | "value" | null }> {
  if (!matches.length || !query) {
    return [{ text: query, matchType: null }];
  }

  // Priority for match types when there are overlaps: column > operator > value
  const matchTypePriority = { column: 0, operator: 1, value: 2 };

  // Sort matches by start position, then by priority (lower = higher priority)
  const sorted = [...matches].sort((a, b) => {
    if (a.inputRange.start !== b.inputRange.start) {
      return a.inputRange.start - b.inputRange.start;
    }
    return matchTypePriority[a.matchType] - matchTypePriority[b.matchType];
  });

  const segments: Array<{ text: string; matchType: "column" | "operator" | "value" | null }> = [];
  let currentPos = 0;

  for (const match of sorted) {
    // Skip matches that are entirely within already processed text (overlapping)
    if (match.inputRange.end <= currentPos) {
      continue;
    }

    // Adjust start if match overlaps with already processed text
    const effectiveStart = Math.max(match.inputRange.start, currentPos);

    // Add unmatched text before this match
    if (effectiveStart > currentPos) {
      segments.push({
        text: query.slice(currentPos, effectiveStart),
        matchType: null,
      });
    }

    // Add the matched segment
    segments.push({
      text: query.slice(effectiveStart, match.inputRange.end),
      matchType: match.matchType,
    });

    currentPos = match.inputRange.end;
  }

  // Add any remaining text after last match
  if (currentPos < query.length) {
    segments.push({
      text: query.slice(currentPos),
      matchType: null,
    });
  }

  return segments;
}

/**
 * Component to render highlighted query text showing what matched what.
 */
function HighlightedQuery({ 
  query, 
  matches 
}: { 
  query: string; 
  matches?: QueryMatch[];
}) {
  if (!matches || matches.length === 0) {
    return <span className="text-muted-foreground">{query}</span>;
  }

  const segments = getHighlightSegments(query, matches);

  return (
    <span className="font-mono text-xs">
      {segments.map((seg, i) => {
        if (!seg.matchType) {
          return <span key={i} className="text-muted-foreground">{seg.text}</span>;
        }

        const colorClasses = {
          column: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
          operator: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
          value: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
        };

        return (
          <span 
            key={i} 
            className={`px-0.5 rounded ${colorClasses[seg.matchType]}`}
            title={`Matched: ${seg.matchType}`}
          >
            {seg.text}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Renders text with certain character indexes highlighted (bold).
 * Used to show which characters in a suggestion matched the user's query.
 * 
 * @param text - The text to render
 * @param matchedIndexes - Array of character indexes to highlight
 */
function HighlightedText({ 
  text, 
  matchedIndexes,
  className 
}: { 
  text: string; 
  matchedIndexes?: number[];
  className?: string;
}) {
  if (!matchedIndexes || matchedIndexes.length === 0) {
    return <span className={className}>{text}</span>;
  }

  // Create a set for O(1) lookup
  const indexSet = new Set(matchedIndexes);
  
  // Group consecutive characters into segments
  const segments: Array<{ text: string; highlighted: boolean }> = [];
  let currentSegment = { text: "", highlighted: indexSet.has(0) };
  
  for (let i = 0; i < text.length; i++) {
    const isHighlighted = indexSet.has(i);
    if (isHighlighted === currentSegment.highlighted) {
      currentSegment.text += text[i];
    } else {
      if (currentSegment.text) {
        segments.push(currentSegment);
      }
      currentSegment = { text: text[i], highlighted: isHighlighted };
    }
  }
  if (currentSegment.text) {
    segments.push(currentSegment);
  }

  return (
    <span className={className ? `whitespace-pre ${className}` : 'whitespace-pre'}>
      {segments.map((seg, i) => (
        seg.highlighted ? (
          <span key={i} className="font-bold">{seg.text}</span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      ))}
    </span>
  );
}

/**
 * Maps enum data values to translation keys
 */
const STATUS_TRANSLATION_KEYS: Record<string, string> = {
  "Open": "values.status.open",
  "In Progress": "values.status.inProgress",
  "Closed": "values.status.closed",
  "Blocked": "values.status.blocked",
};

const DEPARTMENT_TRANSLATION_KEYS: Record<string, string> = {
  "Engineering": "values.department.engineering",
  "Design": "values.department.design",
  "Product": "values.department.product",
};

/**
 * Status badge component with translation support
 */
function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const variants: Record<string, { bg: string; text: string }> = {
    "Open": { bg: "bg-emerald-500/15", text: "text-emerald-600" },
    "In Progress": { bg: "bg-amber-500/15", text: "text-amber-600" },
    "Closed": { bg: "bg-slate-500/15", text: "text-slate-500" },
    "Blocked": { bg: "bg-rose-500/15", text: "text-rose-600" },
  };
  const v = variants[status] ?? { bg: "bg-muted", text: "text-muted-foreground" };
  
  // Get translated status text
  const translationKey = STATUS_TRANSLATION_KEYS[status];
  const displayText = translationKey ? t(translationKey) : status;
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${v.bg} ${v.text}`}>
      {displayText}
    </span>
  );
}

// Priority indicator
function PriorityIndicator({ priority }: { priority: number }) {
  const colors = [
    "bg-slate-300",
    "bg-emerald-400",
    "bg-amber-400",
    "bg-orange-500",
    "bg-rose-500",
  ];
  return (
    <div className="flex items-center gap-1">
      <div className={`size-2 rounded-full ${colors[priority - 1] ?? colors[0]}`} />
      <span className="text-sm tabular-nums">{priority}</span>
    </div>
  );
}


/**
 * Reusable component to render filter parts (column, operator, arguments).
 * Used in both suggestion dropdown and applied filters bar.
 * 
 * @param suggestion - The filter suggestion containing parts data
 * @param showPlaceholders - Whether to show placeholders for missing arguments
 */
function FilterParts({ 
  suggestion, 
  showPlaceholders = true 
}: { 
  suggestion: FilterSuggestion; 
  showPlaceholders?: boolean;
}) {
  const { parts, operator, queryMatches } = suggestion;
  
  // Calculate missing arguments for placeholders
  const opInfo = getOperator(operator);
  const minArgs = opInfo.isVariadic ? (opInfo.minArguments ?? 1) : (opInfo.requiresArgument ? 1 : 0);
  const currentArgs = parts.arguments?.length ?? 0;
  const missingArgs = Math.max(0, minArgs - currentArgs);
  
  // Find query matches for each part type
  const columnMatch = queryMatches?.find(m => m.matchType === "column");
  const operatorMatch = queryMatches?.find(m => m.matchType === "operator");
  const valueMatches = queryMatches?.filter(m => m.matchType === "value") ?? [];
  
  // Helper to find if an argument was matched
  // For multiple arguments (in/not in), match by index first, then fall back to string matching
  const getArgMatchInfo = (argText: string, argIndex: number) => {
    // Try to match by index first (for in/not in operators with multiple args)
    if (argIndex < valueMatches.length) {
      const indexMatch = valueMatches[argIndex];
      // Verify it matches the text (safety check)
      if (indexMatch && indexMatch.matchedTarget === argText) {
        return indexMatch;
      }
    }
    // Fall back to string matching (for single args or when index doesn't match)
    return valueMatches.find(m => m.matchedTarget === argText);
  };
  
  return (
    <>
      <HighlightedText 
        text={parts.column.text}
        matchedIndexes={columnMatch?.matchedCharIndexes}
        className="font-medium text-foreground truncate"
      />
      <span className="shrink-0 h-4 px-1 rounded inline-flex items-center bg-muted text-muted-foreground text-[10px]">
        <HighlightedText 
          text={parts.operator.matchedAlias ?? parts.operator.text}
          matchedIndexes={operatorMatch?.matchedCharIndexes}
        />
      </span>
      {/* Render existing arguments - use character-level highlighting */}
      {parts.arguments?.map((a: { text: string; displayText?: string; displayMatchedIndexes?: number[] }, i: number) => {
        const argMatch = getArgMatchInfo(a.text, i);
        // Use displayText when available (for truncated long values), otherwise use full text
        // Use displayMatchedIndexes when available (relative to displayText), otherwise use matchedCharIndexes (relative to full text)
        const displayText = a.displayText ?? a.text;
        const matchedIndexes = a.displayMatchedIndexes ?? argMatch?.matchedCharIndexes;
        return (
          <span 
            key={i}
            className="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground max-w-[200px] truncate"
            title={a.displayText ? a.text : undefined}
          >
            <HighlightedText 
              text={displayText}
              matchedIndexes={matchedIndexes}
            />
          </span>
        );
      })}
      {/* Render placeholders for missing arguments */}
      {showPlaceholders && Array.from({ length: missingArgs }).map((_, i) => (
        <span 
          key={`missing-${i}`}
          className="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-dashed border-muted-foreground/40 text-muted-foreground/50"
        >
          …
        </span>
      ))}
    </>
  );
}

/**
 * Custom suggestion item renderer with three-column layout:
 * - Suggestion (left aligned, flexible)
 * - Score (right aligned, fixed width)
 * - # Results (right aligned, fixed width)
 */
function SuggestionItem({ suggestion }: { suggestion: FilterSuggestion }) {
  const { resultCount, score, scoreBreakdown, category } = suggestion;

  // Format score for display (0-1 range, 4 decimal places)
  const displayScore = score.toFixed(4);
  
  // Determine color based on score (0-1 range)
  const getScoreColor = () => {
    if (score >= 0.8) return "text-emerald-600";
    if (score >= 0.6) return "text-lime-600";
    if (score >= 0.4) return "text-amber-600";
    if (score >= 0.2) return "text-orange-600";
    return "text-rose-600";
  };

  // Build detailed tooltip content
  const tooltipLines = [
    `Final Score: ${displayScore}`,
    `Category: ${category}`,
    "",
  ];

  if (scoreBreakdown) {
    tooltipLines.push(
      "── Score Breakdown ──",
      `Raw Match: ${scoreBreakdown.rawScore.toFixed(4)}`,
      `Adjusted Score: ${scoreBreakdown.adjustedScore.toFixed(4)} (${scoreBreakdown.tokenCount}/${scoreBreakdown.totalTokens} tokens)`,
    );
  }

  tooltipLines.push(
    "",
    "── Match Info ──",
    `Column: ${suggestion.column.name}`,
    `Operator: ${suggestion.operator}`,
  );

  // Show all argument values
  if (suggestion.arguments && suggestion.arguments.length > 0) {
    const argValues = suggestion.arguments.map((arg) => {
      if (arg.kind === "string") return `"${arg.value}"`;
      if (arg.kind === "number") return String(arg.value);
      if (arg.kind === "date") return arg.value.toISOString().split("T")[0];
      if (arg.kind === "boolean") return String(arg.value);
      return "?";
    });
    tooltipLines.push(`Arguments: [${argValues.join(", ")}]`);
    
    // Show if more arguments are needed
    const opInfo = getOperator(suggestion.operator);
    const minArgs = opInfo.isVariadic ? (opInfo.minArguments ?? 1) : (opInfo.requiresArgument ? 1 : 0);
    if (suggestion.arguments.length < minArgs) {
      tooltipLines.push(`Missing: ${minArgs - suggestion.arguments.length} more value(s) needed`);
    }
  }

  // Show query match info for highlighting
  if (suggestion.queryMatches && suggestion.queryMatches.length > 0) {
    tooltipLines.push(
      "",
      "── Query Matches ──",
    );
    for (const match of suggestion.queryMatches) {
      tooltipLines.push(
        `${match.matchType}: "${match.inputText}" → "${match.matchedTarget}" (pos ${match.inputRange.start}-${match.inputRange.end})`
      );
    }
  }

  const tooltipContent = tooltipLines.join("\n");

  return (
    <div className="flex items-center w-full gap-2 text-xs">
      {/* Suggestion column - left aligned, grows to push score/results right */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <FilterParts suggestion={suggestion} showPlaceholders={true} />
      </div>
      
      {/* Score column - left aligned, fixed width */}
      <span 
        className={`w-10 font-mono tabular-nums cursor-help shrink-0 ${getScoreColor()}`}
        title={tooltipContent}
      >
        {displayScore}
      </span>
      
      {/* Results column - left aligned, fixed width */}
      <span 
        className="w-14 text-muted-foreground tabular-nums shrink-0" 
        data-testid="result-count"
      >
        {resultCount.toLocaleString()}
      </span>
    </div>
  );
}

// Table row component with virtualization support
function TableRow({ 
  row, 
  isSelected, 
  onSelect 
}: { 
  row: TaskRow; 
  isSelected: boolean;
  onSelect: (rowId: number | null) => void;
}) {
  const { t } = useTranslation();
  
  const handleClick = () => {
    onSelect(isSelected ? null : row.id);
  };
  
  return (
    <tr
      onClick={handleClick}
      className={`border-b transition-all h-12 cursor-pointer ${
        isSelected 
          ? "border-l-4 border-l-primary" 
          : "border-l-2 border-l-transparent hover:border-l-primary/40"
      }`}
    >
      <td className="px-3 py-2 whitespace-nowrap h-12">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-3 py-2 font-medium whitespace-nowrap h-12">{row.assignee}</td>
      <td className="px-3 py-2 whitespace-nowrap h-12">
        <PriorityIndicator priority={row.priority} />
      </td>
      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap h-12">
        {DEPARTMENT_TRANSLATION_KEYS[row.department] ? t(DEPARTMENT_TRANSLATION_KEYS[row.department]) : row.department}
      </td>
      <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap h-12">{row.dueDate}</td>
      <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap h-12 text-xs">{row.created}</td>
      <td className="px-3 py-2 text-center whitespace-nowrap h-12">
        {row.isBlocked ? (
          <XIcon className="size-4 text-rose-500 mx-auto" />
        ) : (
          <CheckIcon className="size-4 text-emerald-500 mx-auto" />
        )}
      </td>
      <td className="px-3 py-2 text-muted-foreground text-sm h-12 max-w-xs" title={row.comments}>
        <span className="block truncate">
          {row.comments || <span className="text-muted-foreground/50 italic">{t("ui.noComments")}</span>}
        </span>
      </td>
    </tr>
  );
}

/**
 * Gets a column definition from the schema by ID
 */
function getColumnById(columnId: string) {
  return TASK_SCHEMA.columns.find((c) => c.id === columnId);
}

/**
 * Sortable column header component with click handler and sort indicator
 */
function SortableColumnHeader({
  column,
  label,
  sortState,
  onSort,
  columnKey,
}: {
  column: ReturnType<typeof getColumnById>;
  label: string;
  sortState: SortState;
  onSort: (columnId: keyof TaskRow) => void;
  columnKey: keyof TaskRow;
}) {
  if (!column) return null;

  const isSorted = sortState.column === columnKey;
  const isAsc = isSorted && sortState.direction === "asc";
  const isDesc = isSorted && sortState.direction === "desc";

  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      className="flex items-center gap-1 group hover:text-foreground transition-colors cursor-pointer"
    >
      <ColumnHeader column={column} label={label} />
      <span className="shrink-0">
        {isAsc ? (
          <ArrowUpIcon className="size-3.5 text-foreground" />
        ) : isDesc ? (
          <ArrowDownIcon className="size-3.5 text-foreground" />
        ) : (
          <ChevronsUpDownIcon className="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </span>
    </button>
  );
}

// Virtual data table component
function VirtualDataTable({ 
  data, 
  selectedRowId,
  onRowSelect,
  sortState,
  onSort,
}: { 
  data: TaskRow[]; 
  selectedRowId: number | null;
  onRowSelect: (rowId: number | null) => void;
  sortState: SortState;
  onSort: (columnId: keyof TaskRow) => void;
}) {
  const { t } = useTranslation();
  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Get column definitions for headers
  const statusColumn = getColumnById(COLUMN_IDS.status);
  const assigneeColumn = getColumnById(COLUMN_IDS.assignee);
  const priorityColumn = getColumnById(COLUMN_IDS.priority);
  const departmentColumn = getColumnById(COLUMN_IDS.department);
  const dueDateColumn = getColumnById(COLUMN_IDS.dueDate);
  const createdColumn = getColumnById(COLUMN_IDS.created);
  const isBlockedColumn = getColumnById(COLUMN_IDS.isBlocked);
  const commentsColumn = getColumnById(COLUMN_IDS.comments);

  return (
    <div className="overflow-hidden rounded-lg border border-border flex flex-col max-h-full">
      <div
        ref={parentRef}
        className="flex-1 overflow-auto min-h-0 isolate"
      >
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="border-b">
              <th className="px-3 py-3 text-left font-normal whitespace-nowrap">
                <SortableColumnHeader
                  column={statusColumn}
                  label={t("table.headers.status")}
                  sortState={sortState}
                  onSort={onSort}
                  columnKey="status"
                />
              </th>
              <th className="px-3 py-3 text-left font-normal whitespace-nowrap">
                <SortableColumnHeader
                  column={assigneeColumn}
                  label={t("table.headers.assignee")}
                  sortState={sortState}
                  onSort={onSort}
                  columnKey="assignee"
                />
              </th>
              <th className="px-3 py-3 text-left font-normal whitespace-nowrap">
                <SortableColumnHeader
                  column={priorityColumn}
                  label={t("table.headers.priority")}
                  sortState={sortState}
                  onSort={onSort}
                  columnKey="priority"
                />
              </th>
              <th className="px-3 py-3 text-left font-normal whitespace-nowrap">
                <SortableColumnHeader
                  column={departmentColumn}
                  label={t("table.headers.department")}
                  sortState={sortState}
                  onSort={onSort}
                  columnKey="department"
                />
              </th>
              <th className="px-3 py-3 text-left font-normal whitespace-nowrap">
                <SortableColumnHeader
                  column={dueDateColumn}
                  label={t("table.headers.dueDate")}
                  sortState={sortState}
                  onSort={onSort}
                  columnKey="dueDate"
                />
              </th>
              <th className="px-3 py-3 text-left font-normal whitespace-nowrap">
                <SortableColumnHeader
                  column={createdColumn}
                  label={t("table.headers.created")}
                  sortState={sortState}
                  onSort={onSort}
                  columnKey="created"
                />
              </th>
              <th className="px-3 py-3 text-left font-normal whitespace-nowrap">
                <SortableColumnHeader
                  column={isBlockedColumn}
                  label={t("table.headers.isBlocked")}
                  sortState={sortState}
                  onSort={onSort}
                  columnKey="isBlocked"
                />
              </th>
              <th className="px-3 py-3 text-left font-normal">
                <SortableColumnHeader
                  column={commentsColumn}
                  label={t("table.headers.comments")}
                  sortState={sortState}
                  onSort={onSort}
                  columnKey="comments"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <FilterIcon className="size-10 mb-3 opacity-40" />
                    <p className="text-sm font-medium">{t("ui.noRowsTitle")}</p>
                    <p className="text-xs mt-1">{t("ui.noRowsHint")}</p>
                  </div>
                </td>
              </tr>
            ) : (
              <>
                {/* Spacer row to account for virtual scroll offset */}
                <tr style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }} />
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = data[virtualRow.index];
                  return (
                    <TableRow
                      key={row.id}
                      row={row}
                      isSelected={selectedRowId === row.id}
                      onSelect={onRowSelect}
                    />
                  );
                })}
              </>
            )}
          </tbody>
        </table>
        {/* Padding element to ensure proper scroll height */}
        {data.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems()[virtualizer.getVirtualItems().length - 1]?.end ?? 0) }} />
        )}
      </div>
    </div>
  );
}

// Main FilterCombobox component
export function FilterCombobox() {
  const { t, i18n: i18nInstance } = useTranslation();
  
  // Version counter to trigger re-renders when data changes
  const [dataVersion, setDataVersion] = React.useState(0);
  
  // Create FuzzyFilter instance with i18n
  // Set benchmark: true to enable telemetry spans (accessible via filter.getTelemetry())
  const [filter] = React.useState<FuzzyFilter>(() => {
    const i18nProvider = createI18nextProvider(i18nInstance);
    const f = createFuzzyFilter({ 
      maxSuggestions: 12,
      i18nProvider,
      benchmark: true, // Enable to see telemetry spans via window.__filter.getTelemetry()
    });
    f.setSchema(TASK_SCHEMA);
    f.indexData(INITIAL_DATASET);
    
    // Expose filter globally for debugging
    // Access in console: window.__filter.getTelemetry()?.getSpans()
    (window as unknown as { __filter: FuzzyFilter }).__filter = f;
    
    // Attach Axiom telemetry exporter if configured
    // Set VITE_AXIOM_API_KEY and VITE_AXIOM_DATASET environment variables to enable
    attachAxiomExporter(f.getTelemetry());
    
    return f;
  });

  // Track applied filters
  const [appliedFilters, setAppliedFilters] = React.useState<FilterSuggestion[]>([]);
  const [selectedValue, setSelectedValue] = React.useState<string | null>(null);
  
  // Track selected row for deletion - stores the row ID (not display index)
  const [selectedRowId, setSelectedRowId] = React.useState<number | null>(null);

  // Sorting state for table columns
  const [sortState, setSortState] = React.useState<SortState>({
    column: null,
    direction: "asc",
  });

  /**
   * Handle column header click to toggle sorting
   * @param columnId - The column to sort by
   */
  const handleSort = React.useCallback((columnId: keyof TaskRow) => {
    setSortState((prev) => {
      if (prev.column === columnId) {
        // Toggle direction if same column, or clear if already desc
        if (prev.direction === "asc") {
          return { column: columnId, direction: "desc" };
        }
        // Clear sorting
        return { column: null, direction: "asc" };
      }
      // New column, start with ascending
      return { column: columnId, direction: "asc" };
    });
  }, []);

  // Compile applied filters for use as context
  const compiledFilters = React.useMemo(() => {
    const compiled: CompiledFilter[] = [];
    for (const f of appliedFilters) {
      // Extract raw values from arguments array for compileFilter
      const value = f.arguments?.map((arg: HypothesisValueType) => {
        if (arg.kind === "string") return arg.value;
        if (arg.kind === "number") return arg.value;
        if (arg.kind === "boolean") return arg.value;
        if (arg.kind === "date") return arg.value;
        return undefined;
      }).filter((v: unknown) => v !== undefined);
      
      // Check if operator is variadic (in, nin, between) - always pass array for these
      const opInfo = getOperator(f.operator);
      const compileValue = opInfo.isVariadic 
        ? value  // Always pass array for variadic operators
        : (value && value.length === 1 ? value[0] : value);  // Unwrap single values for non-variadic
      const c = filter.compileFilter(f.column.id, f.operator, compileValue);
      if (c) compiled.push(c);
    }
    return compiled;
  }, [appliedFilters, filter]);

  // Use the hook for filter state management with new indexing features
  const {
    query,
    suggestionsQuery,
    setQuery,
    suggestions,
    isIndexing,
    indexProgress,
    addRow: hookAddRow,
    deleteRow: hookDeleteRow,
    getData,
  } = useFuzzyFilter(filter, {
    debounceMs: 100,
    filterContext: compiledFilters,
  });

  /**
   * Add a new random row using faker (lazy-loaded)
   * Uses Date.now() for the created timestamp to show when the row was actually created
   */
  const handleAddRow = React.useCallback(async () => {
    const currentData = getData();
    const newId = currentData.length > 0 
      ? Math.max(...currentData.map(r => (r as TaskRow).id)) + 1 
      : 1;
    const newTask = await generateSingleTaskAsync(newId);
    // Override the created timestamp with the current time (second precision)
    newTask.created = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    hookAddRow(newTask);
    setDataVersion(v => v + 1);
  }, [getData, hookAddRow]);

  /**
   * Delete the selected row by finding its actual index in the original data
   */
  const handleDeleteRow = React.useCallback(() => {
    if (selectedRowId === null) return;
    
    // Find the actual index in the original data array using the row's ID
    const originalData = getData() as TaskRow[];
    const originalIndex = originalData.findIndex(row => row.id === selectedRowId);
    
    if (originalIndex !== -1) {
      hookDeleteRow(originalIndex);
      setDataVersion(v => v + 1);
    }
    setSelectedRowId(null);
  }, [selectedRowId, hookDeleteRow, getData]);

  // Refetch suggestions when language changes
  // This ensures suggestions update with new translations immediately
  const prevLanguageRef = React.useRef(i18nInstance.language);
  React.useEffect(() => {
    // When language changes, trigger a refetch by updating the query
    // This causes the hook to refetch suggestions with the new translations
    if (i18nInstance.language !== prevLanguageRef.current) {
      prevLanguageRef.current = i18nInstance.language;
      // Only refetch if there's a current query
      if (query && query.trim()) {
        // Force a refetch by clearing and restoring the query
        // This ensures the hook detects a change and refetches with new translations
        const currentQuery = query.trim();
        setQuery("");
        // Restore the original query after a brief delay to allow the refetch
        const timeoutId = setTimeout(() => {
          setQuery(currentQuery);
        }, 10);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [i18nInstance.language, query, setQuery]);

  // Track hovered suggestion index for input highlighting
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);

  // Get the query matches from hovered > first suggestion for input highlighting
  // Only show highlighting when query matches suggestionsQuery (in sync after debounce)
  const isQueryInSync = query === suggestionsQuery;
  const highlightedSuggestion = isQueryInSync 
    ? (hoveredIndex !== null ? suggestions[hoveredIndex] : suggestions[0])
    : null;
  const inputQueryMatches = highlightedSuggestion?.queryMatches;

  // Handle selection
  const handleSelect = (value: string | null) => {
    if (!value) return;
    const suggestion = suggestions.find((s: FilterSuggestion) => s.id === value);
    if (suggestion) {
      if (suggestion.isComplete) {
        // Add to applied filters (avoid duplicates)
        setAppliedFilters((prev) => {
          if (prev.some((f) => f.id === suggestion.id)) return prev;
          return [...prev, suggestion];
        });
        // Clear the combobox input and selection
        setQuery("");
        setSelectedValue(null);
        // Reset hover state
        setHoveredIndex(null);
      } else {
        // Continue typing with the completion text
        setQuery(suggestion.completionText);
      }
    }
  };

  // Remove an applied filter
  const removeFilter = (id: string) => {
    setAppliedFilters((prev) => prev.filter((f) => f.id !== id));
  };

  // Clear all filters
  const clearAllFilters = () => {
    setAppliedFilters([]);
  };

  /**
   * Compare two values for sorting based on their type
   * Handles strings, numbers, booleans, and dates
   */
  const compareValues = React.useCallback((a: unknown, b: unknown, direction: SortDirection): number => {
    const multiplier = direction === "asc" ? 1 : -1;

    // Handle null/undefined
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;

    // Handle booleans (true comes before false in ascending)
    if (typeof a === "boolean" && typeof b === "boolean") {
      return (a === b ? 0 : a ? -1 : 1) * multiplier;
    }

    // Handle numbers
    if (typeof a === "number" && typeof b === "number") {
      return (a - b) * multiplier;
    }

    // Handle strings (including dates in YYYY-MM-DD format)
    if (typeof a === "string" && typeof b === "string") {
      return a.localeCompare(b) * multiplier;
    }

    // Fallback: convert to string and compare
    return String(a).localeCompare(String(b)) * multiplier;
  }, []);

  // Apply filters and sorting to data
  const filteredData = React.useMemo(() => {
    const currentData = getData() as TaskRow[];
    
    // Step 1: Apply filters
    let result: TaskRow[];
    if (appliedFilters.length === 0) {
      result = [...currentData]; // Clone to avoid mutating original
    } else {
      // Compile all filters using the same logic as compiledFilters context
      const compiled: CompiledFilter[] = [];
      for (const f of appliedFilters) {
        // Extract raw values from arguments array for compileFilter
        const value = f.arguments?.map((arg: HypothesisValueType) => {
          if (arg.kind === "string") return arg.value;
          if (arg.kind === "number") return arg.value;
          if (arg.kind === "boolean") return arg.value;
          if (arg.kind === "date") return arg.value;
          return undefined;
        }).filter((v: unknown) => v !== undefined);
        
        // Check if operator is variadic (in, nin, between) - always pass array for these
        const opInfo = getOperator(f.operator);
        const compileValue = opInfo.isVariadic 
          ? value  // Always pass array for variadic operators
          : (value && value.length === 1 ? value[0] : value);  // Unwrap single values for non-variadic
        const c = filter.compileFilter(f.column.id, f.operator, compileValue);
        if (c) {
          compiled.push(c);
        }
      }

      // Apply all filters (AND logic)
      result = currentData.filter((row: TaskRow) =>
        compiled.every((cf: CompiledFilter) => cf.predicate(row))
      );
    }

    // Step 2: Apply sorting
    if (sortState.column) {
      const { column, direction } = sortState;
      result.sort((a, b) => compareValues(a[column], b[column], direction));
    }

    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFilters, filter, getData, dataVersion, sortState, compareValues]);

  return (
    <div className="w-full flex flex-col gap-6 min-h-0 flex-1">
      {/* Filter controls */}
      <div className="space-y-4">
        {/* Query visualization above combobox - always render to prevent layout jumping */}
        <QueryVisualization
          query={query}
          matches={inputQueryMatches || []}
          suggestion={highlightedSuggestion ?? undefined}
        />

        {/* Combobox */}
        <Combobox
          value={selectedValue}
          onValueChange={handleSelect}
          inputValue={query}
          onInputValueChange={setQuery}
        >
          <ComboboxInput
            placeholder={t("ui.filterPlaceholder")}
            showClear={query.length > 0}
            className="w-full"
          />
          <ComboboxContent className="w-[var(--anchor-width)]">
            <ComboboxList>
              {/* Suggestions with column headers */}
              {suggestions.length > 0 && (
                <ComboboxGroup>
                  {/* Column headers - pr-8 matches ComboboxItem's right padding for check indicator */}
                  <div className="flex items-center w-full gap-2 pl-2 pr-8 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b border-border/50 mb-1 whitespace-nowrap">
                    <span className="flex-1">{t("ui.suggestion")}</span>
                    <span className="w-10 shrink-0">{t("ui.score")}</span>
                    <span className="w-14 shrink-0">{t("ui.results")}</span>
                    {/* Indexing indicator */}
                    {isIndexing && (
                      <span className="flex items-center gap-1 text-primary shrink-0">
                        <Loader2Icon className="size-3 animate-spin" />
                        <span>{indexProgress ? `${indexProgress.percentage}%` : ""}</span>
                      </span>
                    )}
                  </div>
                  {suggestions.map((suggestion: FilterSuggestion, index: number) => (
                    <ComboboxItem
                      key={suggestion.id}
                      value={suggestion.id}
                      className="py-1.5"
                      data-testid={`suggestion-${suggestion.column.id}-${suggestion.operator}`}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                    >
                      <SuggestionItem suggestion={suggestion} />
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>

      {/* Active filters */}
      {appliedFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">{t("ui.activeFilters")}</span>
          {appliedFilters.map((f) => (
            <div
              key={f.id}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 h-auto bg-secondary text-secondary-foreground rounded-md text-xs"
            >
              <FilterParts suggestion={f} showPlaceholders={false} />
              <button
                onClick={() => removeFilter(f.id)}
                className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
          <button
            onClick={clearAllFilters}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            {t("ui.clearAll")}
          </button>
        </div>
      )}

      {/* Menu bar with actions and summary */}
      <div className="flex items-center justify-between mb-2">
        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleAddRow}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            title={t("ui.addRow")}
          >
            <PlusIcon className="size-4" />
            {t("ui.addRow")}
          </button>
          
          {selectedRowId !== null && (
            <button
              onClick={handleDeleteRow}
              className="inline-flex items-center justify-center size-8 rounded-md bg-destructive hover:bg-destructive/90 transition-colors focus:outline-none focus:ring-2 focus:ring-destructive focus:ring-offset-2 animate-in fade-in zoom-in-95 duration-200"
              title={t("ui.deleteRow")}
            >
              <Trash2Icon className="size-4 text-white" />
            </button>
          )}
        </div>

        {/* Filter summary */}
        <span className="text-xs text-muted-foreground">
          {appliedFilters.length > 0
            ? t("ui.filterSummary", {
                filterCount: appliedFilters.length,
                filteredCount: filteredData.length.toLocaleString(),
                totalCount: getData().length.toLocaleString(),
              })
            : t("ui.itemCount", {
                filteredCount: filteredData.length.toLocaleString(),
                totalCount: getData().length.toLocaleString(),
              })}
        </span>
      </div>

      {/* Virtual data table with row selection and sorting */}
      <VirtualDataTable 
        data={filteredData} 
        selectedRowId={selectedRowId}
        onRowSelect={setSelectedRowId}
        sortState={sortState}
        onSort={handleSort}
      />
    </div>
  );
}
