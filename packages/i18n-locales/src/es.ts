/**
 * Spanish locale translations for FuzzyFilter
 */
import type { FuzzyFilterTranslations } from "../../fuzzyfilter/src/types/i18n.ts";

export const es: FuzzyFilterTranslations = {
  operators: {
    eq: {
      label: "es igual a",
      aliases: ["igual", "igual a", "es", "=", "==", "==="],
    },
    neq: {
      label: "no es igual a",
      aliases: ["!=", "!==", "<>", "≠", "diferente", "distinto"],
    },
    eqIgnoreCase: {
      label: "es igual a (ignorar mayúsculas)",
      aliases: ["igual ignorar mayúsculas", "igual sin mayúsculas"],
    },
    neqIgnoreCase: {
      label: "no es igual a (ignorar mayúsculas)",
      aliases: ["diferente ignorar mayúsculas"],
    },
    lt: {
      label: "menor que",
      aliases: ["<", "antes", "menor", "inferior"],
    },
    lte: {
      label: "menor o igual que",
      aliases: ["<=", "máximo", "como máximo", "≤"],
    },
    gt: {
      label: "mayor que",
      aliases: [">", "después", "mayor", "superior"],
    },
    gte: {
      label: "mayor o igual que",
      aliases: [">=", "mínimo", "al menos", "≥"],
    },
    in: {
      label: "en",
      aliases: ["uno de", "cualquiera de", "incluye", "∈"],
    },
    nin: {
      label: "no en",
      aliases: ["no uno de", "ninguno de", "excluye", "∉"],
    },
    contains: {
      label: "contiene",
      aliases: ["tiene", "incluye", "como", "~", "⊃"],
    },
    notContains: {
      label: "no contiene",
      aliases: ["no incluye", "excluye", "!~", "⊅"],
    },
    startsWith: {
      label: "comienza con",
      aliases: ["prefijo", "^", "^…", "empieza con"],
    },
    endsWith: {
      label: "termina con",
      aliases: ["sufijo", "$", "…$", "acaba con"],
    },
    isEmpty: {
      label: "está vacío",
      aliases: ["es nulo", "nulo", "∅", "vacío", "falta"],
    },
    isNotEmpty: {
      label: "no está vacío",
      aliases: ["no es nulo", "no nulo", "existe", "presente", "≠∅"],
    },
    isTrue: {
      label: "es verdadero",
      aliases: ["verdadero", "sí", "activado", "activo", "✓"],
    },
    isFalse: {
      label: "es falso",
      aliases: ["falso", "no", "desactivado", "inactivo", "✗"],
    },
    before: {
      label: "antes de",
      aliases: ["anterior", "previo a", "hasta", "←"],
    },
    after: {
      label: "después de",
      aliases: ["posterior", "desde", "a partir de", "→"],
    },
    between: {
      label: "entre",
      aliases: ["rango", "dentro de", "↔"],
    },
  },
  wordSets: {
    less: ["menos", "menor", "inferior", "bajo"],
    greater: ["mayor", "más", "superior", "arriba", "sobre"],
    than: ["que"],
    equal: ["igual", "iguales"],
    or: ["o"],
    not: ["no"],
    from: ["desde", "de"],
    to: ["hasta", "a"],
    between: ["entre"],
    and: ["y"],
    contains: ["contiene", "tiene", "incluye"],
    starts: ["comienza", "empieza"],
    ends: ["termina", "acaba"],
    with: ["con"],
    is: ["es", "está"],
    empty: ["vacío", "vacía", "nulo", "nula", "falta"],
  },
};
