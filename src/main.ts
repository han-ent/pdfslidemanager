import './styles.css';
import { ko } from './i18n/ko';
import { createSplitPdf } from './pdf/convert';
import { applyCropBoxOverride, applyCropTemplateToPageRange, applyLayoutToPageRange, applyOutputCropBoxesOverride, buildConversionPlan, createDetectedPagePlan, pageNumbersWithSameInitialLayout, updatePageLayout } from './pdf/grid';
import { suggestLayoutFromImage, suggestLayoutFromPageBox, type LayoutSuggestion } from './pdf/layout-detect';
import { readPdfFile, type LoadedPdf } from './pdf/load';
import { renderPdfPageForAnalysisWithMetadata, renderPdfPageToCanvas } from './pdf/render';
import { initialState, reducer, type AppState } from './state/store';
import type { AnalysisRenderMetadata, DetectionSource, LayoutPresetId, PagePlan } from './types';
import { clear, element } from './ui/dom';
import { createDropZone } from './ui/dropzone';
import { createExportPanel, describeExportDisabledReason, installNoUploadNetworkGuard } from './ui/export';
import { createInspectorPanel, type InspectorDraft } from './ui/page-range-editor';
import { createPreviewStage, createThumbnailRail, renderExpectedOutputPreviews, syncPreviewSurfaceToCanvas, syncThumbnailRailScroll, type PreviewCropBoxChange, type PreviewCropBoxesChange } from './ui/preview';

declare global {
  interface Window {
    __pdfSlideSplitterTestHooks?: {
      failNextExport?: boolean;
      attemptNetworkDuringExport?: boolean;
      blockedNetworkEvents?: string[];
      guardProbe?: {
        fetchBlocked?: boolean;
        fetchError?: string;
        sendBeaconReturn?: boolean;
      };
    };
  }
}

document.documentElement.lang = ko.htmlLang;
document.title = ko.appTitle;
document.querySelector('meta[name="description"]')?.setAttribute('content', ko.metaDescription);

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error(ko.appRootMissing);
}
const app: HTMLDivElement = appRoot;

let state: AppState = { ...initialState };
let loadedPdf: LoadedPdf | null = null;
let objectUrl = '';
let renderGeneration = 0;
let railScrollTop = 0;
let previousSelectedPageIndex = -1;
let inspectorDraft: InspectorDraft = { scope: 'page', range: '', menuOpen: false };

function resetTransientUi(): void {
  railScrollTop = 0;
  previousSelectedPageIndex = -1;
  inspectorDraft = { scope: 'page', range: '', menuOpen: false };
}

function dispatch(action: Parameters<typeof reducer>[1]): void {
  state = reducer(state, action);
  renderApp();
}

function renderApp(): void {
  renderGeneration += 1;
  const generation = renderGeneration;
  const existingRail = app.querySelector<HTMLElement>('.thumbnail-rail');
  if (existingRail) {
    const lockedScroll = existingRail.dataset.lockedScroll;
    railScrollTop = lockedScroll !== undefined ? Number(lockedScroll) : existingRail.scrollTop;
  }
  const selectionChanged = state.selectedPageIndex !== previousSelectedPageIndex;
  const restoreRailFocus = Boolean(existingRail?.contains(document.activeElement));
  clear(app);
  const statusRegion = createStatusRegion();
  app.append(createHeader(), ...(statusRegion ? [statusRegion] : []));

  if (state.phase === 'empty' || state.phase === 'loading') {
    app.append(
      element('main', { className: 'empty-shell' }, [
        createDropZone({ onFile: handleFile }),
        createPrivacyChecklist(),
      ]),
    );
    return;
  }

  const selectedPage = state.pages[state.selectedPageIndex] ?? state.pages[0];
  if (!selectedPage) {
    app.append(
      element('main', { className: 'empty-shell' }, [
        element('div', { className: 'notice notice-error', text: ko.noPagePlan }),
      ]),
    );
    return;
  }

  const workspace = element('main', { className: 'workspace', attrs: { 'data-testid': 'workspace' } });
  workspace.append(
    createThumbnailRail({
      pages: state.pages,
      selectedPageIndex: state.selectedPageIndex,
      onSelectPage: (pageIndex) => dispatch({ type: 'select-page', pageIndex }),
    }),
    createPreviewStage(selectedPage, {
      onUpdateCropBox: handleCropBoxUpdate,
      onUpdateCropBoxes: handleCropBoxesUpdate,
    }),
    element('div', { className: 'side-stack' }, [
      createInspectorPanel({
        page: selectedPage,
        pageCount: state.pages.length,
        savedLayouts: state.savedLayouts,
        selectedSavedLayoutId: state.selectedSavedLayoutId ?? '',
        saveCurrentLayoutDisabledReason: getSaveCurrentLayoutDisabledReason(selectedPage),
        similarPageRange: similarPageRange(),
        draft: inspectorDraft,
        onDraftChange: (draft) => {
          inspectorDraft = draft;
        },
        onLayoutChange: handleLayoutChange,
        onApplyRange: handleApplyRange,
        onApplyCurrentTemplateToRange: handleApplyCurrentTemplateToRange,
        onResetPage: handleResetPage,
        onSaveCurrentLayout: handleSaveCurrentLayout,
        onSelectSavedLayout: handleSelectSavedLayout,
        onRenameSavedLayout: handleRenameSavedLayout,
        onUpdateSavedLayout: handleUpdateSavedLayout,
        onDeleteSavedLayout: handleDeleteSavedLayout,
        onApplySavedLayout: handleApplySavedLayout,
      }),
      createExportPanel({
        state,
        objectUrl,
        onConvert: handleConvert,
        onReset: resetApp,
      }),
    ]),
  );
  app.append(workspace);
  const rail = app.querySelector<HTMLElement>('.thumbnail-rail');
  if (rail) syncThumbnailRailScroll(rail, railScrollTop, selectionChanged, restoreRailFocus);
  previousSelectedPageIndex = state.selectedPageIndex;

  void renderSelectedCanvas(selectedPage, generation);
}

function createHeader(): HTMLElement {
  return element('header', { className: 'top-bar' }, [
    element('div', { className: 'brand-block' }, [
      element('span', { className: 'brand-mark', text: ko.brandMark }),
      element('div', {}, [
        element('strong', { text: ko.appTitle }),
        element('span', { text: ko.brandSubtitle }),
      ]),
    ]),
    element('div', { className: 'top-actions' }, [
      element('span', { className: 'privacy-badge', text: ko.privacyBadge }),
      element('a', {
        className: 'help-link',
        text: ko.helpLink,
        attrs: { href: '#limitations' },
      }),
    ]),
  ]);
}

function createStatusRegion(): HTMLElement | null {
  const text = state.errorMessage || state.statusMessage;
  if (!text) return null;
  const statusClass = state.errorMessage ? 'status-region has-error' : 'status-region';
  return element('section', {
    className: statusClass,
    text,
    attrs: {
      'aria-live': state.phase === 'processing' || state.phase === 'error' ? 'assertive' : 'polite',
      'data-testid': 'status-region',
    },
  });
}

function createPrivacyChecklist(): HTMLElement {
  return element('section', { className: 'privacy-checklist', attrs: { id: 'limitations' } }, [
    element('article', {}, [
      element('h2', { text: ko.privacyLocalTitle }),
      element('p', { text: ko.privacyLocalBody }),
    ]),
    element('article', {}, [
      element('h2', { text: ko.privacyReviewTitle }),
      element('p', { text: ko.privacyReviewBody }),
    ]),
    element('article', {}, [
      element('h2', { text: ko.privacyOutputTitle }),
      element('p', { text: ko.privacyOutputBody }),
    ]),
  ]);
}

async function handleFile(file: File): Promise<void> {
  try {
    resetTransientUi();
    dispatch({ type: 'loading', message: ko.readingFile(file.name) });
    if (loadedPdf?.pdfJsDocument.destroy) {
      await loadedPdf.pdfJsDocument.destroy();
    }
    revokeObjectUrl();
    loadedPdf = await readPdfFile(file);
    const pages = await buildInitialPagePlans(loadedPdf);
    const initialPages = clonePagePlans(pages);
    const plan = buildConversionPlan(file.name, pages, loadedPdf.bytes.byteLength);
    dispatch({
      type: 'loaded',
      sourceFileName: file.name,
      sourceByteLength: loadedPdf.bytes.byteLength,
      sourceHash: loadedPdf.sourceHash,
      pages,
      initialPages,
      plan,
    });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

async function buildInitialPagePlans(pdf: LoadedPdf): Promise<PagePlan[]> {
  const pages: PagePlan[] = [];
  for (let index = 0; index < pdf.pageBoxes.length; index += 1) {
    const pageBox = pdf.pageBoxes[index];
    if (!pageBox) continue;
    dispatch({ type: 'loading', message: ko.analyzingPage(index + 1, pdf.pageBoxes.length) });
    try {
      const analysis = await renderPdfPageForAnalysisWithMetadata(pdf.pdfJsDocument, index + 1, 360);
      pdf.pdfJsDocument.cleanup?.();
      const suggestion = suggestLayoutFromImage(analysis.imageData, pageBox);
      pages.push(createDetectedPlanFromSuggestion(index, pageBox, suggestion, 'projection-profile', analysis.metadata));
    } catch {
      const suggestion = suggestLayoutFromPageBox(pageBox);
      pages.push(createDetectedPlanFromSuggestion(index, pageBox, {
        ...suggestion,
        confidence: 'review-needed',
        reviewState: 'review-needed',
        reason: ko.analysisFailed(suggestion.reason),
      }, 'analysis-failed'));
    }
  }
  return pages;
}

function createDetectedPlanFromSuggestion(
  pageIndex: number,
  pageBox: PagePlan['pageBox'],
  suggestion: LayoutSuggestion,
  source: DetectionSource,
  analysis?: AnalysisRenderMetadata,
): PagePlan {
  return createDetectedPagePlan(pageIndex, pageBox, {
    layoutId: suggestion.layoutId,
    ...(suggestion.grid ? { grid: suggestion.grid } : {}),
    confidence: suggestion.confidence,
    ...(suggestion.reviewState ? { reviewState: suggestion.reviewState } : {}),
    reason: suggestion.reason,
    score: suggestion.score,
    source,
    detection: { ...suggestion.detection, source, ...(suggestion.detection.render ? {} : analysis ? { render: analysis } : {}) },
    visualCropRects: suggestion.visualCropRects,
    ...(analysis ? { analysis } : {}),
  });
}

async function renderSelectedCanvas(page: PagePlan, generation: number): Promise<void> {
  const canvas = app.querySelector<HTMLCanvasElement>('[data-testid="pdf-canvas"]');
  if (!loadedPdf || !canvas) return;
  try {
    await renderPdfPageToCanvas(loadedPdf.pdfJsDocument, page.pageNumber, canvas, 860);
    if (generation === renderGeneration) {
      syncPreviewSurfaceToCanvas(canvas);
      renderExpectedOutputPreviews(page, canvas, app);
    }
  } catch (error) {
    if (generation === renderGeneration) {
      dispatch({ type: 'error', message: ko.previewFailed(getErrorMessage(error)) });
    }
  }
}

function handleLayoutChange(layoutId: LayoutPresetId): void {
  updatePages((pages) => pages.map((page, index) => (index === state.selectedPageIndex ? updatePageLayout(page, layoutId) : page)));
}

function handleApplyRange(range: string, layoutId: LayoutPresetId): void {
  try {
    updatePages((pages) => applyLayoutToPageRange(pages, range, layoutId));
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function similarPageRange(): string {
  return pageNumbersWithSameInitialLayout(
    state.pages.length,
    state.initialPages.map((page) => page.layoutId),
    state.pages.map((page) => page.layoutId),
    state.selectedPageIndex,
  ).join(',');
}

function handleApplyCurrentTemplateToRange(range: string): void {
  const selectedPage = state.pages[state.selectedPageIndex];
  if (!selectedPage) return;
  try {
    updatePages((pages) => applyCropTemplateToPageRange(pages, range, selectedPage));
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleCropBoxUpdate(change: PreviewCropBoxChange): void {
  try {
    updatePages((pages) => pages.map((page) => {
      if (page.pageIndex !== change.pageIndex) return page;
      return applyCropBoxOverride(page, {
        cropBoxes: change.cropBoxes,
        reason: `User adjusted crop ${change.cropIndex + 1} with ${change.interaction}.`,
      });
    }));
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleCropBoxesUpdate(change: PreviewCropBoxesChange): void {
  try {
    updatePages((pages) => pages.map((page) => {
      if (page.pageIndex !== change.pageIndex) return page;
      return applyOutputCropBoxesOverride(page, change.cropBoxes, outputCropBoxesUpdateReason(change));
    }));
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function outputCropBoxesUpdateReason(change: PreviewCropBoxesChange): string {
  if (change.interaction === 'delete') return `User deleted output slide ${(change.fromIndex ?? 0) + 1}.`;
  if (change.interaction === 'reorder') return `User moved output slide ${(change.fromIndex ?? 0) + 1} to position ${(change.toIndex ?? 0) + 1}.`;
  return 'User edited output slide pages.';
}

function handleResetPage(): void {
  const original = state.initialPages[state.selectedPageIndex];
  if (!original) return;
  updatePages((pages) => pages.map((page, index) => (index === state.selectedPageIndex ? clonePagePlan(original) : page)));
}

function updatePages(pagesOrUpdater: PagePlan[] | ((pages: readonly PagePlan[]) => PagePlan[])): void {
  const pages = typeof pagesOrUpdater === 'function' ? pagesOrUpdater(state.pages) : pagesOrUpdater;
  const plan = buildConversionPlan(state.sourceFileName, pages, state.sourceByteLength);
  dispatch({ type: 'update-pages', pages, plan });
}

function handleSaveCurrentLayout(): void {
  const selectedPage = state.pages[state.selectedPageIndex];
  if (!selectedPage) return;
  const disabledReason = getSaveCurrentLayoutDisabledReason(selectedPage);
  if (disabledReason) {
    dispatch({ type: 'error', message: disabledReason });
    return;
  }

  try {
    dispatch({ type: 'save-saved-layout', page: selectedPage });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleSelectSavedLayout(layoutId: string): void {
  try {
    dispatch({ type: 'select-saved-layout', savedLayoutId: layoutId || null });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleRenameSavedLayout(layoutId: string, name: string): void {
  try {
    dispatch({ type: 'rename-saved-layout', savedLayoutId: layoutId, name });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleUpdateSavedLayout(layoutId: string): void {
  const selectedPage = state.pages[state.selectedPageIndex];
  if (!selectedPage) return;
  const disabledReason = getSaveCurrentLayoutDisabledReason(selectedPage);
  if (disabledReason) {
    dispatch({ type: 'error', message: disabledReason });
    return;
  }

  try {
    dispatch({ type: 'update-saved-layout', savedLayoutId: layoutId, page: selectedPage });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleDeleteSavedLayout(layoutId: string): void {
  try {
    dispatch({ type: 'delete-saved-layout', savedLayoutId: layoutId });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleApplySavedLayout(range: string, layoutId: string): void {
  try {
    dispatch({ type: 'apply-saved-layout', savedLayoutId: layoutId, range });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function getSaveCurrentLayoutDisabledReason(page: PagePlan): string {
  if (page.reviewState === 'review-needed') return ko.saveReview;
  if (page.cropBoxes.length === 0) return ko.saveNoCrops;
  return '';
}

async function handleConvert(): Promise<void> {
  if (!loadedPdf || !state.plan) return;
  const disabledReason = describeExportDisabledReason({
    sourceBytes: loadedPdf.bytes,
    plan: state.plan,
    requireReview: state.pages.some((page) => page.reviewState === 'review-needed'),
    reviewAccepted: false,
  });
  if (disabledReason) {
    dispatch({ type: 'error', message: disabledReason });
    return;
  }
  const guard = installNoUploadNetworkGuard({
    onBlocked: (event) => {
      window.__pdfSlideSplitterTestHooks?.blockedNetworkEvents?.push(`${event.method} ${event.url}`);
    },
  });
  try {
    revokeObjectUrl();
    dispatch({ type: 'processing', message: ko.converting });
    if (window.__pdfSlideSplitterTestHooks?.attemptNetworkDuringExport) {
      window.__pdfSlideSplitterTestHooks.attemptNetworkDuringExport = false;
      await probeNoUploadGuardForTest();
    }
    if (window.__pdfSlideSplitterTestHooks?.failNextExport) {
      window.__pdfSlideSplitterTestHooks.failNextExport = false;
      throw new Error(ko.simulatedExportFailure);
    }
    const result = await createSplitPdf(loadedPdf.bytes, state.plan, (progress) => {
      dispatch({ type: 'processing', message: ko.convertingProgress(progress.completed, progress.total) });
    });
    objectUrl = URL.createObjectURL(new Blob([toArrayBuffer(result.bytes)], { type: 'application/pdf' }));
    dispatch({ type: 'success', result, message: ko.exportComplete(result.outputFileName) });
  } catch (error) {
    dispatch({ type: 'error', message: ko.exportFailed(getErrorMessage(error)) });
  } finally {
    guard.dispose();
  }
}

async function probeNoUploadGuardForTest(): Promise<void> {
  const hook = window.__pdfSlideSplitterTestHooks;
  if (!hook) return;
  hook.guardProbe = {};
  try {
    await fetch('/__pdf-slide-splitter-upload-probe', { method: 'POST', body: new Uint8Array([37, 80, 68, 70]) });
    hook.guardProbe.fetchBlocked = false;
  } catch (error) {
    hook.guardProbe.fetchBlocked = true;
    hook.guardProbe.fetchError = getErrorMessage(error);
  }
  hook.guardProbe.sendBeaconReturn = navigator.sendBeacon?.('/__pdf-slide-splitter-beacon-probe', new Uint8Array([1, 2, 3]));
}

function resetApp(): void {
  resetTransientUi();
  revokeObjectUrl();
  if (loadedPdf?.pdfJsDocument.destroy) {
    void loadedPdf.pdfJsDocument.destroy();
  }
  loadedPdf = null;
  dispatch({ type: 'reset' });
}

function clonePagePlans(pages: readonly PagePlan[]): PagePlan[] {
  return pages.map(clonePagePlan);
}

function clonePagePlan(page: PagePlan): PagePlan {
  const cropBoxes = page.cropBoxes.map((cropBox) => ({ ...cropBox }));
  const cloned: PagePlan = {
    ...page,
    grid: { ...page.grid, margin: { ...page.grid.margin }, gutter: { ...page.grid.gutter } },
    cropBoxes,
    crops: cropBoxes,
    cropOptions: {
      margin: { ...page.cropOptions.margin },
      gutter: { ...page.cropOptions.gutter },
    },
  };
  if (page.detection) cloned.detection = { ...page.detection, cropRects: [...page.detection.cropRects] };
  return cloned;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function revokeObjectUrl(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = '';
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let previewResizeFrame = 0;
window.addEventListener('resize', () => {
  if (previewResizeFrame) cancelAnimationFrame(previewResizeFrame);
  previewResizeFrame = requestAnimationFrame(() => {
    previewResizeFrame = 0;
    const canvas = app.querySelector<HTMLCanvasElement>('[data-testid="pdf-canvas"]');
    if (canvas && canvas.width > 0 && canvas.height > 0) syncPreviewSurfaceToCanvas(canvas);
  });
});

renderApp();
