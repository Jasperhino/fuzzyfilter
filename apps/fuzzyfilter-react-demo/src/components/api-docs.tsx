/**
 * API Documentation Panel
 *
 * Displays dynamically generated documentation for the FuzzyFilter hook
 * and all available operators.
 */

import * as React from "react";
import { OPERATORS, getOperatorsForType, DataType, type OperatorDefinition } from "@jasperhino/fuzzyfilter";
import { Tabs } from "@base-ui/react/tabs";
import {
  BookOpenIcon,
  CodeIcon,
  ListIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LayersIcon,
} from "lucide-react";
import { DataTypeBadge } from "./data-type-icon";

/**
 * Operator text badge component - for aliases display
 */
function OperatorBadge({ text }: { text: string }) {
  return (
    <span className="shrink-0 text-[10px] h-4 px-1 rounded inline-flex items-center font-medium bg-muted text-muted-foreground">
      {text}
    </span>
  );
}

/**
 * Get the number of arguments for an operator
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
 * Argument placeholder component
 */
function ArgPlaceholder({ label }: { label: string }) {
  return (
    <span className="shrink-0 text-[10px] h-4 px-1.5 rounded inline-flex items-center border border-border text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * Argument display component based on operator type
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
 * Operator documentation item
 */
function OperatorDoc({ operator }: { operator: OperatorDefinition }) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full h-10 flex items-center gap-1.5 px-3 hover:bg-muted/50 transition-colors text-left"
      >
        <span className="text-muted-foreground shrink-0">
          {isExpanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </span>
        
        {/* Operator label */}
        <span className="text-xs text-foreground truncate flex-1 min-w-0">
          {operator.id}
        </span>

        {/* Argument placeholders */}
        <div className="flex items-center gap-1 shrink-0">
          <OperatorArgs operator={operator} />
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 text-xs bg-muted/30">
          {/* Aliases */}
          {operator.aliases.length > 0 && (
            <div>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wider font-medium">
                Aliases
              </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {operator.aliases.map((alias: string) => (
                  <OperatorBadge key={alias} text={alias} />
                ))}
              </div>
            </div>
          )}

          {/* Supported Types */}
          <div>
            <span className="text-muted-foreground text-[10px] uppercase tracking-wider font-medium">
              Types
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {operator.supportedTypes.map((type: string) => (
                <DataTypeBadge key={type} type={type} />
              ))}
            </div>
          </div>

          {/* Properties */}
          <div className="flex flex-wrap gap-2">
            {operator.isVariadic && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-medium">
                variadic
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hook interface documentation
 */
function HookDocs() {
  const [isExpanded, setIsExpanded] = React.useState(true);

  const returnProps = [
    { name: "query", type: "string", desc: "Current query value" },
    { name: "suggestions", type: "FilterSuggestion[]", desc: "Current suggestions" },
    { name: "isLoading", type: "boolean", desc: "Loading state" },
    { name: "error", type: "Error | null", desc: "Error state" },
    { name: "selectedIndex", type: "number", desc: "Selected suggestion index" },
    { name: "selectedSuggestion", type: "FilterSuggestion | null", desc: "Currently selected" },
    { name: "setQuery", type: "(query: string) => void", desc: "Update query" },
    { name: "selectSuggestion", type: "(index: number) => void", desc: "Select by index" },
    { name: "navigateSuggestions", type: "(dir: 'up' | 'down') => void", desc: "Navigate up/down" },
    { name: "applySuggestion", type: "() => void", desc: "Apply selected" },
    { name: "reset", type: "() => void", desc: "Reset all state" },
  ];

  const options = [
    { name: "debounceMs", type: "number", desc: "Debounce delay (default: 150)" },
    { name: "initialQuery", type: "string", desc: "Initial query string" },
    { name: "onApply", type: "(suggestion) => void", desc: "Callback on apply" },
    { name: "filterContext", type: "CompiledFilter[]", desc: "For stacked counts" },
  ];

  return (
    <div className="space-y-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className="text-muted-foreground">
          {isExpanded ? (
            <ChevronDownIcon className="size-4" />
          ) : (
            <ChevronRightIcon className="size-4" />
          )}
        </span>
        <CodeIcon className="size-4 text-primary" />
        <span className="font-semibold text-sm">useFuzzyFilter()</span>
      </button>

      {isExpanded && (
        <div className="space-y-4 pl-6">
          {/* Options */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
              Options
            </h4>
            <div className="space-y-1">
              {options.map((opt) => (
                <div key={opt.name} className="flex items-start gap-2 text-xs">
                  <code className="font-mono text-primary shrink-0">{opt.name}</code>
                  <span className="text-muted-foreground">—</span>
                  <span className="text-muted-foreground">{opt.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Returns */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
              Returns
            </h4>
            <div className="space-y-1">
              {returnProps.map((prop) => (
                <div key={prop.name} className="flex items-start gap-2 text-xs">
                  <code className="font-mono text-primary shrink-0">{prop.name}</code>
                  <span className="text-muted-foreground">—</span>
                  <span className="text-muted-foreground">{prop.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main API Documentation Panel
 */
export function ApiDocs() {
  const operators = Object.values(OPERATORS) as OperatorDefinition[];

  // Group operators by category
  const operatorGroups = React.useMemo(() => {
    const groups: Record<string, OperatorDefinition[]> = {
      Equality: [],
      Comparison: [],
      "Set Membership": [],
      "Pattern Matching": [],
      Nullability: [],
      Boolean: [],
      Date: [],
    };

    operators.forEach((op) => {
      if (["eq", "neq", "eqIgnoreCase", "neqIgnoreCase"].includes(op.id)) {
        groups.Equality.push(op);
      } else if (["lt", "lte", "gt", "gte"].includes(op.id)) {
        groups.Comparison.push(op);
      } else if (["in", "nin"].includes(op.id)) {
        groups["Set Membership"].push(op);
      } else if (["contains", "notContains", "startsWith", "endsWith"].includes(op.id)) {
        groups["Pattern Matching"].push(op);
      } else if (["isEmpty", "isNotEmpty"].includes(op.id)) {
        groups.Nullability.push(op);
      } else if (["isTrue", "isFalse"].includes(op.id)) {
        groups.Boolean.push(op);
      } else if (["before", "after", "between"].includes(op.id)) {
        groups.Date.push(op);
      }
    });

    return groups;
  }, [operators]);

  return (
    <div className="h-full flex flex-col bg-background border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <BookOpenIcon className="size-4 text-primary" />
          <h2 className="font-semibold text-sm">API Reference</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          fuzzyfilter-react documentation
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-6">
          {/* Hook Documentation */}
          <HookDocs />

          {/* Operators */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ListIcon className="size-4 text-primary" />
              <span className="font-semibold text-sm">Operators</span>
              <span className="text-xs text-muted-foreground">
                ({operators.length} total)
              </span>
            </div>

            {Object.entries(operatorGroups).map(([group, ops]) => {
              if (ops.length === 0) return null;
              return (
                <div key={group}>
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1 px-3">
                    {group}
                  </h4>
                  <div className="border border-border rounded-md overflow-hidden">
                    {ops.map((op) => (
                      <OperatorDoc key={op.id} operator={op} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Operators By DataType */}
          <OperatorsByDataType />

        </div>
      </div>
    </div>
  );
}

/**
 * Data types to show in the tabs
 */
const DATA_TYPES = [
  { type: DataType.STRING, label: "String" },
  { type: DataType.NUMBER, label: "Number" },
  { type: DataType.DATE, label: "Date" },
  { type: DataType.BOOLEAN, label: "Boolean" },
  { type: DataType.ENUM, label: "Enum" },
] as const;

/**
 * Operators grouped by data type with tabs
 */
function OperatorsByDataType() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <LayersIcon className="size-4 text-primary" />
        <span className="font-semibold text-sm">Operators By Type</span>
      </div>

      <Tabs.Root defaultValue={DataType.STRING} className="border border-border rounded-md overflow-hidden">
        <Tabs.List className="relative z-0 flex gap-0.5 px-1 py-1 bg-muted/50 border-b border-border">
          {DATA_TYPES.map(({ type, label }) => (
            <Tabs.Tab
              key={type}
              value={type}
              className="flex h-7 items-center justify-center px-2.5 text-[11px] font-medium text-muted-foreground outline-none select-none rounded-sm transition-colors hover:text-foreground data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm"
            >
              {label}
            </Tabs.Tab>
          ))}
          <Tabs.Indicator className="absolute bottom-1 left-0 h-7 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] rounded-sm bg-background shadow-sm transition-all duration-200 ease-in-out -z-10" />
        </Tabs.List>

        {DATA_TYPES.map(({ type }) => {
          const ops = getOperatorsForType(type);
          return (
            <Tabs.Panel key={type} value={type} className="p-2">
              <div className="flex flex-wrap gap-1.5">
                {ops.map((op) => (
                  <div
                    key={op.id}
                    className="px-2 py-1 rounded-md bg-muted/50 text-xs text-muted-foreground"
                  >
                    {op.label}
                  </div>
                ))}
              </div>
            </Tabs.Panel>
          );
        })}
      </Tabs.Root>
    </div>
  );
}
