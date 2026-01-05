/**
 * Axiom Exporter Tests
 *
 * Tests the AxiomExporter's attach/detach lifecycle and event forwarding.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { createAxiomExporter } from "./axiom-exporter.ts";
import type { TelemetryCollectorLike, WideEventLike } from "./types.ts";

// Mock the @axiomhq/js module
const mockIngest = mock(() => {});
const mockFlush = mock(() => Promise.resolve());

mock.module("@axiomhq/js", () => ({
  Axiom: class MockAxiom {
    constructor(public config: { token: string; url?: string; onError?: (e: Error) => void }) {}
    ingest = mockIngest;
    flush = mockFlush;
  },
}));

/**
 * Creates a mock telemetry collector for testing.
 */
function createMockCollector(): TelemetryCollectorLike & {
  emit: (event: WideEventLike) => void;
  listeners: Set<(event: WideEventLike) => void>;
} {
  const listeners = new Set<(event: WideEventLike) => void>();

  return {
    listeners,
    onEvent(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    emit(event: WideEventLike) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

/**
 * Creates a sample WideEvent for testing.
 */
function createSampleEvent(overrides?: Partial<WideEventLike>): WideEventLike {
  return {
    event_id: "evt_test123",
    timestamp: new Date().toISOString(),
    operation: "suggest",
    duration_ms: 12.5,
    outcome: "success",
    ...overrides,
  };
}

describe("createAxiomExporter", () => {
  beforeEach(() => {
    mockIngest.mockClear();
    mockFlush.mockClear();
  });

  test("should create an exporter with isAttached=false initially", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });

    expect(exporter.isAttached).toBe(false);
  });

  test("should set isAttached=true after attaching to collector", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });
    const collector = createMockCollector();

    exporter.attach(collector);

    expect(exporter.isAttached).toBe(true);
  });

  test("should set isAttached=false after detaching", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });
    const collector = createMockCollector();

    exporter.attach(collector);
    exporter.detach();

    expect(exporter.isAttached).toBe(false);
  });

  test("should forward events to Axiom ingest", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });
    const collector = createMockCollector();

    exporter.attach(collector);

    const event = createSampleEvent();
    collector.emit(event);

    expect(mockIngest).toHaveBeenCalledTimes(1);
    expect(mockIngest).toHaveBeenCalledWith("test-dataset", [
      expect.objectContaining({
        event_id: event.event_id,
        operation: event.operation,
        duration_ms: event.duration_ms,
      }),
    ]);
  });

  test("should enrich events with serviceName when provided", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
      serviceName: "my-app",
    });
    const collector = createMockCollector();

    exporter.attach(collector);
    collector.emit(createSampleEvent());

    expect(mockIngest).toHaveBeenCalledWith("test-dataset", [
      expect.objectContaining({
        _service: "my-app",
      }),
    ]);
  });

  test("should enrich events with environment when provided", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
      environment: "production",
    });
    const collector = createMockCollector();

    exporter.attach(collector);
    collector.emit(createSampleEvent());

    expect(mockIngest).toHaveBeenCalledWith("test-dataset", [
      expect.objectContaining({
        _environment: "production",
      }),
    ]);
  });

  test("should enrich events with both serviceName and environment", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
      serviceName: "my-app",
      environment: "staging",
    });
    const collector = createMockCollector();

    exporter.attach(collector);
    collector.emit(createSampleEvent());

    expect(mockIngest).toHaveBeenCalledWith("test-dataset", [
      expect.objectContaining({
        _service: "my-app",
        _environment: "staging",
      }),
    ]);
  });

  test("should not forward events after detaching", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });
    const collector = createMockCollector();

    exporter.attach(collector);
    exporter.detach();

    collector.emit(createSampleEvent());

    expect(mockIngest).not.toHaveBeenCalled();
  });

  test("should call Axiom flush when flush() is called", async () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });

    await exporter.flush();

    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  test("should replace previous subscription when attaching twice", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });
    const collector1 = createMockCollector();
    const collector2 = createMockCollector();

    exporter.attach(collector1);
    exporter.attach(collector2);

    // Emit from first collector should not trigger ingest (unsubscribed)
    collector1.emit(createSampleEvent({ event_id: "from-collector-1" }));

    // Emit from second collector should trigger ingest
    collector2.emit(createSampleEvent({ event_id: "from-collector-2" }));

    // Only the second event should have been ingested
    expect(mockIngest).toHaveBeenCalledTimes(1);
    expect(mockIngest).toHaveBeenCalledWith("test-dataset", [
      expect.objectContaining({
        event_id: "from-collector-2",
      }),
    ]);
  });

  test("should handle multiple events", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });
    const collector = createMockCollector();

    exporter.attach(collector);

    collector.emit(createSampleEvent({ operation: "suggest" }));
    collector.emit(createSampleEvent({ operation: "indexData" }));
    collector.emit(createSampleEvent({ operation: "compile" }));

    expect(mockIngest).toHaveBeenCalledTimes(3);
  });

  test("should use custom API URL when provided", () => {
    // This test verifies the config is passed correctly
    // The actual URL usage is internal to the Axiom client
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
      apiUrl: "https://api.eu.axiom.co",
    });

    expect(exporter).toBeDefined();
    expect(exporter.isAttached).toBe(false);
  });

  test("should use default error handler when onError not provided", () => {
    // Just verify it doesn't throw
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });

    expect(exporter).toBeDefined();
  });

  test("should accept custom onError handler", () => {
    const customErrorHandler = mock(() => {});

    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
      onError: customErrorHandler,
    });

    expect(exporter).toBeDefined();
  });
});

describe("TelemetryCollector integration", () => {
  beforeEach(() => {
    mockIngest.mockClear();
    mockFlush.mockClear();
  });

  test("should work with events containing nested objects", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });
    const collector = createMockCollector();

    exporter.attach(collector);

    const event: WideEventLike = {
      event_id: "evt_nested",
      timestamp: new Date().toISOString(),
      operation: "suggest",
      duration_ms: 15.2,
      outcome: "success",
      query: {
        text: "status eq open",
        length: 14,
        token_count: 3,
      },
      result: {
        suggestion_count: 5,
        top_score: 0.95,
      },
    };

    collector.emit(event);

    expect(mockIngest).toHaveBeenCalledWith("test-dataset", [
      expect.objectContaining({
        event_id: "evt_nested",
        query: expect.objectContaining({
          text: "status eq open",
          token_count: 3,
        }),
        result: expect.objectContaining({
          suggestion_count: 5,
        }),
      }),
    ]);
  });

  test("should preserve all event fields when forwarding", () => {
    const exporter = createAxiomExporter({
      apiToken: "test-token",
      dataset: "test-dataset",
    });
    const collector = createMockCollector();

    exporter.attach(collector);

    const event: WideEventLike = {
      event_id: "evt_full",
      timestamp: "2026-01-05T16:00:00.000Z",
      operation: "indexData",
      duration_ms: 123.45,
      outcome: "success",
      custom_field: "custom_value",
      numeric_field: 42,
      array_field: [1, 2, 3],
    };

    collector.emit(event);

    expect(mockIngest).toHaveBeenCalledWith("test-dataset", [
      expect.objectContaining({
        event_id: "evt_full",
        timestamp: "2026-01-05T16:00:00.000Z",
        operation: "indexData",
        duration_ms: 123.45,
        outcome: "success",
        custom_field: "custom_value",
        numeric_field: 42,
        array_field: [1, 2, 3],
      }),
    ]);
  });
});
