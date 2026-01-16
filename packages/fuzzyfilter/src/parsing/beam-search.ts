/**
 * Beam Search Engine
 *
 * Multi-stage beam search parser for fuzzy filter queries.
 * Pipeline: INPUT → Chunking → Field Resolution → Operator Resolution → Value Parsing → Scoring
 *
 * @module fuzzyfilter/parsing/beam-search
 */

import type { Match } from "../types/core";
import type { FieldSchema, OperatorOverload } from "../types/field-centric";
import type { Trie } from "../trie";
import type { UnitRegistry } from "../units/types";
import type {
  BeamSearchConfig,
  Chunking,
  ParseBeam,
  ParseMatch,
  ParsedValue,
  ScoreBreakdown,
} from "./types";
import type { ValueParser } from "./value-parser";
import { generateChunkings } from "./chunker";
import { multiplyScores } from "./value-parser";

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: BeamSearchConfig = {
  maxBeams: 20,
  pruneThreshold: 0.1,
  earlyPruneRatio: 0.3,
};

// =============================================================================
// SUGGESTION RESULT
// =============================================================================

/**
 * Final suggestion from beam search.
 */
export interface BeamSuggestion {
  /** Composite score [0,1] */
  score: number;
  /** Resolved field key */
  fieldKey: string;
  /** Resolved operator ID */
  operatorId: string;
  /** Matched overload IDs that could apply */
  overloadIds: string[];
  /** All matches for highlighting/autocompletion */
  matches: ParseMatch[];
  /** Parsed values with units */
  parsedValues: ParsedValue[];
  /** Unparsed remaining text */
  remaining: string;
  /** Whether this is a complete, executable filter */
  isComplete: boolean;
  /** Score breakdown for debugging */
  scoreBreakdown: ScoreBreakdown & { final: number };
}

// =============================================================================
// BEAM SEARCH ENGINE
// =============================================================================

/**
 * Dependencies for the beam search engine.
 */
export interface BeamSearchDependencies {
  /** Trie for fuzzy field name matching */
  fieldTrie: Trie<{ key: string; schema: FieldSchema<unknown> }>;
  /** Trie for fuzzy operator name matching */
  operatorTrie: Trie<{
    fieldKey: string;
    operatorId: string;
    overload: OperatorOverload<unknown, Record<string, unknown>>;
  }>;
  /** Unit registry for unit matching */
  unitRegistry: UnitRegistry;
  /** Value parsers keyed by type */
  valueParsers: Map<string, ValueParser<unknown>>;
  /** Function to get overloads for a field+operator */
  getOverloads: (
    fieldKey: string,
    operatorId: string
  ) => OperatorOverload<unknown, Record<string, unknown>>[];
}

/**
 * Create a beam search engine.
 */
export function createBeamSearchEngine(
  deps: BeamSearchDependencies,
  config: Partial<BeamSearchConfig> = {}
) {
  const cfg: BeamSearchConfig = { ...DEFAULT_CONFIG, ...config };
  let beamIdCounter = 0;

  /**
   * Generate suggestions for a query using beam search.
   */
  function suggest(query: string): BeamSuggestion[] {
    if (!query.trim()) {
      return [];
    }

    // Reset beam ID counter
    beamIdCounter = 0;

    // Phase 1: Generate all plausible chunkings
    const chunkings = generateChunkings(query);

    // Initialize beams from chunkings
    let beams: ParseBeam[] = chunkings.map((chunking) =>
      createInitialBeam(query, chunking)
    );

    // Phase 2: Field resolution
    beams = resolveFields(beams);
    beams = pruneBeams(beams);

    // Phase 3: Operator resolution
    beams = resolveOperators(beams);
    beams = pruneBeams(beams);

    // Phase 4: Value parsing
    beams = parseValues(beams);
    beams = pruneBeams(beams);

    // Phase 5: Finalize and return suggestions
    return finalize(beams);
  }

  /**
   * Create initial beam from a chunking.
   */
  function createInitialBeam(input: string, chunking: Chunking): ParseBeam {
    return {
      id: beamIdCounter++,
      input,
      remaining: input,
      matches: [],
      state: "field",
      score: chunking.plausibility,
      scoreFactors: {
        chunking: chunking.plausibility,
        field: 1,
        operator: 1,
        valueParse: 1,
        unitMatch: 1,
        completeness: 1,
      },
      parsedValues: [],
      chunking,
      chunkIndex: 0,
    };
  }

  /**
   * Phase 2: Resolve fields from chunks.
   */
  function resolveFields(beams: ParseBeam[]): ParseBeam[] {
    const expanded: ParseBeam[] = [];

    for (const beam of beams) {
      const chunking = beam.chunking;
      if (!chunking || chunking.chunks.length === 0) {
        // No chunks - can't resolve field
        expanded.push(beam);
        continue;
      }

      const firstChunk = chunking.chunks[0];

      // Fuzzy search for matching fields
      const fieldMatches = deps.fieldTrie.fuzzySearch(firstChunk.text, 5);

      if (fieldMatches.length === 0) {
        // No field matches - keep beam with penalty
        expanded.push({
          ...beam,
          score: beam.score * 0.5,
          scoreFactors: { ...beam.scoreFactors, field: 0.5 },
        });
        continue;
      }

      // Create a beam for each field match
      for (const fm of fieldMatches) {
        const match: ParseMatch = {
          text: firstChunk.text,
          resolvedTo: fm.value.key,
          score: fm.score,
          indexes: fm.indexes ? Array.from(fm.indexes) : undefined,
          role: "field",
          start: firstChunk.start,
          end: firstChunk.end,
        };

        expanded.push({
          ...beam,
          id: beamIdCounter++,
          field: { key: fm.value.key, schema: fm.value.schema },
          matches: [...beam.matches, match],
          score: beam.score * fm.score,
          scoreFactors: { ...beam.scoreFactors, field: fm.score },
          state: "operator",
          chunkIndex: 1,
          remaining: beam.input.slice(firstChunk.end).trim(),
        });
      }
    }

    return expanded;
  }

  /**
   * Phase 3: Resolve operators from chunks.
   */
  function resolveOperators(beams: ParseBeam[]): ParseBeam[] {
    const expanded: ParseBeam[] = [];

    for (const beam of beams) {
      if (beam.state !== "operator" || !beam.field) {
        expanded.push(beam);
        continue;
      }

      const chunking = beam.chunking;
      if (!chunking || beam.chunkIndex >= chunking.chunks.length) {
        // No more chunks - incomplete but valid
        expanded.push({
          ...beam,
          state: "complete",
        });
        continue;
      }

      const opChunk = chunking.chunks[beam.chunkIndex];

      // Search for operators valid for this field
      const opMatches = deps.operatorTrie.fuzzySearch(opChunk.text, 5);

      // Filter to operators valid for this field
      const validMatches = opMatches.filter(
        (m) => m.value.fieldKey === beam.field!.key
      );

      if (validMatches.length === 0) {
        // No valid operator - check if this chunk might be a value
        // (for implicit operators like equality)
        expanded.push({
          ...beam,
          score: beam.score * 0.7,
          scoreFactors: { ...beam.scoreFactors, operator: 0.7 },
          state: "value",
          // Don't advance chunkIndex - treat this chunk as value
        });
        continue;
      }

      // Group by operatorId to avoid duplicates
      const seenOps = new Set<string>();

      for (const om of validMatches) {
        if (seenOps.has(om.value.operatorId)) continue;
        seenOps.add(om.value.operatorId);

        const overloads = deps.getOverloads(
          beam.field.key,
          om.value.operatorId
        );

        const match: ParseMatch = {
          text: opChunk.text,
          resolvedTo: om.value.operatorId,
          score: om.score,
          indexes: om.indexes ? Array.from(om.indexes) : undefined,
          role: "operator",
          start: opChunk.start,
          end: opChunk.end,
        };

        expanded.push({
          ...beam,
          id: beamIdCounter++,
          operator: { id: om.value.operatorId, overloads },
          matches: [...beam.matches, match],
          score: beam.score * om.score,
          scoreFactors: { ...beam.scoreFactors, operator: om.score },
          state: "value",
          chunkIndex: beam.chunkIndex + 1,
          remaining: beam.input.slice(opChunk.end).trim(),
        });
      }
    }

    return expanded;
  }

  /**
   * Phase 4: Parse values from remaining chunks.
   */
  function parseValues(beams: ParseBeam[]): ParseBeam[] {
    const expanded: ParseBeam[] = [];

    for (const beam of beams) {
      if (beam.state !== "value") {
        expanded.push(beam);
        continue;
      }

      const remaining = beam.remaining.trim();
      if (!remaining) {
        // No value text - mark as complete
        expanded.push({
          ...beam,
          state: "complete",
        });
        continue;
      }

      // Try each value parser
      let foundValues = false;

      for (const [_type, parser] of deps.valueParsers) {
        const parseResults = parser.parse(remaining, deps.unitRegistry, {
          beam,
          field: beam.field?.schema,
          operator: beam.operator?.overloads[0],
        });

        for (const pr of parseResults) {
          foundValues = true;

          const unitScore = pr.unit?.score ?? 1;
          const valueScore = multiplyScores(pr.score, unitScore);

          // Create match for the value
          const valueMatch: ParseMatch = {
            text: pr.rawText,
            resolvedTo: String(pr.value),
            score: pr.score,
            role: "value",
            start: pr.start,
            end: pr.end,
          };

          // Optionally add unit match
          const matches = [...beam.matches, valueMatch];
          if (pr.unit) {
            matches.push({
              text: pr.unit.item.id,
              resolvedTo: pr.unit.item.id,
              score: pr.unit.score,
              indexes: pr.unit.indexes,
              role: "unit",
              start: pr.start, // Approximate
              end: pr.end,
            });
          }

          expanded.push({
            ...beam,
            id: beamIdCounter++,
            parsedValues: [...beam.parsedValues, pr],
            matches,
            score: beam.score * valueScore,
            scoreFactors: {
              ...beam.scoreFactors,
              valueParse: pr.score,
              unitMatch: unitScore,
            },
            state: "complete",
            remaining: remaining.slice(pr.end).trim(),
          });
        }
      }

      // If no parser matched, keep beam with penalty
      if (!foundValues) {
        expanded.push({
          ...beam,
          score: beam.score * 0.6,
          scoreFactors: { ...beam.scoreFactors, valueParse: 0.6 },
          state: "complete",
        });
      }
    }

    return expanded;
  }

  /**
   * Prune beams below threshold.
   */
  function pruneBeams(beams: ParseBeam[]): ParseBeam[] {
    if (beams.length === 0) return beams;

    const bestScore = Math.max(...beams.map((b) => b.score));
    const threshold = Math.max(
      cfg.pruneThreshold,
      bestScore * cfg.earlyPruneRatio
    );

    return beams
      .filter((b) => b.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.maxBeams);
  }

  /**
   * Finalize beams into suggestions.
   */
  function finalize(beams: ParseBeam[]): BeamSuggestion[] {
    return beams.map((beam) => {
      // Apply completeness penalty
      const remainingLen = beam.remaining.trim().length;
      const completeness = Math.pow(0.95, remainingLen);
      const finalScore = beam.score * completeness;

      // Determine if complete - needs field, operator, AND parsed values
      const isComplete =
        beam.state === "complete" &&
        beam.field !== undefined &&
        beam.operator !== undefined &&
        beam.parsedValues.length > 0 &&
        remainingLen === 0;

      return {
        score: finalScore,
        fieldKey: beam.field?.key ?? "",
        operatorId: beam.operator?.id ?? "",
        overloadIds: beam.operator?.overloads.map((o) => o.id) ?? [],
        matches: beam.matches,
        parsedValues: beam.parsedValues,
        remaining: beam.remaining,
        isComplete,
        scoreBreakdown: {
          ...beam.scoreFactors,
          completeness,
          final: finalScore,
        },
      };
    });
  }

  return {
    suggest,
  };
}

/**
 * Type for the beam search engine.
 */
export type BeamSearchEngine = ReturnType<typeof createBeamSearchEngine>;
