/**
 * English (default) locale translations for FuzzyFilter
 * 
 * The `operators` section provides translatable aliases for each operator.
 * These are referenced in operator definitions using `t(operators.eq)` syntax.
 * Each key can map to an array of alternative phrasings.
 */
import type { FuzzyFilterTranslations } from "../../fuzzyfilter/src/types/i18n.ts";

export const en: FuzzyFilterTranslations = {
  operators: {
    eq: {
      label: "equals",
      aliases: ["equal", "equals", "is"],
    },
    neq: {
      label: "not equals",
      aliases: ["not equals", "not equal", "is not", "isn't", "doesn't equal", "does not equal"],
    },
    eqIgnoreCase: {
      label: "equals (ignore case)",
      aliases: ["equals ignore case", "equal ignore case"],
    },
    neqIgnoreCase: {
      label: "not equals (ignore case)",
      aliases: ["not equals ignore case", "not equal ignore case"],
    },
    lt: {
      label: "less than",
      aliases: ["less than", "smaller than", "lower than"],
    },
    lte: {
      label: "less than or equal",
      aliases: ["less than or equal", "at most", "no more than"],
    },
    gt: {
      label: "greater than",
      aliases: ["greater than", "bigger than", "larger than", "more than"],
    },
    gte: {
      label: "greater than or equal",
      aliases: ["greater than or equal", "at least", "no less than"],
    },
    in: {
      label: "in",
      aliases: ["one of", "any of"],
    },
    nin: {
      label: "not in",
      aliases: ["not in", "not one of", "none of"],
    },
    contains: {
      label: "contains",
      aliases: ["contains", "has", "includes"],
    },
    notContains: {
      label: "does not contain",
      aliases: ["does not contain", "doesn't contain", "not contains"],
    },
    startsWith: {
      label: "starts with",
      aliases: ["starts with", "begins with"],
    },
    endsWith: {
      label: "ends with",
      aliases: ["ends with"],
    },
    isEmpty: {
      label: "is empty",
      aliases: ["is empty", "is blank", "is null", "is missing"],
    },
    isNotEmpty: {
      label: "is not empty",
      aliases: ["is not empty", "is not blank", "has value"],
    },
    isTrue: {
      label: "is true",
      aliases: ["is true", "is yes", "is on", "is enabled", "is active"],
    },
    isFalse: {
      label: "is false",
      aliases: ["is false", "is no", "is off", "is disabled", "is inactive"],
    },
    before: {
      label: "before",
      aliases: ["before", "earlier than", "prior to"],
    },
    after: {
      label: "after",
      aliases: ["after", "later than", "since"],
    },
    between: {
      label: "between",
      aliases: ["between", "in range", "within"],
    },
  },
};
