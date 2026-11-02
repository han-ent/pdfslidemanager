import { describe, expect, it } from 'vitest';
import { degrees, PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { A4_LANDSCAPE_PAGE, convertPdfSlides, extractPageBoxes, fitCropWithinA4Landscape, rotatedDrawOrigin, visualCropSize } from '../../src/pdf/convert';
import { cropBoxesForGrid, gridForPreset, pdfBoxToVisualRect } from '../../src/pdf/grid';
import { suggestLayoutFromImage } from '../../src/pdf/layout-detect';
import { expectedOutputPreviewGeometry, fitPreviewDisplaySize } from '../../src/ui/preview';
import type { PageBox } from '../../src/types';

// Regression tests for "the slides in the preview don't exactly match" (see
// /workspace/review/pdfslidemanager-test for the synthetic-PDF harness that found these).

describe('preview canvas / overlay sizing', () => {
  it('keeps the bitmap aspect ratio for tall pages instead of stretching the overlay box', () => {
    // A4 portrait rendered at 860px wide (1216px tall) in an 922px frame with a 660px height cap.
    // Old CSS produced an 860x660 element box with an object-fit letterboxed bitmap inside it,
    // while the crop overlay used the full 860px width (~174px horizontal error per edge).
    const size = fitPreviewDisplaySize({ width: 860, height: 1216 }, { maxWidth: 922, maxHeight: 660 });
    expect(size.height).toBeCloseTo(660, 1);
    expect(size.width / size.height).toBeCloseTo(860 / 1216, 3);
    expect(size.width).toBeLessThan(470);
  });

  it('fills the available width for landscape pages that fit under the height cap', () => {
    const size = fitPreviewDisplaySize({ width: 1720, height: 1216 }, { maxWidth: 860, maxHeight: 900 });
    expect(size.width).toBeCloseTo(860, 1);
    expect(size.height).toBeCloseTo(608, 0);
  });

  it('returns an empty size for unusable inputs', () => {
    expect(fitPreviewDisplaySize({ width: 0, height: 100 }, { maxWidth: 500, maxHeight: 500 })).toEqual({ width: 0, height: 0 });
    expect(fitPreviewDisplaySize({ width: 100, height: 100 }, { maxWidth: 0, maxHeight: 500 })).toEqual({ width: 0, height: 0 });
  });
});

describe('rotated source pages', () => {
  it('uses the rotation-aware crop size for the expected output preview', () => {
    const pageBox: PageBox = { x: 0, y: 0, width: 595, height: 842, rotation: 90 };
    const crop = { x: 0, y: 0, width: 300, height: 400 }; // visually 400 wide x 300 tall
    const geometry = expectedOutputPreviewGeometry({ width: 842, height: 595 }, crop, pageBox, { width: 842, height: 595 });
    expect(geometry.drawWidth / geometry.drawHeight).toBeCloseTo(4 / 3, 2);
  });

  it.each([0, 90, 180, 270])('maps the visual top-left of the crop to the top-left of the A4 placement (rotation %i)', (rotation) => {
    const crop = { x: 40, y: 60, width: 300, height: 200 };
    const visual = visualCropSize(crop, rotation);
    const placement = fitCropWithinA4Landscape(visual);
    const origin = rotatedDrawOrigin(placement, rotation);
    const swapped = rotation === 90 || rotation === 270;
    const sx = (swapped ? placement.drawHeight : placement.drawWidth) / crop.width;
    const sy = (swapped ? placement.drawWidth : placement.drawHeight) / crop.height;
    const theta = (origin.rotate * Math.PI) / 180;
    // Same composition pdf-lib uses: translate(origin) · rotate(theta) · scale(sx, sy) · formMatrix(-left, -bottom)
    const map = (px: number, py: number): [number, number] => {
      const u = (px - crop.x) * sx;
      const v = (py - crop.y) * sy;
      return [origin.x + u * Math.cos(theta) - v * Math.sin(theta), origin.y + u * Math.sin(theta) + v * Math.cos(theta)];
    };
    // Visual top-left corner of the crop in unrotated PDF space, per PDF.js viewport conventions.
    const pageBox = { x: 0, y: 0, width: 1000, height: 1000, rotation };
    const corners: Array<[number, number]> = [
      [crop.x, crop.y],
      [crop.x + crop.width, crop.y],
      [crop.x, crop.y + crop.height],
      [crop.x + crop.width, crop.y + crop.height],
    ];
    const visualTopLeft = corners.find(([px, py]) => {
      const v = pdfBoxToVisualRect({ x: px, y: py, width: 0, height: 0 }, pageBox);
      const r = pdfBoxToVisualRect(crop, pageBox);
      return Math.abs(v.x - r.x) < 1e-6 && Math.abs(v.y - r.y) < 1e-6;
    });
    expect(visualTopLeft).toBeDefined();
    const [ox, oy] = map(...visualTopLeft!);
    expect(ox).toBeCloseTo(placement.drawX, 4);
    expect(oy).toBeCloseTo(placement.drawY + placement.drawHeight, 4);
  });

  it.each([90, 180, 270])('exports upright, correctly ordered slides from a /Rotate %i handout', async (rotation) => {
    const source = await createRotatedHandout(rotation);
    const [pageBox] = await extractPageBoxes(source);
    expect(pageBox?.rotation).toBe(rotation);
    const crops = cropBoxesForGrid(0, { mediaBox: pageBox! }, gridForPreset('two-by-two'));
    const { bytes } = await convertPdfSlides(source, { pages: [{ pageIndex: 0, pageNumber: 1, pageBox: pageBox!, cropBoxes: crops }] } as never);
    const regions = crops.map((crop) => fitCropWithinA4Landscape(visualCropSize(crop, rotation)));
    const texts = await outputTextPlacement(bytes, regions);
    expect(texts).toHaveLength(4);
    texts.forEach((text, index) => {
      expect(text.str).toBe(`S${index + 1}`);
      // Upright text: no rotation/flip in the final text matrix.
      expect(text.a).toBeGreaterThan(0);
      expect(Math.abs(text.b)).toBeLessThan(1e-3);
      // Label was drawn near the visual top-left of each slide.
      expect(text.x).toBeLessThan(A4_LANDSCAPE_PAGE.width / 2);
      expect(text.y).toBeGreaterThan(A4_LANDSCAPE_PAGE.height / 2);
    });
  });
});

describe('framed slide detection edges', () => {
  it('detects a single wide framed column (2-up portrait) even with an interior vertical stroke', () => {
    // 1 column x 2 rows, slides ~82% of page width. A tall glyph stem inside each slide used to be
    // picked as the right edge because single intervals were capped at 72% of the axis.
    const image = framedImage(300, 424, [
      { x: 27, y: 24, width: 246, height: 184 },
      { x: 27, y: 220, width: 246, height: 184 },
    ], (set) => {
      for (const top of [24, 220]) for (let y = top + 50; y < top + 140; y += 1) for (let x = 140; x < 145; x += 1) set(x, y);
    });
    const suggestion = suggestLayoutFromImage(image, { x: 0, y: 0, width: 300, height: 424 });
    expect(suggestion.layoutId).toBe('two-up-vertical');
    expect(suggestion.visualCropRects).toHaveLength(2);
    for (const rect of suggestion.visualCropRects) {
      expect(rect.x).toBeLessThanOrEqual(27);
      expect(rect.x + rect.width).toBeGreaterThanOrEqual(274);
    }
  });

  it('keeps the slide frame lines inside the detected crop on every side', () => {
    const frames = [
      { x: 20, y: 30, width: 120, height: 90 },
      { x: 160, y: 30, width: 120, height: 90 },
      { x: 20, y: 140, width: 120, height: 90 },
      { x: 160, y: 140, width: 120, height: 90 },
    ];
    const suggestion = suggestLayoutFromImage(framedImage(300, 260, frames), { x: 0, y: 0, width: 300, height: 260 });
    expect(suggestion.visualCropRects).toHaveLength(4);
    suggestion.visualCropRects.forEach((rect, index) => {
      const frame = frames[index]!;
      expect(rect.x).toBeLessThanOrEqual(frame.x);
      expect(rect.y).toBeLessThanOrEqual(frame.y);
      expect(rect.x + rect.width).toBeGreaterThanOrEqual(frame.x + frame.width + 1);
      expect(rect.y + rect.height).toBeGreaterThanOrEqual(frame.y + frame.height + 1);
      // ...without swallowing the gutter.
      expect(rect.width).toBeLessThan(frame.width + 6);
      expect(rect.height).toBeLessThan(frame.height + 6);
    });
  });
});

function framedImage(
  width: number,
  height: number,
  frames: Array<{ x: number; y: number; width: number; height: number }>,
  extra?: (set: (x: number, y: number) => void) => void,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const set = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    data[offset] = 20;
    data[offset + 1] = 20;
    data[offset + 2] = 20;
  };
  for (const f of frames) {
    for (let dx = 0; dx <= f.width; dx += 1) {
      set(f.x + dx, f.y);
      set(f.x + dx, f.y + f.height);
    }
    for (let dy = 0; dy <= f.height; dy += 1) {
      set(f.x, f.y + dy);
      set(f.x + f.width, f.y + dy);
    }
  }
  extra?.(set);
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

/** A4 portrait page whose content is drawn sideways/upside-down so that /Rotate makes a normal 2x2 handout. */
async function createRotatedHandout(rotation: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const page = doc.addPage([W, H]);
  page.setRotation(degrees(rotation));
  const swapped = rotation === 90 || rotation === 270;
  const vw = swapped ? H : W;
  const vh = swapped ? W : H;
  const toPdf = (vx: number, vy: number): [number, number] => {
    switch (rotation) {
      case 90: return [vy, vx];
      case 180: return [W - vx, vy];
      case 270: return [W - vy, H - vx];
      default: return [vx, H - vy];
    }
  };
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const order = row * 2 + column + 1;
      const [a0, a1] = toPdf((column * vw) / 2 + 10, (row * vh) / 2 + 10);
      const [b0, b1] = toPdf(((column + 1) * vw) / 2 - 10, ((row + 1) * vh) / 2 - 10);
      page.drawRectangle({ x: Math.min(a0, b0), y: Math.min(a1, b1), width: Math.abs(a0 - b0), height: Math.abs(a1 - b1), borderColor: rgb(0, 0, 0), borderWidth: 2 });
      const [tx, ty] = toPdf((column * vw) / 2 + 30, (row * vh) / 2 + 60);
      page.drawText(`S${order}`, { x: tx, y: ty, size: 24, font, rotate: degrees(rotation) });
    }
  }
  return doc.save();
}

async function outputTextPlacement(
  bytes: Uint8Array,
  regions: ReadonlyArray<{ drawX: number; drawY: number; drawWidth: number; drawHeight: number }>,
): Promise<Array<{ str: string; a: number; b: number; x: number; y: number }>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const results: Array<{ str: string; a: number; b: number; x: number; y: number }> = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [a, b, , , x, y] = item.transform as number[];
        // Embedded pages keep the whole source content stream; the form BBox clips the rest
        // visually but getTextContent() still reports it, so keep only text inside the drawn slide.
        const region = regions[pageNumber - 1]!;
        if (x! < region.drawX || y! < region.drawY || x! > region.drawX + region.drawWidth || y! > region.drawY + region.drawHeight) continue;
        results.push({ str: item.str, a: a!, b: b!, x: x!, y: y! });
      }
    }
    return results;
  } finally {
    await task.destroy();
  }
}
