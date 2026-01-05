/**
 * French locale translations for FuzzyFilter
 */
import type { FuzzyFilterTranslations } from "../../fuzzyfilter/src/types/i18n.ts";

export const de: FuzzyFilterTranslations = {
  operators: {
    eq: {
      label: "gleich zu",
      aliases: ["gleich", "gleich zu", "ist", "=", "==", "==="],
    },
    neq: {
      label: "ungleich zu",
      aliases: ["!=", "!==", "<>", "≠", "ungleich zu"],
    },
    eqIgnoreCase: {
      label: "gleich case-insensitiv",
      aliases: ["gleich case-insensitiv", "gleich case-insensitive"],
    },
    neqIgnoreCase: {
      label: "ungleich case-insensitiv",
      aliases: ["ungleich case-insensitiv", "ungleich case-insensitive"],
    },
    lt: {
      label: "kleiner",
      aliases: ["<", "vor", "weniger", "unter", "kleiner als"],
    },
    lte: {
      label: "kleiner gleich",
      aliases: ["<=", "höchstens", "≤"],
    },
    gt: {
      label: "größer",
      aliases: [">", "nach", "mehr", "über", "größer als"],
    },
    gte: {
      label: "supérieur ou égal à",
      aliases: [">=", "minimum", "au moins", "≥"],
    },
    in: {
      label: "in",
      aliases: ["eins von", "einen von", "einer von", "einige von", "enthält", "∈"],
    },
    nin: {
      label: "nicht in",
      aliases: ["nicht eins von", "nicht einen von", "nicht einer von", "nicht einige von", "enthält nicht", "∉"],
    },
    contains: {
      label: "enthält",
      aliases: ["wie", "~", "⊃"],
    },
    notContains: {
      label: "enthält nicht",
      aliases: ["enthält nicht", "!~", "⊅"],
    },
    startsWith: {
      label: "beginnt mit",
      aliases: ["am Anfang", "^", "^…"],
    },
    endsWith: {
      label: "endet mit",
      aliases: ["am Ende", "$", "…$"],
    },
    isEmpty: {
      label: "ist leer",
      aliases: ["ist null", "null", "∅", "leer", "fehlt"],
    },
    isNotEmpty: {
      label: "ist nicht leer",
      aliases: ["ist nicht null", "nicht null", "existiert", "vorhanden", "≠∅"],
    },
    isTrue: {
      label: "ist wahr",
      aliases: ["wahr", "ja", "aktiviert", "aktiv", "✓"],
    },
    isFalse: {
      label: "ist falsch",
      aliases: ["falsch", "nein", "deaktiviert", "inaktiv", "✗"],
    },
    before: {
      label: "vor",
      aliases: ["vorher", "bis", "←"],
    },
    after: {
      label: "nach",
      aliases: ["nachher", "seit", "ab", "→"],
    },
    between: {
      label: "zwischen",
      aliases: ["von bis", "von bis zu", "↔"],
    },
  },
  wordSets: {
    less: ["weniger", "kleiner", "unter", "niedriger"],
    greater: ["mehr", "größer", "über", "höher"],
    than: ["que"],
    equal: ["gleich", "gleich zu"],
    or: ["oder"],
    not: ["nicht", "kein"],
    from: ["von", "seit"],
    to: ["bis", "bis zu"],
    between: ["zwischen"],
    and: ["und"],
    contains: ["enthält", "hat"],
    starts: ["beginnt", "beginnt mit", "am Anfang", "am"],
    ends: ["endet", "endet mit", "am Ende"],
    with: ["mit"],
    is: ["ist"],
    empty: ["leer", "null", "fehlt"],
  },
};