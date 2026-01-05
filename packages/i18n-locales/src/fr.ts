/**
 * French locale translations for FuzzyFilter
 */
import type { FuzzyFilterTranslations } from "../../fuzzyfilter/src/types/i18n.ts";

export const fr: FuzzyFilterTranslations = {
  operators: {
    eq: {
      label: "égal à",
      aliases: ["égal", "égale", "est", "=", "==", "==="],
    },
    neq: {
      label: "différent de",
      aliases: ["!=", "!==", "<>", "≠", "pas égal"],
    },
    eqIgnoreCase: {
      label: "égal à (ignorer la casse)",
      aliases: ["égal ignorer casse", "égal sans casse"],
    },
    neqIgnoreCase: {
      label: "différent de (ignorer la casse)",
      aliases: ["différent ignorer casse"],
    },
    lt: {
      label: "inférieur à",
      aliases: ["<", "avant", "moins", "sous"],
    },
    lte: {
      label: "inférieur ou égal à",
      aliases: ["<=", "maximum", "au plus", "≤"],
    },
    gt: {
      label: "supérieur à",
      aliases: [">", "après", "plus", "au-dessus"],
    },
    gte: {
      label: "supérieur ou égal à",
      aliases: [">=", "minimum", "au moins", "≥"],
    },
    in: {
      label: "dans",
      aliases: ["un de", "l'un de", "inclut", "∈"],
    },
    nin: {
      label: "pas dans",
      aliases: ["pas un de", "aucun de", "exclut", "∉"],
    },
    contains: {
      label: "contient",
      aliases: ["a", "inclut", "comme", "~", "⊃"],
    },
    notContains: {
      label: "ne contient pas",
      aliases: ["n'inclut pas", "exclut", "!~", "⊅"],
    },
    startsWith: {
      label: "commence par",
      aliases: ["préfixe", "^", "^…"],
    },
    endsWith: {
      label: "se termine par",
      aliases: ["suffixe", "$", "…$"],
    },
    isEmpty: {
      label: "est vide",
      aliases: ["est nul", "nul", "∅", "vide", "manquant"],
    },
    isNotEmpty: {
      label: "n'est pas vide",
      aliases: ["n'est pas nul", "non nul", "existe", "présent", "≠∅"],
    },
    isTrue: {
      label: "est vrai",
      aliases: ["vrai", "oui", "activé", "actif", "✓"],
    },
    isFalse: {
      label: "est faux",
      aliases: ["faux", "non", "désactivé", "inactif", "✗"],
    },
    before: {
      label: "avant",
      aliases: ["précédent", "jusqu'à", "←"],
    },
    after: {
      label: "après",
      aliases: ["postérieur", "depuis", "à partir de", "→"],
    },
    between: {
      label: "entre",
      aliases: ["plage", "dans", "↔"],
    },
  },
  wordSets: {
    less: ["moins", "inférieur", "sous", "bas"],
    greater: ["plus", "supérieur", "au-dessus", "sur"],
    than: ["que"],
    equal: ["égal", "égale"],
    or: ["ou"],
    not: ["pas", "non"],
    from: ["de", "depuis"],
    to: ["à", "jusqu'à"],
    between: ["entre"],
    and: ["et"],
    contains: ["contient", "a", "inclut"],
    starts: ["commence", "début"],
    ends: ["termine", "finit"],
    with: ["avec"],
    is: ["est"],
    empty: ["vide", "nul", "nulle", "manquant"],
  },
};
