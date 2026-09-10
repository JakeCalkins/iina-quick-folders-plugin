# Browser UI guide

The UI runs in IINA's standalone-window webview. It must remain responsive and usable at the default 500×600 size.

## Module responsibilities

- Keep `app.js` as the orchestration layer for state, rendering, backend messages, and commands.
- Put pure search/filter state in `browse-model.js` or shared helpers, row construction in `item-view.js`, media loading in `media-preview.js`, and modal behavior in `dialog-controller.js`.
- When adding a classic script, load it before its consumer in `index.html`. Shared browser/Node modules must retain their global-plus-CommonJS export pattern.
- Send backend requests through `postMessage`; never assume direct access to IINA or the local filesystem.

## Interaction and accessibility

- Build dynamic content with DOM methods and `textContent`; do not interpolate filenames or paths into HTML.
- Preserve listbox/option semantics, visible-only selection, keyboard shortcuts, focus trapping, focus restoration, and descriptive labels/titles.
- Directories must remain navigable under file filters. Search, filters, watched visibility, and selection must compose without stale state.
- Keep async thumbnail and metadata work lazy, bounded, deduplicated, and resilient to rerenders or deleted paths.
- Avoid layout reads inside large item loops. Batch DOM insertion and cache derived search/index records.
- Add hover, focus-visible, pressed, disabled, loading, empty, and error states where relevant.
- Respect `prefers-reduced-motion`; animations must not flicker, clip, block input, or encode essential state alone.

## Visual regression checks

- Exercise root, nested, watched, empty, loading, filtered, searched, selected, and confirmation states as relevant.
- Check both light and dark appearance at 500×600 and a narrower stress width.
- Verify long names, breadcrumbs, metadata chips, action bars, footer controls, and remove animations do not overflow or clip.
- Verify keyboard-only operation and an error-free browser console.
