---
"@jasperhino/fuzzyfilter": patch
"fuzzyfilter-react": patch
"fuzzyfilter-vue": patch
---

Update documentation with correct package names and new API features

- Updated all docs to use `@jasperhino/fuzzyfilter` package name
- Documented new hook/composable features:
  - `suggestionsQuery` - track which query generated current suggestions
  - `filterContext` - for stacked filter counts
  - `selectedSuggestion` - computed selected suggestion
  - `navigateSuggestions` - keyboard navigation with wrap-around
  - `isIndexing`, `indexProgress` - async indexing state
  - `telemetryEvents` - telemetry events when benchmark mode is enabled
  - `addRow`, `deleteRow`, `reindex`, `getData` - data mutation methods
