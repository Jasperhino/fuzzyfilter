/**
 * Candidate-Based Suggestion Engine
 *
 * Generates suggestions by:
 * 1. Creating ALL (field, operator, overload) candidates upfront
 * 2. For each candidate, trying to fill arguments from query chunks
 * 3. Scoring based on argument coverage and match quality
 *
 * This ensures every suggestion has a field + operator + overload.
 *
 * @module fuzzyfilter/parsing/candidate-engine
 */

import type { ZodObject, ZodType } from "zod";
import type { FieldSchema, OperatorOverload, ArgumentTypeRegistry, OperatorArgument } from "../types/field-centric";
import type { Trie } from "../trie";
import type { UnitRegistry } from "../units/types";
import type { Chunking, ParseMatch, ParsedValue, ScoreBreakdown } from "./types";
import type { ValueParser } from "./value-parser";
import { generateChunkings } from "./chunker";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A candidate represents one possible (field, operator, overload) combination.
 */
export interface Candidate {
  fieldKey: string;
  fieldSchema: FieldSchema<unknown>;
  operatorId: string;
  overload: OperatorOverload<unknown, Record<string, unknown>>;
}

/**
 * Entry in the value trie (indexed data values).
 */
export interface ValueTrieEntry {
  value: string;
  fieldKey: string;
  rowCount: number;
}

/**
 * Result of filling arguments for a candidate.
 */
export interface ArgumentFilling {
  /** Arguments that were successfully filled */
  filledArgs: Record<string, unknown>;
  /** Argument keys that couldn't be filled */
  missingArgs: string[];
  /** Matches for each filled argument */
  matches: ParseMatch[];
  /** Parsed values */
  parsedValues: ParsedValue<unknown>[];
  /** Query chunks that weren't used */
  unusedChunks: string[];
  /** Coverage score (0-1): filled / total args */
  coverage: number;
  /** Average match quality (0-1) */
  matchQuality: number;
}

/**
 * A scored candidate suggestion.
 */
export interface CandidateSuggestion {
  /** The candidate (field + operator + overload) */
  candidate: Candidate;
  /** How arguments were filled */
  filling: ArgumentFilling;
  /** Final composite score (0-1) */
  score: number;
  /** Score breakdown */
  scoreBreakdown: ScoreBreakdown & { 
    final: number;
    coverage: number;
    matchQuality: number;
    unusedPenalty: number;
  };
  /** The chunking used */
  chunking: Chunking;
  /** Is this suggestion complete (all required args filled)? */
  isComplete: boolean;
}

/**
 * Entry in the argument value trie (indexed argument values).
 */
export interface ArgumentValueTrieEntry {
  value: string;
  argumentType: string;
}

/**
 * Dependencies for the candidate engine.
 */
export interface CandidateEngineDependencies {
  /** All field schemas */
  fields: Map<string, FieldSchema<unknown>>;
  /** Trie for fuzzy field name matching */
  fieldTrie: Trie<{ key: string; schema: FieldSchema<unknown> }>;
  /** Trie for fuzzy value matching (indexed data) */
  valueTrie: Trie<ValueTrieEntry>;
  /** Trie for fuzzy argument value matching (indexed argument types) */
  argumentValueTrie: Trie<ArgumentValueTrieEntry>;
  /** Argument type definitions */
  argumentTypes: ArgumentTypeRegistry;
  /** Unit registry for unit matching */
  unitRegistry: UnitRegistry;
  /** Value parsers keyed by type */
  valueParsers: Map<string, ValueParser<unknown>>;
  /** Function to get field label */
  getFieldLabel: (fieldKey: string) => string;
  /** Function to get operator label */
  getOperatorLabel: (i18nKey: string) => string;
  /** Function to get field aliases (optional) */
  getFieldAliases?: (labelKey: string) => string[];
  /** Function to get operator aliases (optional) */
  getOperatorAliases?: (i18nKey: string) => string[];
}

/**
 * Configuration for the candidate engine.
 */
export interface CandidateEngineConfig {
  /** Maximum candidates to evaluate */
  maxCandidates?: number;
  /** Minimum score threshold */
  minScore?: number;
  /** Maximum suggestions to return */
  maxSuggestions?: number;
}

const DEFAULT_CONFIG: Required<CandidateEngineConfig> = {
  maxCandidates: 100,
  minScore: 0.1,
  maxSuggestions: 10,
};

// =============================================================================
// CANDIDATE ENGINE
// =============================================================================

/**
 * Create a candidate-based suggestion engine.
 */
export function createCandidateEngine(
  deps: CandidateEngineDependencies,
  config: CandidateEngineConfig = {}
) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Pre-generate all candidates (cached)
  let candidatesCache: Candidate[] | null = null;

  /**
   * Get all candidates (field × operator × overload).
   */
  function getAllCandidates(): Candidate[] {
    if (candidatesCache) return candidatesCache;

    const candidates: Candidate[] = [];

    for (const [fieldKey, fieldSchema] of deps.fields) {
      for (const opConfig of fieldSchema.operators) {
        for (const overload of opConfig.overloads) {
          candidates.push({
            fieldKey,
            fieldSchema,
            operatorId: opConfig.operatorId,
            overload: overload as OperatorOverload<unknown, Record<string, unknown>>,
          });
        }
      }
    }

    // Sort by priority (higher first)
    candidates.sort((a, b) => (b.overload.priority ?? 0) - (a.overload.priority ?? 0));

    candidatesCache = candidates;
    return candidates;
  }

  /**
   * Invalidate the candidates cache (call when fields change).
   */
  function invalidateCache(): void {
    candidatesCache = null;
  }

  /**
   * Generate suggestions for a query.
   */
  function suggest(query: string): CandidateSuggestion[] {
    if (!query.trim()) return [];

    // Get all chunkings of the query
    const chunkings = generateChunkings(query);
    const bestChunking = chunkings[0]; // Use highest plausibility chunking
    if (!bestChunking) return [];

    // Get all candidates
    const candidates = getAllCandidates();

    // Score each candidate
    const scored: CandidateSuggestion[] = [];

    for (const candidate of candidates.slice(0, cfg.maxCandidates)) {
      const suggestion = scoreCandidate(candidate, query, bestChunking);
      if (suggestion.score >= cfg.minScore) {
        scored.push(suggestion);
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Return top suggestions
    return scored.slice(0, cfg.maxSuggestions);
  }

  /**
   * Score a candidate against the query.
   */
  function scoreCandidate(
    candidate: Candidate,
    query: string,
    chunking: Chunking
  ): CandidateSuggestion {
    // Check if query matches field/operator labels
    const { fieldMatchScore, operatorMatchScore, matchedChunks, fieldOperatorMatches } = matchFieldAndOperator(
      candidate,
      chunking
    );

    // Fill arguments from chunks (excluding already-matched field/operator chunks)
    const filling = fillArguments(candidate, query, chunking, matchedChunks);
    
    // Prepend field/operator matches to the matches array
    filling.matches = [...fieldOperatorMatches, ...filling.matches];

    // Calculate scores
    const coverage = filling.coverage;
    const matchQuality = filling.matchQuality;
    const unusedPenalty = Math.pow(0.8, filling.unusedChunks.length);
    const chunkingScore = chunking.plausibility;

    // Final score: field/operator match is critical, then coverage, then match quality
    // If field matches, we heavily prioritize this candidate
    // If operator also matches, even more priority
    const fieldBoost = fieldMatchScore > 0 ? 0.3 * fieldMatchScore : 0;
    const operatorBoost = operatorMatchScore > 0 ? 0.2 * operatorMatchScore : 0;
    const baseScore = coverage * 0.25 + matchQuality * 0.15 + unusedPenalty * 0.05 + chunkingScore * 0.05;
    const final = fieldBoost + operatorBoost + baseScore;

    // Is complete if all required args are filled
    const isComplete = filling.missingArgs.length === 0 && filling.unusedChunks.length === 0;

    return {
      candidate,
      filling,
      score: final,
      scoreBreakdown: {
        chunking: chunkingScore,
        field: fieldMatchScore,
        operator: operatorMatchScore,
        valueParse: matchQuality,
        unitMatch: 1,
        completeness: isComplete ? 1 : 0.8,
        coverage,
        matchQuality,
        unusedPenalty,
        final,
      },
      chunking,
      isComplete,
    };
  }

  /**
   * Calculate Levenshtein edit distance between two strings.
   */
  function editDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1, // substitution
            matrix[i]![j - 1]! + 1,     // insertion
            matrix[i - 1]![j]! + 1      // deletion
          );
        }
      }
    }
    return matrix[b.length]![a.length]!;
  }

  /**
   * Calculate fuzzy match score based on edit distance.
   * Returns 0-1 where 1 is exact match and lower values are worse matches.
   */
  function fuzzyMatchScore(chunk: string, label: string): number {
    if (chunk === label) return 1.0;
    if (chunk.length < 3) return 0;
    
    const distance = editDistance(chunk, label);
    const maxLen = Math.max(chunk.length, label.length);
    
    // Allow 1 edit per 4 characters, minimum 1 edit allowed
    const maxAllowedDistance = Math.max(1, Math.floor(maxLen / 4));
    
    if (distance > maxAllowedDistance) return 0;
    
    // Score based on similarity: 1 - (distance / maxLen)
    return Math.max(0, 1 - (distance / maxLen)) * 0.8; // 0.8 max for fuzzy matches
  }

  /**
   * Match field and operator labels against query chunks.
   * Returns scores (0-1), which chunks were used, and the actual matches for display.
   */
  function matchFieldAndOperator(
    candidate: Candidate,
    chunking: Chunking
  ): { 
    fieldMatchScore: number; 
    operatorMatchScore: number; 
    matchedChunks: Set<number>;
    fieldOperatorMatches: ParseMatch[];
  } {
    const matchedChunks = new Set<number>();
    const fieldOperatorMatches: ParseMatch[] = [];
    let fieldMatchScore = 0;
    let operatorMatchScore = 0;
    let fieldMatchChunk: { idx: number; text: string; start: number; end: number; resolvedTo: string } | null = null;
    let operatorMatchChunk: { idx: number; text: string; start: number; end: number; resolvedTo: string } | null = null;

    // Get field label and aliases
    const fieldLabel = deps.getFieldLabel(candidate.fieldKey);
    const fieldAliases = deps.getFieldAliases?.(candidate.fieldSchema.labelKey) ?? [];
    const fieldLabels = [fieldLabel, ...fieldAliases].map(l => l.toLowerCase());
    const primaryFieldLabel = fieldLabel; // Keep original case for display

    // Get operator label and aliases
    const operatorLabel = deps.getOperatorLabel(candidate.overload.i18nKey);
    const operatorAliases = deps.getOperatorAliases?.(candidate.overload.i18nKey) ?? [];
    const operatorLabels = [operatorLabel, ...operatorAliases].map(l => l.toLowerCase());
    const primaryOperatorLabel = operatorLabel;

    // Try to match field label against chunks
    for (let i = 0; i < chunking.chunks.length; i++) {
      const chunk = chunking.chunks[i]!;
      const chunkLower = chunk.text.toLowerCase();

      // Check field match
      if (!matchedChunks.has(i) && fieldMatchScore < 0.5) {
        for (const label of fieldLabels) {
          let score = 0;
          // Exact match
          if (chunkLower === label) {
            score = 1.0;
          }
          // Prefix match
          else if (label.startsWith(chunkLower) && chunkLower.length >= 3) {
            score = chunkLower.length / label.length;
          }
          // Contains match
          else if (label.includes(chunkLower) && chunkLower.length >= 3) {
            score = 0.7 * chunkLower.length / label.length;
          }
          // Fuzzy match (edit distance) for typos like "crated" → "created"
          else {
            score = fuzzyMatchScore(chunkLower, label);
          }

          if (score > fieldMatchScore) {
            fieldMatchScore = score;
            matchedChunks.add(i);
            fieldMatchChunk = {
              idx: i,
              text: chunk.text,
              start: chunk.start,
              end: chunk.end,
              resolvedTo: primaryFieldLabel,
            };
          }
        }
      }

      // Check operator match
      if (!matchedChunks.has(i) && operatorMatchScore < 0.5) {
        for (const label of operatorLabels) {
          let score = 0;
          // Exact match
          if (chunkLower === label) {
            score = 1.0;
          }
          // Prefix match
          else if (label.startsWith(chunkLower) && chunkLower.length >= 3) {
            score = chunkLower.length / label.length;
          }
          // Contains match
          else if (label.includes(chunkLower) && chunkLower.length >= 3) {
            score = 0.7 * chunkLower.length / label.length;
          }
          // Fuzzy match (edit distance) for typos like "aftr" → "after"
          else {
            score = fuzzyMatchScore(chunkLower, label);
          }

          if (score > operatorMatchScore) {
            operatorMatchScore = score;
            matchedChunks.add(i);
            operatorMatchChunk = {
              idx: i,
              text: chunk.text,
              start: chunk.start,
              end: chunk.end,
              resolvedTo: primaryOperatorLabel,
            };
          }
        }
      }
    }

    // Add field match to matches array if found
    if (fieldMatchChunk && fieldMatchScore > 0) {
      fieldOperatorMatches.push({
        text: fieldMatchChunk.text,
        resolvedTo: fieldMatchChunk.resolvedTo,
        score: fieldMatchScore,
        role: "field",
        start: fieldMatchChunk.start,
        end: fieldMatchChunk.end,
      });
    }

    // Add operator match to matches array if found
    if (operatorMatchChunk && operatorMatchScore > 0) {
      fieldOperatorMatches.push({
        text: operatorMatchChunk.text,
        resolvedTo: operatorMatchChunk.resolvedTo,
        score: operatorMatchScore,
        role: "operator",
        start: operatorMatchChunk.start,
        end: operatorMatchChunk.end,
      });
    }

    return { fieldMatchScore, operatorMatchScore, matchedChunks, fieldOperatorMatches };
  }

  /**
   * Fill arguments for a candidate from query chunks.
   * @param reservedChunks Chunks already used for field/operator matching
   */
  function fillArguments(
    candidate: Candidate,
    query: string,
    chunking: Chunking,
    reservedChunks: Set<number> = new Set()
  ): ArgumentFilling {
    const filledArgs: Record<string, unknown> = {};
    const missingArgs: string[] = [];
    const matches: ParseMatch[] = [];
    const parsedValues: ParsedValue<unknown>[] = [];
    // Start with reserved chunks already marked as used
    const usedChunkIndexes = new Set<number>(reservedChunks);

    // Check if using new arguments array or legacy argumentSchema
    if (candidate.overload.arguments) {
      return fillArgumentsFromTypes(candidate, chunking, reservedChunks, usedChunkIndexes);
    }

    // Legacy: Get expected argument names from the schema
    const schema = candidate.overload.argumentSchema;
    if (!schema) {
      return {
        filledArgs,
        missingArgs,
        matches,
        parsedValues,
        unusedChunks: [],
        coverage: 1,
        matchQuality: 0.5,
      };
    }
    const argNames = getSchemaArgNames(schema);

    // Special case: timeframe arguments (start + end) need combined parsing
    const hasTimeframeArgs = argNames.includes("start") && argNames.includes("end");
    if (hasTimeframeArgs) {
      const timeframeResult = tryFillTimeframeArgs(chunking, usedChunkIndexes);
      if (timeframeResult) {
        filledArgs["start"] = timeframeResult.start;
        filledArgs["end"] = timeframeResult.end;
        matches.push(...timeframeResult.matches);
        for (const idx of timeframeResult.usedIndexes) {
          usedChunkIndexes.add(idx);
        }
      } else {
        missingArgs.push("start", "end");
      }
      // Process remaining non-timeframe arguments
      for (const argName of argNames) {
        if (argName === "start" || argName === "end") continue;
        const argSchema = getArgSchema(schema, argName);
        const result = tryFillArg(argName, argSchema, candidate, chunking, usedChunkIndexes);
        if (result) {
          filledArgs[argName] = result.value;
          matches.push(...result.matches);
          if (result.parsedValue) {
            parsedValues.push(result.parsedValue);
          }
          for (const idx of result.usedIndexes) {
            usedChunkIndexes.add(idx);
          }
        } else {
          missingArgs.push(argName);
        }
      }
    } else {
      // Standard argument filling
      for (const argName of argNames) {
        const argSchema = getArgSchema(schema, argName);
        const result = tryFillArg(argName, argSchema, candidate, chunking, usedChunkIndexes);

        if (result) {
          filledArgs[argName] = result.value;
          matches.push(...result.matches);
          if (result.parsedValue) {
            parsedValues.push(result.parsedValue);
          }
          for (const idx of result.usedIndexes) {
            usedChunkIndexes.add(idx);
          }
        } else {
          missingArgs.push(argName);
        }
      }
    }

    // Find unused chunks (excluding reserved field/operator chunks)
    const unusedChunks: string[] = [];
    for (let i = 0; i < chunking.chunks.length; i++) {
      if (!usedChunkIndexes.has(i) && !reservedChunks.has(i)) {
        unusedChunks.push(chunking.chunks[i]!.text);
      }
    }

    // Calculate scores
    const totalArgs = argNames.length;
    const coverage = totalArgs > 0 ? (totalArgs - missingArgs.length) / totalArgs : 1;
    const matchQuality = matches.length > 0
      ? matches.reduce((sum, m) => sum + m.score, 0) / matches.length
      : 0.5;

    return {
      filledArgs,
      missingArgs,
      matches,
      parsedValues,
      unusedChunks,
      coverage,
      matchQuality,
    };
  }

  /**
   * Try to fill start/end timeframe arguments by combining unused chunks
   * and parsing them with the timeframe parser.
   */
  function tryFillTimeframeArgs(
    chunking: Chunking,
    usedIndexes: Set<number>
  ): { start: Date; end: Date; matches: ParseMatch[]; usedIndexes: number[] } | null {
    // Get the timeframe parser from dependencies
    const timeframeParser = deps.valueParsers.get("timeframe");
    if (!timeframeParser) return null;

    // Collect unused chunks and their indexes
    const unusedChunkInfos: Array<{ idx: number; text: string; start: number; end: number }> = [];
    for (let i = 0; i < chunking.chunks.length; i++) {
      if (!usedIndexes.has(i)) {
        const chunk = chunking.chunks[i]!;
        unusedChunkInfos.push({ idx: i, text: chunk.text, start: chunk.start, end: chunk.end });
      }
    }

    if (unusedChunkInfos.length === 0) return null;

    // Reconstruct the text from unused chunks (preserving order)
    const combinedText = unusedChunkInfos.map(c => c.text).join(" ");

    // Try to parse with the timeframe parser
    const parseResults = timeframeParser.parse(combinedText, deps.unitRegistry);

    if (parseResults.length > 0) {
      const best = parseResults[0]!;
      // The timeframe parser returns { start: Date, end: Date }
      const tfValue = best.value as { start: Date; end: Date };

      if (tfValue && tfValue.start instanceof Date && tfValue.end instanceof Date) {
        // Mark all unused chunks as used (they were all part of the timeframe text)
        const usedIdxs = unusedChunkInfos.map(c => c.idx);

        const matches: ParseMatch[] = [{
          text: combinedText,
          resolvedTo: `${tfValue.start.toLocaleDateString()} - ${tfValue.end.toLocaleDateString()}`,
          score: best.score,
          role: "value",
          start: unusedChunkInfos[0]!.start,
          end: unusedChunkInfos[unusedChunkInfos.length - 1]!.end,
        }];

        return {
          start: tfValue.start,
          end: tfValue.end,
          matches,
          usedIndexes: usedIdxs,
        };
      }
    }

    return null;
  }

  /**
   * Fill arguments using the new arguments array pattern with type references.
   */
  function fillArgumentsFromTypes(
    candidate: Candidate,
    chunking: Chunking,
    reservedChunks: Set<number>,
    usedChunkIndexes: Set<number>
  ): ArgumentFilling {
    const filledArgs: Record<string, unknown> = {};
    const missingArgs: string[] = [];
    const matches: ParseMatch[] = [];
    const parsedValues: ParsedValue<unknown>[] = [];

    if (!candidate.overload.arguments) {
      return {
        filledArgs,
        missingArgs,
        matches,
        parsedValues,
        unusedChunks: [],
        coverage: 1,
        matchQuality: 0.5,
      };
    }

    // Special case: timeframe arguments (start + end) need combined parsing
    const timeframeArgs = candidate.overload.arguments.filter(
      (arg) => arg.name === "start" || arg.name === "end"
    );
    if (timeframeArgs.length === 2) {
      const timeframeResult = tryFillTimeframeArgs(chunking, usedChunkIndexes);
      if (timeframeResult) {
        filledArgs["start"] = timeframeResult.start;
        filledArgs["end"] = timeframeResult.end;
        matches.push(...timeframeResult.matches);
        for (const idx of timeframeResult.usedIndexes) {
          usedChunkIndexes.add(idx);
        }
      } else {
        missingArgs.push("start", "end");
      }
    }

    // Process remaining arguments
    for (const arg of candidate.overload.arguments) {
      if (arg.name === "start" || arg.name === "end") continue; // Already handled
      if (filledArgs[arg.name] !== undefined) continue; // Already filled

      const argType = deps.argumentTypes[arg.argumentSchemaKey];
      if (!argType) {
        missingArgs.push(arg.name);
        continue;
      }

      // Strategy 1: Try argument value trie (for indexed values)
      if (argType.indexing) {
        const match = tryMatchFromArgumentTrie(arg, arg.argumentSchemaKey, chunking, usedChunkIndexes);
        if (match) {
          if (arg.isArray) {
            filledArgs[arg.name] = Array.isArray(filledArgs[arg.name])
              ? [...(filledArgs[arg.name] as string[]), match.value]
              : [match.value];
          } else {
            filledArgs[arg.name] = match.value;
          }
          matches.push(...match.matches);
          for (const idx of match.usedIndexes) {
            usedChunkIndexes.add(idx);
          }
          continue;
        }
      }

      // Strategy 2: Try parser
      const parsed = tryParseArgumentType(arg, argType, chunking, usedChunkIndexes);
      if (parsed) {
        if (arg.isArray) {
          filledArgs[arg.name] = Array.isArray(filledArgs[arg.name])
            ? [...(filledArgs[arg.name] as unknown[]), parsed.value]
            : [parsed.value];
        } else {
          filledArgs[arg.name] = parsed.value;
        }
        matches.push(...parsed.matches);
        if (parsed.parsedValue) {
          parsedValues.push(parsed.parsedValue);
        }
        for (const idx of parsed.usedIndexes) {
          usedChunkIndexes.add(idx);
        }
      } else {
        missingArgs.push(arg.name);
      }
    }

    // Find unused chunks
    const unusedChunks: string[] = [];
    for (let i = 0; i < chunking.chunks.length; i++) {
      if (!usedChunkIndexes.has(i) && !reservedChunks.has(i)) {
        unusedChunks.push(chunking.chunks[i]!.text);
      }
    }

    // Calculate scores
    const totalArgs = candidate.overload.arguments.length;
    const coverage = totalArgs > 0 ? (totalArgs - missingArgs.length) / totalArgs : 1;
    const matchQuality = matches.length > 0
      ? matches.reduce((sum, m) => sum + m.score, 0) / matches.length
      : 0.5;

    return {
      filledArgs,
      missingArgs,
      matches,
      parsedValues,
      unusedChunks,
      coverage,
      matchQuality,
    };
  }

  /**
   * Try to match an argument value from the argument value trie.
   */
  function tryMatchFromArgumentTrie(
    arg: OperatorArgument,
    argumentSchemaKey: string,
    chunking: Chunking,
    usedIndexes: Set<number>
  ): { value: string; matches: ParseMatch[]; usedIndexes: number[] } | null {
    const matches: ParseMatch[] = [];
    const usedIdxs: number[] = [];

    for (let i = 0; i < chunking.chunks.length; i++) {
      if (usedIndexes.has(i)) continue;

      const chunk = chunking.chunks[i]!;
      const trieMatches = deps.argumentValueTrie.fuzzySearch(chunk.text, 3);

      // Filter to values for this argument schema key
      const relevantMatches = trieMatches.filter(
        (tm) => tm.value.argumentType === argumentSchemaKey
      );

      if (relevantMatches.length > 0) {
        const best = relevantMatches[0]!;
        matches.push({
          text: chunk.text,
          resolvedTo: best.value.value,
          score: best.score,
          indexes: best.indexes ? Array.from(best.indexes) : undefined,
          role: "value",
          start: chunk.start,
          end: chunk.end,
        });
        usedIdxs.push(i);
        return { value: best.value.value, matches, usedIndexes: usedIdxs };
      }
    }

    return null;
  }

  /**
   * Try to parse an argument using its parser.
   * For date-like parsers, tries combining consecutive unused chunks.
   */
  function tryParseArgumentType(
    arg: OperatorArgument,
    argType: { parser: any },
    chunking: Chunking,
    usedIndexes: Set<number>
  ): { value: unknown; matches: ParseMatch[]; parsedValue?: ParsedValue<unknown>; usedIndexes: number[] } | null {
    const parser = deps.valueParsers.get(arg.argumentSchemaKey);
    if (!parser) return null;

    const matches: ParseMatch[] = [];
    const usedIdxs: number[] = [];

    // For date-like arguments, try multi-chunk combinations first
    const isDateLike = arg.argumentSchemaKey === "date" || arg.argumentSchemaKey === "timeframe";
    
    if (isDateLike) {
      // Try combining consecutive unused chunks (e.g., "last friday" from ["last", "friday"])
      const unusedChunkInfos: Array<{ idx: number; text: string; start: number; end: number }> = [];
      for (let i = 0; i < chunking.chunks.length; i++) {
        if (!usedIndexes.has(i)) {
          const chunk = chunking.chunks[i]!;
          unusedChunkInfos.push({ idx: i, text: chunk.text, start: chunk.start, end: chunk.end });
        }
      }

      // Try different window sizes starting from larger combinations
      for (let windowSize = Math.min(4, unusedChunkInfos.length); windowSize >= 2; windowSize--) {
        for (let start = 0; start <= unusedChunkInfos.length - windowSize; start++) {
          const windowChunks = unusedChunkInfos.slice(start, start + windowSize);
          const combinedText = windowChunks.map(c => c.text).join(" ");
          
          const parseResults = parser.parse(combinedText, deps.unitRegistry);
          
          if (parseResults.length > 0) {
            const best = parseResults[0]!;
            const windowIdxs = windowChunks.map(c => c.idx);
            const startPos = windowChunks[0]!.start;
            const endPos = windowChunks[windowChunks.length - 1]!.end;
            
            // Format resolvedTo nicely for dates
            let resolvedTo = String(best.value);
            if (best.value instanceof Date) {
              resolvedTo = best.value.toDateString();
            }
            
            matches.push({
              text: combinedText,
              resolvedTo,
              score: best.score,
              role: "value",
              start: startPos,
              end: endPos,
            });
            
            // Fix parsedValue positions
            const parsedValue: ParsedValue<unknown> = {
              ...best,
              rawText: combinedText,
              start: startPos,
              end: endPos,
            };
            
            return { value: best.value, matches, parsedValue, usedIndexes: windowIdxs };
          }
        }
      }
    }

    // Single chunk parsing (for non-date types or if multi-chunk failed)
    for (let i = 0; i < chunking.chunks.length; i++) {
      if (usedIndexes.has(i)) continue;

      const chunk = chunking.chunks[i]!;
      const parseResults = parser.parse(chunk.text, deps.unitRegistry);

      if (parseResults.length > 0) {
        const best = parseResults[0]!;
        
        // Format resolvedTo nicely for dates
        let resolvedTo = String(best.value);
        if (best.value instanceof Date) {
          resolvedTo = best.value.toDateString();
        }
        
        matches.push({
          text: chunk.text,
          resolvedTo,
          score: best.score,
          role: "value",
          start: chunk.start,
          end: chunk.end,
        });
        usedIdxs.push(i);
        
        // Fix parsedValue positions
        const parsedValue: ParsedValue<unknown> = {
          ...best,
          rawText: chunk.text,
          start: chunk.start,
          end: chunk.end,
        };
        
        return { value: best.value, matches, parsedValue, usedIndexes: usedIdxs };
      }
    }

    return null;
  }

  /**
   * Try to fill a single argument from chunks.
   */
  function tryFillArg(
    argName: string,
    argSchema: ZodType<unknown> | null,
    candidate: Candidate,
    chunking: Chunking,
    usedIndexes: Set<number>
  ): { value: unknown; matches: ParseMatch[]; parsedValue?: ParsedValue<unknown>; usedIndexes: number[] } | null {
    const matches: ParseMatch[] = [];
    const usedIdxs: number[] = [];

    // Strategy 1: Try value trie for array arguments (like materialTypes)
    if (argName.endsWith("Types") || argName.endsWith("s")) {
      const arrayValues: string[] = [];

      for (let i = 0; i < chunking.chunks.length; i++) {
        if (usedIndexes.has(i)) continue;

        const chunk = chunking.chunks[i]!;
        const valueMatches = deps.valueTrie.fuzzySearch(chunk.text, 3);

        // Filter to values for this candidate's field
        const relevantMatches = valueMatches.filter(
          (vm) => vm.value.fieldKey === candidate.fieldKey
        );

        if (relevantMatches.length > 0) {
          const best = relevantMatches[0]!;
          arrayValues.push(best.value.value);
          matches.push({
            text: chunk.text,
            resolvedTo: best.value.value,
            score: best.score,
            indexes: best.indexes ? Array.from(best.indexes) : undefined,
            role: "value",
            start: chunk.start,
            end: chunk.end,
          });
          usedIdxs.push(i);
        }
      }

      if (arrayValues.length > 0) {
        return { value: arrayValues, matches, usedIndexes: usedIdxs };
      }
    }

    // Strategy 2: Try parsers for numeric/typed arguments
    // Prioritize parser that matches the argument name (e.g., "percentage" parser for "percentage" arg)
    const parsersToTry = Array.from(deps.valueParsers.entries());
    if (argName === "percentage" || argName === "amount" || argName === "value") {
      // Sort to try matching parser type first
      parsersToTry.sort(([typeA], [typeB]) => {
        if (typeA === argName) return -1;
        if (typeB === argName) return 1;
        return 0;
      });
    }

    for (const [parserType, parser] of parsersToTry) {
      for (let i = 0; i < chunking.chunks.length; i++) {
        if (usedIndexes.has(i)) continue;

        const chunk = chunking.chunks[i]!;
        const parseResults = parser.parse(chunk.text, deps.unitRegistry);

        if (parseResults.length > 0) {
          const best = parseResults[0]!;

          // Check if this argument expects a number/percentage/amount
          if (argName === "percentage" || argName === "value" || argName === "amount") {
            // Extract the numeric value
            let numValue: number | undefined;
            let resolvedText: string | undefined;
            
            if (typeof best.value === "number") {
              numValue = best.value;
              // For percentage parser, preserve the original text (includes "%")
              if (argName === "percentage" && parserType === "percentage") {
                resolvedText = best.rawText; // Preserves "20%" instead of just "20"
              } else {
                resolvedText = String(numValue);
              }
            } else if (typeof best.value === "object" && best.value !== null && "value" in best.value) {
              const obj = best.value as { value: number; dimension?: string };
              // For percentage args, prefer percentage-dimensioned values
              if (argName === "percentage" && obj.dimension === "percentage") {
                numValue = obj.value;
                resolvedText = best.rawText; // Preserves unit/dimension info
              } else if (argName === "percentage" && parserType === "percentage") {
                // Percentage parser returned a number directly, but we want to preserve "%"
                numValue = typeof best.value === "number" ? best.value : obj.value;
                resolvedText = best.rawText;
              } else if (argName !== "percentage") {
                numValue = obj.value;
                resolvedText = best.rawText;
              }
            }

            if (numValue !== undefined) {
              matches.push({
                text: chunk.text,
                resolvedTo: resolvedText ?? String(numValue),
                score: best.score,
                role: "value",
                start: chunk.start,
                end: chunk.end,
              });
              usedIdxs.push(i);
              return { value: numValue, matches, parsedValue: best, usedIndexes: usedIdxs };
            }
          }

          // For 'amount' argument expecting { value, unit }
          if (argName === "amount" && typeof best.value === "object" && best.value !== null) {
            const obj = best.value as { value: number; unit?: { id: string } };
            if ("value" in obj) {
              const amountValue = { value: obj.value, unit: obj.unit?.id ?? "kg" };
              matches.push({
                text: chunk.text,
                resolvedTo: `${obj.value}${obj.unit?.id ?? ""}`,
                score: best.score,
                role: "value",
                start: chunk.start,
                end: chunk.end,
              });
              usedIdxs.push(i);
              return { value: amountValue, matches, parsedValue: best, usedIndexes: usedIdxs };
            }
          }
        }
      }
    }

    // Strategy 3: For simple string values, use chunk text directly
    for (let i = 0; i < chunking.chunks.length; i++) {
      if (usedIndexes.has(i)) continue;

      const chunk = chunking.chunks[i]!;

      // Use as string value if it looks like one
      if (chunk.type === "word" && argName === "value") {
        matches.push({
          text: chunk.text,
          resolvedTo: chunk.text,
          score: 0.7,
          role: "value",
          start: chunk.start,
          end: chunk.end,
        });
        usedIdxs.push(i);
        return { value: chunk.text, matches, usedIndexes: usedIdxs };
      }
    }

    return null;
  }

  /**
   * Get argument names from a Zod schema.
   */
  function getSchemaArgNames(schema: ZodType<unknown>): string[] {
    // For ZodObject, get shape keys
    if ("shape" in schema && typeof schema.shape === "object") {
      return Object.keys(schema.shape as object);
    }

    // For other schemas, try to get inner type
    if ("_def" in schema) {
      const def = schema._def as { typeName?: string; shape?: () => object };
      if (def.typeName === "ZodObject" && def.shape) {
        return Object.keys(def.shape());
      }
    }

    return [];
  }

  /**
   * Get the schema for a specific argument.
   */
  function getArgSchema(schema: ZodType<unknown>, argName: string): ZodType<unknown> | null {
    if ("shape" in schema && typeof schema.shape === "object") {
      const shape = schema.shape as Record<string, ZodType<unknown>>;
      return shape[argName] ?? null;
    }

    if ("_def" in schema) {
      const def = schema._def as { shape?: () => Record<string, ZodType<unknown>> };
      if (def.shape) {
        return def.shape()[argName] ?? null;
      }
    }

    return null;
  }

  return {
    suggest,
    getAllCandidates,
    invalidateCache,
  };
}

/**
 * Type for the candidate engine.
 */
export type CandidateEngine = ReturnType<typeof createCandidateEngine>;
