/**
 * Helper functions for working with operators
 * 
 * These derive properties that aren't directly on operator configs
 * but can be computed from patterns.
 */

/**
 * Check if an operator is variadic (accepts multiple arguments).
 * Derived from patterns - checks if any pattern has:
 * - A variadic placeholder ({...} or {name...})
 * - 2+ argument placeholders
 */
export function isOperatorVariadic(op: { patterns?: string[] } | undefined): boolean {
  if (!op || !op.patterns) return false;
  
  return op.patterns.some((p: string) => {
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
export function operatorRequiresArgument(op: { patterns?: string[] } | undefined): boolean {
  if (!op) return false;
  return op.patterns?.some((p: string) => /\{[^}]*\}/.test(p)) ?? false;
}

/**
 * Get minimum number of arguments for an operator.
 * Derived from the pattern with the fewest argument placeholders.
 */
export function getMinArguments(op: { patterns?: string[] } | undefined): number {
  if (!op || !op.patterns) return 0;
  const counts = op.patterns.map((p: string) => (p.match(/\{[^}]+\}/g) || []).length);
  return Math.min(...counts);
}
