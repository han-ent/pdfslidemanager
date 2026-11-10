import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { A4_LANDSCAPE_PAGE } from '../../src/pdf/convert';

const lecturePath = resolve('test sample/vft.pdf');

test('loads the owner lecture handout, keeps the rail, and exports a local PDF', async ({ page }) => {
  test.skip(!existsSync(lecturePath), 'private lecture PDF is not in this workspace');
  test.setTimeout(600_000);

  const nonLocalRequests: string[] = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const appOrigin = new URL(page.url()).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin && url.protocol !== 'blob:') nonLocalRequests.push(request.url());
  });

  await page.getByTestId('pdf-input').setInputFiles(lecturePath);
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 420_000 });
  await expect(page.getByRole('button', { name: '85쪽', exact: true })).toBeAttached();

  const rail = page.locator('.thumbnail-rail');
  const before = await rail.evaluate((node) => {
    const railElement = node as HTMLElement;
    const button = [...railElement.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === '60쪽');
    if (!(button instanceof HTMLElement)) throw new Error('60쪽 버튼을 찾지 못했습니다.');
    railElement.scrollTop = Math.max(0, button.offsetTop - railElement.clientHeight / 2);
    return railElement.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await page.getByRole('button', { name: '60쪽', exact: true }).click();
  await expect(page.getByTestId('crop-overlay')).toHaveAttribute('aria-label', '60쪽 자르기 영역');
  await expect.poll(() => rail.evaluate((node) => (node as HTMLElement).scrollTop)).toBe(before);

  const reviewBlocked = await page.getByTestId('convert-button').isDisabled();
  if (reviewBlocked) {
    for (let pageNumber = 1; pageNumber <= 85 && await page.getByTestId('convert-button').isDisabled(); pageNumber += 1) {
      await page.getByRole('button', { name: `${pageNumber}쪽`, exact: true }).click();
      const needsReview = await page.getByTestId('review-needed-page').count();
      if (needsReview > 0) await page.getByTestId('layout-one-up').click();
    }
  }

  await page.getByRole('button', { name: '4쪽', exact: true }).click();
  await page.getByTestId('layout-two-by-three').click();
  await expect(page.getByTestId('preview-summary')).toHaveAttribute('data-layout-id', 'two-by-three');
  const cards = page.getByTestId('expected-output-card');
  await expect(cards).toHaveCount(6);
  const firstCropX = await cards.nth(0).getAttribute('data-crop-x');
  const secondCropX = await cards.nth(1).getAttribute('data-crop-x');
  await cards.nth(1).dragTo(cards.nth(0));
  await expect.poll(() => cards.nth(0).getAttribute('data-crop-x')).toBe(secondCropX);
  await page.getByTestId('expected-output-delete-button').first().click();
  await expect(cards).toHaveCount(5);
  expect(firstCropX).not.toBe(secondCropX);

  await page.getByTestId('convert-button').click();
  await expect(page.getByTestId('success-message')).toContainText('쪽 준비됨', { timeout: 420_000 });
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-link').click(),
  ]).then(([downloadEvent]) => downloadEvent);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const outputPdf = await PDFDocument.load(await readFile(downloadedPath!));
  expect(outputPdf.getPageCount()).toBeGreaterThan(10);
  expect(outputPdf.getPage(0).getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
  expect(outputPdf.getPage(0).getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);
  expect(nonLocalRequests).toEqual([]);
});
