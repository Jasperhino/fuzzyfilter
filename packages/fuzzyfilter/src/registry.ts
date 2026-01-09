/**
 * Instance Registry
 * 
 * Manages operator definitions per FuzzyFilter instance.
 * When operators are provided in config, they replace the defaults entirely.
 * Users can spread defaultFuzzyFilterOperators to extend rather than replace.
 * 
 * Compiles operator patterns with i18n resolution for efficient matching.
 * Patterns are compiled at runtime because i18n translations are resolved dynamically.
 * 
 * @module fuzzyfilter/registry
 */

import type { OperatorDefinition } from "./types/core.ts";
import type { FuzzyFilterConfig } from "./types/api.ts";
import type { I18nProvider } from "./types/i18n.ts";
import { compileOperatorDefinition, type CompiledOperator } from "./pattern-compiler.ts";
import { defaultFuzzyFilterOperators } from "./operators.ts";

/**
 * Instance registry for operators.
 * 
 * Each FuzzyFilter instance has its own registry, allowing different
 * instances to have different sets of operators.
 * 
 * The registry compiles operator patterns when created and can recompile
 * when the language changes (via i18n provider onChange callbacks).
 */
export class InstanceRegistry {
  private operators: Map<string, OperatorDefinition>;
  private compiledOperators: Map<string, CompiledOperator>;
  private i18nProvider?: I18nProvider;

  /**
   * Creates a new instance registry.
   * 
   * @param config - FuzzyFilter configuration with optional operators
   * @param i18nProvider - Optional i18n provider for pattern compilation
   * @throws Error if duplicate operator IDs are provided
   * @throws Error if an operator is missing a predicate
   */
  constructor(config: Partial<FuzzyFilterConfig>, i18nProvider?: I18nProvider) {
    // Use provided or fall back to defaults
    const ops = config.operators ?? defaultFuzzyFilterOperators;

    // Validate operators
    const opIds = new Set<string>();
    for (const op of ops) {
      if (opIds.has(op.id)) {
        throw new Error(`Duplicate operator ID: "${op.id}"`);
      }
      if (!op.predicate) {
        throw new Error(`Operator "${op.id}" is missing a predicate implementation`);
      }
      opIds.add(op.id);
    }

    this.operators = new Map(ops.map(op => [op.id, op]));
    this.compiledOperators = new Map();
    this.i18nProvider = i18nProvider;

    // Compile all operator patterns
    this.compilePatterns();
  }

  /**
   * Compile all operator patterns with the current i18n provider.
   * Call this when the language changes to update pattern expansions.
   */
  compilePatterns(): void {
    this.compiledOperators.clear();
    
    for (const [id, op] of this.operators) {
      // All operators must have patterns
      if (!op.patterns || op.patterns.length === 0) {
        throw new Error(`Operator "${id}" must have at least one pattern`);
      }
      
      const compiled = compileOperatorDefinition(
        {
          key: op.id,
          patterns: [...op.patterns],
        },
        this.i18nProvider
      );
      this.compiledOperators.set(id, compiled);
    }
  }

  /**
   * Update the i18n provider and recompile patterns.
   * 
   * @param provider - The new i18n provider
   */
  setI18nProvider(provider: I18nProvider): void {
    this.i18nProvider = provider;
    this.compilePatterns();
  }

  /**
   * Get an operator by ID.
   * 
   * @param id - The operator ID
   * @returns The operator definition, or undefined if not found
   */
  getOperator(id: string): OperatorDefinition | undefined {
    return this.operators.get(id);
  }

  /**
   * Get a compiled operator by ID.
   * 
   * @param id - The operator ID
   * @returns The compiled operator, or undefined if not found
   */
  getCompiledOperator(id: string): CompiledOperator | undefined {
    return this.compiledOperators.get(id);
  }

  /**
   * Get all registered operators.
   * 
   * @returns Array of all operator definitions
   */
  getAllOperators(): OperatorDefinition[] {
    return Array.from(this.operators.values());
  }

  /**
   * Get all compiled operators.
   * 
   * @returns Array of all compiled operators
   */
  getAllCompiledOperators(): CompiledOperator[] {
    return Array.from(this.compiledOperators.values());
  }

  /**
   * Get all trie keywords from all compiled operators.
   * Useful for building the operator trie.
   * 
   * @returns Map of keyword to operator ID
   */
  getAllTrieKeywords(): Map<string, string> {
    const keywords = new Map<string, string>();
    
    for (const [id, compiled] of this.compiledOperators) {
      for (const keyword of compiled.trieKeywords) {
        keywords.set(keyword, id);
      }
    }
    
    return keywords;
  }

  /**
   * Check if an operator ID exists in the registry.
   * 
   * @param id - The operator ID to check
   * @returns true if the operator exists
   */
  hasOperator(id: string): boolean {
    return this.operators.has(id);
  }

  /**
   * Get the number of registered operators.
   */
  get operatorCount(): number {
    return this.operators.size;
  }

  /**
   * Check if an operator requires arguments.
   * 
   * @param id - The operator ID
   * @returns true if the operator requires at least one argument
   */
  operatorRequiresArgument(id: string): boolean {
    const compiled = this.compiledOperators.get(id);
    return compiled?.requiresArgument ?? false;
  }

  /**
   * Check if an operator is variadic (accepts multiple arguments).
   * 
   * @param id - The operator ID
   * @returns true if the operator accepts multiple arguments
   */
  operatorIsVariadic(id: string): boolean {
    const compiled = this.compiledOperators.get(id);
    return compiled?.isVariadic ?? false;
  }

  /**
   * Get the minimum number of arguments for an operator.
   * 
   * @param id - The operator ID
   * @returns The minimum argument count, or 0 if not found
   */
  getOperatorMinArguments(id: string): number {
    const compiled = this.compiledOperators.get(id);
    return compiled?.minArguments ?? 0;
  }
}
