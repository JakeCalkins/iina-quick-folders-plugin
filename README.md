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
- Select media content by clicking on it. Close the Quick Folders window anytime with `Cmd + W` (Ctrl on Windows/Linux)

## Packaging for sharing

```
iina-plugin pack quick-folders.iinaplugin
```
This creates a `.iinaplgz` file you can share; users can open it directly with IINA to install.
