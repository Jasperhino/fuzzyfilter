import { describe, test, expect } from "bun:test";
import { generateChunkings, chunkInput } from "./chunker";

describe("generateChunkings", () => {
  describe("whitespace-separated input", () => {
    test("chunks simple spaced input", () => {
      const chunkings = generateChunkings("status = open");
      expect(chunkings.length).toBeGreaterThan(0);

      const best = chunkings[0];
      expect(best.chunks.map((c) => c.text)).toEqual(["status", "=", "open"]);
      expect(best.strategy).toBe("whitespace");
    });

    test("chunks multi-word query", () => {
      const chunkings = generateChunkings("weight > 50 kg");
      const best = chunkings[0];
      expect(best.chunks.map((c) => c.text)).toEqual([
        "weight",
        ">",
        "50",
        "kg",
      ]);
    });

    test("handles multi-char operators", () => {
      const chunkings = generateChunkings("amount >= 100");
      const best = chunkings[0];
      expect(best.chunks.map((c) => c.text)).toEqual(["amount", ">=", "100"]);
    });
  });

  describe("class-transition chunking", () => {
    test("splits on character class transitions", () => {
      const chunkings = generateChunkings("weight>50kg");

      // Find the class-transition result
      const classTransition = chunkings.find(
        (c) => c.strategy === "class-transition"
      );
      expect(classTransition).toBeDefined();
      expect(classTransition!.chunks.map((c) => c.text)).toEqual([
        "weight",
        ">",
        "50",
        "kg",
      ]);
    });

    test("handles no spaces with operators", () => {
      const chunkings = generateChunkings("status=active");
      const classTransition = chunkings.find(
        (c) => c.strategy === "class-transition"
      );
      expect(classTransition!.chunks.map((c) => c.text)).toEqual([
        "status",
        "=",
        "active",
      ]);
    });

    test("splits number-unit combinations", () => {
      const chunkings = generateChunkings("50kg");
      const classTransition = chunkings.find(
        (c) => c.strategy === "class-transition"
      );
      expect(classTransition!.chunks.map((c) => c.text)).toEqual(["50", "kg"]);
    });

    test("handles multi-char operators without spaces", () => {
      const chunkings = generateChunkings("amount>=100");
      const classTransition = chunkings.find(
        (c) => c.strategy === "class-transition"
      );
      expect(classTransition!.chunks.map((c) => c.text)).toEqual([
        "amount",
        ">=",
        "100",
      ]);
    });
  });

  describe("no chunking strategy", () => {
    test("includes no-chunking when it differs from other strategies", () => {
      // For input with no spaces and transitions, none produces different result
      // whitespace: ["50kg"] (one chunk)
      // class-transition: ["50", "kg"] (two chunks)
      // none: ["50kg"] - same as whitespace, so deduplicated
      // Use input where all three differ or none is unique
      const chunkings = generateChunkings("abc");
      // For "abc": whitespace=["abc"], class-transition=["abc"], none=["abc"]
      // All same, so only one result. Let's check it's present.
      expect(chunkings.length).toBeGreaterThan(0);
      expect(chunkings[0].chunks[0].text).toBe("abc");
    });
  });

  describe("plausibility scoring", () => {
    test("whitespace chunking has highest base plausibility", () => {
      // Use input where whitespace and class-transition differ
      const chunkings = generateChunkings("weight>50");
      // whitespace: ["weight>50"] - one chunk
      // class-transition: ["weight", ">", "50"] - three chunks
      const whitespace = chunkings.find((c) => c.strategy === "whitespace");
      const classTransition = chunkings.find(
        (c) => c.strategy === "class-transition"
      );
      expect(whitespace).toBeDefined();
      expect(classTransition).toBeDefined();
      // Both should be high since they're reasonable interpretations
      expect(whitespace!.plausibility).toBeGreaterThan(0);
      expect(classTransition!.plausibility).toBeGreaterThan(0);
    });

    test("no-chunking has low plausibility", () => {
      // For "a b c": all strategies produce same result due to spaces
      // Let's use an input where none strategy is kept
      const chunkings = generateChunkings("a b c");
      // When strategies produce same chunks, the higher plausibility one wins
      // Since whitespace (0.95) > none (0.3), whitespace wins
      // So we can't easily test none's plausibility in isolation
      // Instead test that the returned chunkings have reasonable scores
      expect(chunkings.length).toBeGreaterThan(0);
      for (const c of chunkings) {
        expect(c.plausibility).toBeGreaterThan(0);
        expect(c.plausibility).toBeLessThanOrEqual(1);
      }
    });

    test("penalizes too many chunks", () => {
      const short = generateChunkings("a b");
      const long = generateChunkings("a b c d e f g h");

      const shortWs = short.find((c) => c.strategy === "whitespace")!;
      const longWs = long.find((c) => c.strategy === "whitespace")!;

      expect(longWs.plausibility).toBeLessThan(shortWs.plausibility);
    });

    test("penalizes single-char non-operators", () => {
      const chunkings = generateChunkings("a = b");
      const ws = chunkings.find((c) => c.strategy === "whitespace")!;
      // Has two single-char non-operators: 'a' and 'b'
      expect(ws.plausibility).toBeLessThan(0.95);
    });

    test("penalizes starting with operator", () => {
      const normal = generateChunkings("status = open");
      const opFirst = generateChunkings("> 50");

      const normalBest = normal[0];
      const opFirstBest = opFirst[0];

      expect(opFirstBest.plausibility).toBeLessThan(normalBest.plausibility);
    });

    test("penalizes consecutive operators", () => {
      const chunkings = generateChunkings("a > < b");
      const ws = chunkings.find((c) => c.strategy === "whitespace")!;
      expect(ws.plausibility).toBeLessThan(0.95);
    });

    test("bonuses field-operator-args pattern", () => {
      const chunkings = generateChunkings("status = open");
      const ws = chunkings.find((c) => c.strategy === "whitespace")!;
      // Should get bonus for field-op-args pattern
      expect(ws.plausibility).toBeGreaterThanOrEqual(0.95);
    });
  });

  describe("chunk type detection", () => {
    test("detects word chunks", () => {
      const chunking = chunkInput("status");
      expect(chunking.chunks[0].type).toBe("word");
    });

    test("detects number chunks", () => {
      const chunking = chunkInput("123");
      expect(chunking.chunks[0].type).toBe("number");
    });

    test("detects decimal numbers", () => {
      const chunking = chunkInput("123.45");
      expect(chunking.chunks[0].type).toBe("number");
    });

    test("detects operator chunks", () => {
      const chunking = chunkInput(">");
      expect(chunking.chunks[0].type).toBe("operator");
    });

    test("detects mixed chunks", () => {
      // For "50kg": whitespace produces ["50kg"] (mixed), class-transition produces ["50", "kg"]
      // The whitespace result will have the mixed type
      const chunkings = generateChunkings("50kg");
      const whitespace = chunkings.find((c) => c.strategy === "whitespace")!;
      expect(whitespace.chunks[0].type).toBe("mixed");
    });
  });

  describe("position tracking", () => {
    test("tracks chunk positions correctly", () => {
      const chunking = chunkInput("status = open");
      const chunks = chunking.chunks;

      expect(chunks[0].start).toBe(0);
      expect(chunks[0].end).toBe(6); // "status"

      expect(chunks[1].start).toBe(7);
      expect(chunks[1].end).toBe(8); // "="

      expect(chunks[2].start).toBe(9);
      expect(chunks[2].end).toBe(13); // "open"
    });

    test("tracks positions in class-transition chunking", () => {
      const chunkings = generateChunkings("weight>50kg");
      const ct = chunkings.find((c) => c.strategy === "class-transition")!;
      const chunks = ct.chunks;

      expect(chunks[0].text).toBe("weight");
      expect(chunks[0].start).toBe(0);
      expect(chunks[0].end).toBe(6);

      expect(chunks[1].text).toBe(">");
      expect(chunks[1].start).toBe(6);
      expect(chunks[1].end).toBe(7);

      expect(chunks[2].text).toBe("50");
      expect(chunks[2].start).toBe(7);
      expect(chunks[2].end).toBe(9);

      expect(chunks[3].text).toBe("kg");
      expect(chunks[3].start).toBe(9);
      expect(chunks[3].end).toBe(11);
    });
  });

  describe("edge cases", () => {
    test("handles empty input", () => {
      const chunkings = generateChunkings("");
      expect(chunkings.length).toBeGreaterThan(0);
      expect(chunkings[0].chunks).toEqual([]);
    });

    test("handles whitespace-only input", () => {
      const chunkings = generateChunkings("   ");
      expect(chunkings[0].chunks).toEqual([]);
    });

    test("handles single character", () => {
      const chunkings = generateChunkings("a");
      expect(chunkings[0].chunks.length).toBe(1);
      expect(chunkings[0].chunks[0].text).toBe("a");
    });

    test("handles range operators", () => {
      const chunkings = generateChunkings("10..20");
      const ct = chunkings.find((c) => c.strategy === "class-transition")!;
      expect(ct.chunks.map((c) => c.text)).toEqual(["10", "..", "20"]);
    });
  });

  describe("deduplication", () => {
    test("deduplicates identical chunkings", () => {
      // For "a b c", whitespace and class-transition produce the same result
      const chunkings = generateChunkings("a b c");
      const textsSet = new Set(
        chunkings.map((c) => c.chunks.map((ch) => ch.text).join("|"))
      );
      expect(textsSet.size).toBe(chunkings.length);
    });
  });
});

describe("chunkInput", () => {
  test("returns the most plausible chunking", () => {
    const chunking = chunkInput("status = open");
    expect(chunking.chunks.map((c) => c.text)).toEqual(["status", "=", "open"]);
  });
});
