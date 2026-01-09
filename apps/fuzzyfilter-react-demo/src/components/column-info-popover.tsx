/**
 * Column Info Popover Component
 *
 * Displays information about a column's data type, available operators,
 * and accepted argument types in a hover popover on the column header.
 * Uses the same arg notation and rendering style as the API reference.
 */

import * as React from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from "@/components/ui/popover";
import { DataTypeIcon, DataTypeBadge } from "./data-type-icon";
import {
  getAllOperators,
  DataType,
  type OperatorDefinition,
  type AnyColumnDefinition,
} from "@jasperhino/fuzzyfilter";

/**
 * Props for the ColumnInfoPopover component
 */
interface ColumnInfoPopoverProps {
  /** The column definition to display info for */
  column: AnyColumnDefinition;
  /** Children to render as the trigger */
  children: React.ReactNode;
}

/**
 * Get the number of arguments for an operator (matching API reference)
 */
function getArgCount(operator: OperatorDefinition): number {
  // Derive from patterns
  const hasArgs = operator.patterns.some(p => /\{[^}]*\}/.test(p));
  if (!hasArgs) return 0;
  
  // Check if variadic (has patterns with 2+ args)
  const isVariadic = operator.patterns.some(p => (p.match(/\{[^}]*\}/g) || []).length >= 2);
  if (isVariadic) {
    if (operator.id === "between") return 2;
    return -1; // Unlimited (in, nin)
  }
  return 1;
}

/**
 * Operator badge component - displays operator as text label
 */
function OperatorBadgeLabel({ operator }: { operator: OperatorDefinition }) {
  return (
    <span className="shrink-0 text-[10px] h-4 px-1 rounded inline-flex items-center font-medium bg-muted text-muted-foreground">
      {operator.id}
    </span>
  );
}

/**
 * Argument placeholder component (matching API reference style)
 */
function ArgPlaceholder({ label }: { label: string }) {
  return (
    <span className="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * Argument display component based on operator type (matching API reference)
 */
function OperatorArgs({ operator }: { operator: OperatorDefinition }) {
  const argCount = getArgCount(operator);

  if (argCount === 0) {
    return (
      <span className="text-[10px] text-muted-foreground/60">
        no args
      </span>
    );
  }

  if (argCount === 1) {
    return <ArgPlaceholder label="arg 1" />;
  }

  if (argCount === 2) {
    return (
      <>
        <ArgPlaceholder label="arg 1" />
        <ArgPlaceholder label="arg 2" />
      </>
    );
  }

  // Variadic (in, nin) - show [arg 1] ... [arg n]
  return (
    <>
      <ArgPlaceholder label="arg 1" />
      <span className="text-[10px] text-muted-foreground/60">…</span>
      <ArgPlaceholder label="arg n" />
    </>
  );
}

/**
 * Renders an info popover showing column operators and argument types.
 * The popover is triggered on hover of the entire header cell.
 *
 * @param props - Component props
 * @returns Popover trigger wrapping children with column info content
 */
export function ColumnInfoPopover({ column, children }: ColumnInfoPopoverProps) {
  const operators = React.useMemo(
    () => getAllOperators(),
    []
  );

  const columnName = column.labelKey || column.id;
  const columnType = column.type || "string";

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        className="cursor-help"
        aria-label={`Info about ${columnName} column`}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-[300px]">
        <div className="space-y-3">
          {/* Header with column name and type */}
          <div className="flex items-center justify-between">
            <PopoverTitle className="flex items-center gap-2 mb-0">
              <DataTypeIcon type={columnType} size="size-4" />
              <span>{columnName}</span>
            </PopoverTitle>
            <DataTypeBadge type={columnType} size="sm" />
          </div>

          {/* Operators section */}
          <div className="space-y-1.5">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Available Operators
            </h4>
            <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
              {operators.map((op) => (
                <OperatorRow key={op.id} operator={op} />
              ))}
            </div>
          </div>

          {/* Column-specific hints */}
          {column.values && column.values.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Allowed Values
              </h4>
              <div className="flex flex-wrap gap-1">
                {column.values.slice(0, 6).map((value, idx) => (
                  <code
                    key={idx}
                    className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono"
                  >
                    {String(value)}
                  </code>
                ))}
                {column.values.length > 6 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{column.values.length - 6} more
                  </span>
                )}
              </div>
            </div>
          )}

          {column.type === "boolean" && (
            <div className="text-[10px] text-muted-foreground">
              {"trueLabel" in column && `True: ${column.trueLabel}`}
              {"falseLabel" in column && ` · False: ${column.falseLabel}`}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Props for the OperatorRow component
 */
interface OperatorRowProps {
  /** The operator info */
  operator: OperatorDefinition;
}

/**
 * Renders a single operator row with label and argument placeholders
 * (matching the API reference style)
 */
function OperatorRow({ operator }: OperatorRowProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs py-1 px-1.5 rounded hover:bg-muted/50">
      {/* Operator label */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <OperatorBadgeLabel operator={operator} />
        <span className="text-muted-foreground truncate">
          {operator.id}
        </span>
      </div>

      {/* Argument placeholders */}
      <div className="flex items-center gap-1 shrink-0">
        <OperatorArgs operator={operator} />
      </div>
    </div>
  );
}

/**
 * Props for the ColumnHeader component
 */
interface ColumnHeaderProps {
  /** The column definition */
  column: AnyColumnDefinition;
  /** The column label to display */
  label: string;
  /** Additional CSS classes for the container */
  className?: string;
}

/**
 * Renders a table column header with data type icon and info popover on hover.
 * The entire header cell is hoverable to show the popover.
 *
 * @param props - Component props
 * @returns Column header with icon, label wrapped in info popover
 */
export function ColumnHeader({ column, label, className }: ColumnHeaderProps) {
  const columnType = column.type || "string";
  return (
    <ColumnInfoPopover column={column}>
      <div className={`flex items-center gap-1 ${className ?? ""}`}>
        <DataTypeIcon type={columnType} className="shrink-0" size="size-3" />
        <span className="font-medium text-muted-foreground text-sm truncate">{label}</span>
      </div>
    </ColumnInfoPopover>
  );
}
