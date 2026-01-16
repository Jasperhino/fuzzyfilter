import * as chrono from 'chrono-node';
import type { Amount, Percentage, Timeframe } from "./domain-models";

// Local type definitions for argument parsing (not yet part of the core package)
export interface ArgumentParseResult<T> {
  type: string;
  value: T;
  index: number;
  text: string;
}

export interface ArgumentParser<T> {
  parse(query: string): ArgumentParseResult<T>[];
}

export class DateParser implements ArgumentParser<Date> {
  parse(query: string): ArgumentParseResult<Date>[] {
    return chrono
      .parse(query, new Date())
      .filter((r) => !r.end) // single dates only
      .map((r) => ({
        type: 'date',
        value: r.start.date(),
        index: r.index,
        text: r.text,
      }));
  }
}

export class TimeframeParser implements ArgumentParser<Timeframe> {
  parse(query: string): ArgumentParseResult<Timeframe>[] {
    return chrono.parse(query, new Date()).filter((r) => r.end).map((r) => ({
      type: 'timeframe',
      value: { start: r.start.date(), end: r.end!.date() },
      index: r.index,
      text: r.text,
    }));
  }
}

export class CountParser implements ArgumentParser<number> {
  parse(query: string): ArgumentParseResult<number>[] {
    return [{
      type: 'count',
      value: parseInt(query),
      index: 0,
      text: query,
    }];
  }
}

export class AmountParser implements ArgumentParser<Amount> {
  parse(query: string): ArgumentParseResult<Amount>[] {
    const regex = /(\d+)\s*(kg|t)/gi;
    const results: ArgumentParseResult<Amount>[] = [];
    let match;
    while ((match = regex.exec(query)) !== null) {
      results.push({
        type: 'amount',
        value: { value: parseInt(match[1]!), unit: match[2]!.toLowerCase() as 'kg' | 't' },
        index: match.index,
        text: match[0],
      });
    }
    return results;
  }
}

export class PercentageParser implements ArgumentParser<Percentage> {
  parse(query: string): ArgumentParseResult<Percentage>[] {
    // A percentage is a number between 0 and 100 with a % sign or the word "percent" or a number between 0 and 1
    const regex = /(\d+)\s*(%|percent)/gi;
    const results: ArgumentParseResult<Percentage>[] = [];
    let match;
    while ((match = regex.exec(query)) !== null) {
      results.push({
        type: 'percentage',
        value: parseInt(match[1]!),
        index: match.index,
        text: match[0],
      });
    }
    return results;
  }
}
