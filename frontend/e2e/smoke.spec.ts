import { expect, test } from '@playwright/test';

test('home page renders primary CTAs', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.getByRole('heading', { name: /كتب لم تُنشر من قبل، الآن بين يديك/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /ادخل إلى المكتبة/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /ارفع مخطوطتك/i })).toBeVisible();
});
