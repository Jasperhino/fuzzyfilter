/**
 * Pattern Compiler
 * 
 * Compiles pattern strings into matcher functions with support for:
 * - {arg} or {} placeholders for user-provided values (single argument)
 * - {...} or {name...} placeholders for variadic arguments (1 or more values)
 * - @keyword references to local aliases
 * - t(key) references to i18n translation keys (returns string or string[])
 * 
 * @module fuzzyfilter/pattern-compiler
 */

import type { I18nProvider } from "./types/i18n.ts";
import type { Token } from "./types/parsing.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of parsing a pattern string
 */
export interface ParsedPattern {
  /** The raw pattern string */
  raw: string;
  /** Pattern segments in order */
  segments: PatternSegment[];
  /** Number of argument placeholders */
  argCount: number;
  /** Argument placeholder names in order */
  argNames: string[];
  /** Local alias references (@keyword) found */
  aliasRefs: string[];
  /** i18n references ($keyword) found */
  i18nRefs: string[];
  /** Whether this pattern has a variadic argument ({...} or {name...}) */
  hasVariadicArg: boolean;
}

/**
 * A segment of a parsed pattern
 */
export type PatternSegment =
  | { type: "literal"; value: string }
  | { type: "arg"; name: string }
  | { type: "variadicArg"; name: string }  // {...} or {name...} - accepts 1+ values
  | { type: "aliasRef"; key: string }  // @keyword
  | { type: "i18nRef"; key: string };  // t(key) - can return string or string[]

/**
 * A compiled pattern ready for matching
 */
export interface CompiledPattern {
  /** The raw pattern string */
  raw: string;
  /** Parsed pattern structure */
  parsed: ParsedPattern;
  /** Number of arguments required */
  argCount: number;
  /** All expanded literal variations (after alias/i18n resolution) */
  expansions: ExpandedPattern[];
}

/**
 * An expanded pattern variation
 */
export interface ExpandedPattern {
  /** The literal pattern string with placeholders */
  pattern: string;
  /** Keywords that appear between/around arguments */
  keywords: string[];
  /** Matcher function for token sequences */
  match: (tokens: Token[]) => PatternMatch | null;
}

/**
 * Result of a successful pattern match
 */
export interface PatternMatch {
  /** The operator key */
  operatorKey: string;
  /** Extracted argument values */
  args: string[];
  /** Token indices consumed */
  consumedTokens: number[];
  /** Match confidence score */
  score: number;
}

/**
 * Options for pattern compilation
 */
export interface PatternCompilerOptions {
  /** i18n provider for t(key) resolution */
  i18nProvider?: I18nProvider;
}

/**
 * Compiled operator with all patterns compiled
 */
export interface CompiledOperator {
  /** The operator key */
  key: string;
  /** All compiled patterns */
  patterns: CompiledPattern[];
  /** Minimum argument count across all patterns */
  minArguments: number;
  /** Maximum argument count across all patterns */
  maxArguments: number;
  /** Whether any pattern requires arguments */
  requiresArgument: boolean;
  /** Whether any pattern accepts multiple arguments */
  isVariadic: boolean;
  /** All keywords for trie insertion (after expansion) - general (not type-specific) */
  trieKeywords: string[];
  /** Type-specific keywords (key is DataType, value is array of keywords) */
  typeSpecificTrieKeywords?: Record<string, string[]>;
}

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse a pattern string into its components.
 * 
 * Supports:
 * - `{}` or `{name}` - Single argument placeholder
 * - `{...}` or `{name...}` - Variadic argument placeholder (1 or more values)
 * - `t(key)` - i18n translation reference
 * - `literal` - Literal text
 * 
 * @param pattern - The pattern string (e.g., "t(operators.eq) {value}")
 * @returns Parsed pattern structure
 */
export function parsePattern(pattern: string): ParsedPattern {
  const segments: PatternSegment[] = [];
  const argNames: string[] = [];
  const aliasRefs: string[] = [];
  const i18nRefs: string[] = [];
  let hasVariadicArg = false;
  
  // Tokenize the pattern by finding all special sequences
  let lastIndex = 0;
  let argCounter = 0;
  
  // Combined regex to find all special tokens
  // Matches: {name...}, {...}, {name}, {}, t(key), t(nested.key)
  // Note: Variadic patterns ({...} or {name...}) must be checked first
  const tokenRegex = /(\{(\w*)\.\.\.\})|(\{(\w*)\})|(t\(([^)]+)\))/g;
  let match: RegExpExecArray | null;
  
  while ((match = tokenRegex.exec(pattern)) !== null) {
    // Add any literal text before this match
    if (match.index > lastIndex) {
      const literal = pattern.slice(lastIndex, match.index).trim();
      if (literal) {
        segments.push({ type: "literal", value: literal });
      }
    }
    
    if (match[1]) {
      // {name...} or {...} variadic placeholder
      const name = match[2] || `args${argCounter++}`;
      segments.push({ type: "variadicArg", name });
      argNames.push(name);
      hasVariadicArg = true;
    } else if (match[3]) {
      // {arg} or {} placeholder
      const name = match[4] || `arg${argCounter++}`;
      segments.push({ type: "arg", name });
      argNames.push(name);
    } else if (match[5]) {
      // t(key) i18n reference
      const key = match[6]!;
      segments.push({ type: "i18nRef", key });
      i18nRefs.push(key);
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add any remaining literal text
  if (lastIndex < pattern.length) {
    const literal = pattern.slice(lastIndex).trim();
    if (literal) {
      segments.push({ type: "literal", value: literal });
    }
  }
  
  return {
    raw: pattern,
    segments,
    argCount: argNames.length,
    argNames,
    aliasRefs,
    i18nRefs,
    hasVariadicArg,
  };
}

// ============================================================================
// ALIAS & I18N RESOLUTION
// ============================================================================

/**
 * Resolve a t(key) reference via i18n provider.
 * Returns an array of strings (aliases).
 * 
 * @param key - The i18n key (e.g., "operators.eq")
 * @param i18nProvider - The i18n provider
 * @returns Resolved translation(s) or the key itself as fallback
 */
function resolveI18nRef(key: string, i18nProvider?: I18nProvider): string[] {
  if (i18nProvider?.getAliases) {
    return i18nProvider.getAliases(key);
  }
  // Fallback: try translate() for backward compatibility
  if (i18nProvider?.translate) {
    const translated = i18nProvider.translate(key);
    if (translated !== undefined) {
      return Array.isArray(translated) ? translated : [translated];
    }
  }
  // Fallback to the key itself (replace dots/underscores with spaces for readability)
  const fallback = key.replace(/[._]/g, " ");
  return [fallback];
}

/**
 * Generate all permutations of pattern expansions.
 * 
 * @param parsed - Parsed pattern
 * @param i18nProvider - i18n provider for t() refs
 * @returns Array of expanded pattern strings
 */
function generateExpansions(
  parsed: ParsedPattern,
  i18nProvider?: I18nProvider
): string[] {
  // Start with a single empty expansion
  let expansions: string[][] = [[]];
  
  for (const segment of parsed.segments) {
    const newExpansions: string[][] = [];
    
    for (const current of expansions) {
      switch (segment.type) {
        case "literal":
          newExpansions.push([...current, segment.value]);
          break;
          
        case "arg":
          // Keep placeholder as-is (single argument)
          newExpansions.push([...current, `{${segment.name}}`]);
          break;
          
        case "variadicArg":
          // Keep variadic placeholder with ... suffix for matching
          newExpansions.push([...current, `{${segment.name}...}`]);
          break;
          
        case "aliasRef":
          // @keyword references are no longer supported - treat as literal
          // This should not happen in new patterns, but handle gracefully
          newExpansions.push([...current, segment.key]);
          break;
          
        case "i18nRef": {
          // Resolve via i18n provider - can return multiple values
          const translations = resolveI18nRef(segment.key, i18nProvider);
          for (const translation of translations) {
            newExpansions.push([...current, translation]);
          }
          break;
        }
      }
    }
    
    expansions = newExpansions;
  }
  
  // Join segments into pattern strings
  return expansions.map(parts => parts.join(" ").trim());
}

// ============================================================================
// PATTERN MATCHING
// ============================================================================

/**
 * Extract keywords (non-placeholder parts) from an expanded pattern.
 * Returns individual words AND multi-word phrases for trie insertion.
 */
function extractKeywords(expandedPattern: string): string[] {
  // Remove {arg} and {arg...} placeholders and get the remaining parts
  const cleaned = expandedPattern.replace(/\{\w+\.\.\.?\}/g, " ");
  const words = cleaned.split(/\s+/).filter(s => s.length > 0);
  
  const keywords: string[] = [...words];
  
  // For multi-word phrases, also include the combined phrase
  // This enables matching "not equals" as a single bigram
  if (words.length > 1) {
    keywords.push(words.join(" "));
  }
  
  return keywords;
}

/**
 * Create a matcher function for an expanded pattern.
 * 
 * @param expandedPattern - The expanded pattern string
 * @param operatorKey - The operator key
 * @returns Matcher function
 */
function createMatcher(
  expandedPattern: string,
  operatorKey: string
): (tokens: Token[]) => PatternMatch | null {
  const parts = expandedPattern.split(/\s+/).filter(s => s.length > 0);
  const argIndices: number[] = [];
  const variadicIndex: number | null = null;
  const literalParts: { index: number; value: string }[] = [];
  
  parts.forEach((part, i) => {
    if (part.match(/^\{\w+\.\.\.\}$/)) {
      // Variadic argument - matches all remaining tokens
      argIndices.push(i);
    } else if (part.match(/^\{\w+\}$/)) {
      // Single argument
      argIndices.push(i);
    } else {
      literalParts.push({ index: i, value: part.toLowerCase() });
    }
  });
  
  // Check if the last part is variadic
  const lastPart = parts[parts.length - 1];
  const hasVariadicEnd = lastPart?.match(/^\{\w+\.\.\.\}$/) !== null;
  
  return (tokens: Token[]): PatternMatch | null => {
    // Minimum tokens: non-variadic parts count
    const minTokens = hasVariadicEnd ? parts.length : parts.length;
    if (tokens.length < minTokens) return null;
    
    const args: string[] = [];
    const consumedTokens: number[] = [];
    let score = 0;
    
    // Try to match from the start
    for (let i = 0; i < parts.length && i < tokens.length; i++) {
      const part = parts[i]!;
      const token = tokens[i]!;
      
      if (part.match(/^\{\w+\.\.\.\}$/)) {
        // Variadic argument - consume this and all remaining tokens
        for (let j = i; j < tokens.length; j++) {
          args.push(tokens[j]!.text);
          consumedTokens.push(j);
          score += 0.5; // Partial score for args
        }
        break; // Variadic consumes all remaining
      } else if (part.match(/^\{\w+\}$/)) {
        // This is a single argument placeholder - accept any token
        args.push(token.text);
        consumedTokens.push(i);
        score += 0.5; // Partial score for args
      } else {
        // This is a literal keyword - must match exactly
        if (token.normalized === part.toLowerCase()) {
          consumedTokens.push(i);
          score += 1; // Full score for exact keyword match
        } else {
          return null; // No match - keywords must match exactly
        }
      }
    }
    
    // Normalize score
    score = score / Math.max(parts.length, consumedTokens.length);
    
    return {
      operatorKey,
      args,
      consumedTokens,
      score,
    };
  };
}

// ============================================================================
// COMPILATION
// ============================================================================

/**
 * Compile a single pattern string.
 * 
 * @param pattern - The pattern string
 * @param operatorKey - The operator key (for match results)
 * @param options - Compilation options
 * @returns Compiled pattern
 */
export function compilePattern(
  pattern: string,
  operatorKey: string,
  options: PatternCompilerOptions = {}
): CompiledPattern {
  const parsed = parsePattern(pattern);
  const expansionStrings = generateExpansions(parsed, options.i18nProvider);
  
  const expansions: ExpandedPattern[] = expansionStrings.map(exp => ({
    pattern: exp,
    keywords: extractKeywords(exp),
    match: createMatcher(exp, operatorKey),
  }));
  
  return {
    raw: pattern,
    parsed,
    argCount: parsed.argCount,
    expansions,
  };
}

/**
 * Compile all patterns for an operator.
 * 
 * @param key - The operator key
 * @param patterns - Array of pattern strings
 * @param options - Compilation options
 * @returns Compiled operator
 */
export function compileOperator(
  key: string,
  patterns: string[],
  options: PatternCompilerOptions = {}
): CompiledOperator {
  const compiledPatterns = patterns.map(p => compilePattern(p, key, options));
  
  // Derive metadata from patterns
  const argCounts = compiledPatterns.map(p => p.argCount);
  const minArguments = Math.min(...argCounts);
  const maxArguments = Math.max(...argCounts);
  const requiresArgument = minArguments > 0;
  // isVariadic is true if any pattern has a variadic arg ({...}) OR has 2+ arguments
  const hasVariadicPattern = compiledPatterns.some(p => p.parsed.hasVariadicArg);
  const isVariadic = hasVariadicPattern || maxArguments > 1;
  
  // Collect all keywords for trie insertion
  const trieKeywords = new Set<string>();
  trieKeywords.add(key); // Always add the operator key itself
  
  for (const cp of compiledPatterns) {
    for (const exp of cp.expansions) {
      for (const kw of exp.keywords) {
        trieKeywords.add(kw.toLowerCase());
      }
    }
  }
  
  return {
    key,
    patterns: compiledPatterns,
    minArguments,
    maxArguments,
    requiresArgument,
    isVariadic,
    trieKeywords: Array.from(trieKeywords),
  };
}

/**
 * Compile an operator definition.
 * 
 * @param def - Operator definition object
 * @param i18nProvider - i18n provider
 * @returns Compiled operator
 */
export function compileOperatorDefinition(
  def: {
    key: string;
    patterns: string[];
  },
  i18nProvider?: I18nProvider
): CompiledOperator {
  const options: PatternCompilerOptions = {
    i18nProvider,
  };
  
  // Compile patterns
  return compileOperator(def.key, def.patterns, options);
}
