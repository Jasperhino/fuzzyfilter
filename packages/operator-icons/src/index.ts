/**
 * Operator Icons
 *
 * Maps fuzzyfilter operators to Lucide icon names.
 * This package provides a shared mapping that can be used
 * by both React and Vue examples.
 */

import type { Operator } from "fuzzyfilter";

/**
 * Lucide icon names that correspond to operators.
 * These are the exact names used in lucide-react and lucide-vue-next.
 */
export type LucideIconName =
  | "Equal"
  | "EqualNot"
  | "CaseSensitive"
  | "CaseUpper"
  | "ChevronLeft"
  | "ChevronLeftSquare"
  | "ChevronRight"
  | "ChevronRightSquare"
  | "List"
  | "ListX"
  | "Search"
  | "SearchX"
  | "TextCursorInput"
  | "MoveRight"
  | "CircleOff"
  | "CircleCheck"
  | "Check"
  | "X"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowLeftRight";

/**
 * Mapping from operator ID to Lucide icon name.
 *
 * Each operator is mapped to the most semantically appropriate
 * Lucide icon for visual representation.
 */
export const OPERATOR_ICON_MAP: Record<Operator, LucideIconName> = {
  // Equality Operators
  eq: "Equal",
  neq: "EqualNot",
  eqIgnoreCase: "EqualApproximately",
  neqIgnoreCase: "EqualApproximatelyNot",

  // Comparison Operators
  lt: "ChevronLeft",
  lte: "ChevronLeftSquare",
  gt: "ChevronRight",
  gte: "ChevronRightSquare",

  // Set Membership Operators
  in: "CircleDot",
  nin: "CircleSlash",

  // Pattern Matching Operators
  contains: "Search",
  notContains: "SearchX",
  startsWith: "Circumflex", // Custom
  endsWith: "DollarSign", // Custom

  // Nullability Operators
  isEmpty: "CircleOff",
  isNotEmpty: "CircleCheck",

  // Boolean Operators
  isTrue: "Check",
  isFalse: "X",

  // Date-Specific Operators
  before: "ArrowLeftFromLine",
  after: "ArrowRightFromLine",
  between: "ArrowLeftRightLines", // Custom
} as const;

/**
 * Get the Lucide icon name for an operator.
 *
 * @param operator - The operator ID
 * @returns The corresponding Lucide icon name
 */
export function getOperatorIconName(operator: Operator): LucideIconName {
  return OPERATOR_ICON_MAP[operator];
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



