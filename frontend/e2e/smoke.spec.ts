import { expect, test } from '@playwright/test';

test('home page renders primary CTAs', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.getByRole('heading', { name: /كتب لم تُنشر من قبل، الآن بين يديك/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /ادخل إلى المكتبة/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /ارفع مخطوطتك/i })).toBeVisible();
});

test('landing search console opens with the mode section and sign-in gate', async ({ page }) => {
  await page.goto('/');
  // Focusing the header search box opens the research-console dialog. (The
  // hero section repeats the same label, so scope to the first = header box.)
  await page.getByRole('textbox', { name: /ابحث في المكتبة/i }).first().click();
  const dialog = page.getByRole('dialog', { name: /البحث الذكي في المكتبة/i });
  await expect(dialog).toBeVisible();
  // Signed out: mode toggle is available, facets are gated behind sign-in.
  await expect(dialog.getByRole('button', { name: 'مزيج' })).toBeVisible();
  await expect(dialog.getByText(/سجّل الدخول للتصفية/)).toBeVisible();
  // AI submit is present (disabled until a query is typed).
  await expect(dialog.getByRole('button', { name: /ابحث بالذكاء الاصطناعي/i })).toBeVisible();
  // Escape closes the console.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
