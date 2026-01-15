import { ArgumentParser, ArgumentParseResult } from "../fuzzyfilter/types";
import chrono from 'chrono-node';
import { Amount, ProcessingType, Timeframe } from "./domain-models";

class DateParser implements ArgumentParser {
  static parse(query: string): ArgumentParseResult<Date>[] {
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

class TimeframeParser implements ArgumentParser<Timeframe> {
  static parse(query: string): ArgumentParseResult<Timeframe>[] {
    return chrono.parse(query, new Date()).filter((r) => r.end).map((r) => ({
      type: 'timeframe',
      value: { start: r.start.date(), end: r.end!.date() },
      index: r.index,
      text: r.text,
    }));
  }
}

class CountParser implements ArgumentParser<number> {
  static parse(query: string): ArgumentParseResult<number>[] {
    return [{
      type: 'count',
      value: parseInt(query),
      index: 0,
      text: query,
    }];
  }
}

class AmountParser implements ArgumentParser<Amount> {
  static parse(query: string): ArgumentParseResult<Amount>[] {
    const regex = /(\d+)\s*(kg|t)/gi;
    const results: ArgumentParseResult<Amount>[] = [];
    let match;
    while ((match = regex.exec(query)) !== null) {
      results.push({
        type: 'amount',
        value: { value: parseInt(match[1]), unit: match[2] },
        index: match.index,
        text: match[0],
      });
    }
    return results;
  }
}