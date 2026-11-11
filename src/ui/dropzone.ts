import { ko } from '../i18n';
import { element } from './dom';

export interface DropZoneOptions {
  onFile(file: File): void;
}

export function createDropZone({ onFile }: DropZoneOptions): HTMLElement {
  const input = element('input', {
    attrs: {
      id: 'pdf-input',
      type: 'file',
      accept: 'application/pdf,.pdf',
      'data-testid': 'pdf-input',
    },
  });
  input.className = 'visually-hidden';

  const browseButton = element('span', { className: 'button button-primary', text: ko.choosePdf });
  const dropZone = element(
    'label',
    {
      className: 'drop-zone-card',
      attrs: {
        for: 'pdf-input',
        'data-testid': 'dropzone',
      },
    },
    [
      element('span', { className: 'drop-icon', attrs: { 'aria-hidden': 'true' }, text: '⇩' }),
      element('span', { className: 'eyebrow', text: ko.dropEyebrow }),
      element('h1', { text: ko.dropTitle }),
      element('p', { text: ko.dropBody }),
      browseButton,
      element('span', { className: 'privacy-note', text: ko.dropPrivacy }),
      input,
    ],
  );

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  });

  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('is-drag-over');
    });
  }

  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove('is-drag-over');
    });
  }

  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });

  return dropZone;
}
