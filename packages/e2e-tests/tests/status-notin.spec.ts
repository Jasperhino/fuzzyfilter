import { test, expect } from "@playwright/test";

/**
 * Test configuration for each framework's example app
 */
const apps = [
  { name: "React", url: "http://localhost:5173" },
  { name: "Vue", url: "http://localhost:5174" },
];

/**
 * Test that typing "status notin" correctly shows the Status column with nin operator
 * as the top suggestion. This tests the optimal slot assignment algorithm.
 */
for (const { name, url } of apps) {
  test.describe(`${name} Status NotIn Suggestion`, () => {
    test("'status notin' shows Status nin as top suggestion", async ({
      page,
    }) => {
      // Navigate to the app
      await page.goto(url);

      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000); // Extra wait for data indexing

      // Get the filter input
      const filterInput = page.getByPlaceholder(
        "Filter by column, operator, or value..."
      );

      // Click and type "status notin"
      await filterInput.click();
      await filterInput.fill("status notin");

      // Wait for suggestions to appear
      await page.waitForTimeout(500); // Debounce delay

      // Find suggestions using data-testid (works for both React and Vue)
      const suggestions = page.locator('[data-testid^="suggestion-"]');
      await expect(suggestions.first()).toBeVisible({ timeout: 5000 });

      // Get the first suggestion
      const firstSuggestion = suggestions.first();

      // The first suggestion should contain "Status" and "notIn" operator
      const suggestionText = await firstSuggestion.textContent();
      expect(suggestionText).toContain("Status");
      // Check for either "notIn", "nin", or "not in" (case insensitive)
      const lowerText = suggestionText?.toLowerCase() ?? "";
      expect(
        lowerText.includes("notin") ||
          lowerText.includes("nin") ||
          lowerText.includes("not in")
      ).toBe(true);
    });

    test("'nin status' also shows Status nin as top suggestion", async ({
      page,
    }) => {
      // Navigate to the app
      await page.goto(url);

      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);

      // Get the filter input
      const filterInput = page.getByPlaceholder(
        "Filter by column, operator, or value..."
      );

      // Click and type "nin status" (reversed order)
      await filterInput.click();
      await filterInput.fill("nin status");

      // Wait for suggestions to appear
      await page.waitForTimeout(500);

      // Find suggestions using data-testid (works for both React and Vue)
      const suggestions = page.locator('[data-testid^="suggestion-"]');
      await expect(suggestions.first()).toBeVisible({ timeout: 5000 });

      // Get the first suggestion
      const firstSuggestion = suggestions.first();

      // The first suggestion should contain "Status" and the nin operator
      const suggestionText = await firstSuggestion.textContent();
      expect(suggestionText).toContain("Status");
      // Check for either "notIn", "nin", or "not in"
      const lowerText = suggestionText?.toLowerCase() ?? "";
      expect(
        lowerText.includes("notin") ||
          lowerText.includes("nin") ||
          lowerText.includes("not in")
      ).toBe(true);
    });

    test.skip("Status nin suggestion has high score from combined column+operator match", async ({
      page,
    }) => {
      // Navigate to the app
      await page.goto(url);

      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);

      // Get the filter input
      const filterInput = page.getByPlaceholder(
        "Filter by column, operator, or value..."
      );

      // Click and type "status notin"
      await filterInput.click();
      await filterInput.fill("status notin");

      // Wait for suggestions to appear
      await page.waitForTimeout(500);

      // Find suggestions using data-testid (works for both React and Vue)
      const suggestions = page.locator('[data-testid^="suggestion-"]');
      await expect(suggestions.first()).toBeVisible({ timeout: 5000 });

      // Get the first suggestion
      const firstSuggestion = suggestions.first();

      // Check that the score is high (> 5000) indicating both column and operator matched
      // The score element has a title with score breakdown
      const scoreElement = firstSuggestion.locator('[title*="Final Score"]');
      if ((await scoreElement.count()) > 0) {
        const title = await scoreElement.getAttribute("title");
        const scoreMatch = title?.match(/Final Score:\s*(\d+)/);
        if (scoreMatch) {
          const score = parseInt(scoreMatch[1], 10);
          // With combined column + operator match + bonus, score should be > 5000
          expect(score).toBeGreaterThan(5000);
        }
      }
    });
  });
}

