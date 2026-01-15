/**
 * Trie Implementation
 * For fast prefix matching of column and operator names.
 */

import fuzzysort from "fuzzysort";

/**
 * Trie interface for prefix and fuzzy searching.
 */
export interface Trie<T> {
  insert(key: string, value: T): void;
  lookup(key: string): T | undefined;
  prefixSearch(prefix: string): Array<{ key: string; value: T }>;
  search(query: string, limit?: number): Array<{ item: T; score: number; indexes?: readonly number[] }>;
  fuzzySearch(
    query: string,
    limit?: number,
    scoreFn?: (result: { score: number; indexes: readonly number[]; target: string; obj: { key: string; value: T } }) => number
  ): Array<{ key: string; value: T; score: number; indexes?: readonly number[] }>;
  entries(): Array<{ key: string; value: T }>;
  clear(): void;
  readonly size: number;
}

interface TrieNode<T> {
  children: Map<string, TrieNode<T>>;
  value?: T;
  key?: string;
}

/**
 * Create a new Trie for fast prefix and fuzzy searching
 */
export function createTrie<T>(): Trie<T> {
  const root: TrieNode<T> = { children: new Map() };
  let _size = 0;

  // Store all entries for fuzzy search
  const allEntries: Array<{ key: string; value: T; prepared: ReturnType<typeof fuzzysort.prepare> }> = [];

  function insert(key: string, value: T): void {
    const normalizedKey = key.toLowerCase();
    let node = root;

    for (const char of normalizedKey) {
      if (!node.children.has(char)) {
        node.children.set(char, { children: new Map() });
      }
      node = node.children.get(char)!;
    }

    if (node.value === undefined) {
      _size++;
    }
    node.value = value;
    node.key = key;

    // Add to entries for fuzzy search
    allEntries.push({
      key,
      value,
      prepared: fuzzysort.prepare(normalizedKey),
    });
  }

  function lookup(key: string): T | undefined {
    const normalizedKey = key.toLowerCase();
    let node = root;

    for (const char of normalizedKey) {
      if (!node.children.has(char)) {
        return undefined;
      }
      node = node.children.get(char)!;
    }

    return node.value;
  }

  function prefixSearch(prefix: string): Array<{ key: string; value: T }> {
    const normalizedPrefix = prefix.toLowerCase();
    let node = root;

    // Navigate to prefix node
    for (const char of normalizedPrefix) {
      if (!node.children.has(char)) {
        return [];
      }
      node = node.children.get(char)!;
    }

    // Collect all values under this node
    const results: Array<{ key: string; value: T }> = [];

    function collect(n: TrieNode<T>) {
      if (n.value !== undefined && n.key !== undefined) {
        results.push({ key: n.key, value: n.value });
      }
      for (const child of n.children.values()) {
        collect(child);
      }
    }

    collect(node);
    return results;
  }

  /**
   * Performs fuzzy search on the trie entries.
   * 
   * @param query - The search query
   * @param limit - Maximum number of results to return
   * @param scoreFn - Optional custom scoring function.
   *                  Receives the fuzzysort result and should return a score (0-1 range, higher is better).
   *                  This can be used to apply additional scoring logic like density penalties.
   * @returns Array of matches with key, value, score (0-1, fuzzysort v3), and match indexes
   */
  function fuzzySearch(
    query: string,
    limit = 10,
    scoreFn?: (result: { score: number; indexes: readonly number[]; target: string; obj: { key: string; value: T } }) => number
  ): Array<{ key: string; value: T; score: number; indexes?: readonly number[] }> {
    if (!query) {
      // Return all entries if no query
      return allEntries.slice(0, limit).map((e) => ({
        key: e.key,
        value: e.value,
        score: 0,
        indexes: undefined,
      }));
    }

    // fuzzysort v3 uses 0-1 scores (1 = perfect, 0.5 = good, 0 = no match)
    // Threshold of 0.1 is lenient to allow fuzzy matches while filtering obvious noise
    // Use key: "prepared" to search on the prepared field
    const results = fuzzysort.go(query.toLowerCase(), allEntries, {
      key: "prepared",
      limit: scoreFn ? undefined : limit, // Get more results if we need to re-score
      threshold: 0.1,
    });

    // Map results and optionally apply custom scoring
    let mappedResults = results.map((r) => ({
      key: r.obj.key,
      value: r.obj.value,
      score: scoreFn 
        ? scoreFn({ score: r.score, indexes: r.indexes, target: r.target, obj: r.obj })
        : r.score,
      indexes: r.indexes,
    }));

    // If using custom scoring, re-sort and limit
    if (scoreFn) {
      mappedResults = mappedResults
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    }

    return mappedResults;
  }

  function entries(): Array<{ key: string; value: T }> {
    return allEntries.map((e) => ({ key: e.key, value: e.value }));
  }

  function clear(): void {
    root.children.clear();
    allEntries.length = 0;
    _size = 0;
  }

  function search(
    query: string,
    limit = 10
  ): Array<{ item: T; score: number; indexes?: readonly number[] }> {
    const results = fuzzySearch(query, limit);
    return results.map(r => ({
      item: r.value,
      score: r.score,
      indexes: r.indexes,
    }));
  }

  return {
    insert,
    lookup,
    prefixSearch,
    search,
    fuzzySearch,
    entries,
    clear,
    get size() {
      return _size;
    },
  };
}

