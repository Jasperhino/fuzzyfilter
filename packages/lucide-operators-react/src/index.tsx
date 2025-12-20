/**
 * Lucide Operators React
 *
 * React icon components for fuzzyfilter operators.
 * Wraps lucide-react and provides custom operator icons.
 */

import * as React from "react";
import {
  OPERATOR_ICON_MAP,
  type IconName,
  type CustomIconName,
  type LucideIconName,
} from "lucide-operators";

// Import custom SVGs as React components
import BetweenSvg from "lucide-operators/assets/between.svg?react";
import ContainsSvg from "lucide-operators/assets/contains.svg?react";
import ContainsNotSvg from "lucide-operators/assets/contains-not.svg?react";
import StartsWithSvg from "lucide-operators/assets/starts-with.svg?react";
import EndsWithSvg from "lucide-operators/assets/ends-with.svg?react";
import GreaterThanEqualsSvg from "lucide-operators/assets/greater-than-equals.svg?react";
import LessThanEqualsSvg from "lucide-operators/assets/less-than-equals.svg?react";
import EqualApproximatelyNotSvg from "lucide-operators/assets/equals-approximately-not.svg?react";

// Import Lucide icons used by operators
import {
  Equal,
  EqualNot,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CircleSlash,
  CircleOff,
  CircleCheck,
  Check,
  X,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  type LucideIcon,
  EqualApproximately,
} from "lucide-react";

// Re-export everything from lucide-react for convenience
export * from "lucide-react";

// Re-export types and mapping from lucide-operators
export {
  OPERATOR_ICON_MAP,
  type IconName,
  type CustomIconName,
  type LucideIconName,
} from "lucide-operators";

/**
 * Icon component type - matches Lucide's interface
 */
export type IconComponent = React.FC<{ className?: string }>;

/**
 * Custom icon components from SVG files
 */
const CustomIcons: Record<CustomIconName, IconComponent> = {
  Between: BetweenSvg,
  Contains: ContainsSvg,
  ContainsNot: ContainsNotSvg,
  StartsWith: StartsWithSvg,
  EndsWith: EndsWithSvg,
  GreaterThanEquals: GreaterThanEqualsSvg,
  LessThanEquals: LessThanEqualsSvg,
  EqualApproximatelyNot: EqualApproximatelyNotSvg,
};

/**
 * Lucide icon components used by operators
 */
const LucideIcons: Record<LucideIconName, LucideIcon> = {
  Equal,
  EqualNot,
  EqualApproximately,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CircleSlash,
  CircleOff,
  CircleCheck,
  Check,
  X,
  ArrowLeftFromLine,
  ArrowRightFromLine,
};

/**
 * Unified map of all operator icons (Lucide + custom).
 */
export const OPERATOR_ICONS: Record<IconName, LucideIcon | IconComponent> = {
  ...LucideIcons,
  ...CustomIcons,
};

/**
 * Get the icon component for an operator ID.
 *
 * @param operatorId - The operator ID (e.g., "eq", "contains")
 * @returns The corresponding icon component, or null if not found
 *
 * @example
 * ```tsx
 * import { getOperatorIcon } from "lucide-operators-react";
 *
 * const Icon = getOperatorIcon("contains");
 * if (Icon) {
 *   return <Icon className="size-4" />;
 * }
 * ```
 */
export function getOperatorIcon(
  operatorId: string
): LucideIcon | IconComponent | null {
  const iconName = OPERATOR_ICON_MAP[operatorId as keyof typeof OPERATOR_ICON_MAP];
  return iconName ? OPERATOR_ICONS[iconName] : null;
}

/**
 * Get the icon component by icon name.
 *
 * @param iconName - The icon name (e.g., "Equal", "Contains")
 * @returns The corresponding icon component, or null if not found
 */
export function getIcon(iconName: IconName): LucideIcon | IconComponent | null {
  return OPERATOR_ICONS[iconName] ?? null;
}

// Export custom icons individually for direct imports
export {
  BetweenSvg as Between,
  ContainsSvg as Contains,
  ContainsNotSvg as ContainsNot,
  StartsWithSvg as StartsWith,
  EndsWithSvg as EndsWith,
  GreaterThanEqualsSvg as GreaterThanEquals,
  LessThanEqualsSvg as LessThanEquals,
  EqualApproximatelyNotSvg as EqualApproximatelyNot,
};



