import { describe, expect, it } from 'vitest';
import { createInspectorPanel } from '../../src/ui/page-range-editor';
import type { CropBox, PagePlan, SavedLayoutTemplate } from '../../src/types';

describe('createInspectorPanel saved layout controls', () => {
  it('labels grid presets, saved crop layouts, and one-off crop copying as separate inspector sections', () => {
    const panel = createInspectorPanel({
      page: createPagePlan(),
      pageCount: 4,
      savedLayouts: [createSavedLayout('saved-layout-1', 'Opening crops')],
      selectedSavedLayoutId: 'saved-layout-1',
      onLayoutChange: () => undefined,
      onApplyRange: () => undefined,
      onApplyCurrentTemplateToRange: () => undefined,
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => undefined,
      onSelectSavedLayout: () => undefined,
      onRenameSavedLayout: () => undefined,
      onUpdateSavedLayout: () => undefined,
      onDeleteSavedLayout: () => undefined,
      onApplySavedLayout: () => undefined,
    });

    expectText(panel, '현재 쪽');
    expectText(panel, '1 / 4쪽');
    expectText(panel, '적용 범위');
    expectText(panel, '자르기 저장');
    expectText(panel, '이 쪽만');
    expectText(panel, '같은 모양 쪽 전부');
    expectText(panel, '범위 입력');
    expect(panel.textContent!.indexOf('1×1')).toBeLessThan(panel.textContent!.indexOf('적용 범위'));
    expect(panel.textContent!.indexOf('적용 범위')).toBeLessThan(panel.textContent!.indexOf('자르기 저장'));
    expect(panel.textContent).not.toContain('Crop spacing');
    expect(panel.textContent).not.toContain('Session only');
    expect(getByTestId(panel, 'layout-picker').getAttribute('aria-label')).toBe('레이아웃');
    expect(getInput(panel, 'range-input').getAttribute('aria-label')).toBe('적용할 쪽 범위');
    expect(panel.querySelector('[data-testid="range-layout-select"]')).toBeNull();
    expectText(getButton(panel, 'apply-range-button'), '적용');
    expectText(getButton(panel, 'apply-current-template-button'), '자르기 복사');
    getButton(panel, 'saved-layout-menu-button').click();
    expectText(getButton(panel, 'apply-saved-layout-button'), '저장본 적용');
  });

  it('shows an empty saved-layout state and disables saved-layout actions until a crop layout is saved', () => {
    const panel = createInspectorPanel({
      page: createPagePlan(),
      pageCount: 4,
      savedLayouts: [],
      onLayoutChange: () => undefined,
      onApplyRange: () => undefined,
      onApplyCurrentTemplateToRange: () => undefined,
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => undefined,
      onSelectSavedLayout: () => undefined,
      onRenameSavedLayout: () => undefined,
      onUpdateSavedLayout: () => undefined,
      onDeleteSavedLayout: () => undefined,
      onApplySavedLayout: () => undefined,
    });

    expectText(getByTestId(panel, 'saved-layout-empty-state'), '저장한 자르기가 없습니다');
    expect(getButton(panel, 'save-current-layout-button').disabled).toBe(false);
    expect(panel.querySelector('[data-testid="saved-layout-select"]')).toBeNull();
    expect(panel.querySelector('[data-testid="saved-layout-name-input"]')).toBeNull();
    expect(panel.querySelector('[data-testid="saved-layout-menu-button"]')).toBeNull();
    for (const testId of ['rename-saved-layout-button', 'update-saved-layout-button', 'apply-saved-layout-button', 'delete-saved-layout-button']) {
      expect(panel.querySelector(`[data-testid="${testId}"]`)).toBeNull();
    }
  });

  it('does not infer a selected saved layout when AppState has no selection', () => {
    const calls: string[] = [];
    const panel = createInspectorPanel({
      page: createPagePlan(),
      pageCount: 4,
      savedLayouts: [createSavedLayout('saved-layout-1', 'Layout 1'), createSavedLayout('saved-layout-2', 'Layout 2')],
      selectedSavedLayoutId: '',
      onLayoutChange: () => undefined,
      onApplyRange: () => undefined,
      onApplyCurrentTemplateToRange: () => undefined,
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => undefined,
      onSelectSavedLayout: (layoutId) => calls.push(`select:${layoutId}`),
      onRenameSavedLayout: (layoutId, name) => calls.push(`rename:${layoutId}:${name}`),
      onUpdateSavedLayout: (layoutId) => calls.push(`update:${layoutId}`),
      onDeleteSavedLayout: (layoutId) => calls.push(`delete:${layoutId}`),
      onApplySavedLayout: (range, layoutId) => calls.push(`apply:${range}:${layoutId}`),
    });

    const select = getSelect(panel, 'saved-layout-select');
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('');
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['저장 항목 선택', 'Layout 1', 'Layout 2']);
    expect(panel.querySelector('[data-testid="saved-layout-name-input"]')).toBeNull();
    getButton(panel, 'saved-layout-menu-button').click();
    expectText(panel, '항목을 고르면');
    for (const testId of ['rename-saved-layout-button', 'update-saved-layout-button', 'apply-saved-layout-button', 'delete-saved-layout-button']) {
      expect(panel.querySelector(`[data-testid="${testId}"]`)).toBeNull();
    }

    select.value = 'saved-layout-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(calls).toEqual(['select:saved-layout-1', 'apply:1:saved-layout-1']);
  });

  it('disables saving or updating the current page when it needs review or has no crop boxes', () => {
    const reviewPanel = createInspectorPanel({
      page: createPagePlan({ reviewState: 'review-needed' }),
      pageCount: 1,
      saveCurrentLayoutDisabledReason: '확인이 필요한 쪽은 저장할 수 없습니다. 레이아웃을 먼저 고르세요.',
      onLayoutChange: () => undefined,
      onApplyRange: () => undefined,
      onApplyCurrentTemplateToRange: () => undefined,
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => undefined,
    });

    const reviewSave = getButton(reviewPanel, 'save-current-layout-button');
    expect(reviewSave.disabled).toBe(true);
    expect(reviewSave.title).toMatch(/확인이 필요/);

    const noCropPanel = createInspectorPanel({
      page: createPagePlan({ cropBoxes: [] }),
      pageCount: 1,
      savedLayouts: [createSavedLayout('saved-layout-1', 'Layout 1')],
      selectedSavedLayoutId: 'saved-layout-1',
      saveCurrentLayoutDisabledReason: '저장할 자르기 영역이 없습니다.',
      onLayoutChange: () => undefined,
      onApplyRange: () => undefined,
      onApplyCurrentTemplateToRange: () => undefined,
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => undefined,
      onUpdateSavedLayout: () => undefined,
    });

    const noCropSave = getButton(noCropPanel, 'save-current-layout-button');
    const noCropUpdate = getButton(noCropPanel, 'update-saved-layout-button');
    expect(noCropSave.disabled).toBe(true);
    expect(noCropUpdate.disabled).toBe(true);
    expect(noCropUpdate.title).toMatch(/자르기 영역이 없습니다/);
    expectText(getByTestId(noCropPanel, 'saved-layout-disabled-reason'), '저장할 자르기 영역이 없습니다');
  });

  it('wires grid preset, current crop copy, and saved crop layout callbacks separately', () => {
    const calls: string[] = [];
    const panel = createInspectorPanel({
      page: createPagePlan(),
      pageCount: 4,
      savedLayouts: [createSavedLayout('saved-layout-1', 'Layout 1'), createSavedLayout('saved-layout-2', 'Layout 2')],
      selectedSavedLayoutId: 'saved-layout-2',
      onLayoutChange: (layoutId) => calls.push(`grid-selected:${layoutId}`),
      onApplyRange: (range, layoutId) => calls.push(`grid-range:${range}:${layoutId}`),
      onApplyCurrentTemplateToRange: (range) => calls.push(`copy-current:${range}`),
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => calls.push('save'),
      onSelectSavedLayout: (layoutId) => calls.push(`select:${layoutId}`),
      onRenameSavedLayout: (layoutId, name) => calls.push(`rename:${layoutId}:${name}`),
      onUpdateSavedLayout: (layoutId) => calls.push(`update:${layoutId}`),
      onDeleteSavedLayout: (layoutId) => calls.push(`delete:${layoutId}`),
      onApplySavedLayout: (range, layoutId) => calls.push(`apply:${range}:${layoutId}`),
    });

    getButton(panel, 'layout-three-by-two').click();
    const rangeScope = getInput(panel, 'apply-scope-range');
    rangeScope.checked = true;
    rangeScope.dispatchEvent(new Event('change', { bubbles: true }));
    getInput(panel, 'range-input').value = '2, 4';
    getButton(panel, 'apply-range-button').click();
    getButton(panel, 'apply-current-template-button').click();
    getButton(panel, 'save-current-layout-button').click();

    const select = getSelect(panel, 'saved-layout-select');
    expect(select.value).toBe('saved-layout-2');
    select.value = 'saved-layout-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const nameInput = getInput(panel, 'saved-layout-name-input');
    expect(nameInput.value).toBe('Layout 2');
    nameInput.value = 'Lecture Slides';
    getButton(panel, 'rename-saved-layout-button').click();

    getButton(panel, 'update-saved-layout-button').click();

    getInput(panel, 'range-input').value = '2, 4';
    getButton(panel, 'apply-saved-layout-button').click();
    getButton(panel, 'delete-saved-layout-button').click();

    expect(calls).toEqual([
      'grid-selected:three-by-two',
      'grid-range:2, 4:two-up-horizontal',
      'copy-current:2, 4',
      'save',
      'select:saved-layout-1',
      'apply:2, 4:saved-layout-1',
      'rename:saved-layout-2:Lecture Slides',
      'update:saved-layout-2',
      'apply:2, 4:saved-layout-2',
      'delete:saved-layout-2',
    ]);
  });
});

function expectText(element: HTMLElement, expected: string): void {
  expect(element.textContent).toContain(expected);
}

function getByTestId(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  expect(element).not.toBeNull();
  return element!;
}

function getButton(container: HTMLElement, testId: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(button).not.toBeNull();
  return button!;
}

function getInput(container: HTMLElement, testId: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  expect(input).not.toBeNull();
  return input!;
}

function getSelect(container: HTMLElement, testId: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`);
  expect(select).not.toBeNull();
  return select!;
}

function createPagePlan(overrides: Partial<PagePlan> = {}): PagePlan {
  const pageIndex = overrides.pageIndex ?? 0;
  const pageNumber = pageIndex + 1;
  const pageBox = { x: 0, y: 0, width: 612, height: 792 };
  const cropBoxes = overrides.cropBoxes ?? [createCropBox(pageIndex, pageNumber)];

  return {
    pageIndex,
    pageNumber,
    layoutId: 'two-up-horizontal',
    layout: 'two-up-horizontal',
    grid: { id: 'two-up-horizontal', label: '2-up horizontal', columns: 2, rows: 1, readingOrder: 'row-major' },
    pageBox,
    boxes: { mediaBox: pageBox },
    cropBoxes,
    crops: cropBoxes,
    confidence: 'high',
    reviewState: 'ready',
    reason: 'Test page plan.',
    score: 1,
    overridden: false,
    cropOptions: { margin: {}, gutter: {} },
    ...overrides,
  };
}

function createCropBox(pageIndex: number, pageNumber: number): CropBox {
  return {
    x: 0,
    y: 396,
    width: 306,
    height: 396,
    left: 0,
    bottom: 396,
    pageIndex,
    pageNumber,
    order: 1,
    label: 'Slide 1',
    row: 0,
    column: 0,
  };
}

function createSavedLayout(id: string, name: string): SavedLayoutTemplate {
  return {
    id,
    name,
    sourcePageIndex: 0,
    sourcePageNumber: 1,
    template: {
      layoutId: 'two-up-horizontal',
      label: '2-up horizontal',
      columns: 2,
      rows: 1,
      readingOrder: 'row-major',
      rects: [
        {
          x: 0,
          y: 0,
          width: 306,
          height: 396,
          order: 1,
          label: 'Slide 1',
          row: 0,
          column: 0,
        },
      ],
    },
  };
}
