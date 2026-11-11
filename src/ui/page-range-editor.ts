import { ko, type ApplyScope } from '../i18n';
import { LAYOUT_PRESETS } from '../pdf/grid';
import type { LayoutPresetId, PagePlan, SavedLayoutTemplate } from '../types';
import { element } from './dom';

export interface InspectorDraft {
  scope: ApplyScope;
  range: string;
  menuOpen: boolean;
}

export interface InspectorPanelOptions {
  page: PagePlan;
  pageCount: number;
  savedLayouts?: readonly SavedLayoutTemplate[];
  selectedSavedLayoutId?: string;
  saveCurrentLayoutDisabledReason?: string;
  similarPageRange?: string;
  draft?: InspectorDraft;
  onDraftChange?(draft: InspectorDraft): void;
  onLayoutChange(layoutId: LayoutPresetId): void;
  onApplyRange(range: string, layoutId: LayoutPresetId): void;
  onApplyCurrentTemplateToRange(range: string): void;
  onResetPage(): void;
  onSaveCurrentLayout?(): void;
  onSelectSavedLayout?(layoutId: string): void;
  onRenameSavedLayout?(layoutId: string, name: string): void;
  onUpdateSavedLayout?(layoutId: string): void;
  onDeleteSavedLayout?(layoutId: string): void;
  onApplySavedLayout?(range: string, layoutId: string): void;
}

const LAYOUT_ORDER: LayoutPresetId[] = [
  'one-up',
  'two-up-vertical',
  'two-up-horizontal',
  'two-by-two',
  'two-by-three',
  'three-by-two',
];

export function createInspectorPanel({
  page,
  pageCount,
  savedLayouts = [],
  selectedSavedLayoutId = '',
  saveCurrentLayoutDisabledReason = '',
  similarPageRange = '',
  draft = { scope: 'page', range: '', menuOpen: false },
  onDraftChange,
  onLayoutChange,
  onApplyRange,
  onApplyCurrentTemplateToRange,
  onResetPage,
  onSaveCurrentLayout,
  onSelectSavedLayout,
  onRenameSavedLayout,
  onUpdateSavedLayout,
  onDeleteSavedLayout,
  onApplySavedLayout,
}: InspectorPanelOptions): HTMLElement {
  const panel = element('section', {
    className: 'inspector-panel',
    attrs: { 'data-testid': 'inspector-panel', 'aria-label': ko.inspectorLabel },
  });
  const state: InspectorDraft = { scope: draft.scope, range: draft.range, menuOpen: draft.menuOpen };
  const publishDraft = (): void => onDraftChange?.({ ...state });

  const rangeInput = element('input', {
    attrs: {
      type: 'text',
      value: state.range,
      'aria-label': ko.rangeAria,
      'data-testid': 'range-input',
      placeholder: ko.rangePlaceholder,
      inputmode: 'text',
    },
  }) as HTMLInputElement;
  rangeInput.addEventListener('input', () => {
    state.range = rangeInput.value;
    publishDraft();
  });

  const scopeGroup = element('div', {
    className: 'scope-choices',
    attrs: { role: 'radiogroup', 'aria-label': ko.applyScope, 'data-testid': 'apply-scope' },
  });
  const pageRadio = createScopeRadio('page', ko.scopePage, 'apply-scope-page', state.scope === 'page');
  const similarRadio = createScopeRadio('similar', ko.scopeSimilar, 'apply-scope-similar', state.scope === 'similar');
  const rangeRadio = createScopeRadio('range', ko.scopeRange, 'apply-scope-range', state.scope === 'range');
  const rangeChoice = element('label', { className: 'scope-choice scope-choice-range' }, [
    rangeRadio,
    element('span', { text: ko.scopeRange }),
    rangeInput,
  ]);
  scopeGroup.append(
    element('label', { className: 'scope-choice' }, [pageRadio, element('span', { text: ko.scopePage })]),
    element('label', { className: 'scope-choice' }, [similarRadio, element('span', { text: ko.scopeSimilar })]),
    rangeChoice,
  );
  for (const radio of [pageRadio, similarRadio, rangeRadio]) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.scope = radio.value as ApplyScope;
      publishDraft();
    });
  }
  rangeInput.addEventListener('focus', () => {
    state.scope = 'range';
    rangeRadio.checked = true;
    publishDraft();
  });

  const rangeForScope = (): string => {
    if (state.scope === 'page') return String(page.pageNumber);
    if (state.scope === 'similar') return similarPageRange || String(page.pageNumber);
    return rangeInput.value;
  };

  const applyButton = element('button', {
    className: 'button button-secondary',
    text: ko.apply,
    attrs: { type: 'button', 'data-testid': 'apply-range-button' },
  });
  applyButton.addEventListener('click', () => onApplyRange(rangeForScope(), page.layoutId));

  const copyButton = element('button', {
    className: 'button button-ghost',
    text: ko.copyCrop,
    attrs: { type: 'button', 'data-testid': 'apply-current-template-button' },
  });
  copyButton.addEventListener('click', () => onApplyCurrentTemplateToRange(rangeForScope()));

  const resetButton = element('button', {
    className: 'button button-ghost',
    text: ko.resetPage,
    attrs: { type: 'button', 'data-testid': 'reset-page-button' },
  });
  resetButton.addEventListener('click', onResetPage);

  panel.append(
    element('div', { className: 'panel-heading' }, [
      element('span', { className: 'eyebrow', text: ko.currentPage }),
      element('h2', { text: ko.pageFraction(page.pageNumber, pageCount) }),
    ]),
    element('div', { className: 'panel-section' }, [
      createLayoutPicker(page.layoutId, onLayoutChange),
    ]),
    element('div', { className: 'panel-section' }, [
      element('h3', { text: ko.applyScope }),
      scopeGroup,
      applyButton,
      element('div', { className: 'inspector-text-actions' }, [resetButton, copyButton]),
    ]),
    createSavedLayoutsSection({
      savedLayouts,
      selectedSavedLayoutId,
      saveCurrentLayoutDisabledReason,
      menuOpen: state.menuOpen,
      rangeForScope,
      onMenuOpenChange: (open) => {
        state.menuOpen = open;
        publishDraft();
      },
      onSaveCurrentLayout,
      onSelectSavedLayout,
      onRenameSavedLayout,
      onUpdateSavedLayout,
      onDeleteSavedLayout,
      onApplySavedLayout,
    }),
  );
  return panel;
}

function createScopeRadio(value: ApplyScope, label: string, testId: string, checked: boolean): HTMLInputElement {
  const radio = element('input', {
    attrs: {
      type: 'radio',
      name: 'apply-scope',
      value,
      'aria-label': label,
      'data-testid': testId,
    },
  }) as HTMLInputElement;
  radio.checked = checked;
  return radio;
}

interface SavedLayoutsSectionOptions {
  savedLayouts: readonly SavedLayoutTemplate[];
  selectedSavedLayoutId: string;
  saveCurrentLayoutDisabledReason: string;
  menuOpen: boolean;
  rangeForScope(): string;
  onMenuOpenChange(open: boolean): void;
  onSaveCurrentLayout: (() => void) | undefined;
  onSelectSavedLayout: ((layoutId: string) => void) | undefined;
  onRenameSavedLayout: ((layoutId: string, name: string) => void) | undefined;
  onUpdateSavedLayout: ((layoutId: string) => void) | undefined;
  onDeleteSavedLayout: ((layoutId: string) => void) | undefined;
  onApplySavedLayout: ((range: string, layoutId: string) => void) | undefined;
}

function createSavedLayoutsSection({
  savedLayouts,
  selectedSavedLayoutId,
  saveCurrentLayoutDisabledReason,
  menuOpen,
  rangeForScope,
  onMenuOpenChange,
  onSaveCurrentLayout,
  onSelectSavedLayout,
  onRenameSavedLayout,
  onUpdateSavedLayout,
  onDeleteSavedLayout,
  onApplySavedLayout,
}: SavedLayoutsSectionOptions): HTMLElement {
  const selectedLayout = selectedSavedLayoutId ? savedLayouts.find((layout) => layout.id === selectedSavedLayoutId) : undefined;
  const selectedId = selectedLayout?.id ?? '';
  const saveDisabledReason = saveCurrentLayoutDisabledReason || (!onSaveCurrentLayout ? ko.saveUnavailable : '');

  const saveButton = element('button', {
    className: 'button button-secondary',
    text: ko.saveCurrent,
    attrs: { type: 'button', 'data-testid': 'save-current-layout-button' },
  });
  saveButton.toggleAttribute('disabled', saveDisabledReason !== '');
  if (saveDisabledReason) saveButton.setAttribute('title', saveDisabledReason);
  saveButton.addEventListener('click', () => onSaveCurrentLayout?.());

  const children: Array<Node | null> = [
    element('h3', { text: ko.saveCropHeading }),
    element('p', { className: 'muted', text: ko.saveHint }),
  ];
  if (savedLayouts.length === 0) {
    children.push(element('p', {
      className: 'muted',
      text: ko.emptySaved,
      attrs: { 'data-testid': 'saved-layout-empty-state' },
    }));
  }
  if (saveDisabledReason) {
    children.push(element('p', {
      className: 'muted',
      text: saveDisabledReason,
      attrs: { 'data-testid': 'saved-layout-disabled-reason' },
    }));
  }

  const rowChildren: Node[] = [saveButton];
  if (savedLayouts.length > 0) {
    const savedLayoutSelect = element('select', {
      attrs: { 'aria-label': ko.savedLayout, 'data-testid': 'saved-layout-select' },
    });
    savedLayoutSelect.append(element('option', { text: ko.chooseSaved, attrs: { value: '' } }));
    for (const savedLayout of savedLayouts) {
      const option = element('option', { text: savedLayout.name, attrs: { value: savedLayout.id } });
      option.selected = savedLayout.id === selectedId;
      savedLayoutSelect.append(option);
    }
    if (!onSelectSavedLayout) {
      savedLayoutSelect.toggleAttribute('disabled', true);
      savedLayoutSelect.title = ko.selectUnavailable;
    }
    savedLayoutSelect.addEventListener('change', () => {
      const layoutId = savedLayoutSelect.value;
      onSelectSavedLayout?.(layoutId);
      if (layoutId) onApplySavedLayout?.(rangeForScope(), layoutId);
    });
    rowChildren.push(savedLayoutSelect);

    const menuButton = element('button', {
      className: 'button button-ghost saved-menu-button',
      text: '⋯',
      attrs: {
        type: 'button',
        'data-testid': 'saved-layout-menu-button',
        'aria-label': ko.savedMenu,
        'aria-expanded': menuOpen ? 'true' : 'false',
        'aria-controls': 'saved-layout-menu',
      },
    });
    const menu = element('div', {
      className: 'saved-menu',
      attrs: { id: 'saved-layout-menu', 'data-testid': 'saved-layout-menu' },
    });
    if (!menuOpen) menu.hidden = true;
    menuButton.addEventListener('click', () => {
      const willOpen = menu.hidden !== false;
      menu.hidden = !willOpen;
      menuButton.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      onMenuOpenChange(willOpen);
    });

    if (!selectedId) {
      menu.append(element('p', { className: 'muted', text: ko.menuNeedsSelection }));
    } else {
      const nameInput = element('input', {
        attrs: {
          type: 'text',
          value: selectedLayout?.name ?? '',
          'aria-label': ko.layoutName,
          'data-testid': 'saved-layout-name-input',
          placeholder: ko.layoutNamePlaceholder,
        },
      }) as HTMLInputElement;
      const renameButton = createMenuButton(ko.rename, 'rename-saved-layout-button', Boolean(onRenameSavedLayout), ko.renameUnavailable, () => {
        onRenameSavedLayout?.(selectedId, nameInput.value);
      });
      const updateReason = saveCurrentLayoutDisabledReason || (!onUpdateSavedLayout ? ko.updateUnavailable : '');
      const updateButton = createMenuButton(ko.updateFromPage, 'update-saved-layout-button', updateReason === '', updateReason, () => {
        onUpdateSavedLayout?.(selectedId);
      });
      const applyButton = createMenuButton(ko.applySaved, 'apply-saved-layout-button', Boolean(onApplySavedLayout), ko.applySavedUnavailable, () => {
        onApplySavedLayout?.(rangeForScope(), selectedId);
      });
      const deleteButton = createMenuButton(ko.deleteSaved, 'delete-saved-layout-button', Boolean(onDeleteSavedLayout), ko.deleteUnavailable, () => {
        onDeleteSavedLayout?.(selectedId);
      });
      menu.append(
        element('label', { className: 'field-label' }, [element('span', { text: ko.layoutName }), nameInput]),
        renameButton,
        updateButton,
        applyButton,
        deleteButton,
      );
    }
    rowChildren.push(menuButton);
    children.push(element('div', { className: 'saved-row' }, rowChildren), menu);
  } else {
    children.push(element('div', { className: 'saved-row' }, rowChildren));
  }

  return element('div', { className: 'panel-section', attrs: { 'data-testid': 'saved-layouts-section' } }, children);
}

function createMenuButton(label: string, testId: string, enabled: boolean, disabledReason: string, onClick: () => void): HTMLButtonElement {
  const button = element('button', {
    className: 'button button-secondary',
    text: label,
    attrs: { type: 'button', 'data-testid': testId },
  });
  button.toggleAttribute('disabled', !enabled);
  if (!enabled && disabledReason) button.title = disabledReason;
  button.addEventListener('click', onClick);
  return button;
}

function createLayoutPicker(selected: LayoutPresetId, onChange: (layoutId: LayoutPresetId) => void): HTMLElement {
  const group = element('div', {
    className: 'segmented-picker',
    attrs: {
      role: 'radiogroup',
      'aria-label': ko.layoutChipsLabel,
      'data-testid': 'layout-picker',
    },
  });
  for (const layoutId of LAYOUT_ORDER) {
    const preset = LAYOUT_PRESETS[layoutId];
    const button = element('button', {
      className: `segment ${layoutId === selected ? 'is-selected' : ''}`,
      text: preset.label,
      attrs: {
        type: 'button',
        role: 'radio',
        'aria-checked': String(layoutId === selected),
        title: ko.gridTitle(preset.columns, preset.rows),
        'data-testid': `layout-${layoutId}`,
      },
    });
    button.addEventListener('click', () => onChange(layoutId));
    group.append(button);
  }
  return group;
}
