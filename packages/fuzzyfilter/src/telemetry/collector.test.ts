/**
 * Tests for the TelemetryCollector
 *
 * @module fuzzyfilter/telemetry/collector.test
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createTelemetryCollector, NULL_TELEMETRY_COLLECTOR } from "./collector.ts";
import type { WideEvent, IndexDataEvent, SuggestEvent } from "./types.ts";

describe("TelemetryCollector", () => {
  describe("createTelemetryCollector", () => {
    it("should create a collector with default config", () => {
      const collector = createTelemetryCollector();
      expect(collector.config.enabled).toBe(true);
      expect(collector.config.maxEvents).toBe(1000);
    });

    it("should allow custom config", () => {
      const collector = createTelemetryCollector({
        maxEvents: 50,
        captureQueryText: false,
      });
      expect(collector.config.maxEvents).toBe(50);
      expect(collector.config.captureQueryText).toBe(false);
    });
  });

  describe("startEvent and finalization", () => {
    it("should create an event with correct operation", () => {
      const collector = createTelemetryCollector();
      const builder = collector.startEvent<IndexDataEvent>("indexData");
      const event = builder.success();

      expect(event.operation).toBe("indexData");
      expect(event.outcome).toBe("success");
      expect(event.duration_ms).toBeGreaterThanOrEqual(0);
      expect(event.event_id).toMatch(/^evt_/);
      expect(event.timestamp).toBeDefined();
    });

    it("should record error outcome", () => {
      const collector = createTelemetryCollector();
      const builder = collector.startEvent<IndexDataEvent>("indexData");
      builder.recordError(new Error("Test error"), "TEST_ERR");
      const event = builder.error();

      expect(event.outcome).toBe("error");
      expect(event.error?.type).toBe("Error");
      expect(event.error?.message).toBe("Test error");
      expect(event.error?.code).toBe("TEST_ERR");
    });

    it("should record cancelled outcome", () => {
      const collector = createTelemetryCollector();
      const builder = collector.startEvent<IndexDataEvent>("indexData");
      const event = builder.cancel();

      expect(event.outcome).toBe("cancelled");
    });

    it("should allow setting fields via set()", () => {
      const collector = createTelemetryCollector();
      const builder = collector.startEvent<IndexDataEvent>("indexData");
      builder.set("indexing", { row_count: 100, is_async: false });
      const event = builder.success();

      expect(event.indexing?.row_count).toBe(100);
      expect(event.indexing?.is_async).toBe(false);
    });

    it("should allow merging fields via merge()", () => {
      const collector = createTelemetryCollector();
      const builder = collector.startEvent<IndexDataEvent>("indexData");
      builder.merge({
        indexing: { row_count: 200, is_async: true },
        result: { columns_indexed: 5, unique_values: 50 },
      });
      const event = builder.success();

      expect(event.indexing?.row_count).toBe(200);
      expect(event.result?.columns_indexed).toBe(5);
    });
  });

  describe("Phase timing", () => {
    it("should track phase timings via startPhase()", async () => {
      const collector = createTelemetryCollector();
      const builder = collector.startEvent<IndexDataEvent>("indexData");

      const endPhase1 = builder.startPhase("phase1_ms");
      await new Promise((r) => setTimeout(r, 5)); // Simulate work
      const duration1 = endPhase1();

      const endPhase2 = builder.startPhase("phase2_ms");
      await new Promise((r) => setTimeout(r, 3)); // Simulate work
      const duration2 = endPhase2();

      const phases = builder.getPhases();

      expect(duration1).toBeGreaterThan(0);
      expect(duration2).toBeGreaterThan(0);
      expect(phases.phase1_ms).toBe(duration1);
      expect(phases.phase2_ms).toBe(duration2);
    });

    it("should track phase timings via recordPhase()", () => {
      const collector = createTelemetryCollector();
      const builder = collector.startEvent<IndexDataEvent>("indexData");

      builder.recordPhase("manual_phase_ms", 42.5);

      const phases = builder.getPhases();
      expect(phases.manual_phase_ms).toBe(42.5);
    });

    it("should return empty phases object when no phases recorded", () => {
      const collector = createTelemetryCollector();
      const builder = collector.startEvent<IndexDataEvent>("indexData");

      const phases = builder.getPhases();
      expect(phases).toEqual({});
    });

    it("should not record phases after event is completed", () => {
      const collector = createTelemetryCollector();
      const builder = collector.startEvent<IndexDataEvent>("indexData");
      builder.success();

      builder.recordPhase("late_phase_ms", 100);
      const phases = builder.getPhases();

      expect(phases.late_phase_ms).toBeUndefined();
    });
  });

  describe("Event collection", () => {
    it("should collect events", () => {
      const collector = createTelemetryCollector();

      collector.startEvent<IndexDataEvent>("indexData").success();
      collector.startEvent<SuggestEvent>("suggest").success();

      expect(collector.getEvents().length).toBe(2);
    });

    it("should evict old events when exceeding maxEvents", () => {
      const collector = createTelemetryCollector({ maxEvents: 3 });

      for (let i = 0; i < 5; i++) {
        collector.startEvent<IndexDataEvent>("indexData").success();
      }

      expect(collector.getEvents().length).toBe(3);
    });

    it("should filter events by operation", () => {
      const collector = createTelemetryCollector();

      collector.startEvent<IndexDataEvent>("indexData").success();
      collector.startEvent<SuggestEvent>("suggest").success();
      collector.startEvent<IndexDataEvent>("indexData").success();

      const indexEvents = collector.getEventsByOperation<IndexDataEvent>("indexData");
      expect(indexEvents.length).toBe(2);
    });

    it("should clear events", () => {
      const collector = createTelemetryCollector();

      collector.startEvent<IndexDataEvent>("indexData").success();
      collector.clear();

      expect(collector.getEvents().length).toBe(0);
    });

    it("should call event listeners", () => {
      const collector = createTelemetryCollector();
      const events: WideEvent[] = [];

      collector.onEvent((e) => events.push(e));
      collector.startEvent<IndexDataEvent>("indexData").success();

      expect(events.length).toBe(1);
      expect(events[0]!.operation).toBe("indexData");
    });

    it("should allow unsubscribing from events", () => {
      const collector = createTelemetryCollector();
      const events: WideEvent[] = [];

      const unsubscribe = collector.onEvent((e) => events.push(e));
      collector.startEvent<IndexDataEvent>("indexData").success();
      unsubscribe();
      collector.startEvent<IndexDataEvent>("indexData").success();

      expect(events.length).toBe(1);
    });
  });

  describe("getSummary", () => {
    it("should calculate basic statistics", () => {
      const collector = createTelemetryCollector();

      collector.startEvent<IndexDataEvent>("indexData").success();
      collector.startEvent<SuggestEvent>("suggest").success();
      collector.startEvent<SuggestEvent>("suggest").error();

      const summary = collector.getSummary();

      expect(summary.totalEvents).toBe(3);
      expect(summary.eventsByOperation.indexData).toBe(1);
      expect(summary.eventsByOperation.suggest).toBe(2);
      expect(summary.eventsByOutcome.success).toBe(2);
      expect(summary.eventsByOutcome.error).toBe(1);
      expect(summary.errorRate).toBeCloseTo(33.33, 1);
    });

    it("should calculate percentiles", async () => {
      const collector = createTelemetryCollector();

      // Create multiple events with different durations
      for (let i = 0; i < 10; i++) {
        const builder = collector.startEvent<IndexDataEvent>("indexData");
        await new Promise((r) => setTimeout(r, i + 1)); // Variable delay
        builder.success();
      }

      const summary = collector.getSummary();

      expect(summary.percentilesByOperation.indexData).toBeDefined();
      expect(summary.percentilesByOperation.indexData!.count).toBe(10);
      expect(summary.percentilesByOperation.indexData!.min).toBeGreaterThan(0);
      expect(summary.percentilesByOperation.indexData!.max).toBeGreaterThan(
        summary.percentilesByOperation.indexData!.min
      );
      expect(summary.percentilesByOperation.indexData!.p50).toBeGreaterThan(0);
      expect(summary.percentilesByOperation.indexData!.p95).toBeGreaterThan(0);
      expect(summary.percentilesByOperation.indexData!.p99).toBeGreaterThan(0);
    });

    it("should calculate average phase timings", () => {
      const collector = createTelemetryCollector();

      // Create events with phase data
      for (let i = 0; i < 3; i++) {
        const builder = collector.startEvent<IndexDataEvent>("indexData");
        builder.recordPhase("value_counting_ms", 10 + i);
        builder.recordPhase("trie_building_ms", 5 + i);
        builder.set("phases", builder.getPhases());
        builder.success();
      }

      const summary = collector.getSummary();

      expect(summary.avgPhasesByOperation.indexData).toBeDefined();
      expect(summary.avgPhasesByOperation.indexData!.value_counting_ms).toBe(11); // avg of 10,11,12
      expect(summary.avgPhasesByOperation.indexData!.trie_building_ms).toBe(6); // avg of 5,6,7
    });

    it("should return empty statistics for no events", () => {
      const collector = createTelemetryCollector();
      const summary = collector.getSummary();

      expect(summary.totalEvents).toBe(0);
      expect(summary.errorRate).toBe(0);
      expect(summary.percentilesByOperation).toEqual({});
      expect(summary.avgPhasesByOperation).toEqual({});
    });
  });

  describe("NULL_TELEMETRY_COLLECTOR", () => {
    it("should have disabled config", () => {
      expect(NULL_TELEMETRY_COLLECTOR.config.enabled).toBe(false);
    });

    it("should return no-op builder", () => {
      const builder = NULL_TELEMETRY_COLLECTOR.startEvent<IndexDataEvent>("indexData");
      const event = builder.success();

      expect(event.operation).toBe("indexData");
      expect(event.duration_ms).toBe(0);
    });

    it("should have no-op phase methods", () => {
      const builder = NULL_TELEMETRY_COLLECTOR.startEvent<IndexDataEvent>("indexData");

      const endPhase = builder.startPhase("test_ms");
      expect(endPhase()).toBe(0);

      builder.recordPhase("manual_ms", 50);
      expect(builder.getPhases()).toEqual({});
    });

    it("should return empty collections", () => {
      expect(NULL_TELEMETRY_COLLECTOR.getEvents()).toEqual([]);
      expect(NULL_TELEMETRY_COLLECTOR.getEventsByOperation("indexData")).toEqual([]);
      expect(NULL_TELEMETRY_COLLECTOR.toJSON()).toEqual([]);
    });

    it("should return empty summary", () => {
      const summary = NULL_TELEMETRY_COLLECTOR.getSummary();

      expect(summary.totalEvents).toBe(0);
      expect(summary.percentilesByOperation).toEqual({});
      expect(summary.avgPhasesByOperation).toEqual({});
    });
  });
});
