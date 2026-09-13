# Changelog

All notable changes to the Quick Folders IINA plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes yet._

## [3.0.0] - 2026-09-13

### Added
- Added Playwright WebKit functional UI coverage and cross-module integration workflow tests
- Added durable playback progress, configurable automatic completion, conservative resume, and Continue Watching
- Added Recently Added, Unwatched, and filename-based Continue Series smart views
- Added list and poster-grid layouts backed by path-stable virtualization for 100,000-item result sets
- Added a searchable command palette, structured search suggestions, and removable query chips for playback state, duration, resolution, first-seen date, folder, and extension clauses
- Added validated browser-context restoration for location, query, filter, layout, and scroll position
- Added privacy-safe, in-memory diagnostics and preview-cache controls

### Changed
- Split settings, playback history, browser context, and the versioned per-root index into independently migrated stores
- Serialized shared-state mutations across IINA player instances and bounded/debounced lazy metadata persistence
- Made startup publish compact navigation state immediately, then publish the cached search index and reconcile roots in the background while retaining unavailable-root results
- Preserved lazily discovered duration and resolution metadata in the index and replaced thumbnails only after their new image is ready
- Made index refreshes use per-root change markers to reconcile only changed directories when supported, with a safe full-scan fallback, atomic publication, and deduplicated concurrent refreshes
- Added validated backup recovery for persisted JSON state
- Split release validation from privileged publishing so third-party development dependencies never receive release credentials

### Fixed
- Prevented a newly loaded title from overwriting the preceding title's progress during file transitions
- Kept command-palette focus restoration from stealing focus from commands that open another dialog or focus search
- Made the keyboard navigation cursor visibly follow the focused media row
- Distinguished queue collapse from destructive remove controls, kept the drag-to-queue label unclipped, and removed stray outer window gutters
- Kept search usable at 320×480, recalculated poster-grid geometry when the queue changes width, and cleared hidden search-suggestion focus state
- Invalidated the index when scan preferences change and pruned ignored directory trees during incremental discovery
- Accepted malformed window messages without throwing and removed deleted-root paths from playback data and recovery backups

### Security
- Revalidated every media path without symbolic-link components immediately before native tools, playback, queue construction, and Trash operations

## [2.7.0] - 2026-09-12

### Added
- Added a responsive wide-window layout with Finder-style ancestor columns and an automatically revealed queue pane

## [2.6.1] - 2026-09-12

### Changed
- Refined search with an inline shortcut hint, focus-revealed syntax tips, an in-field clear button, adjacent file filtering, and a labeled queue control
- Made keyboard browsing flow from search into results, with selection, playback, parent navigation, range selection, and queue actions available without the mouse

## [2.6.0] - 2026-09-12

### Added
- Made the expanded queue pane a clear drop target for single and multi-item media drags

### Changed
- Prevented narrow media rows from clipping metadata chips by hiding lower-priority details first, and made bitrate chips opt-in

### Fixed
- Made every level of deep breadcrumbs reachable through a compact earlier-folders menu and removed layout-timed label mutation
- Kept file-list keyboard commands from firing through focused buttons, breadcrumbs, form fields, or modified system shortcuts
- Fixed file removal by using IINA's supported Trash API for user media and reporting failures without hiding the file

## [2.4.0] - 2026-09-10

### Added
- Expanded the IINA-compatible video, audio, and image formats available for browsing and filtering
- Added lazy codec, bitrate, sample-rate, and channel chips alongside duration and resolution
- Added generated preview artwork for media without a native thumbnail, with optional local `ffmpeg` frame and embedded-art extraction for non-native formats
- Added window-level arrow-key navigation, Shift-arrow range selection, `/` search focus, and Enter activation for focused media
- Added a persistent drag-and-drop media queue with multi-selection, multi-item reordering, an expandable editor, and native IINA playlist playback

### Changed
- Made a plain file click play immediately, while modifier-click, the selection control, and Space provide predictable multi-selection
- Bounded thumbnail work with type-aware Quick Look, image resizing, safe temporary cleanup, deduplication, and in-memory caching
- Restyled metadata chips as quiet, borderless labels with adaptive light and dark appearance
- Kept indexing non-blocking and reduced repeated index transfers and list rebuilding during navigation and selection

### Fixed
- Polished file and queue drag-and-drop with compact drag previews, a labeled queue target, clearer source feedback, and more visible reorder positions.
- Restored immediate media previews during slow native thumbnail extraction, prioritized metadata chips, clarified queue action buttons, and prevented the root-folder Remove label from clipping
- Restored back-button, root-bounded breadcrumb, file-filter, and local browser-message interactions that could be lost during WebKit rerenders
- Prevented native text selection while building a multi-file selection
- Fixed thumbnail reads that incorrectly treated IINA's directory-relative result paths as filesystem-root paths
- Avoided unbounded Quick Look work for unsupported containers such as MKV
- Prevented lazy thumbnails and metadata chips from disappearing when IINA suspends animations or replaces the standalone WebView
- Kept row hover treatments and the expanding root-folder Remove button inside the scroll viewport
- Kept the complete interface usable at narrow window widths, including header, selection, queue, search, and confirmation controls
- Kept browsing, selection, dragging, search, and filtering available while the search index refreshes, with compact non-blocking progress
- Made Shift-arrow queue selection include the initially focused row
- Isolated **Watch Queue** in a managed IINA player, then verified and repaired the native playlist after folder autoload so only queued items play in the requested order

### Security
- Reduced the plugin manifest to its required filesystem permission, removed persistent path-bearing diagnostics, and tightened configured-root path validation

## [2.3.5] - 2026-09-10

### Fixed
- Made configured menu shortcuts use IINA's required key syntax, refresh while the plugin is running, and moved the conflicting `⌘ ⇧ A` default to `⌘ ⇧ K`
- Restored the installed plugin runtime by exporting shared modules through IINA's empty CommonJS module wrapper

## [2.3.3] - 2026-09-10

### Fixed
- Made release publishing recover safely when a tag already has an empty GitHub release, and verify the downloadable package after upload

## [2.3.2] - 2026-09-09

### Fixed
- Restored **Install from GitHub** by placing the IINA manifest and runtime at the repository root, and added validation to keep source and packaged installation layouts compatible
- Made release preparation increment IINA's `ghVersion` update counter so published versions can be discovered reliably

## [2.3.0] - 2026-09-09

### Added
- Multi-select file actions for marking media watched or unwatched and permanently deleting files after confirmation
- Optional watched-file hiding with a dedicated Watched folder for restoring items
- Lazy-loaded duration and resolution metadata chips for media files
- Keyboard shortcut help available from the header or by pressing `?`

### Changed
- Polished navigation, action, hover, and feedback animations with consistent icons and reduced-motion support
- Unified header and footer edge treatments and stabilized the root-folder remove animation
- Modularized shared file typing, indexed search, row rendering, dialogs, and media loading while reducing repeated work during rendering and indexing
- Added dependency-free validation and packaging commands, pull-request CI, verified release artifacts, structured issue forms, and contributor/release documentation
- Added scoped coding-agent guidance, Claude references, and automated checks for contributor-file packaging and common privacy leaks

### Fixed
- Added adaptive colors for readable text and controls in macOS light mode
- Kept the selected file type filter in sync when folder data refreshes, so All Files reliably restores the complete listing
- Kept folders navigable while filtering files and kept video extensions available when audio files are disabled
- Cleared stale selections after searches, filters, and external updates, and corrected empty-state messages
- Restored backend file-type classification during indexing by sharing the classifier between runtimes
- Prevented overlapping index scans and stale partial indexes during folder-list changes

## [2.2.0] - 2026-02-03

### Added
- Proper light mode support

### Changed
- Overhauled file scanning, caching, and detection
- Improved identification of IINA-playable files in deeply nested folders
- Excluded additional non-playable files such as `.DS_Store` and `.plist` files

### Fixed
- Corrected small UI inconsistencies
- Made file icons consistent with the flat visual style

## [2.1.0] - 2026-01-04

### Added
- Enhanced README with comprehensive documentation
- GitHub Actions workflow for automated releases
- Screenshots directory for visual documentation
- Improved .gitignore for plugin development

### Changed
- Updated Info.json with enhanced description and author URL
- Restructured documentation for better clarity

### Fixed
- Documentation improvements for GitHub release

## [2.0.0]

### Added
- Initial release of Quick Folders plugin
- Quick access window for browsing media folders
- Customizable keyboard shortcuts
- Smart filtering options (video, audio, images)
- Configurable folder indexing depth
- Search functionality
- Preferences page with full customization
