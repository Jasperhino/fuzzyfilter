/**
 * Flexible Beam Search Engine
 *
 * A more flexible beam search that tries ALL interpretations per chunk:
 * - Field match
 * - Operator match
 * - Value match (via parsers)
 * - Value match (via value trie - indexed data)
 *
 * This allows patterns like "20% water" where the value comes first.
 *
 * @module fuzzyfilter/parsing/flexible-beam-search
 */

import type { Match } from "../types/core";
import type { FieldSchema, OperatorOverload } from "../types/field-centric";
import type { Trie } from "../trie";
import type { UnitRegistry } from "../units/types";
import type {
  BeamSearchConfig,
  Chunk,
  Chunking,
  ParseMatch,
  ParsedValue,
  ScoreBreakdown,
} from "./types";
import type { ValueParser } from "./value-parser";
import { generateChunkings } from "./chunker";
import { multiplyScores } from "./value-parser";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Entry in the value trie (indexed data values).
 */
export interface ValueTrieEntry {
  /** The actual value string */
  value: string;
  /** Which field this value belongs to */
  fieldKey: string;
  /** How many rows have this value */
  rowCount: number;
}

/**
 * Extended dependencies for flexible beam search.
 */
export interface FlexibleBeamSearchDependencies {
  /** Trie for fuzzy field name matching */
  fieldTrie: Trie<{ key: string; schema: FieldSchema<unknown> }>;

  /** Trie for fuzzy operator name matching */
  operatorTrie: Trie<{
    fieldKey: string;
    operatorId: string;
    overload: OperatorOverload<unknown, Record<string, unknown>>;
  }>;

  /** Trie for fuzzy VALUE matching (indexed data) */
  valueTrie: Trie<ValueTrieEntry>;

  /** Unit registry for unit matching */
  unitRegistry: UnitRegistry;

  /** Value parsers keyed by type */
  valueParsers: Map<string, ValueParser<unknown>>;

  /** Function to get overloads for a field+operator */
  getOverloads: (
    fieldKey: string,
    operatorId: string
  ) => OperatorOverload<unknown, Record<string, unknown>>[];

  /** Function to infer field from a value (optional) */
  inferFieldFromValue?: (value: string) => string | undefined;
}

/**
 * A single interpretation of a chunk.
 */
interface ChunkInterpretation {
  /** What role this chunk plays */
  role: "field" | "operator" | "value" | "unit" | "unknown";
  /** The chunk being interpreted */
  chunk: Chunk;
  /** Match score [0,1] */
  score: number;
  /** What it resolved to */
  resolvedTo: string;
  /** Character indexes for highlighting */
  indexes?: number[];
  /** For field matches */
  fieldKey?: string;
  fieldSchema?: FieldSchema<unknown>;
  /** For operator matches */
  operatorId?: string;
  overload?: OperatorOverload<unknown, Record<string, unknown>>;
  /** For value matches */
  parsedValue?: ParsedValue<unknown>;
  /** For value trie matches (indexed data) */
  valueTrieEntry?: ValueTrieEntry;
}

/**
 * A beam representing one interpretation path.
 */
interface FlexibleBeam {
  id: number;
  /** Original input */
  input: string;
  /** All chunk interpretations so far */
  interpretations: ChunkInterpretation[];
  /** Remaining unprocessed text */
  remaining: string;
  /** Composite score */
  score: number;
  /** Inferred field (from any source) */
  inferredField?: { key: string; schema: FieldSchema<unknown> };
  /** Inferred operator */
  inferredOperator?: {
    id: string;
    overloads: OperatorOverload<unknown, Record<string, unknown>>[];
  };
  /** Parsed values */
  parsedValues: ParsedValue<unknown>[];
  /** Current chunk index */
  chunkIndex: number;
  /** The chunking being used */
  chunking: Chunking;
}

/**
 * Final suggestion from flexible beam search.
 */
export interface FlexibleBeamSuggestion {
  /** Composite score [0,1] */
  score: number;
  /** Resolved field key */
  fieldKey: string;
  /** Resolved operator ID */
  operatorId: string;
  /** Matched overload IDs */
  overloadIds: string[];
  /** All matches for highlighting */
  matches: ParseMatch[];
  /** Parsed values */
  parsedValues: ParsedValue<unknown>[];
  /** Unparsed remaining text */
  remaining: string;
  /** Is this a complete filter? */
  isComplete: boolean;
  /** Score breakdown */
  scoreBreakdown: ScoreBreakdown & { final: number; coherence: number };
  /** The chunking used */
  chunking: Chunking;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: BeamSearchConfig = {
  maxBeams: 30,
  pruneThreshold: 0.05,
  earlyPruneRatio: 0.2,
};

// =============================================================================
// FLEXIBLE BEAM SEARCH ENGINE
// =============================================================================

/**
 * Create a flexible beam search engine.
 */
export function createFlexibleBeamSearchEngine(
  deps: FlexibleBeamSearchDependencies,
  config: Partial<BeamSearchConfig> = {}
) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let beamIdCounter = 0;

  /**
   * Generate suggestions using flexible beam search.
   */
  function suggest(query: string): FlexibleBeamSuggestion[] {
    if (!query.trim()) {
      return [];
    }

    beamIdCounter = 0;

    // Phase 1: Generate chunkings
    const chunkings = generateChunkings(query);

    // Phase 2: For each chunking, generate all possible interpretation paths
    let beams: FlexibleBeam[] = [];

    for (const chunking of chunkings) {
      const initialBeam: FlexibleBeam = {
        id: beamIdCounter++,
        input: query,
        interpretations: [],
        remaining: query,
        score: chunking.plausibility,
        parsedValues: [],
        chunkIndex: 0,
        chunking,
      };
      beams.push(initialBeam);
    }

    // Phase 3: Process each chunk, trying all interpretations
    let maxChunks = Math.max(...chunkings.map((c) => c.chunks.length));
    for (let i = 0; i < maxChunks; i++) {
      beams = expandBeamsForChunk(beams, i);
      beams = pruneBeams(beams);
    }

    // Phase 4: Apply coherence scoring and finalize
    return finalizeBeams(beams);
  }

  /**
   * Expand beams by trying all interpretations for a chunk.
   */
  function expandBeamsForChunk(beams: FlexibleBeam[], chunkIdx: number): FlexibleBeam[] {
    const expanded: FlexibleBeam[] = [];

    for (const beam of beams) {
      const chunk = beam.chunking.chunks[chunkIdx];
      if (!chunk) {
        // No more chunks for this beam
        expanded.push(beam);
        continue;
      }

      // Get all interpretations for this chunk
      const interpretations = getChunkInterpretations(chunk, beam);

      if (interpretations.length === 0) {
        // No interpretations - keep beam with unknown interpretation
        expanded.push({
          ...beam,
          id: beamIdCounter++,
          interpretations: [
            ...beam.interpretations,
            {
              role: "unknown",
              chunk,
              score: 0.3,
              resolvedTo: chunk.text,
            },
          ],
          score: beam.score * 0.3,
          chunkIndex: chunkIdx + 1,
          remaining: beam.input.slice(chunk.end).trim(),
        });
        continue;
      }

      // Create a new beam for each interpretation
      for (const interp of interpretations) {
        const newBeam = applyInterpretation(beam, interp, chunkIdx);
        expanded.push(newBeam);
      }
    }

    return expanded;
  }

  /**
   * Get all possible interpretations for a chunk.
   */
  function getChunkInterpretations(
    chunk: Chunk,
    beam: FlexibleBeam
  ): ChunkInterpretation[] {
    const interpretations: ChunkInterpretation[] = [];
    const text = chunk.text;

    // 1. Try as FIELD
    const fieldMatches = deps.fieldTrie.fuzzySearch(text, 3);
    for (const fm of fieldMatches) {
      if (fm.score >= 0.5) {
        interpretations.push({
          role: "field",
          chunk,
          score: fm.score,
          resolvedTo: fm.value.key,
          indexes: fm.indexes ? Array.from(fm.indexes) : undefined,
          fieldKey: fm.value.key,
          fieldSchema: fm.value.schema,
        });
      }
    }

    // 2. Try as OPERATOR
    const opMatches = deps.operatorTrie.fuzzySearch(text, 3);
    for (const om of opMatches) {
      if (om.score >= 0.5) {
        // Check if this operator is valid for any inferred field
        const validForField =
          !beam.inferredField || om.value.fieldKey === beam.inferredField.key;

        if (validForField) {
          const overloads = deps.getOverloads(om.value.fieldKey, om.value.operatorId);
          interpretations.push({
            role: "operator",
            chunk,
            score: om.score * (beam.inferredField ? 1.0 : 0.8), // Bonus if field matches
            resolvedTo: om.value.operatorId,
            indexes: om.indexes ? Array.from(om.indexes) : undefined,
            operatorId: om.value.operatorId,
            overload: om.value.overload,
            // Also capture the field if not yet inferred
            fieldKey: om.value.fieldKey,
          });
        }
      }
    }

    // 3. Try as VALUE (via value trie - indexed data)
    const valueMatches = deps.valueTrie.fuzzySearch(text, 5);
    for (const vm of valueMatches) {
      if (vm.score >= 0.4) {
        interpretations.push({
          role: "value",
          chunk,
          score: vm.score,
          resolvedTo: vm.value.value,
          indexes: vm.indexes ? Array.from(vm.indexes) : undefined,
          valueTrieEntry: vm.value,
          // The value tells us which field it belongs to!
          fieldKey: vm.value.fieldKey,
        });
      }
    }

    // 4. Try as VALUE (via parsers)
    for (const [_type, parser] of deps.valueParsers) {
      const parseResults = parser.parse(text, deps.unitRegistry, {
        beam: beam as any, // TODO: proper type
        field: beam.inferredField?.schema,
        operator: beam.inferredOperator?.overloads[0],
      });

      for (const pr of parseResults) {
        if (pr.score >= 0.5) {
          interpretations.push({
            role: "value",
            chunk,
            score: pr.score,
            resolvedTo: formatParsedValueForDisplay(pr),
            parsedValue: pr,
          });
        }
      }
    }

    // Sort by score
    return interpretations.sort((a, b) => b.score - a.score);
  }

  /**
   * Apply an interpretation to create a new beam.
   */
  function applyInterpretation(
    beam: FlexibleBeam,
    interp: ChunkInterpretation,
    chunkIdx: number
  ): FlexibleBeam {
    const newBeam: FlexibleBeam = {
      ...beam,
      id: beamIdCounter++,
      interpretations: [...beam.interpretations, interp],
      score: beam.score * interp.score,
      chunkIndex: chunkIdx + 1,
      remaining: beam.input.slice(interp.chunk.end).trim(),
      parsedValues: [...beam.parsedValues],
    };

    // Update inferred field/operator based on interpretation
    if (interp.role === "field" && interp.fieldKey && interp.fieldSchema) {
      newBeam.inferredField = { key: interp.fieldKey, schema: interp.fieldSchema };
    }

    if (interp.role === "operator" && interp.operatorId) {
      const overloads = deps.getOverloads(
        interp.fieldKey ?? beam.inferredField?.key ?? "",
        interp.operatorId
      );
      newBeam.inferredOperator = { id: interp.operatorId, overloads };

      // Also infer field from operator if not yet inferred
      if (!newBeam.inferredField && interp.fieldKey) {
        const fieldMatch = deps.fieldTrie.fuzzySearch(interp.fieldKey, 1)[0];
        if (fieldMatch) {
          newBeam.inferredField = {
            key: fieldMatch.value.key,
            schema: fieldMatch.value.schema,
          };
        }
      }
    }

    if (interp.role === "value") {
      // If value came from value trie, it tells us the field
      if (interp.valueTrieEntry && !newBeam.inferredField) {
        const fieldMatch = deps.fieldTrie.fuzzySearch(interp.valueTrieEntry.fieldKey, 1)[0];
        if (fieldMatch) {
          newBeam.inferredField = {
            key: fieldMatch.value.key,
            schema: fieldMatch.value.schema,
          };
        }
      }

      if (interp.parsedValue) {
        newBeam.parsedValues.push(interp.parsedValue);
      }
    }

    return newBeam;
  }

  /**
   * Prune low-scoring beams.
   */
  function pruneBeams(beams: FlexibleBeam[]): FlexibleBeam[] {
    if (beams.length === 0) return beams;

    const bestScore = Math.max(...beams.map((b) => b.score));
    const threshold = Math.max(cfg.pruneThreshold, bestScore * cfg.earlyPruneRatio);

    return beams
      .filter((b) => b.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.maxBeams);
  }

  /**
   * Calculate coherence score for a beam.
   * Higher coherence = interpretations fit together well.
   */
  function calculateCoherence(beam: FlexibleBeam): number {
    let coherence = 1.0;

    const hasField = beam.inferredField !== undefined;
    const hasOperator = beam.inferredOperator !== undefined;
    const hasValue = beam.parsedValues.length > 0 || beam.interpretations.some((i) => i.role === "value");

    // Bonus for having all three components
    if (hasField && hasOperator && hasValue) {
      coherence *= 1.2;
    } else if (hasField && hasValue) {
      // Field + value but no operator - could be implicit equals
      coherence *= 1.0;
    } else if (hasField && hasOperator) {
      // Field + operator but no value - incomplete
      coherence *= 0.8;
    } else if (hasValue && !hasField) {
      // Value but no field - need to infer field
      coherence *= 0.7;
    }

    // Check operator-field compatibility
    if (hasField && hasOperator) {
      const fieldKey = beam.inferredField!.key;
      const overloads = deps.getOverloads(fieldKey, beam.inferredOperator!.id);
      if (overloads.length > 0) {
        coherence *= 1.1; // Compatible
      } else {
        coherence *= 0.5; // Incompatible
      }
    }

    // Penalty for unknown interpretations
    const unknownCount = beam.interpretations.filter((i) => i.role === "unknown").length;
    coherence *= Math.pow(0.7, unknownCount);

    // Clamp to [0, 1]
    return Math.min(1, Math.max(0, coherence));
  }

  /**
   * Finalize beams into suggestions.
   */
  function finalizeBeams(beams: FlexibleBeam[]): FlexibleBeamSuggestion[] {
    const suggestions: FlexibleBeamSuggestion[] = [];

    for (const beam of beams) {
      const coherence = calculateCoherence(beam);
      const remainingLen = beam.remaining.trim().length;
      const completeness = Math.pow(0.95, remainingLen);
      const finalScore = beam.score * coherence * completeness;

      // Build matches from interpretations
      const matches: ParseMatch[] = beam.interpretations
        .filter((i) => i.role !== "unknown")
        .map((i) => ({
          text: i.chunk.text,
          resolvedTo: i.resolvedTo,
          score: i.score,
          indexes: i.indexes,
          role: i.role === "field" ? "field" : i.role === "operator" ? "operator" : "value",
          start: i.chunk.start,
          end: i.chunk.end,
        }));

      // Determine if complete
      const isComplete =
        beam.inferredField !== undefined &&
        beam.inferredOperator !== undefined &&
        (beam.parsedValues.length > 0 || beam.interpretations.some((i) => i.role === "value")) &&
        remainingLen === 0;

      suggestions.push({
        score: finalScore,
        fieldKey: beam.inferredField?.key ?? "",
        operatorId: beam.inferredOperator?.id ?? "",
        overloadIds: beam.inferredOperator?.overloads.map((o) => o.id) ?? [],
        matches,
        parsedValues: beam.parsedValues,
        remaining: beam.remaining,
        isComplete,
        scoreBreakdown: {
          chunking: beam.chunking.plausibility,
          field: beam.inferredField ? 1 : 0.5,
          operator: beam.inferredOperator ? 1 : 0.7,
          valueParse: beam.parsedValues.length > 0 ? 1 : 0.6,
          unitMatch: 1,
          completeness,
          coherence,
          final: finalScore,
        },
        chunking: beam.chunking,
      });
    }

    // Sort by final score and dedupe
    return suggestions
      .sort((a, b) => b.score - a.score)
      .filter((s, i, arr) => {
        // Simple dedupe by fieldKey + operatorId
        return i === arr.findIndex((x) => x.fieldKey === s.fieldKey && x.operatorId === s.operatorId);
      });
  }

  return {
    suggest,
  };
}

/**
 * Type for the flexible beam search engine.
 */
export type FlexibleBeamSearchEngine = ReturnType<typeof createFlexibleBeamSearchEngine>;

/**
 * Format a parsed value for display in resolvedTo.
 */
function formatParsedValueForDisplay(pv: ParsedValue<unknown>): string {
  const value = pv.value;

  // Handle NumberWithUnit type
  if (typeof value === "object" && value !== null && "value" in value) {
    const numVal = value as { value: number; unit?: { id: string }; dimension?: string };
    if (numVal.unit) {
      return `${numVal.value}${numVal.unit.id}`;
    }
    if (numVal.dimension === "percentage") {
      return `${numVal.value}%`;
    }
    return String(numVal.value);
  }

  // Handle primitives
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  // Fallback to raw text
  return pv.rawText;
}
