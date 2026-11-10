import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFixture } from '../fixtures/generate-fixtures';

test.beforeAll(async () => {
  await writeFixture('tests/fixtures/generated/upload-shell.pdf', [{ layoutId: 'three-by-two' }]);
});

test('loads a PDF through the file picker shell without external upload requests', async ({ page }) => {
  const externalRequests: string[] = [];
  await page.goto('/');
  const appOrigin = new URL(page.url()).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin && url.protocol !== 'blob:') {
      externalRequests.push(request.url());
    }
  });

  await expect(page.getByRole('heading', { name: '강의 PDF를 올려 슬라이드별로 나누세요' })).toBeVisible();
  await expect(page.getByText('이 브라우저 안에서만 처리합니다').first()).toBeVisible();

  await page.getByTestId('pdf-input').setInputFiles(resolve('tests/fixtures/generated/upload-shell.pdf'));

  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('export-panel')).toContainText('upload-shell.pdf');
  await expect(page.getByTestId('convert-button')).toBeEnabled();
  expect(externalRequests).toEqual([]);
});
