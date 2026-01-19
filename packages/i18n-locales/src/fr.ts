/**
 * French locale translations for FuzzyFilter
 */
import type { FieldCentricTranslations } from "../../fuzzyfilter/src/types/field-centric.ts";

export const fr = {
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
};
