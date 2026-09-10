# Changelog

All notable changes to the Quick Folders IINA plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes yet._

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
