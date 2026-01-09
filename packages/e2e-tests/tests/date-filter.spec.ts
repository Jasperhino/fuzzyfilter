import { test, expect } from "@playwright/test";

/**
 * Test configuration for each framework's example app
 */
const apps = [
  { name: "React", url: "http://localhost:5173" },
  { name: "Vue", url: "http://localhost:5174" },
];

/**
 * Helper to parse the result count from text (just the number, e.g., "10,000")
 */
function parseResultCount(text: string): number {
  // The UI shows just the number with locale formatting (e.g., "10,000")
  const match = text.match(/^([\d,]+)$/);
  if (!match) throw new Error(`Could not parse result count from: ${text}`);
  return parseInt(match[1].replace(/,/g, ""), 10);
}

/**
 * Helper to parse the task count from filter summary "X/10,000 items" or "N filters applied, X/10,000 items"
 */
function parseTaskCount(text: string): number {
  // Match "X/10,000" format (with optional text before like "N filters applied, ")
  const match = text.match(/([\d,]+)\s*\/\s*[\d,]+/);
  if (!match) throw new Error(`Could not parse task count from: ${text}`);
  return parseInt(match[1].replace(/,/g, ""), 10);
}

/**
 * Test date filtering - specifically the "created today" bug
 * 
 * Bug description:
 * 1. When typing "created today", the complete date suggestion (<Created At> <is> <Today's Date>)
 *    should rank HIGHER than incomplete suggestions without a value (e.g., <Created At> <is>)
 * 2. The result count shown in the suggestion preview should match the actual filtered count
 *    when the filter is applied
 */
for (const { name, url } of apps) {
  test.describe(`${name} Date Filtering`, () => {
    test("'created today' shows complete date filter ranked first", async ({ page }) => {
      // Navigate to the app
      await page.goto(url);
      
      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000); // Extra wait for data indexing
      
      // Get the filter input
      const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");
      
      // =========================================================
      // STEP 1: Type "created today" to search for date filter
      // =========================================================
      await filterInput.click();
      await filterInput.fill("created today");
      
      // Wait for suggestions to appear
      await page.waitForTimeout(500);
      
      // =========================================================
      // STEP 2: Verify the first suggestion is a COMPLETE date filter
      // =========================================================
      
      // The first suggestion should be the complete "Created At = [Today's Date]" filter
      // NOT an incomplete filter like "Created At =" without a value
      const firstSuggestion = page.locator('[data-testid^="suggestion-"]').first();
      await expect(firstSuggestion).toBeVisible({ timeout: 5000 });
      
      // Get the suggestion text - it should include a date value (not just end with "=")
      const suggestionText = await firstSuggestion.textContent();
      console.log(`${name}: First suggestion: "${suggestionText}"`);
      
      // The first suggestion should have an argument (date value) - look for "Dec" or similar
      // A complete suggestion will have more text after the operator
      const hasDateValue = suggestionText && (
        suggestionText.includes("Dec") || 
        suggestionText.includes("Jan") || 
        suggestionText.includes("Feb") ||
        suggestionText.includes("Mar") ||
        suggestionText.includes("Apr") ||
        suggestionText.includes("May") ||
        suggestionText.includes("Jun") ||
        suggestionText.includes("Jul") ||
        suggestionText.includes("Aug") ||
        suggestionText.includes("Sep") ||
        suggestionText.includes("Oct") ||
        suggestionText.includes("Nov") ||
        suggestionText.includes("Today")
      );
      
      expect(hasDateValue).toBe(true);
      
      // =========================================================
      // STEP 3: Get the preview result count
      // =========================================================
      const resultCountElement = firstSuggestion.getByTestId("result-count");
      const resultCountText = await resultCountElement.textContent();
      const previewCount = parseResultCount(resultCountText || "");
      
      console.log(`${name}: Preview shows ${previewCount} results`);
      
      // =========================================================
      // STEP 4: Click the suggestion to apply the filter
      // =========================================================
      await firstSuggestion.click();
      await page.waitForTimeout(500);
      
      // =========================================================
      // STEP 5: Verify the actual filtered count matches the preview
      // =========================================================
      
      // Get the actual task count from header "(X of 10,000)"
      const filterSummary = page.getByTestId("filter-summary");
      const headerText = await filterSummary.textContent();
      const actualCount = parseTaskCount(headerText || "");
      
      console.log(`${name}: Actual filtered count: ${actualCount}`);
      
      // CRITICAL: The preview count should match the actual count
      // This was the bug: preview showed 2 but actual was 0
      expect(actualCount).toBe(previewCount);
    });

    test("complete date filter suggestions rank higher than incomplete ones", async ({ page }) => {
      // Navigate to the app
      await page.goto(url);
      
      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);
      
      // Get the filter input
      const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");
      
      await filterInput.click();
      await filterInput.fill("created today");
      
      // Wait for suggestions to appear
      await page.waitForTimeout(500);
      
      // Get all suggestions
      const allSuggestions = page.locator('[data-testid^="suggestion-"]');
      const count = await allSuggestions.count();
      
      // Collect scores and check order
      const suggestionsData: Array<{ text: string; score: number; hasValue: boolean }> = [];
      
      for (let i = 0; i < Math.min(count, 5); i++) {
        const suggestion = allSuggestions.nth(i);
        const text = await suggestion.textContent();
        
        // Extract score from the score badge (class contains font-mono and tabular-nums)
        const scoreElement = suggestion.locator('.font-mono.tabular-nums').first();
        const scoreText = await scoreElement.textContent();
        const score = parseInt(scoreText || "0", 10);
        
        // Check if suggestion has a value (date in the text)
        const hasValue = text ? (
          text.includes("Dec") || 
          text.includes("Today") ||
          /\d{1,2},\s*\d{4}/.test(text) // Date pattern like "19, 2025"
        ) : false;
        
        suggestionsData.push({ text: text || "", score, hasValue });
        console.log(`${name}: Suggestion ${i + 1}: score=${score}, hasValue=${hasValue}, text="${text?.substring(0, 60)}..."`);
      }
      
      // =========================================================
      // ASSERTION: Complete suggestions (with value) should rank higher
      // =========================================================
      
      // Find the first complete suggestion (with date value)
      const firstComplete = suggestionsData.find(s => s.hasValue);
      // Find the first incomplete suggestion (without date value, just operator)
      const firstIncomplete = suggestionsData.find(s => !s.hasValue);
      
      if (firstComplete && firstIncomplete) {
        // The complete suggestion should have a higher score
        expect(firstComplete.score).toBeGreaterThan(firstIncomplete.score);
        console.log(`${name}: Complete suggestion score (${firstComplete.score}) > Incomplete suggestion score (${firstIncomplete.score}) ✓`);
      }
      
      // The first suggestion should be complete (have a date value)
      expect(suggestionsData[0]?.hasValue).toBe(true);
    });

    test("'yesterday today' (without separator) shows between operator as top suggestion", async ({ page }) => {
      // Navigate to the app
      await page.goto(url);
      
      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);
      
      // Get the filter input
      const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");
      
      // =========================================================
      // STEP 1: Type "yesterday today" WITHOUT a separator (-)
      // This tests the custom chrono refiner that merges consecutive dates
      // =========================================================
      await filterInput.click();
      await filterInput.fill("yesterday today");
      
      // Wait for suggestions to appear
      await page.waitForTimeout(500);
      
      // =========================================================
      // STEP 2: First suggestion should be a between operator with both dates
      // =========================================================
      const firstSuggestion = page.locator('[data-testid^="suggestion-"]').first();
      await expect(firstSuggestion).toBeVisible({ timeout: 5000 });
      
      const suggestionText = await firstSuggestion.textContent();
      console.log(`${name}: First suggestion for 'yesterday today': "${suggestionText}"`);
      
      // Should be a between operator with two dates
      // The UI shows "between" as text and dates in separate badges (no "-" between them)
      expect(suggestionText).toMatch(/between.*Dec.*Dec/);
      
      // =========================================================
      // STEP 3: Get the preview result count and apply filter
      // =========================================================
      const resultCountElement = firstSuggestion.getByTestId("result-count");
      const resultCountText = await resultCountElement.textContent();
      const previewCount = parseResultCount(resultCountText || "");
      
      console.log(`${name}: Preview shows ${previewCount} results for 'yesterday today'`);
      
      await firstSuggestion.click();
      await page.waitForTimeout(500);
      
      // =========================================================
      // STEP 4: Verify the actual count matches preview
      // =========================================================
      const filterSummary = page.getByTestId("filter-summary");
      const headerText = await filterSummary.textContent();
      const actualCount = parseTaskCount(headerText || "");
      
      console.log(`${name}: Actual filtered count: ${actualCount}`);
      
      // The preview count should match the actual count
      expect(actualCount).toBe(previewCount);
      console.log(`${name}: 'yesterday today' filter works correctly - preview (${previewCount}) matches actual (${actualCount})`);
    });

    test("'created last week' displays two separate date argument badges", async ({ page }) => {
      // Navigate to the app
      await page.goto(url);
      
      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);
      
      // Get the filter input
      const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");
      
      // =========================================================
      // STEP 1: Type "created last week" to search for date range filter
      // =========================================================
      await filterInput.click();
      await filterInput.fill("created last week");
      
      // Wait for suggestions to appear
      await page.waitForTimeout(500);
      
      // =========================================================
      // STEP 2: Find the between suggestion for Created At (or alias "Created")
      // =========================================================
      const betweenSuggestion = page.locator('[data-testid^="suggestion-"]').filter({
        hasText: /Created.*between/,
      }).first();
      
      await expect(betweenSuggestion).toBeVisible({ timeout: 5000 });
      
      const suggestionText = await betweenSuggestion.textContent();
      console.log(`${name}: Between suggestion: "${suggestionText}"`);
      
      // =========================================================
      // STEP 3: Verify there are TWO separate argument badges 
      // not one badge containing "date - date"
      // =========================================================
      
      // Look for argument badges (text-[10px] with border classes)
      // There should be exactly 2 date argument badges for a between operator
      const argBadges = betweenSuggestion.locator('span.border');
      const argCount = await argBadges.count();
      
      console.log(`${name}: Found ${argCount} argument badges`);
      
      // Should have 2 separate argument badges for the date range
      expect(argCount).toBe(2);
      
      // Each badge should NOT contain " - " (they should be separate dates)
      const firstArg = await argBadges.nth(0).textContent();
      const secondArg = await argBadges.nth(1).textContent();
      
      console.log(`${name}: First arg: "${firstArg}", Second arg: "${secondArg}"`);
      
      expect(firstArg).not.toContain(" - ");
      expect(secondArg).not.toContain(" - ");
      
      // Both should contain date text (Dec, Jan, etc.)
      expect(firstArg).toMatch(/Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov/);
      expect(secondArg).toMatch(/Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov/);
    });

    test("'from yesterday to today' date range filter shows correct results", async ({ page }) => {
      // Navigate to the app
      await page.goto(url);
      
      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);
      
      // Get the filter input
      const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");
      
      // =========================================================
      // STEP 1: Type "from yesterday to today" to search for date range filter
      // =========================================================
      await filterInput.click();
      await filterInput.fill("from yesterday to today");
      
      // Wait for suggestions to appear
      await page.waitForTimeout(500);
      
      // =========================================================
      // STEP 2: Find the between suggestion for the date range
      // =========================================================
      // The UI shows "between" as text and dates in separate badges
      const betweenSuggestion = page.locator('[data-testid^="suggestion-"]').filter({
        hasText: /between.*Dec.*Dec/,
      }).first();
      
      await expect(betweenSuggestion).toBeVisible({ timeout: 5000 });
      
      // Get the preview count from the suggestion
      const resultCountElement = betweenSuggestion.getByTestId("result-count");
      const resultCountText = await resultCountElement.textContent();
      const previewCount = parseResultCount(resultCountText || "");
      
      console.log(`${name}: Preview shows ${previewCount} results for date range filter`);
      
      // =========================================================
      // STEP 3: Click to apply the date range filter
      // =========================================================
      await betweenSuggestion.click();
      await page.waitForTimeout(500);
      
      // =========================================================
      // STEP 4: Verify the actual count matches the preview count
      // =========================================================
      const filterSummary = page.getByTestId("filter-summary");
      const headerText = await filterSummary.textContent();
      const actualCount = parseTaskCount(headerText || "");
      
      console.log(`${name}: Actual filtered count: ${actualCount}`);
      
      // CRITICAL: The preview count should match the actual count
      // This was the bug: preview showed N results but actual was 0
      expect(actualCount).toBe(previewCount);
      
      // The filter should show some results (at least for dates within the range)
      // Note: This may be 0 if no data falls within the date range, which is valid
      // The key assertion is that preview === actual
      console.log(`${name}: Date range filter works correctly - preview (${previewCount}) matches actual (${actualCount})`);
    });
  });
}

