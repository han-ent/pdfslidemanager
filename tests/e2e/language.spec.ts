import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFixture } from '../fixtures/generate-fixtures';

const FIXTURE = 'tests/fixtures/generated/e2e-language.pdf';

test.beforeAll(async () => {
  await writeFixture(FIXTURE, [{ layoutId: 'two-by-two' }]);
});

test.describe('English browser', () => {
  test.use({ locale: 'en-US' });

  test('defaults to English, remembers a Korean choice, and keeps text inside the viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('PDF Slide Splitter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Drop a lecture PDF to split it into slides' })).toBeVisible();
    await expect.poll(() => storageKeys(page)).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('language-ko').click();
    await expect(page).toHaveTitle('PDF 슬라이드 나누기');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    await expect(page.getByRole('heading', { name: '강의 PDF를 올려 슬라이드별로 나누세요' })).toBeVisible();
    await expect.poll(() => storageKeys(page)).toEqual(['pdfslidemanager.locale']);

    await page.reload();
    await expect(page).toHaveTitle('PDF 슬라이드 나누기');
    await expect(page.getByTestId('language-ko')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('language-en').click();
    await page.getByTestId('pdf-input').setInputFiles(resolve(FIXTURE));
    await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('inspector-panel')).toContainText('Current page');
    await expect(page.getByTestId('saved-layout-empty-state')).toContainText('No saved crops yet');
    await expect(page.locator('.thumbnail-rail')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoElementOverflow(page, '.inspector-panel');
    await expectNoElementOverflow(page, '.thumbnail-rail');

    await page.setViewportSize({ width: 360, height: 780 });
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('inspector-panel')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoElementOverflow(page, '.inspector-panel');
    await expectNoElementOverflow(page, '.thumbnail-rail');
  });
});

async function storageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage).sort());
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectNoElementOverflow(page: Page, selector: string): Promise<void> {
  const overflow = await page.locator(selector).evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
