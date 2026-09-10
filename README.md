# Quick Folders (IINA plugin)

Adds a custom window to the IINA media application which displays a user-defined set of directories for quickly viewing and playing media content.

The user can trigger this with a simple hotkey (defaults are currently `A` to trigger the window and `N` to add new folders to the Quick Folders set).

Adds preferences for filtering by filetype, hotkeys, and indexing depth. Go to `IINA Settings > Plugins > Quick Folders > Settings` to modify these.

## Install for development

1. Ensure the CLI helper is available: `ln -s /Applications/IINA.app/Contents/MacOS/iina-plugin /usr/local/bin/iina-plugin` (one-time).
2. From this repo root run:
   ```sh
   iina-plugin link quick-folders.iinaplugin
   ```
   This creates a `~/.iinaplugin-dev` symlink that IINA auto-loads. Reload IINA to pick it up.

To remove: `iina-plugin unlink quick-folders.iinaplugin`.

## How to use (with default settings)

- Launch IINA.
- Install the plugin (see above).
- Hit `A` to launch the window anywhere while using IINA.
- Hit `N` and add any directory you want.
- Once directories are loaded and indexed, navigate using the UI or search to filter more efficiently.
- Close the Quick Folders window anytime with `Cmd + W` (Ctrl on Windows/Linux).
- Select one file with a click, extend the selection with `Cmd`/`Ctrl`, or select a range with `Shift`. Double-click a file (or press `Enter`) to open it.
- Use the selection action bar—or press `W`—to mark files watched. Watched files are dimmed and grouped at the bottom of each folder.
- Press `Delete` or `Backspace` to permanently delete selected files after confirmation.
- Enable **Hide watched files while browsing** to replace watched items with a **Watched** folder at the Quick Folders root, where they can be restored to unwatched.

### Search syntax

Search is fuzzy by default, so abbreviated names and small typos can still match. You can combine multiple clauses:

- `summer trip` matches files containing both fuzzy terms.
- `"summer trip"` searches for that literal phrase.
- `summer*.mp4` and `clip-??.mov` use `*` and `?` wildcards.
- `summer -draft` excludes matches containing `draft`.
- `ext:mp4`, `ext:m*`, and `-ext:mov` filter by file extension. Multiple positive `ext:` clauses are treated as alternatives.

## Packaging for sharing

```
iina-plugin pack quick-folders.iinaplugin
```
This creates a `.iinaplgz` file you can share; users can open it directly with IINA to install.
