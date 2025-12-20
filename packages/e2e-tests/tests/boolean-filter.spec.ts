import { test, expect } from "@playwright/test";

/**
 * Test configuration for each framework's example app
 */
const apps = [
  { name: "React", url: "http://localhost:5173" },
  { name: "Vue", url: "http://localhost:5174" },
];

/**
 * Helper to parse the result count from "X results" text
 */
function parseResultCount(text: string): number {
  const match = text.match(/(\d[\d,]*)\s+results?/);
  if (!match) throw new Error(`Could not parse result count from: ${text}`);
  return parseInt(match[1].replace(/,/g, ""), 10);
}

/**
 * Helper to parse the task count from header "(X of 10,000)"
 */
function parseTaskCount(text: string): number {
  const match = text.match(/\(?([\d,]+)\s+of\s+[\d,]+\)?/);
  if (!match) throw new Error(`Could not parse task count from: ${text}`);
  return parseInt(match[1].replace(/,/g, ""), 10);
}

/**
 * Test boolean filtering - specifically the "blocked true" ranking issue
 *
 * Bug description:
 * When typing "blocked true", the boolean operator suggestion (Is Blocked is true)
 * should rank higher than fulltext search results because:
 * 1. "blocked" matches the "Is Blocked" column
 * 2. "true" matches the "isTrue" operator alias
 * 3. Since isTrue doesn't require arguments, this is a complete filter
 */
for (const { name, url } of apps) {
  test.describe(`${name} Boolean Filtering`, () => {
    test("'blocked true' shows boolean filter as top suggestion", async ({ page }) => {
      // Navigate to the app
      await page.goto(url);

      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000); // Extra wait for data indexing

      // Get the filter input
      const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");

      // =========================================================
      // STEP 1: Type "blocked true" to search for boolean filter
      // =========================================================
      await filterInput.click();
      await filterInput.fill("blocked true");

      // Wait for suggestions to appear
      await page.waitForTimeout(500);

      // =========================================================
      // STEP 2: Verify the first suggestion is the boolean filter
      // =========================================================
      const firstSuggestion = page.locator('[data-testid^="suggestion-"]').first();
      await expect(firstSuggestion).toBeVisible({ timeout: 5000 });

      // Get the suggestion text - it should be "Is Blocked is true" or similar
      const suggestionText = await firstSuggestion.textContent();
      console.log(`${name}: First suggestion for 'blocked true': "${suggestionText}"`);

      // The first suggestion should contain "Is Blocked" and indicate true
      // It should have the checkmark symbol (✓) for isTrue operator
      const isBlockedBooleanFilter = suggestionText && (
        (suggestionText.includes("Is Blocked") && suggestionText.includes("✓")) ||
        (suggestionText.includes("Is Blocked") && suggestionText.toLowerCase().includes("true"))
      );

      expect(isBlockedBooleanFilter).toBe(true);

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
      const tasksHeader = page.locator("h3").filter({ hasText: /of\s+10,000/ }).first();
      const headerText = await tasksHeader.textContent();
      const actualCount = parseTaskCount(headerText || "");

      console.log(`${name}: Actual filtered count: ${actualCount}`);

      // CRITICAL: The preview count should match the actual count
      expect(actualCount).toBe(previewCount);
    });

    test("'blocked false' shows boolean filter as top suggestion", async ({ page }) => {
      // Navigate to the app
      await page.goto(url);

      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);

      // Get the filter input
      const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");

      // =========================================================
      // STEP 1: Type "blocked false" to search for boolean filter
      // =========================================================
      await filterInput.click();
      await filterInput.fill("blocked false");

      // Wait for suggestions to appear
      await page.waitForTimeout(500);

      // =========================================================
      // STEP 2: Verify the first suggestion is the boolean filter
      // =========================================================
      const firstSuggestion = page.locator('[data-testid^="suggestion-"]').first();
      await expect(firstSuggestion).toBeVisible({ timeout: 5000 });

      // Get the suggestion text
      const suggestionText = await firstSuggestion.textContent();
      console.log(`${name}: First suggestion for 'blocked false': "${suggestionText}"`);

      // The first suggestion should contain "Is Blocked" and indicate false
      // It should have the X symbol (✗) for isFalse operator
      const isBlockedFalseFilter = suggestionText && (
        (suggestionText.includes("Is Blocked") && suggestionText.includes("✗")) ||
        (suggestionText.includes("Is Blocked") && suggestionText.toLowerCase().includes("false"))
      );

      expect(isBlockedFalseFilter).toBe(true);

      // =========================================================
      // STEP 3: Verify result count matches
      // =========================================================
      const resultCountElement = firstSuggestion.getByTestId("result-count");
      const resultCountText = await resultCountElement.textContent();
      const previewCount = parseResultCount(resultCountText || "");

      console.log(`${name}: Preview shows ${previewCount} results`);

      await firstSuggestion.click();
      await page.waitForTimeout(500);

      const tasksHeader = page.locator("h3").filter({ hasText: /of\s+10,000/ }).first();
      const headerText = await tasksHeader.textContent();
      const actualCount = parseTaskCount(headerText || "");

      console.log(`${name}: Actual filtered count: ${actualCount}`);

      expect(actualCount).toBe(previewCount);
    });

    test("complete boolean filter ranks higher than incomplete suggestions", async ({ page }) => {
      // Navigate to the app
      await page.goto(url);

      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);

      // Get the filter input
      const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");

      await filterInput.click();
      await filterInput.fill("blocked true");

      // Wait for suggestions to appear
      await page.waitForTimeout(500);

      // Get all suggestions
      const allSuggestions = page.locator('[data-testid^="suggestion-"]');
      const count = await allSuggestions.count();

      // Collect scores
      const suggestionsData: Array<{ text: string; score: number; isComplete: boolean }> = [];

      for (let i = 0; i < Math.min(count, 5); i++) {
        const suggestion = allSuggestions.nth(i);
        const text = await suggestion.textContent();

        // Extract score from the score badge
        const scoreElement = suggestion.locator('.font-mono.tabular-nums').first();
        const scoreText = await scoreElement.textContent();
        const score = parseInt(scoreText || "0", 10);

        // Check if suggestion is complete (boolean filter with Is Blocked)
        const isComplete = text ? (
          (text.includes("Is Blocked") && (text.includes("✓") || text.includes("✗")))
        ) : false;

        suggestionsData.push({ text: text || "", score, isComplete });
        console.log(`${name}: Suggestion ${i + 1}: score=${score}, isComplete=${isComplete}, text="${text?.substring(0, 60)}..."`);
      }

      // =========================================================
      // ASSERTION: Complete boolean filter should rank higher
      // =========================================================

      // Find the first complete boolean filter suggestion
      const firstComplete = suggestionsData.find(s => s.isComplete);
      // Find the first incomplete suggestion (not a complete boolean filter)
      const firstIncomplete = suggestionsData.find(s => !s.isComplete);

      if (firstComplete && firstIncomplete) {
        // The complete suggestion should have a higher score
        expect(firstComplete.score).toBeGreaterThan(firstIncomplete.score);
        console.log(`${name}: Complete suggestion score (${firstComplete.score}) > Incomplete suggestion score (${firstIncomplete.score}) ✓`);
      }

      // The first suggestion should be complete (boolean filter)
      expect(suggestionsData[0]?.isComplete).toBe(true);
    });

    test("'is empty' operator works for boolean column", async ({ page }) => {
      // Navigate to the app
      await page.goto(url);

      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);

      // Get the filter input
      const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");

      // =========================================================
      // STEP 1: Type "blocked empty" to test isEmpty operator
      // =========================================================
      await filterInput.click();
      await filterInput.fill("blocked empty");

      // Wait for suggestions to appear
      await page.waitForTimeout(500);

      // =========================================================
      // STEP 2: Verify there's a suggestion with isEmpty operator
      // =========================================================
      const suggestions = page.locator('[data-testid^="suggestion-"]');
      const count = await suggestions.count();

      let foundIsEmptySuggestion = false;
      for (let i = 0; i < count; i++) {
        const text = await suggestions.nth(i).textContent();
        if (text && text.includes("Is Blocked") && text.includes("∅")) {
          foundIsEmptySuggestion = true;
          console.log(`${name}: Found isEmpty suggestion: "${text}"`);
          break;
        }
      }

      // There should be an isEmpty suggestion for the boolean column
      expect(foundIsEmptySuggestion).toBe(true);
    });
  });
}

