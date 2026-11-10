import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { A4_LANDSCAPE_PAGE } from '../../src/pdf/convert';
import { writeFixture } from '../fixtures/generate-fixtures';

test.beforeAll(async () => {
  await writeFixture('tests/fixtures/generated/e2e-mixed.pdf', [
    { layoutId: 'one-up' },
    { layoutId: 'two-up-horizontal' },
    { layoutId: 'two-by-two' },
    { layoutId: 'three-by-two' },
  ]);

  const blankPdf = await PDFDocument.create();
  const blankPage = blankPdf.addPage([600, 400]);
  blankPage.drawRectangle({ x: 0, y: 0, width: 600, height: 400, color: rgb(1, 1, 1) });
  const blankPath = resolve('tests/fixtures/generated/e2e-blank.pdf');
  await mkdir(dirname(blankPath), { recursive: true });
  await writeFile(blankPath, await blankPdf.save({ useObjectStreams: false }));
});

test('loads a local PDF, shows preview controls, overrides layouts, converts, and exposes a local download', async ({ page }) => {
  const nonLocalRequests: string[] = [];
  const mutatingRequests: string[] = [];
  await page.goto('/');
  const appOrigin = new URL(page.url()).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin && url.protocol !== 'blob:') {
      nonLocalRequests.push(request.url());
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      mutatingRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await expect(page.getByTestId('dropzone')).toContainText('이 브라우저 안에서만');

  await page.getByTestId('pdf-input').setInputFiles(resolve('tests/fixtures/generated/e2e-mixed.pdf'));
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  const overlay = page.getByTestId('crop-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('li')).toHaveCount(1);
  await expect(page.getByTestId('inspector-panel')).toContainText('현재 쪽');

  const firstCrop = page.getByTestId('crop-overlay-item').first();
  const initialCropSize = parseCropSize(await firstCrop.getAttribute('aria-label'));
  await firstCrop.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(async () => {
    const size = parseCropSize(await firstCrop.getAttribute('aria-label'));
    return Number((size.width - initialCropSize.width).toFixed(1));
  }).toBe(-1);
  await expect(page.getByTestId('preview-summary')).toContainText('직접 자름');
  await page.getByTestId('reset-page-button').click();
  await expect.poll(async () => {
    const size = parseCropSize(await page.getByTestId('crop-overlay-item').first().getAttribute('aria-label'));
    return `${size.width}x${size.height}`;
  }).toBe(`${initialCropSize.width}x${initialCropSize.height}`);
  await expect(page.getByTestId('preview-summary')).not.toContainText('직접 자름');

  await page.getByTestId('layout-three-by-two').click();
  await expect(overlay.locator('li')).toHaveCount(6);
  await expect(page.getByTestId('expected-output-preview')).toContainText('미리보기');
  await expect(page.getByTestId('expected-output-canvas')).toHaveCount(6);
  const expectedOutputCard = page.getByTestId('expected-output-canvas').first();
  await expect.poll(async () => expectedOutputCard.evaluate((canvas) => {
    const typedCanvas = canvas as HTMLCanvasElement;
    return {
      width: typedCanvas.width,
      height: typedCanvas.height,
      ratio: Number((typedCanvas.width / typedCanvas.height).toFixed(3)),
    };
  })).toMatchObject({ width: 420, height: 297, ratio: 1.414 });
  const expectedOutputCards = page.getByTestId('expected-output-card');
  const secondCardCropX = await expectedOutputCards.nth(1).getAttribute('data-crop-x');
  expect(secondCardCropX).toBeTruthy();
  await expectedOutputCards.nth(1).dragTo(expectedOutputCards.nth(0));
  await expect.poll(() => page.getByTestId('expected-output-card').first().getAttribute('data-crop-x')).toBe(secondCardCropX);
  await page.getByTestId('expected-output-delete-button').first().click();
  await expect(page.getByTestId('expected-output-card')).toHaveCount(5);
  await expect(page.getByTestId('preview-summary')).toContainText('출력 5장');
  await page.getByTestId('layout-three-by-two').click();
  await expect(page.getByTestId('expected-output-card')).toHaveCount(6);
  const overlayMetrics = await overlay.evaluate((node) => {
    const overlayRect = node.getBoundingClientRect();
    const canvasRect = node.closest('.pdf-preview-page')?.querySelector('canvas')?.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      display: style.display,
      overlayWidth: Math.round(overlayRect.width),
      overlayHeight: Math.round(overlayRect.height),
      canvasWidth: Math.round(canvasRect?.width ?? 0),
      canvasHeight: Math.round(canvasRect?.height ?? 0),
    };
  });
  expect(overlayMetrics).toMatchObject({ display: 'grid' });
  expect(overlayMetrics.overlayWidth).toBe(overlayMetrics.canvasWidth);
  expect(overlayMetrics.overlayHeight).toBe(overlayMetrics.canvasHeight);

  await expect(page.getByTestId('preview-summary')).toHaveAttribute('data-layout-id', 'three-by-two');

  await page.getByTestId('layout-two-by-two').click();
  await expect(page.getByTestId('preview-summary')).toHaveAttribute('data-layout-id', 'two-by-two');
  await page.getByTestId('apply-scope-range').check();
  await page.getByTestId('range-input').fill('2-3');
  await page.getByTestId('apply-range-button').click();
  await selectPreviewPage(page, 2);
  await expect(page.getByTestId('preview-summary')).toHaveAttribute('data-layout-id', 'two-by-two');
  await selectPreviewPage(page, 1);
  await page.evaluate(() => {
    window.__pdfSlideSplitterTestHooks = {
      attemptNetworkDuringExport: true,
      blockedNetworkEvents: [],
    };
  });

  await page.getByTestId('convert-button').click();
  await expect(page.getByTestId('success-message')).toContainText('쪽 준비됨', { timeout: 30_000 });
  const guardProbe = await page.evaluate(() => window.__pdfSlideSplitterTestHooks);
  expect(guardProbe?.guardProbe).toMatchObject({
    fetchBlocked: true,
    sendBeaconReturn: false,
  });
  expect(guardProbe?.guardProbe?.fetchError).toContain('Network upload blocked');
  expect(guardProbe?.blockedNetworkEvents).toEqual([
    expect.stringContaining('POST '),
    expect.stringContaining('BEACON '),
  ]);
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-link').click(),
  ]).then(([downloadEvent]) => downloadEvent);
  expect(download.suggestedFilename()).toBe('e2e-mixed-slides.pdf');
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const outputPdf = await PDFDocument.load(await readFile(downloadedPath!));
  expect(outputPdf.getPage(0).getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
  expect(outputPdf.getPage(0).getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);

  expect(nonLocalRequests).toEqual([]);
  expect(mutatingRequests).toEqual([]);
});

test('saves, renames, updates, reapplies, deletes, and exports a session-local saved crop layout', async ({ page }) => {
  const sourcePath = resolve('tests/fixtures/generated/e2e-mixed.pdf');
  const sourceBefore = await readFile(sourcePath);
  const nonLocalRequests: string[] = [];
  const mutatingRequests: string[] = [];

  await page.goto('/');
  const appOrigin = new URL(page.url()).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin && url.protocol !== 'blob:') {
      nonLocalRequests.push(request.url());
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      mutatingRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await expect(page.getByTestId('dropzone')).toContainText('이 브라우저 안에서만');
  await expect(page.getByText('업로드 없음 · 내 기기에서만 처리')).toBeVisible();

  await page.getByTestId('pdf-input').setInputFiles(sourcePath);
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('saved-layout-empty-state')).toContainText('저장한 자르기가 없습니다');
  await expect(page.getByTestId('saved-layout-select')).toHaveCount(0);

  await page.getByTestId('layout-two-by-two').click();
  await expectSelectedPageCropLayout(page, 1, 'two-by-two', 4);
  await page.getByTestId('save-current-layout-button').click();
  await openSavedMenu(page);
  await expect(page.getByTestId('saved-layout-name-input')).toHaveValue('레이아웃 1');
  await expect(page.getByTestId('saved-layout-select')).toBeEnabled();
  await expect(page.getByTestId('saved-layout-select').locator('option')).toHaveText(['저장 항목 선택', '레이아웃 1']);

  await page.getByTestId('saved-layout-name-input').fill('Lecture crops');
  await page.getByTestId('rename-saved-layout-button').click();
  await openSavedMenu(page);
  await expect(page.getByTestId('saved-layout-name-input')).toHaveValue('Lecture crops');
  await expect(page.getByTestId('saved-layout-select').locator('option')).toHaveText(['저장 항목 선택', 'Lecture crops']);

  await page.getByTestId('apply-scope-range').check();
  await page.getByTestId('range-input').fill('2-3');
  await page.getByTestId('apply-saved-layout-button').click();
  await selectPreviewPage(page, 2);
  await expectSelectedPageCropLayout(page, 2, 'two-by-two', 4);
  await selectPreviewPage(page, 3);
  await expectSelectedPageCropLayout(page, 3, 'two-by-two', 4);

  await selectPreviewPage(page, 1);
  await page.getByTestId('layout-three-by-two').click();
  await expectSelectedPageCropLayout(page, 1, 'three-by-two', 6);
  await selectPreviewPage(page, 2);
  await expectSelectedPageCropLayout(page, 2, 'two-by-two', 4);

  await selectPreviewPage(page, 1);
  await openSavedMenu(page);
  await page.getByTestId('update-saved-layout-button').click();
  await selectPreviewPage(page, 2);
  await expectSelectedPageCropLayout(page, 2, 'two-by-two', 4);
  await page.getByTestId('apply-scope-range').check();
  await page.getByTestId('range-input').fill('2');
  await openSavedMenu(page);
  await page.getByTestId('apply-saved-layout-button').click();
  await expectSelectedPageCropLayout(page, 2, 'three-by-two', 6);
  await selectPreviewPage(page, 3);
  await expectSelectedPageCropLayout(page, 3, 'two-by-two', 4);

  expect(await readBrowserStorageSnapshot(page)).toEqual({
    cacheKeys: [],
    indexedDbNames: [],
    localStorageKeys: [],
    sessionStorageKeys: [],
  });

  await openSavedMenu(page);
  await page.getByTestId('delete-saved-layout-button').click();
  await expect(page.getByTestId('saved-layout-empty-state')).toContainText('저장한 자르기가 없습니다');
  await expect(page.getByTestId('saved-layout-select')).toHaveCount(0);
  await expect(page.getByTestId('apply-saved-layout-button')).toHaveCount(0);

  await page.evaluate(() => {
    window.__pdfSlideSplitterTestHooks = {
      attemptNetworkDuringExport: true,
      blockedNetworkEvents: [],
    };
  });

  await page.getByTestId('convert-button').click();
  await expect(page.getByTestId('success-message')).toContainText('쪽 준비됨', { timeout: 30_000 });
  const guardProbe = await page.evaluate(() => window.__pdfSlideSplitterTestHooks);
  expect(guardProbe?.guardProbe).toMatchObject({
    fetchBlocked: true,
    sendBeaconReturn: false,
  });
  expect(guardProbe?.guardProbe?.fetchError).toContain('Network upload blocked');
  expect(guardProbe?.blockedNetworkEvents).toEqual([
    expect.stringContaining('POST '),
    expect.stringContaining('BEACON '),
  ]);

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-link').click(),
  ]).then(([downloadEvent]) => downloadEvent);
  expect(download.suggestedFilename()).toBe('e2e-mixed-slides.pdf');
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const outputPdf = await PDFDocument.load(await readFile(downloadedPath!));
  for (const pdfPage of outputPdf.getPages()) {
    expect(pdfPage.getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
    expect(pdfPage.getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);
  }

  const sourceAfter = await readFile(sourcePath);
  expect(sourceAfter.byteLength).toBe(sourceBefore.byteLength);
  expect(sourceAfter.equals(sourceBefore)).toBe(true);
  expect(nonLocalRequests).toEqual([]);
  expect(mutatingRequests).toEqual([]);
});

test('review-needed automatic pages block export until a manual layout override restores crops', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(resolve('tests/fixtures/generated/e2e-blank.pdf'));
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('review-needed-page')).toBeVisible();
  await expect(page.getByTestId('crop-overlay').locator('li')).toHaveCount(0);

  await expect(page.getByTestId('review-needed-notice')).toContainText('확인한 뒤 내려받을');
  await expect(page.getByTestId('convert-button')).toBeDisabled();

  await page.getByTestId('layout-one-up').click();
  await expect(page.getByTestId('crop-overlay').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('convert-button')).toBeEnabled();
  await page.getByTestId('convert-button').click();
  await expect(page.getByTestId('success-message')).toContainText('쪽 준비됨', { timeout: 30_000 });
});

test('export failure is graceful and preserves the edit workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(resolve('tests/fixtures/generated/e2e-mixed.pdf'));
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    window.__pdfSlideSplitterTestHooks = { failNextExport: true };
  });
  await page.getByTestId('convert-button').click();
  await expect(page.getByTestId('error-message')).toContainText('PDF를 만들지 못했습니다');
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('inspector-panel')).toBeVisible();
});

async function openSavedMenu(page: Page): Promise<void> {
  const menu = page.getByTestId('saved-layout-menu');
  if (!(await menu.isVisible())) await page.getByTestId('saved-layout-menu-button').click();
  await expect(menu).toBeVisible();
}

test('keeps the page rail scrolled when the clicked page is already visible', async ({ page }) => {
  test.setTimeout(180_000);
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 85; index += 1) {
    const pdfPage = pdf.addPage([640, 480]);
    pdfPage.drawRectangle({ x: 36, y: 36, width: 180, height: 100, color: rgb(0.12, 0.35, 0.7) });
  }
  const railPath = resolve('tests/fixtures/generated/e2e-rail.pdf');
  await mkdir(dirname(railPath), { recursive: true });
  await writeFile(railPath, await pdf.save());

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(railPath);
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 180_000 });
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

  await page.getByRole('button', { name: '60쪽', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('crop-overlay')).toHaveAttribute('aria-label', '85쪽 자르기 영역');
  await expect.poll(() => rail.evaluate((node) => (node as HTMLElement).scrollTop)).toBeGreaterThan(before);
});

function parseCropSize(label: string | null): { width: number; height: number } {
  const match = /가로 ([0-9.]+) × 세로 ([0-9.]+)/.exec(label ?? '');
  if (!match) throw new Error(`Unable to parse crop size from label: ${label}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function selectPreviewPage(page: Page, pageNumber: number): Promise<void> {
  await page.getByRole('button', { name: `${pageNumber}쪽`, exact: true }).click();
  await expect(page.getByTestId('crop-overlay')).toHaveAttribute('aria-label', `${pageNumber}쪽 자르기 영역`);
}

async function expectSelectedPageCropLayout(
  page: Page,
  pageNumber: number,
  layoutId: string,
  cropCount: number,
): Promise<void> {
  await expect(page.getByTestId('crop-overlay')).toHaveAttribute('aria-label', `${pageNumber}쪽 자르기 영역`);
  await expect(page.getByTestId('preview-summary')).toHaveAttribute('data-layout-id', layoutId);
  await expect(page.getByTestId('preview-summary')).toContainText(`출력 ${cropCount}장`);
  await expect(page.getByTestId('crop-overlay').locator('li')).toHaveCount(cropCount);
}

async function readBrowserStorageSnapshot(page: Page): Promise<{
  cacheKeys: string[];
  indexedDbNames: string[];
  localStorageKeys: string[];
  sessionStorageKeys: string[];
}> {
  return page.evaluate(async () => {
    function storageKeys(storage: Storage): string[] {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) keys.push(key);
      }
      return keys.sort();
    }

    const indexedDb = window.indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };

    return {
      cacheKeys: 'caches' in window ? (await caches.keys()).sort() : [],
      indexedDbNames: indexedDb.databases
        ? (await indexedDb.databases()).flatMap((database) => (database.name ? [database.name] : [])).sort()
        : [],
      localStorageKeys: storageKeys(localStorage),
      sessionStorageKeys: storageKeys(sessionStorage),
    };
  });
}
