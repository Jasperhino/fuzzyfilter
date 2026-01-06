/**
 * Lucide Operators - Shared Icon Mapping
 *
 * Provides the operator-to-icon name mapping used by both
 * lucide-operators-react and lucide-operators-vue packages.
 */

import type { Operator } from "@jasperhino/fuzzyfilter";

/**
 * Custom icon names for operators that don't have Lucide equivalents.
 * These icons are provided as SVG files in the assets folder.
 */
export type CustomIconName =
  | "Between"
  | "Contains"
  | "ContainsNot"
  | "StartsWith"
  | "EndsWith"
  | "GreaterThanEquals"
  | "LessThanEquals"
  | "EqualApproximatelyNot";

/**
 * Lucide icon names used for operators.
 * These are the exact component names from lucide-react/lucide-vue-next.
 */
export type LucideIconName =
  | "Equal"
  | "EqualNot"
  | "EqualApproximately"
  | "ChevronLeft"
  | "ChevronRight"
  | "CircleDot"
  | "CircleSlash"
  | "CircleOff"
  | "CircleCheck"
  | "Check"
  | "X"
  | "ArrowLeftFromLine"
  | "ArrowRightFromLine";

/**
 * All icon names (Lucide + custom).
 */
export type IconName = LucideIconName | CustomIconName;

/**
 * Mapping from operator ID to icon name.
 *
 * Each operator is mapped to either a standard Lucide icon
 * or a custom icon from the assets folder.
 */
export const OPERATOR_ICON_MAP: Record<Operator, IconName> = {
  // Equality Operators
  eq: "Equal",
  neq: "EqualNot",
  eqIgnoreCase: "EqualApproximately",
  neqIgnoreCase: "EqualApproximatelyNot", // Custom

  // Comparison Operators
  lt: "ChevronLeft",
  lte: "LessThanEquals", // Custom
  gt: "ChevronRight",
  gte: "GreaterThanEquals", // Custom

  // Set Membership Operators
  in: "CircleDot",
  nin: "CircleSlash",

  // Pattern Matching Operators
  contains: "Contains", // Custom
  notContains: "ContainsNot", // Custom
  startsWith: "StartsWith", // Custom
  endsWith: "EndsWith", // Custom

  // Nullability Operators
  isEmpty: "CircleOff",
  isNotEmpty: "CircleCheck",

  // Boolean Operators
  isTrue: "Check",
  isFalse: "X",

  // Date-Specific Operators
  before: "ArrowLeftFromLine",
  after: "ArrowRightFromLine",
  between: "Between", // Custom
};

/**
 * Get the icon name for an operator.
 *
 * @param operator - The operator ID
 * @returns The corresponding icon name
 */
export function getOperatorIconName(operator: Operator): IconName {
  return OPERATOR_ICON_MAP[operator];
}

/**
 * Check if an icon name is a custom icon (not from Lucide).
 *
 * @param iconName - The icon name to check
 * @returns True if it's a custom icon
 */
export function isCustomIcon(iconName: IconName): iconName is CustomIconName {
  const customIcons: CustomIconName[] = [
    "Between",
    "Contains",
    "ContainsNot",
    "StartsWith",
    "EndsWith",
    "GreaterThanEquals",
    "LessThanEquals",
    "EqualApproximatelyNot",
  ];
  return customIcons.includes(iconName as CustomIconName);
}

/**
 * Type guard to check if a string is a valid operator with an icon mapping.
 *
 * @param value - The value to check
 * @returns True if the value is a valid operator key
 */
export function hasOperatorIcon(value: string): value is Operator {
  return value in OPERATOR_ICON_MAP;
}
