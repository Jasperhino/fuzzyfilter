/**
 * Helper functions for working with OperatorDefinition
 * 
 * These derive properties that aren't directly on OperatorDefinition
 * but can be computed from patterns.
 */

import type { OperatorDefinition } from "@jasperhino/fuzzyfilter";

/**
 * Check if an operator is variadic (accepts multiple arguments).
 * Derived from patterns - checks if any pattern has:
 * - A variadic placeholder ({...} or {name...})
 * - 2+ argument placeholders
 */
export function isOperatorVariadic(op: OperatorDefinition | undefined): boolean {
  if (!op || !op.patterns) return false;
  
  return op.patterns.some(p => {
    // Check for variadic placeholder syntax: {...} or {name...}
    if (/\{\w*\.\.\.\}/.test(p)) return true;
    // Check for 2+ argument placeholders
    return (p.match(/\{[^}]*\}/g) || []).length >= 2;
  });
}

/**
 * Check if an operator requires an argument.
 * Derived from patterns - checks if any pattern has argument placeholders.
 */
export function operatorRequiresArgument(op: OperatorDefinition | undefined): boolean {
  if (!op) return false;
  return op.patterns?.some(p => /\{[^}]*\}/.test(p)) ?? false;
}

/**
 * Get minimum number of arguments for an operator.
 * Derived from the pattern with the fewest argument placeholders.
 */
export function getMinArguments(op: OperatorDefinition | undefined): number {
  if (!op || !op.patterns) return 0;
  const counts = op.patterns.map(p => (p.match(/\{[^}]+\}/g) || []).length);
  return Math.min(...counts);
}
