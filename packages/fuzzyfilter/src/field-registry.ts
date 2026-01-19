/**
 * Field Registry
 * 
 * Manages field-centric configuration including fields, operators, overloads,
 * and argument parsers. Provides lookup methods for the suggestion engine
 * and compiler.
 */

import type {
  FieldSchema,
  OperatorOverload,
  ParserRegistry,
  ArgumentParser,
  ArgumentParseResult,
  FieldCentricTranslations,
} from "./types/field-centric.ts";

/**
 * Manages field schemas and provides lookup utilities.
 */
export class FieldRegistry {
  private fields: Map<string, FieldSchema<any>> = new Map();
  private parsers: ParserRegistry = {};
  private translations: FieldCentricTranslations = {};
  private overloadIndex: Map<string, { fieldKey: string; overload: OperatorOverload<any, any> }> = new Map();
  private currentLocale: string = 'en';

  constructor(
    fields: Record<string, FieldSchema<any>>,
    translations: FieldCentricTranslations
  ) {
    this.fields = new Map(Object.entries(fields));
    this.translations = translations;
    this.buildOverloadIndex();
  }

  /**
   * Builds an index of all overloads by their ID for fast lookup.
   */
  private buildOverloadIndex(): void {
    this.overloadIndex.clear();
    for (const [fieldKey, fieldSchema] of this.fields) {
      for (const opConfig of fieldSchema.operators) {
        for (const overload of opConfig.overloads) {
          this.overloadIndex.set(overload.id, { fieldKey, overload });
        }
      }
    }
  }

  /**
   * Sets the current locale for translations.
   */
  setLocale(locale: string): void {
    this.currentLocale = locale;
  }

  /**
   * Gets the current locale.
   */
  getLocale(): string {
    return this.currentLocale;
  }

  /**
   * Gets a field schema by key.
   */
  getField(fieldKey: string): FieldSchema<any> | null {
    return this.fields.get(fieldKey) ?? null;
  }

  /**
   * Gets all field keys.
   */
  getFieldKeys(): string[] {
    return Array.from(this.fields.keys());
  }

  /**
   * Gets all fields as entries.
   */
  getFields(): Array<[string, FieldSchema<any>]> {
    return Array.from(this.fields.entries());
  }

  /**
   * Gets all overloads for a field.
   */
  getOverloadsForField(fieldKey: string): OperatorOverload<any, any>[] {
    const field = this.fields.get(fieldKey);
    if (!field) return [];
    return field.operators.flatMap(op => op.overloads);
  }

  /**
   * Gets all overloads for a specific operator on a field.
   */
  getOverloadsForOperator(fieldKey: string, operatorId: string): OperatorOverload<any, any>[] {
    const field = this.fields.get(fieldKey);
    if (!field) return [];
    const opConfig = field.operators.find(op => op.operatorId === operatorId);
    return opConfig?.overloads ?? [];
  }

  /**
   * Looks up an overload by its full ID.
   */
  getOverloadById(overloadId: string): { fieldKey: string; overload: OperatorOverload<any, any> } | null {
    return this.overloadIndex.get(overloadId) ?? null;
  }

  /**
   * Gets all overloads across all fields, sorted by priority.
   */
  getAllOverloads(): Array<{ fieldKey: string; overload: OperatorOverload<any, any> }> {
    return Array.from(this.overloadIndex.values())
      .sort((a, b) => (b.overload.priority ?? 0) - (a.overload.priority ?? 0));
  }

  /**
   * Gets a parser by type name.
   */
  getParser<T>(typeName: string): ArgumentParser<T> | null {
    return (this.parsers[typeName] as ArgumentParser<T>) ?? null;
  }

  /**
   * Parses arguments from a query string using all registered parsers.
   * Returns all parse results grouped by type.
   */
  parseArguments(query: string): Map<string, ArgumentParseResult<unknown>[]> {
    const results = new Map<string, ArgumentParseResult<unknown>[]>();
    for (const [typeName, parser] of Object.entries(this.parsers)) {
      const parsed = parser.parse(query);
      if (parsed.length > 0) {
        results.set(typeName, parsed);
      }
    }
    return results;
  }

  /**
   * Gets translated aliases for an i18n key.
   * Checks both common translations and locale-specific translations.
   */
  getAliases(i18nKey: string): string[] {
    const aliases: string[] = [];

    // Check common translations
    const commonValue = this.resolveNestedKey(this.translations.common, i18nKey);
    if (Array.isArray(commonValue)) {
      aliases.push(...commonValue);
    }

    // Check locale-specific translations
    const localeTranslations = this.translations[this.currentLocale];
    if (localeTranslations) {
      const localeValue = this.resolveNestedKey(localeTranslations, i18nKey);
      if (Array.isArray(localeValue)) {
        aliases.push(...localeValue);
      }
    }

    return aliases;
  }

  /**
   * Gets the primary label for an i18n key.
   * Prefers locale-specific human-readable labels over symbols.
   */
  getLabel(i18nKey: string): string | null {
    // First try locale-specific translations (prefer human-readable labels)
    const localeTranslations = this.translations[this.currentLocale];
    if (localeTranslations) {
      const localeValue = this.resolveNestedKey(localeTranslations, i18nKey);
      if (Array.isArray(localeValue) && localeValue.length > 0) {
        // Return first locale-specific label (should be human-readable)
        return localeValue[0];
      }
    }

    // Fall back to common translations
    const commonValue = this.resolveNestedKey(this.translations.common, i18nKey);
    if (Array.isArray(commonValue) && commonValue.length > 0) {
      // For common, prefer longer strings (likely human-readable) over single characters (likely symbols)
      const humanReadable = commonValue.find(alias => alias.length > 2);
      return humanReadable ?? commonValue[0];
    }

    return null;
  }

  /**
   * Resolves a nested key path in an object.
   * e.g., "operators.contents.gt.percentage" resolves to translations.operators.contents.gt.percentage
   */
  private resolveNestedKey(obj: any, keyPath: string): unknown {
    if (!obj) return undefined;
    const parts = keyPath.split('.');
    let current = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * Gets all searchable terms for a field (label + aliases).
   */
  getFieldSearchTerms(fieldKey: string): string[] {
    const field = this.fields.get(fieldKey);
    if (!field) return [];

    const terms: string[] = [];

    // Add label from i18n
    const labelAliases = this.getAliases(field.labelKey);
    terms.push(...labelAliases);

    // Add column key itself
    terms.push(fieldKey);

    // Add static aliases
    if (field.aliases) {
      terms.push(...field.aliases);
    }

    // Add translated aliases
    if (field.aliasKeys) {
      for (const aliasKey of field.aliasKeys) {
        terms.push(...this.getAliases(aliasKey));
      }
    }

    return [...new Set(terms)]; // Dedupe
  }

  /**
   * Gets all searchable terms for an overload (operator label + aliases).
   */
  getOverloadSearchTerms(overload: OperatorOverload<any, any>): string[] {
    return this.getAliases(overload.i18nKey);
  }

  /**
   * Resolves value aliases from an i18n key.
   * Returns an object where keys are canonical values and values are searchable aliases.
   * 
   * @example
   * i18nKey: "values.materialType"
   * Returns: {
   *   water: ['water', 'H2O', 'aqua'],
   *   biochar: ['biochar', 'char', 'carbon'],
   * }
   * 
   * @param i18nKey - The i18n key path (e.g., "values.enums.materialType")
   * @returns Object mapping canonical values to their aliases
   */
  resolveValueAliases(i18nKey: string): Record<string, string | string[]> {
    // Try locale-specific first
    const localeTranslations = this.translations[this.currentLocale];
    const localeValues = localeTranslations
      ? (this.resolveNestedKey(localeTranslations, i18nKey) as Record<string, string | string[]> | undefined)
      : undefined;

    // Try common translations
    const commonValues = this.translations.common
      ? (this.resolveNestedKey(this.translations.common, i18nKey) as Record<string, string | string[]> | undefined)
      : undefined;

    // Merge: locale overrides common
    if (localeValues && typeof localeValues === 'object') {
      return { ...commonValues, ...localeValues };
    }
    if (commonValues && typeof commonValues === 'object') {
      return commonValues;
    }

    return {};
  }
}

/**
 * Creates a field registry from config.
 */
export function createFieldRegistry(
  fields: Record<string, FieldSchema<any>>,
  translations: FieldCentricTranslations
): FieldRegistry {
  return new FieldRegistry(fields, translations);
}
