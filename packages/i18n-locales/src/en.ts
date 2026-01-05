/**
 * English (default) locale translations for FuzzyFilter
 */
import type { FuzzyFilterTranslations } from "../../fuzzyfilter/src/types/i18n.ts";

export const en: FuzzyFilterTranslations = {
  operators: {
    eq: {
      label: "equals",
      aliases: ["equal", "equals", "is", "=", "==", "==="],
    },
    neq: {
      label: "not equals",
      aliases: ["!=", "!==", "<>", "≠"],
    },
    eqIgnoreCase: {
      label: "equals (ignore case)",
      aliases: ["equalsIgnoreCase", "eqic", "equals ignore case", "~=", "≈"],
    },
    neqIgnoreCase: {
      label: "not equals (ignore case)",
      aliases: ["notEqualsIgnoreCase", "neqic", "not equals ignore case", "≉"],
    },
    lt: {
      label: "less than",
      aliases: ["<", "before", "under"],
    },
    lte: {
      label: "less than or equal",
      aliases: ["<=", "max", "at most", "≤"],
    },
    gt: {
      label: "greater than",
      aliases: [">", "after"],
    },
    gte: {
      label: "greater than or equal",
      aliases: [">=", "min", "at least", "≥"],
    },
    in: {
      label: "in",
      aliases: ["oneOf", "one of", "any of", "anyOf", "includes", "∈"],
    },
    nin: {
      label: "not in",
      aliases: ["notIn", "not one of", "none of", "noneOf", "excludes", "∉"],
    },
    contains: {
      label: "contains",
      aliases: ["has", "includes", "like", "~", "⊃"],
    },
    notContains: {
      label: "does not contain",
      aliases: ["doesNotContain", "notIncludes", "excludes", "!~", "⊅"],
    },
    startsWith: {
      label: "starts with",
      aliases: ["prefix", "^", "^…"],
    },
    endsWith: {
      label: "ends with",
      aliases: ["suffix", "$", "…$"],
    },
    isEmpty: {
      label: "is empty",
      aliases: ["isNull", "null", "∅", "hasValue"],
    },
    isNotEmpty: {
      label: "is not empty",
      aliases: ["isNotNull", "notNull", "exists", "present", "≠∅"],
    },
    isTrue: {
      label: "is true",
      aliases: ["true", "yes", "on", "enabled", "active", "✓"],
    },
    isFalse: {
      label: "is false",
      aliases: ["false", "no", "off", "disabled", "inactive", "✗"],
    },
    before: {
      label: "before",
      aliases: ["earlier", "prior to", "priorTo", "earlier than", "preceding", "until", "up to", "←"],
    },
    after: {
      label: "after",
      aliases: ["later", "since", "later than", "following", "from", "starting", "→"],
    },
    between: {
      label: "between",
      aliases: ["range", "within", "↔"],
    },
  },
  wordSets: {
    less: ["less", "smaller", "lower", "under"],
    greater: ["greater", "bigger", "larger", "more", "over", "above"],
    than: ["than"],
    equal: ["equal", "equals", "eq"],
    or: ["or"],
    not: ["not"],
    from: ["from"],
    to: ["to", "till", "until"],
    between: ["between"],
    and: ["and"],
    contains: ["contains", "has", "includes"],
    starts: ["starts", "begins"],
    ends: ["ends"],
    with: ["with"],
    is: ["is"],
    empty: ["empty", "blank", "null", "missing"],
  },
};
