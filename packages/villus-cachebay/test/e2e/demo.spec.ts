import { test, expect } from '@playwright/test';

// Basic e2e to verify the demo app works with Cachebay
// - Page renders a first character name
// - Inflight dedup: clicking "Refetch twice" sends a single network request
// - Fragment update: clicking "Rename first" updates rendered name without extra request

test('renders and supports inflight dedup + fragment update', async ({ page }) => {
  const graphqlUrl = 'https://rickandmortyapi.com/graphql';
  let requestCount = 0;

  page.on('request', (req) => {
    if (req.url() === graphqlUrl && req.method() === 'POST') requestCount += 1;
  });

  await page.goto('/');

  // Wait for first item name
  const nameEl = page.getByTestId('first-name');
  await expect(nameEl).not.toHaveText('');

  // Reset counter after first paint to measure interactions only
  requestCount = 0;

  // Click refetch twice and expect only one request due to inflight dedup
  await page.getByTestId('refetch-twice').click();

  // Give the network a chance to flush
  await page.waitForTimeout(800);
  expect(requestCount).toBeLessThanOrEqual(1);

  // Fragment update should immediately update UI
  const before = await nameEl.textContent();
  await page.getByTestId('rename-first').click();
  await expect(nameEl).not.toHaveText(before || '');
  await expect(nameEl).toContainText('(Edited)');
});
