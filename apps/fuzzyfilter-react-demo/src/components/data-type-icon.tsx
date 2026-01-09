/**
 * Data Type Icon Component
 *
 * Reusable icon and badge components for displaying data type information.
 * Used in the API docs sidebar and column info popovers.
 */

import * as React from "react";
import {
  HashIcon,
  CalendarIcon,
  ToggleLeftIcon,
  ListIcon,
  TypeIcon,
  LayersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataType } from "@jasperhino/fuzzyfilter";

/**
 * Configuration for each data type's icon and styling
 */
export const DATA_TYPE_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; label: string }
> = {
  string: {
    icon: TypeIcon,
    color: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    label: "String",
  },
  number: {
    icon: HashIcon,
    color: "text-muted-foreground",
    label: "Number",
  },
  date: {
    icon: CalendarIcon,
    color: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    label: "Date",
  },
  boolean: {
    icon: ToggleLeftIcon,
    color: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    label: "Boolean",
  },
  enum: {
    icon: ListIcon,
    color: "text-muted-foreground",
    label: "Enum",
  },
  array: {
    icon: LayersIcon,
    color: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
    label: "Array",
  },
};

/**
 * Props for the DataTypeIcon component
 */
interface DataTypeIconProps {
  /** The data type to display an icon for */
  type: string | DataType;
  /** Additional CSS classes */
  className?: string;
  /** Icon size class (defaults to "size-3.5") */
  size?: string;
}

/**
 * Renders an icon representing a data type
 *
 * @param props - Component props
 * @returns Icon element for the specified data type
 */
export function DataTypeIcon({
  type,
  className,
  size = "size-3.5",
}: DataTypeIconProps) {
  const config = DATA_TYPE_CONFIG[type] ?? DATA_TYPE_CONFIG.string;
  const Icon = config.icon;

  return (
    <Icon
      className={cn(size, config.color.split(" ").pop(), className)}
      aria-hidden="true"
    />
  );
}

/**
 * Props for the DataTypeBadge component
 */
interface DataTypeBadgeProps {
  /** The data type to display */
  type: string | DataType;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show the icon (defaults to true) */
  showIcon?: boolean;
  /** Whether to show the label (defaults to true) */
  showLabel?: boolean;
  /** Size variant */
  size?: "sm" | "default";
}

/**
 * Renders a badge with icon and label for a data type
 *
 * @param props - Component props
 * @returns Badge element displaying the data type
 */
export function DataTypeBadge({
  type,
  className,
  showIcon = true,
  showLabel = true,
  size = "default",
}: DataTypeBadgeProps) {
  const config = DATA_TYPE_CONFIG[type] ?? {
    icon: TypeIcon,
    color: "bg-muted text-muted-foreground",
    label: type,
  };
  const Icon = config.icon;

  const sizeClasses =
    size === "sm"
      ? "text-[9px] px-1 py-0.5"
      : "text-[10px] px-1.5 py-0.5";

  const iconSize = size === "sm" ? "size-2" : "size-2.5";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded font-medium",
        sizeClasses,
        config.color,
        className
      )}
    >
      {showIcon && <Icon className={iconSize} aria-hidden="true" />}
      {showLabel && config.label}
    </span>
  );
}
