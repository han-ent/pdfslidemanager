import { expect, test } from '@playwright/test';
import { writeFixture } from '../fixtures/generate-fixtures';

const PORTRAIT_FIXTURE = 'tests/fixtures/generated/e2e-portrait-2x3.pdf';

test.beforeAll(async () => {
  // A4 portrait 2x3 handout: taller than the preview height cap on a normal laptop viewport.
  await writeFixture(PORTRAIT_FIXTURE, [{ layoutId: 'two-by-three', width: 595.28, height: 841.89 }]);
});

test.use({ viewport: { width: 1440, height: 900 } });

test('crop overlay is drawn over the same box as the rendered portrait page bitmap', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(PORTRAIT_FIXTURE);
  await expect(page.getByTestId('crop-overlay-item')).toHaveCount(6);
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="pdf-canvas"]');
    return Boolean(canvas && canvas.width > 300 && canvas.style.height);
  });

  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="pdf-canvas"]')!;
    const overlay = document.querySelector<HTMLElement>('[data-testid="crop-overlay"]')!;
    const box = canvas.getBoundingClientRect();
    const overlayBox = overlay.getBoundingClientRect();
    return {
      bitmapAspect: canvas.width / canvas.height,
      boxAspect: box.width / box.height,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      overlay: { x: overlayBox.x, y: overlayBox.y, width: overlayBox.width, height: overlayBox.height },
    };
  });

  // No object-fit letterboxing: the element box has the bitmap's aspect ratio...
  expect(Math.abs(geometry.boxAspect - geometry.bitmapAspect)).toBeLessThan(0.01);
  // ...and the crop overlay covers exactly that box.
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(geometry.overlay[key] - geometry.box[key])).toBeLessThan(1);
  }
});
