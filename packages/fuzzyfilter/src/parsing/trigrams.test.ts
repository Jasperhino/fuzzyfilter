import { describe, test, expect } from "bun:test";
import {
  padText,
  extractTrigrams,
  buildTrigramBag,
  trigramSimilarity,
  trigramSimilarityString,
  createTrigramScorer,
  prepareCandidate,
  batchMatch,
} from "./trigrams";

describe("padText", () => {
  test("adds ΔΔ at start and Ξ at end", () => {
    expect(padText("hello")).toBe("ΔΔhelloΞ");
  });

  test("converts to lowercase", () => {
    expect(padText("HELLO")).toBe("ΔΔhelloΞ");
  });

  test("replaces spaces with ΞΔΔ", () => {
    expect(padText("Alice King")).toBe("ΔΔaliceΞΔΔkingΞ");
  });

  test("handles multiple spaces", () => {
    expect(padText("hello   world")).toBe("ΔΔhelloΞΔΔworldΞ");
  });

  test("handles empty string", () => {
    expect(padText("")).toBe("ΔΔΞ");
  });

  test("trims whitespace", () => {
    expect(padText("  hello  ")).toBe("ΔΔhelloΞ");
  });
});

describe("extractTrigrams", () => {
  test("extracts trigrams from padded text", () => {
    const trigrams = extractTrigrams("ΔΔhelloΞ");
    expect(trigrams.size).toBeGreaterThan(0);
    expect(trigrams.has("hel")).toBe(true);
    expect(trigrams.has("ell")).toBe(true);
    expect(trigrams.has("llo")).toBe(true);
    expect(trigrams.has("loΞ")).toBe(true);
  });

  test("discards trigrams ending with Δ", () => {
    // In "ΔΔaliceΞΔΔkingΞ", trigrams ending with Δ are discarded
    const trigrams = extractTrigrams("ΔΔaliceΞΔΔkingΞ");
    // "eΞΔ" ends with Δ, should be discarded
    expect(trigrams.has("eΞΔ")).toBe(false);
    // "ΞΔΔ" ends with Δ, should be discarded
    expect(trigrams.has("ΞΔΔ")).toBe(false);
    // "ΔΔk" ends with k, should be kept
    expect(trigrams.has("ΔΔk")).toBe(true);
  });

  test("counts repeated trigrams", () => {
    // "banana" has repeated trigrams
    const trigrams = extractTrigrams("ΔΔbananaΞ");
    expect(trigrams.get("ana")).toBe(2); // appears twice
    expect(trigrams.get("nan")).toBe(1);
  });

  test("handles short strings", () => {
    const trigrams = extractTrigrams("ΔΔabΞ");
    expect(trigrams.size).toBeGreaterThan(0);
    expect(trigrams.has("abΞ")).toBe(true);
  });
});

describe("buildTrigramBag", () => {
  test("builds bag with trigrams and total count", () => {
    const bag = buildTrigramBag("hello");
    expect(bag.trigrams.size).toBeGreaterThan(0);
    expect(bag.totalCount).toBeGreaterThan(0);
    expect(bag.padded).toBe("ΔΔhelloΞ");
  });

  test("handles multi-word text", () => {
    const bag = buildTrigramBag("Alice King");
    expect(bag.padded).toBe("ΔΔaliceΞΔΔkingΞ");
    // Count should be total trigrams minus those ending with Δ
    expect(bag.totalCount).toBeGreaterThan(0);
  });
});

describe("trigramSimilarity", () => {
  test("returns 1 for identical bags", () => {
    const bag1 = buildTrigramBag("hello");
    const bag2 = buildTrigramBag("hello");
    expect(trigramSimilarity(bag1, bag2)).toBe(1);
  });

  test("returns 0 for completely different bags", () => {
    const bag1 = buildTrigramBag("abc");
    const bag2 = buildTrigramBag("xyz");
    expect(trigramSimilarity(bag1, bag2)).toBe(0);
  });

  test("returns score between 0 and 1 for partial matches", () => {
    const bag1 = buildTrigramBag("hello");
    const bag2 = buildTrigramBag("helo"); // missing 'l'
    const score = trigramSimilarity(bag1, bag2);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  test("handles empty bags", () => {
    const empty = buildTrigramBag("");
    const nonEmpty = buildTrigramBag("hello");
    // Empty produces "ΔΔΞ" trigram which won't match real content
    expect(trigramSimilarity(empty, nonEmpty)).toBe(0);
    expect(trigramSimilarity(nonEmpty, empty)).toBe(0);
    // Two empty bags match each other (same boundary trigram)
    expect(trigramSimilarity(empty, empty)).toBe(1);
  });

  test("is symmetric", () => {
    const bag1 = buildTrigramBag("kilogram");
    const bag2 = buildTrigramBag("kilgoram"); // transposition
    expect(trigramSimilarity(bag1, bag2)).toBe(trigramSimilarity(bag2, bag1));
  });
});

describe("trigramSimilarityString", () => {
  test("calculates similarity between strings", () => {
    expect(trigramSimilarityString("hello", "hello")).toBe(1);
    expect(trigramSimilarityString("hello", "helo")).toBeGreaterThan(0.5);
    expect(trigramSimilarityString("abc", "xyz")).toBe(0);
  });

  test("handles transposition typos", () => {
    // "kilgoram" is "kilogram" with 'o' and 'g' transposed
    const score = trigramSimilarityString("kilogram", "kilgoram");
    // Trigrams should still have significant overlap (>= 0.5)
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  test("handles missing characters", () => {
    const score = trigramSimilarityString("kilogram", "kilgram"); // missing 'o'
    expect(score).toBeGreaterThan(0.6);
  });

  test("handles extra characters", () => {
    const score = trigramSimilarityString("kilogram", "killogram"); // extra 'l'
    expect(score).toBeGreaterThan(0.6);
  });

  test("prefix matching is forgiving", () => {
    // "kilo" is a prefix of "kilogram"
    const score = trigramSimilarityString("kilogram", "kilo");
    // Should have decent score since all kilo's trigrams match
    expect(score).toBeGreaterThan(0.3);
  });
});

describe("createTrigramScorer", () => {
  test("creates scorer function", () => {
    const scorer = createTrigramScorer("hello");
    expect(typeof scorer).toBe("function");
  });

  test("blends fuzzysort and trigram scores", () => {
    const scorer = createTrigramScorer("hello", 0.5);

    // Mock fuzzysort result
    const result = {
      score: 0.8,
      indexes: [0, 1, 2, 3, 4] as const,
      target: "hello",
      obj: {},
    };

    const score = scorer(result);
    // Should be blend of 0.8 (fuzzysort) and 1.0 (trigram for identical)
    // 0.8 * 0.5 + 1.0 * 0.5 = 0.9
    expect(score).toBeCloseTo(0.9, 2);
  });

  test("helps with transposition typos", () => {
    const scorer = createTrigramScorer("kilgoram", 0.4);

    // Fuzzysort might give low score for transposition
    const result = {
      score: 0.3, // Low fuzzysort score
      indexes: [0, 1, 2, 3, 5, 6, 7] as const,
      target: "kilogram",
      obj: {},
    };

    const blendedScore = scorer(result);
    // Trigram score should be higher, pulling up the blend
    expect(blendedScore).toBeGreaterThan(0.3);
  });
});

describe("prepareCandidate", () => {
  test("prepares candidate with pre-computed bag", () => {
    const prepared = prepareCandidate({ id: 1 }, "hello");
    expect(prepared.value).toEqual({ id: 1 });
    expect(prepared.text).toBe("hello");
    expect(prepared.bag.trigrams.size).toBeGreaterThan(0);
  });
});

describe("batchMatch", () => {
  test("matches query against multiple candidates", () => {
    const candidates = [
      prepareCandidate({ name: "kilogram" }, "kilogram"),
      prepareCandidate({ name: "gram" }, "gram"),
      prepareCandidate({ name: "meter" }, "meter"),
    ];

    const results = batchMatch("kilo", candidates);
    expect(results.length).toBeGreaterThan(0);
    // kilogram should be first
    expect(results[0].candidate.value.name).toBe("kilogram");
  });

  test("respects minScore filter", () => {
    const candidates = [
      prepareCandidate({ name: "abc" }, "abc"),
      prepareCandidate({ name: "xyz" }, "xyz"),
    ];

    const results = batchMatch("abc", candidates, 0.5);
    // Only abc should match with score > 0.5
    expect(results.length).toBe(1);
    expect(results[0].candidate.value.name).toBe("abc");
  });

  test("sorts by score descending", () => {
    const candidates = [
      prepareCandidate({ name: "hello" }, "hello"),
      prepareCandidate({ name: "helo" }, "helo"),
      prepareCandidate({ name: "helloworld" }, "helloworld"),
    ];

    const results = batchMatch("hello", candidates);
    // Scores should be descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

describe("real-world scenarios", () => {
  test("handles unit name typos", () => {
    const candidates = [
      prepareCandidate("kg", "kilogram"),
      prepareCandidate("g", "gram"),
      prepareCandidate("t", "tonne"),
      prepareCandidate("lb", "pound"),
    ];

    // "kilogarm" - transposed 'a' and 'r'
    const results1 = batchMatch("kilogarm", candidates);
    expect(results1[0].candidate.value).toBe("kg");

    // "kilgoram" - transposed 'o' and 'g'
    const results2 = batchMatch("kilgoram", candidates);
    expect(results2[0].candidate.value).toBe("kg");
  });

  test("handles field name typos", () => {
    const candidates = [
      prepareCandidate("weight", "weight"),
      prepareCandidate("height", "height"),
      prepareCandidate("status", "status"),
    ];

    // "wieght" - common typo
    const results = batchMatch("wieght", candidates);
    // Both weight and height might match, but weight should be first
    expect(results[0].candidate.value).toBe("weight");
  });
});
