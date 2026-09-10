# Installation and troubleshooting

Quick Folders requires IINA 1.4.0 or later on macOS.

## Install from GitHub

This is the recommended method because IINA can associate the plugin with its source repository and discover updates.

1. Open **IINA → Settings → Plugins**.
2. Choose **Install from GitHub**.
3. Enter `JakeCalkins/iina-quick-folders-plugin` or the full repository URL.
4. Confirm the installation, then restart IINA if requested.

Press `⌘ ⇧ K` while IINA is active to open Quick Folders. Press `N` to add your first folder.

## Install a release package

1. Open the [latest GitHub release](https://github.com/JakeCalkins/iina-quick-folders-plugin/releases/latest).
2. Download `quick-folders-v<version>.iinaplgz`.
3. Open the downloaded file with IINA.
4. Restart IINA if requested.

Each automated release includes a `.sha256` file. To verify a download in Terminal:

```sh
shasum -a 256 -c quick-folders-v*.iinaplgz.sha256
```

GitHub also publishes build provenance for release packages. With the GitHub CLI installed, verify it with:

```sh
gh attestation verify quick-folders-v*.iinaplgz --repo JakeCalkins/iina-quick-folders-plugin
```

## Update or reinstall

For GitHub-installed copies, use the update control in **IINA → Settings → Plugins** when an update is available. If an update fails, remove Quick Folders from that screen, restart IINA, and install it again from the repository URL.

Quick Folders stores its folder list and watched state in its IINA plugin data directory. Reinstalling the plugin may remove that state depending on how IINA performs the removal, so note important folder choices first.

## Uninstall

Open **IINA → Settings → Plugins**, select Quick Folders, and choose the remove or uninstall action. Restart IINA if the plugin still appears in the menu.

## Development installation

From the repository root, use the included helper to find IINA's bundled CLI and link the plugin:

```sh
npm run dev:link
```

Unlink it when finished:

```sh
npm run dev:unlink
```

You can also invoke IINA's CLI directly:

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin link .
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the complete development workflow.

## Troubleshooting

### The keyboard shortcut does nothing

- Make sure IINA is the active application.
- Confirm Quick Folders is enabled under **IINA → Settings → Plugins**.
- Check the configured shortcut under **Quick Folders → Settings**.
- Choose a different shortcut if another application or macOS already uses it.

### A folder or media file is missing

- Wait for indexing to finish, then use the refresh button.
- Clear the search and return the type filter to **All Files**.
- Review the audio, image, video-only, watched-file, and maximum-depth preferences.
- Confirm IINA still has filesystem access to the folder.

### Metadata or thumbnails are missing

Metadata and thumbnails load lazily only as files approach the visible list. Quick Folders uses Spotlight and Quick Look for native formats, resizes image previews with macOS tools, and always supplies generated artwork when no source preview is available.

For formats macOS does not preview reliably, such as MKV, Quick Folders can also use an existing `ffmpeg`/`ffprobe` installation from Homebrew, Intel Homebrew, or MacPorts. These tools are optional: without them, playback still works and Quick Folders shows safe generated artwork plus any metadata macOS provides.

### The window looks stale after development changes

Restart IINA after backend changes. For UI-only work, close and reopen the Quick Folders window. Confirm that the development link points to the current clone.

### IINA reports that the plugin is in the wrong format

Make sure the repository name is exactly `JakeCalkins/iina-quick-folders-plugin`. This message can also appear when the latest GitHub release has no installable package and the repository source does not contain a root `Info.json`. Current versions keep the manifest and runtime at the repository root and CI verifies that contract.

### Reporting a reproducible problem

Use the [bug report form](https://github.com/JakeCalkins/iina-quick-folders-plugin/issues/new?template=bug_report.yml). Include the Quick Folders, IINA, and macOS versions; exact steps; installation method; and relevant logs. Remove private filenames and paths before posting screenshots or logs.
