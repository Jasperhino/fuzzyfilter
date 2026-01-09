import { test, expect } from "@playwright/test";

/**
 * Test configuration for each framework's example app
 */
const apps = [
  { name: "React", url: "http://localhost:5173" },
  { name: "Vue", url: "http://localhost:5174" },
];

/**
 * Helper to parse the result count from text (just the number, e.g., "2,816")
 */
function parseResultCount(text: string): number {
  // The UI shows just the number with locale formatting (e.g., "2,816")
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
 * Test filter stacking for each framework
 */
for (const { name, url } of apps) {
  test.describe(`${name} Filter Stacking`, () => {
    test("filter counts update correctly when stacking filters", async ({ page }) => {
      // Navigate to the app
      await page.goto(url);
      
      // Wait for the app to load and data to be indexed
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000); // Extra wait for data indexing
      
      // Get the filter input
      const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");
      
      // =========================================================
      // STEP 1: Type "open" and find the "Status = Open" suggestion
      // =========================================================
      await filterInput.click();
      await filterInput.fill("open");
      
      // Wait for suggestions to appear
      await page.waitForTimeout(500);
      
      // Use data-testid to find the suggestion - works for both React and Vue
      const statusOpenSuggestion = page.getByTestId("suggestion-status-eq");
      await expect(statusOpenSuggestion).toBeVisible({ timeout: 5000 });
      
      // Get the result count from the nested data-testid element
      const resultCountElement = statusOpenSuggestion.getByTestId("result-count");
      const resultCountText = await resultCountElement.textContent();
      const statusOpenSuggestedCount = parseResultCount(resultCountText || "");
      
      console.log(`${name}: "Status = Open" suggestion shows ${statusOpenSuggestedCount} results`);
      
      // =========================================================
      // STEP 2: Click the suggestion to apply the filter
      // =========================================================
      await statusOpenSuggestion.click();
      await page.waitForTimeout(500);
      
      // Verify an active filter badge appears
      await expect(page.locator("text=Active filters")).toBeVisible({ timeout: 5000 });
      
      // Get the current task count from header "(X of 10,000)"
      const filterSummary = page.getByTestId("filter-summary");
      const headerText = await filterSummary.textContent();
      const actualCountAfterStatus = parseTaskCount(headerText || "");
      
      console.log(`${name}: After applying "Status = Open", showing ${actualCountAfterStatus} of 10,000`);
      
      // Verify the count matches what the suggestion predicted
      expect(actualCountAfterStatus).toBe(statusOpenSuggestedCount);
      
      // =========================================================
      // STEP 3: Type "engineering" for department filter
      // =========================================================
      await filterInput.click();
      await filterInput.fill("engineering");
      await page.waitForTimeout(500);
      
      // Find the "Department = Engineering" suggestion
      const deptEngineeringSuggestion = page.getByTestId("suggestion-department-eq");
      await expect(deptEngineeringSuggestion).toBeVisible({ timeout: 5000 });
      
      // Get the result count from the suggestion
      const deptResultCountElement = deptEngineeringSuggestion.getByTestId("result-count");
      const deptResultCountText = await deptResultCountElement.textContent();
      const deptEngineeringSuggestedCount = parseResultCount(deptResultCountText || "");
      
      console.log(`${name}: "Department = Engineering" suggestion shows ${deptEngineeringSuggestedCount} results (with Status = Open context)`);
      
      // The count should be <= the count after status filter (it's a refinement)
      expect(deptEngineeringSuggestedCount).toBeLessThanOrEqual(actualCountAfterStatus);
      
      // =========================================================
      // STEP 4: Apply the department filter by clicking
      // =========================================================
      await deptEngineeringSuggestion.click();
      await page.waitForTimeout(500);
      
      // Get the new task count
      const headerText2 = await filterSummary.textContent();
      const actualCountAfterBoth = parseTaskCount(headerText2 || "");
      
      console.log(`${name}: After applying both filters, showing ${actualCountAfterBoth} of 10,000`);
      
      // =========================================================
      // CRITICAL ASSERTION: The count should match what was suggested
      // This verifies that the filter context stacking works correctly
      // =========================================================
      expect(actualCountAfterBoth).toBe(deptEngineeringSuggestedCount);
      
      // Also verify we have 2 active filter badges
      await expect(page.locator("text=2 filters applied")).toBeVisible({ timeout: 2000 });
    });
  });
}
