/**
 * Lucide Operators Vue
 *
 * Vue icon components for fuzzyfilter operators.
 * Wraps lucide-vue-next and provides custom operator icons.
 */

import { type Component } from "vue";
import {
  OPERATOR_ICON_MAP,
  type IconName,
  type CustomIconName,
  type LucideIconName,
} from "lucide-operators";

// Import custom SVGs as Vue components
import BetweenSvg from "lucide-operators/assets/between.svg?component";
import ContainsSvg from "lucide-operators/assets/contains.svg?component";
import ContainsNotSvg from "lucide-operators/assets/contains-not.svg?component";
import StartsWithSvg from "lucide-operators/assets/starts-with.svg?component";
import EndsWithSvg from "lucide-operators/assets/ends-with.svg?component";
import GreaterThanEqualsSvg from "lucide-operators/assets/greater-than-equals.svg?component";
import LessThanEqualsSvg from "lucide-operators/assets/less-than-equals.svg?component";
import EqualApproximatelyNotSvg from "lucide-operators/assets/equals-approximately-not.svg?component";

// Import Lucide icons used by operators
import {
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
} from "lucide-vue-next";

// Re-export everything from lucide-vue-next for convenience
export * from "lucide-vue-next";

// Re-export types and mapping from lucide-operators
export {
  OPERATOR_ICON_MAP,
  type IconName,
  type CustomIconName,
  type LucideIconName,
} from "lucide-operators";

/**
 * Custom icon components from SVG files
 */
const CustomIcons: Record<CustomIconName, Component> = {
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
const LucideIcons: Record<LucideIconName, Component> = {
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
export const OPERATOR_ICONS: Record<IconName, Component> = {
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
 * ```vue
 * <script setup>
 * import { getOperatorIcon } from "lucide-operators-vue";
 *
 * const Icon = getOperatorIcon("contains");
 * </script>
 *
 * <template>
 *   <component :is="Icon" class="size-4" v-if="Icon" />
 * </template>
 * ```
 */
export function getOperatorIcon(operatorId: string): Component | null {
  const iconName = OPERATOR_ICON_MAP[operatorId as keyof typeof OPERATOR_ICON_MAP];
  return iconName ? OPERATOR_ICONS[iconName] : null;
}

/**
 * Get the icon component by icon name.
 *
 * @param iconName - The icon name (e.g., "Equal", "Contains")
 * @returns The corresponding icon component, or null if not found
 */
export function getIcon(iconName: IconName): Component | null {
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



