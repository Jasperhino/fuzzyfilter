import { test, expect } from "@playwright/test";

/**
 * Test configuration for the Vue example app (only Vue has language selector currently)
 */
const vueApp = { name: "Vue", url: "http://localhost:5174" };

/**
 * Test language switching updates the default suggestions in the combo box
 * 
 * Bug description:
 * When clicking in the combo box without typing anything, default suggestions appear.
 * These suggestions should update when the language is changed (e.g., from English to German).
 * Previously, the default suggestions did not update because the watcher only refetched
 * suggestions when the query was non-empty.
 */
test.describe("Language Change - Default Suggestions", () => {
  test("default suggestions update when language changes", async ({ page }) => {
    // Navigate to the Vue app
    await page.goto(vueApp.url);

    // Wait for the app to load and data to be indexed
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // =========================================================
    // STEP 1: Click on the filter input (empty query) - get default suggestions
    // =========================================================
    const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");
    await filterInput.click();
    
    // Wait for default suggestions to appear
    await page.waitForTimeout(300);
    
    // Get the first suggestion text in English
    const firstSuggestionEn = page.locator('[data-testid^="suggestion-"]').first();
    await expect(firstSuggestionEn).toBeVisible({ timeout: 5000 });
    const englishSuggestionText = await firstSuggestionEn.textContent();
    console.log(`Default suggestion in English: "${englishSuggestionText}"`);

    // Verify it contains English text (e.g., "Status", "equals")
    expect(englishSuggestionText).toContain("Status");

    // =========================================================
    // STEP 2: Close the dropdown by clicking elsewhere, then change language
    // =========================================================
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);

    // Find and click the language selector to change to German
    const languageSelector = page.locator("button").filter({ hasText: /^EN$|English/ }).first();
    
    // If there's a select component, click it and select German
    const selectTrigger = page.locator('[data-testid="language-selector"]').first();
    
    if (await selectTrigger.isVisible()) {
      await selectTrigger.click();
      await page.waitForTimeout(100);
      
      // Click German option
      const germanOption = page.locator('[role="option"]').filter({ hasText: /Deutsch|DE|German/ });
      await germanOption.click();
    } else {
      // Try finding the language selector by other means
      const langSelector = page.locator("select, [role='combobox']").filter({ hasText: /EN|English/ }).first();
      if (await langSelector.isVisible()) {
        await langSelector.selectOption({ label: "Deutsch" });
      }
    }

    // Wait for language to change
    await page.waitForTimeout(500);

    // =========================================================
    // STEP 3: Click on the filter input again - default suggestions should be in German
    // =========================================================
    await filterInput.click();
    
    // Wait for suggestions to appear
    await page.waitForTimeout(300);

    // Get the first suggestion text in German
    const firstSuggestionDe = page.locator('[data-testid^="suggestion-"]').first();
    await expect(firstSuggestionDe).toBeVisible({ timeout: 5000 });
    const germanSuggestionText = await firstSuggestionDe.textContent();
    console.log(`Default suggestion in German: "${germanSuggestionText}"`);

    // =========================================================
    // STEP 4: Verify the suggestions are now in German
    // =========================================================
    // Check that the German text appears - column names should be translated
    // The status column in German should show "Status" (same) but operators should be translated
    // For example "equals" becomes "gleich" in German
    
    // The key test: the suggestion text should have changed from English to German
    // If translations are working, operator aliases should be different
    // German "equals" alias is "gleich" or "ist gleich"
    const hasGermanContent = germanSuggestionText?.includes("gleich") || 
                             germanSuggestionText?.includes("ist") ||
                             germanSuggestionText?.includes("entspricht");
    
    console.log(`Has German content: ${hasGermanContent}`);
    
    // The text should be different from English if translations are working
    // Note: Some column names might be the same in both languages
    expect(germanSuggestionText).not.toBe(englishSuggestionText);
  });

  test("suggestions with query update when language changes", async ({ page }) => {
    // Navigate to the Vue app
    await page.goto(vueApp.url);

    // Wait for the app to load and data to be indexed
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // =========================================================
    // STEP 1: Type a query and get suggestions in English
    // =========================================================
    const filterInput = page.getByPlaceholder("Filter by column, operator, or value...");
    await filterInput.click();
    await filterInput.fill("status");
    
    // Wait for suggestions to appear
    await page.waitForTimeout(500);
    
    // Get the first suggestion text in English
    const firstSuggestionEn = page.locator('[data-testid^="suggestion-"]').first();
    await expect(firstSuggestionEn).toBeVisible({ timeout: 5000 });
    const englishSuggestionText = await firstSuggestionEn.textContent();
    console.log(`Suggestion for 'status' in English: "${englishSuggestionText}"`);

    // =========================================================
    // STEP 2: Change language to German
    // =========================================================
    // Close dropdown first
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);

    // Click language selector and choose German
    const selectTrigger = page.locator('[data-testid="language-selector"]').first();
    
    if (await selectTrigger.isVisible()) {
      await selectTrigger.click();
      await page.waitForTimeout(100);
      
      // Click German option
      const germanOption = page.locator('[role="option"]').filter({ hasText: /Deutsch|DE|German/ });
      await germanOption.click();
    }

    // Wait for language change and suggestions to refresh
    await page.waitForTimeout(500);

    // =========================================================
    // STEP 3: Click on input again - suggestions should be in German
    // =========================================================
    await filterInput.click();
    
    // Wait for suggestions
    await page.waitForTimeout(300);

    // Get the first suggestion text
    const firstSuggestionDe = page.locator('[data-testid^="suggestion-"]').first();
    await expect(firstSuggestionDe).toBeVisible({ timeout: 5000 });
    const germanSuggestionText = await firstSuggestionDe.textContent();
    console.log(`Suggestion for 'status' in German: "${germanSuggestionText}"`);

    // The operator text should be in German now
    expect(germanSuggestionText).not.toBe(englishSuggestionText);
  });
});
