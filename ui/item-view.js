// Stateless row factory. Navigation and mutations stay in the app controller.
const QuickFoldersItemView = (() => {
  const PLAYBACK_STATES = new Set(["new", "in-progress", "watched"]);

  function finiteNumber(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clampFraction(value) {
    const number = finiteNumber(value);
    return number === null ? 0 : Math.min(1, Math.max(0, number));
  }

  function getPlaybackPresentation(item) {
    const progress = item && item.progress && typeof item.progress === "object" ? item.progress : {};
    const position = Math.max(0, finiteNumber(progress.position ?? item.position) || 0);
    const durationValue = finiteNumber(progress.duration ?? item.duration);
    const duration = durationValue && durationValue > 0 ? durationValue : null;
    const suppliedFraction = finiteNumber(progress.fraction ?? item.progressFraction);
    const fraction = clampFraction(suppliedFraction === null && duration ? position / duration : suppliedFraction);
    const suppliedState = progress.state ?? item.playbackState;
    const state = PLAYBACK_STATES.has(suppliedState)
      ? suppliedState
      : item.watched
        ? "watched"
        : fraction > 0
          ? "in-progress"
          : "new";
    const hasPlaybackData = Boolean(
      item.watched || PLAYBACK_STATES.has(suppliedState) || suppliedFraction !== null || position > 0 || duration
    );
    const percent = state === "watched" ? 100 : Math.round(fraction * 100);
    return {
      fraction: state === "watched" ? 1 : fraction,
      hasPlaybackData,
      label: state === "in-progress" ? "In Progress" : state === "watched" ? "Watched" : "New",
      percent,
      state,
      progressLabel: `${percent}% watched`,
    };
  }

  function getFileActivation(event, fromSelectionIndicator = false) {
    if (fromSelectionIndicator || event.shiftKey || event.metaKey || event.ctrlKey) return "select";
    // A double click emits two click events. Opening on the first click keeps
    // playback immediate, while ignoring the second prevents duplicate opens.
    if (Number(event.detail) > 1) return "ignore";
    return "open";
  }

  function getAriaLabel(item, isSelected) {
    if (item.isDir) return `Open folder ${item.name}`;
    const playback = getPlaybackPresentation(item);
    const playbackLabel = playback.hasPlaybackData
      ? `, ${playback.label}${playback.state === "in-progress" ? `, ${playback.progressLabel}` : ""}`
      : "";
    return `${QuickFoldersView.getDisplayName(item)}, ${isSelected ? "selected" : "not selected"}${playbackLabel}`;
  }

  function createFolderInfo(item, options) {
    const info = document.createElement("div");
    info.className = "info";
    if (item.scanning) {
      info.classList.add("info-scanning");
      const wrapper = document.createElement("div");
      wrapper.className = "scan-bar-wrapper";
      const bar = document.createElement("div");
      bar.className = "scan-bar";
      wrapper.appendChild(bar);
      info.appendChild(wrapper);
      return info;
    }

    if (item.isSmartView || item.isWatchedRoot) {
      const count = item.itemCount ?? item.watchedCount;
      info.textContent = Number.isFinite(count)
        ? `${count} item${count === 1 ? "" : "s"}`
        : "Smart view";
      info.title = `Open ${item.name}`;
    } else {
      if (options.atRoot) info.textContent = QuickFoldersView.stripUserHome(item.path);
      info.title = item.path;
    }
    return info;
  }

  function createFileInfo(item, options) {
    const info = document.createElement("div");
    info.className = "info";
    const extension = QuickFoldersFileTypes.getExtension(item.name) || "file";

    const extensionTag = document.createElement("span");
    extensionTag.className = `ext-tag ${QuickFoldersView.getExtensionClass(extension)}`;
    extensionTag.textContent = extension.toUpperCase();
    info.appendChild(extensionTag);
    options.mediaPreview.attachMetadata(info, item.path);

    const playback = getPlaybackPresentation(item);
    if (playback.hasPlaybackData) {
      const stateTag = document.createElement("span");
      stateTag.className = `playback-state-tag playback-state-${playback.state}`;
      if (playback.state === "watched") stateTag.classList.add("watched-tag");
      stateTag.textContent = playback.label;
      stateTag.title = playback.state === "in-progress" ? playback.progressLabel : playback.label;
      info.appendChild(stateTag);
    }

    if (item.unavailable) {
      const unavailable = document.createElement("span");
      unavailable.className = "playback-state-tag unavailable-tag";
      unavailable.textContent = "Unavailable";
      unavailable.title = "The source folder is temporarily unavailable";
      info.appendChild(unavailable);
    }

    const formattedSize = QuickFoldersView.formatFileSize(item.size);
    if (formattedSize) {
      const size = document.createElement("span");
      size.className = "metadata-chip size-chip";
      size.textContent = formattedSize;
      size.title = "File size";
      info.appendChild(size);
    }

    if ((item.fromSearch && options.hasSearchQuery) || item.fromWatchedView || item.fromSmartView) {
      const path = document.createElement("span");
      path.className = "metadata path-metadata";
      path.textContent = QuickFoldersView.getContainingFolder(item.path);
      info.appendChild(path);
    }
    info.title = item.path;
    return info;
  }

  function createTitle(item) {
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = QuickFoldersView.getDisplayName(item);
    title.title = item.name;
    if (!item.isDir) title.dataset.fullName = item.name;
    return title;
  }

  function createRemoveButton(item, onRemove) {
    const button = document.createElement("button");
    button.className = "remove-btn";
    button.innerHTML = `
      <span class="remove-icon">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </span>
      <span class="remove-text">Remove</span>
    `;
    button.title = "Remove folder";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onRemove(item);
    });
    return button;
  }

  function create(item, options) {
    const row = document.createElement("div");
    const isSelected = options.selectedPaths.has(item.path);
    row.className = "row";
    row.dataset.path = item.path;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(isSelected));
    const playback = item.isDir ? null : getPlaybackPresentation(item);
    row.setAttribute("aria-label", getAriaLabel(item, isSelected));
    row.title = item.isDir
      ? "Open folder with Enter or Space"
      : "Space to play, Enter to select, or Q to add to the queue.";
    row.draggable = !item.isDir;
    row.tabIndex = options.focusedPath === item.path ? 0 : -1;
    row.classList.toggle("directory", Boolean(item.isDir));
    row.classList.toggle("watched", Boolean(playback && playback.state === "watched"));
    row.classList.toggle("selected", isSelected);
    row.classList.toggle("unavailable", Boolean(item.unavailable));

    const thumbnail = document.createElement("div");
    thumbnail.className = "thumb";
    options.mediaPreview.loadThumbnail(thumbnail, item.path, item.isDir);
    if (playback && playback.hasPlaybackData && playback.state !== "new") {
      const progress = document.createElement("span");
      progress.className = "playback-progress";
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", playback.progressLabel);
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", String(playback.percent));
      const fill = document.createElement("span");
      fill.className = "playback-progress-fill";
      fill.style.width = `${playback.percent}%`;
      progress.appendChild(fill);
      thumbnail.appendChild(progress);
    }

    const metadata = document.createElement("div");
    metadata.className = "meta";
    metadata.appendChild(createTitle(item));
    metadata.appendChild(item.isDir ? createFolderInfo(item, options) : createFileInfo(item, options));
    row.appendChild(thumbnail);
    row.appendChild(metadata);

    row.addEventListener("click", (event) => {
      if (item.isDir) {
        options.onOpenFolder(item);
        return;
      }
      const fromSelectionIndicator = event.target && event.target.classList &&
        event.target.classList.contains("selection-indicator");
      const activation = getFileActivation(event, fromSelectionIndicator);
      if (activation === "select") {
        options.onSelectFile(item, event, { additive: fromSelectionIndicator });
      } else if (activation === "open") {
        options.onOpenFile(item);
      }
    });
    row.addEventListener("focus", () => options.onFocusItem(item));
    if (!item.isDir && options.onDragFiles) {
      row.addEventListener("dragstart", (event) => {
        const paths = options.onDragFiles(item, event);
        if (!paths || paths.length === 0) {
          event.preventDefault();
          return;
        }
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        if (options.onDragEnd) options.onDragEnd(item);
      });
    }
    row.addEventListener("keydown", (event) => {
      if (event.target !== row) return;
      const hasCommandModifier = event.metaKey || event.ctrlKey || event.altKey;
      if (event.key === "Enter" && !hasCommandModifier) {
        event.preventDefault();
        event.stopPropagation();
        if (item.isDir) options.onOpenFolder(item);
        else options.onSelectFile(item, event, { additive: true, restoreFocus: true });
      } else if (!hasCommandModifier && (event.key === " " || event.key === "Spacebar")) {
        event.preventDefault();
        event.stopPropagation();
        if (item.isDir) options.onOpenFolder(item);
        else options.onOpenFile(item);
      } else if (
        !hasCommandModifier &&
        ["ArrowDown", "ArrowUp", "Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key) &&
        (options.layout === "grid" || !["ArrowLeft", "ArrowRight"].includes(event.key))
      ) {
        event.preventDefault();
        event.stopPropagation();
        options.onMoveFocus(item, event.key, { extendSelection: event.shiftKey });
      }
    });

    if (!item.isDir) {
      const indicator = document.createElement("span");
      indicator.className = "selection-indicator";
      indicator.setAttribute("aria-hidden", "true");
      indicator.textContent = "✓";
      indicator.title = isSelected ? "Deselect file" : "Select file";
      row.appendChild(indicator);
    } else if (options.atRoot && item.isRoot) {
      row.appendChild(createRemoveButton(item, options.onRemoveRoot));
    }

    return row;
  }

  return { clampFraction, create, getAriaLabel, getFileActivation, getPlaybackPresentation };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersItemView;
}
