/**
 * Trie Implementation
 * For fast prefix matching of column and operator names.
 */

import fuzzysort from "fuzzysort";
import type { Trie } from "./types/index.ts";

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

  function fuzzySearch(
    query: string,
    limit = 10
  ): Array<{ key: string; value: T; score: number }> {
    if (!query) {
      // Return all entries if no query
      return allEntries.slice(0, limit).map((e) => ({
        key: e.key,
        value: e.value,
        score: 0,
      }));
    }

    const results = fuzzysort.go(query.toLowerCase(), allEntries, {
      key: "prepared",
      limit,
      threshold: -10000,
    });

    return results.map((r) => ({
      key: r.obj.key,
      value: r.obj.value,
      score: r.score,
    }));
  }

  function entries(): Array<{ key: string; value: T }> {
    return allEntries.map((e) => ({ key: e.key, value: e.value }));
  }

  return {
    insert,
    lookup,
    prefixSearch,
    fuzzySearch,
    entries,
    get size() {
      return _size;
    },
  };
}

