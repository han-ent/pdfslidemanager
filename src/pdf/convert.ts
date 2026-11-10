import { degrees, PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import { ko } from '../i18n/ko';
import type { ConversionPlan as AppConversionPlan, CropBox, ExportResult, PageBox, PdfBox, WorkloadWarning } from '../types';
import { assertCropBoxesBounded } from './grid';
import { hashBytes } from './hash';

export type ConversionPlan = AppConversionPlan | LegacyConvertPlan;

export const A4_LANDSCAPE_PAGE = Object.freeze({
  width: 841.889764,
  height: 595.275591,
});

export const A4_LANDSCAPE_BACKGROUND = Object.freeze({
  red: 1,
  green: 1,
  blue: 1,
});

export interface ConversionProgress {
  completed: number;
  total: number;
  label: string;
}

export interface LegacyConvertPlan {
  regions?: Array<{ sourcePageIndex: number; cropBox: PdfBox | { left: number; bottom: number; width: number; height: number }; label?: string }>;
  sourcePageCount?: number;
}

export async function createSplitPdf(
  sourceBytes: Uint8Array,
  plan: AppConversionPlan,
  onProgress?: (progress: ConversionProgress) => void,
): Promise<ExportResult> {
  const result = await convertPdfSlides(sourceBytes, plan, onProgress);
  const sourceHash = await hashBytes(sourceBytes);
  return {
    bytes: result.bytes,
    outputFileName: plan.outputFileName,
    outputPageCount: result.outputPageCount,
    sourceHashBefore: sourceHash,
    sourceHashAfter: await hashBytes(sourceBytes),
  };
}

export async function convertPdfSlides(
  sourceBytes: Uint8Array,
  plan: AppConversionPlan | LegacyConvertPlan,
  onProgress?: (progress: ConversionProgress) => void,
): Promise<{ bytes: Uint8Array; outputPageCount: number; sourceHashBefore: string; sourceHashAfter: string }> {
  const sourceHashBefore = await hashBytes(sourceBytes);
  const sourceDoc = await PDFDocument.load(sourceBytes.slice(), { updateMetadata: false });
  const outputDoc = await PDFDocument.create();
  const sourcePages = sourceDoc.getPages();
  const regions = normalizeRegions(plan);
  let completed = 0;

  for (const region of regions) {
    const sourcePage = sourcePages[region.sourcePageIndex];
    if (!sourcePage) throw new Error(ko.sourcePageMissing(region.sourcePageIndex + 1));
    const pageBox = getEffectivePageBox(sourcePage);
    const crop = normalizeCropBox(region.cropBox);
    assertCropBoxesBounded([crop], pageBox);
    await appendCropPage(outputDoc, sourcePage, crop, pageBox.rotation ?? 0);
    completed += 1;
    onProgress?.({ completed, total: regions.length, label: region.label ?? String(completed) });
  }

  const bytes = await outputDoc.save({ useObjectStreams: true });
  return { bytes, outputPageCount: regions.length, sourceHashBefore, sourceHashAfter: await hashBytes(sourceBytes) };
}

export async function extractPageBoxes(sourceBytes: Uint8Array): Promise<PageBox[]> {
  const sourceDoc = await PDFDocument.load(sourceBytes.slice(), { updateMetadata: false });
  return sourceDoc.getPages().map(getEffectivePageBox);
}

export function getEffectivePageBox(page: PDFPage): PageBox {
  const cropBox = page.getCropBox();
  const mediaBox = page.getMediaBox();
  const effective = cropBox.width > 0 && cropBox.height > 0 ? cropBox : mediaBox;
  return {
    x: roundPdfPoint(effective.x),
    y: roundPdfPoint(effective.y),
    width: roundPdfPoint(effective.width),
    height: roundPdfPoint(effective.height),
    rotation: page.getRotation().angle,
  };
}

export function validateCropBox(cropBox: PdfBox | { left: number; bottom: number; width: number; height: number }, effectiveBox: PageBox | { left: number; bottom: number; width: number; height: number }, label = 'crop box'): CropBox {
  const crop = normalizeCropBox(cropBox);
  const pageBox = normalizePageBox(effectiveBox);
  assertCropBoxesBounded([crop], pageBox);
  return { ...crop, left: crop.x, bottom: crop.y, pageIndex: 0, pageNumber: 1, order: 1, label, row: 0, column: 0 };
}

export function createWorkloadWarnings(input: {
  sourceBytes: number;
  sourcePageCount: number;
  estimatedOutputPages: number;
}): WorkloadWarning[] {
  const warnings: WorkloadWarning[] = [];
  if (input.sourceBytes > 100 * 1024 * 1024) warnings.push({ code: 'large-source-file', message: ko.warnLargeFile });
  if (input.sourcePageCount > 200) warnings.push({ code: 'many-source-pages', message: ko.warnManyPages });
  if (input.estimatedOutputPages > 1000) warnings.push({ code: 'many-output-pages', message: ko.warnManyOutput });
  return warnings;
}

export interface A4LandscapePlacement {
  pageWidth: number;
  pageHeight: number;
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
}

export function fitCropWithinA4Landscape(crop: Pick<PdfBox, 'width' | 'height'>): A4LandscapePlacement {
  if (crop.width <= 0 || crop.height <= 0) throw new RangeError(ko.cropPositive);
  const scale = Math.min(A4_LANDSCAPE_PAGE.width / crop.width, A4_LANDSCAPE_PAGE.height / crop.height);
  const drawWidth = roundPdfPoint(crop.width * scale);
  const drawHeight = roundPdfPoint(crop.height * scale);
  return {
    pageWidth: A4_LANDSCAPE_PAGE.width,
    pageHeight: A4_LANDSCAPE_PAGE.height,
    drawX: roundPdfPoint((A4_LANDSCAPE_PAGE.width - drawWidth) / 2),
    drawY: roundPdfPoint((A4_LANDSCAPE_PAGE.height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  };
}

/**
 * Size of a PDF-space crop as the reader sees it once the source page's /Rotate is applied.
 * PDF.js previews (and every PDF viewer) show rotated pages upright, so the A4 fit must use
 * this visual size, not the raw (unrotated) crop width/height.
 */
export function visualCropSize(crop: Pick<PdfBox, 'width' | 'height'>, rotation = 0): Pick<PdfBox, 'width' | 'height'> {
  const normalized = normalizePageRotation(rotation);
  return normalized === 90 || normalized === 270 ? { width: crop.height, height: crop.width } : { width: crop.width, height: crop.height };
}

/**
 * Where to anchor drawPage() so an embedded (unrotated) crop, rotated clockwise by the source
 * page's /Rotate, lands exactly on the contain-and-center placement rectangle.
 * pdf-lib rotates counter-clockwise around (x, y), so we pass -rotation.
 */
export function rotatedDrawOrigin(placement: A4LandscapePlacement, rotation = 0): { x: number; y: number; rotate: number } {
  const normalized = normalizePageRotation(rotation);
  const { drawX, drawY, drawWidth, drawHeight } = placement;
  switch (normalized) {
    case 90:
      return { x: drawX, y: drawY + drawHeight, rotate: -90 };
    case 180:
      return { x: drawX + drawWidth, y: drawY + drawHeight, rotate: -180 };
    case 270:
      return { x: drawX + drawWidth, y: drawY, rotate: -270 };
    case 0:
    default:
      return { x: drawX, y: drawY, rotate: 0 };
  }
}

async function appendCropPage(outputDoc: PDFDocument, sourcePage: PDFPage, crop: PdfBox, rotation: number): Promise<void> {
  const [embeddedPage] = await outputDoc.embedPages([sourcePage], [
    { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height },
  ]);
  if (!embeddedPage) throw new Error(ko.embedFailed);
  const visualSize = visualCropSize(crop, rotation);
  const placement = fitCropWithinA4Landscape(visualSize);
  const outputPage = outputDoc.addPage([placement.pageWidth, placement.pageHeight]);
  outputPage.drawRectangle({
    x: 0,
    y: 0,
    width: placement.pageWidth,
    height: placement.pageHeight,
    color: rgb(A4_LANDSCAPE_BACKGROUND.red, A4_LANDSCAPE_BACKGROUND.green, A4_LANDSCAPE_BACKGROUND.blue),
  });
  const normalizedRotation = normalizePageRotation(rotation);
  const swapped = normalizedRotation === 90 || normalizedRotation === 270;
  const origin = rotatedDrawOrigin(placement, rotation);
  outputPage.drawPage(embeddedPage, {
    x: origin.x,
    y: origin.y,
    // Width/height are in the embedded page's own (unrotated) axes.
    width: swapped ? placement.drawHeight : placement.drawWidth,
    height: swapped ? placement.drawWidth : placement.drawHeight,
    ...(origin.rotate !== 0 ? { rotate: degrees(origin.rotate) } : {}),
  });
}

function normalizePageRotation(rotation: number): number {
  return (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
}

function normalizeRegions(plan: AppConversionPlan | LegacyConvertPlan): Array<{ sourcePageIndex: number; cropBox: PdfBox | { left: number; bottom: number; width: number; height: number }; label?: string }> {
  if ('regions' in plan && plan.regions) return plan.regions;
  if ('pages' in plan) {
    return plan.pages.flatMap((page) => page.cropBoxes.map((cropBox) => ({ sourcePageIndex: page.pageIndex, cropBox, label: cropBox.label })));
  }
  return [];
}

function normalizeCropBox(crop: PdfBox | { left: number; bottom: number; width: number; height: number }): PdfBox {
  if ('left' in crop) return { x: crop.left, y: crop.bottom, width: crop.width, height: crop.height };
  return crop;
}

function normalizePageBox(box: PageBox | { left: number; bottom: number; width: number; height: number }): PageBox {
  if ('left' in box) return { x: box.left, y: box.bottom, width: box.width, height: box.height };
  return box;
}

function roundPdfPoint(value: number): number {
  return Number(value.toFixed(6));
}
