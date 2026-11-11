# PDF 슬라이드 나누기

강의나 학회 유인물 PDF를 브라우저 안에서 슬라이드별 PDF로 나눕니다. 파일은 올리지 않고, 내 기기에서만 처리합니다.

앱: https://han-ent.github.io/pdfslidemanager/

오른쪽 위의 **한/EN**으로 언어를 바꿉니다. 선택하면 이 브라우저에 기억됩니다. PDF나 자르기 정보는 저장하지 않습니다.

## 사용법

1. PDF를 끌어다 놓거나 **PDF 선택**으로 엽니다.
2. 왼쪽 쪽 번호에서 확인할 쪽을 고릅니다. 스크롤한 위치는 쪽을 눌러도 유지됩니다.
3. **현재 쪽**에서 레이아웃을 고릅니다. `1×1`, `1×2`, `2×1`, `2×2`, `2×3`, `3×2`.
4. 미리보기에서 자르기 영역을 옮기거나 크기를 조절합니다. 아래 카드는 내보낼 페이지와 같습니다. 카드를 끌어 순서를 바꾸거나 **삭제**할 수 있습니다.
5. **적용 범위**에서 이 쪽만, 같은 모양 쪽 전부, 또는 `2-8` 같은 범위를 고른 뒤 **적용**을 누릅니다.
6. 같은 자르기를 다시 쓰려면 **현재 자르기 저장**을 누릅니다. 처음 이름은 `레이아웃 1`입니다. 고르면 현재 범위에 적용되고, `⋯`에서 이름 변경, 업데이트, 삭제를 합니다. 저장 항목은 이 PDF를 보는 동안만 유지됩니다.
7. **PDF 내려받기**로 새 파일을 저장합니다. 원본은 바뀌지 않습니다.

확인이 필요한 쪽은 레이아웃을 고르기 전에는 내려받을 수 없습니다. 100MB보다 큰 파일, 200쪽이 넘는 PDF, 출력이 1000쪽 넘을 때는 안내만 나오고 작업은 막지 않습니다.

## PDF Slide Splitter

PDF Slide Splitter is a static browser web app that turns multi-slide lecture or conference handout PDFs into one-slide-per-page PDFs for study workflows such as GoodNotes.

Live app: https://han-ent.github.io/pdfslidemanager/

Use the **한/EN** control in the header to switch between Korean and English. The choice is remembered in this browser under `pdfslidemanager.locale`. That language preference is the only value written to `localStorage`. Crop layouts and PDFs are not stored.

## Privacy and runtime model

- Processing is browser-only for v1.
- Source PDFs are selected with drag/drop or the file picker and stay in local browser memory.
- Saved crop layouts are current-PDF/session-only helpers. They are kept in memory for the loaded PDF and are not written to `localStorage`, `sessionStorage`, IndexedDB, caches, or a cloud account.
- The app has no backend, upload endpoint, analytics, OCR, AI processing, or library-management feature.
- During export, a runtime guard blocks write-like `fetch` calls and `navigator.sendBeacon` calls; e2e tests assert there are no external requests.
- The original source file is not modified; the app creates a new local download such as `lecture-slides.pdf`.

## What it does

- Loads PDFs locally with bundled PDF.js assets.
- Suggests layouts per page, including 1×1, 1×2, 2×1, 2×2, 2×3, and 3×2/six-slides.
- Supports mixed PDFs: users can change one page, apply a selected layout to a page range, or copy the current crop overlay as a template for matching pages.
- Saves reusable crop layouts for the current PDF session: save the current crop as `레이아웃 1`, rename it, update it from the current page, apply it to explicit page ranges, or delete it when no longer needed.
- Shows a crop-grid preview before export, with draggable/resizable crop boxes for manual correction.
- Shows an expected-output preview that uses the same A4 landscape contain-and-pad geometry as the exported PDF.
- Lets users drag expected-output slide cards to reorder output pages or delete unwanted output slides before download.
- Exports each cropped slide onto an exact A4 landscape page, centered with white padding when needed.
- Uses pdf-lib by embedding cropped source PDF regions, preserving vector/text quality where the browser PDF engine supports it.
- Downloads the converted PDF locally and reports source-hash immutability.
- Fails gracefully so layout edits remain available if conversion fails.

Detection is advisory: review the crop grid before export, especially for title/agenda pages or handouts with mixed 1-up, 2-up, 2×2, 2×3, and 3×2 pages. Pages marked “review needed” stay blocked from export until you choose or adjust a layout.

## Saved crop layout workflow

Use saved crop layouts when several pages share the same slide geometry:

1. Load a PDF locally and choose a representative page.
2. Pick or adjust the crop grid, then select **현재 자르기 저장**. The first saved layout is named `레이아웃 1`.
3. Rename the layout to something recognizable, such as `Lecture crops`.
4. Enter an explicit page range like `2-8` or `2, 4, 6`, then select **Apply saved crop layout to range**.
5. If the representative page changes later, previously applied pages do not update automatically. Select **Update from current page**, then apply the saved layout again to the page range that should receive the new crop.
6. Delete the saved layout when it is no longer useful. Deleting the saved layout does not rewrite the source PDF or remove edits already applied to pages.

Saved crop layouts are intentionally lightweight: they belong only to the currently loaded PDF in the current browser session. Loading another PDF, resetting the app, or closing the tab clears them. The app does not OCR, classify, upload, sync, or manage a document library.

## Design

The UI follows the project `DESIGN.md`: Apple-inspired clarity, soft depth, large readable surfaces, accessibility-first controls, and no Apple branding, marks, or affiliation copy.

## Workload guardrails

The app surfaces soft warnings for large browser workloads:

- source file larger than 100 MB
- source PDF over 200 pages
- estimated output over 1000 pages

Warnings are not hard limits; they tell the user export may take more memory/time and should fail gracefully without losing edits.

## Development

Recommended local loop:

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal, then drag/drop a PDF into the page. Changes are reflected by the dev server without a Git commit.

Run the full local verification suite:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

Run the production preview locally:

```bash
npm run build
npm run preview
```


## GitHub upload notes

This repository is prepared as a source-only web app repository:

- Commit source files, tests, docs, package metadata, and GitHub Actions workflow files.
- Do not commit `node_modules/`, `dist/`, coverage, Playwright reports, generated fixtures, OMX runtime files, or private sample PDFs.
- Keep real lecture/conference PDFs in an ignored local folder such as `test sample/`.
- The app is static after `npm run build`; the generated `dist/` folder can be hosted separately if needed, but should not be committed by default.

After creating an empty GitHub repository, add the remote and push the clean upload branch:

```bash
git remote add origin git@github.com:<your-user>/<your-repo>.git
git push -u origin main
```

If you prefer HTTPS remotes, use `https://github.com/<your-user>/<your-repo>.git` instead of the SSH URL.

## Manual smoke notes

For final study-device validation, open a generated split PDF in macOS Preview or a browser PDF viewer. If GoodNotes is available, import the output and confirm A4 landscape page sizing, white padding, and annotation behavior. The exported PDF is a new local file; keep the original source PDF as your unchanged reference.

Representative private PDFs can be smoke-tested locally from an ignored folder such as `test sample/`; do not commit those source PDFs.
