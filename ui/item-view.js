// Stateless row factory. Navigation and mutations stay in the app controller.
const QuickFoldersItemView = (() => {
  function getFileActivation(event, fromSelectionIndicator = false) {
    if (fromSelectionIndicator || event.shiftKey || event.metaKey || event.ctrlKey) return "select";
    // A double click emits two click events. Opening on the first click keeps
    // playback immediate, while ignoring the second prevents duplicate opens.
    if (Number(event.detail) > 1) return "ignore";
    return "open";
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

    if (item.isWatchedRoot) {
      const count = item.watchedCount || 0;
      info.textContent = `${count} item${count === 1 ? "" : "s"}`;
      info.title = "Show watched media";
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

    if (item.watched) {
      const watchedTag = document.createElement("span");
      watchedTag.className = "watched-tag";
      watchedTag.textContent = "Watched";
      info.appendChild(watchedTag);
    }

    const formattedSize = QuickFoldersView.formatFileSize(item.size);
    if (formattedSize) {
      const size = document.createElement("span");
      size.className = "metadata-chip size-chip";
      size.textContent = formattedSize;
      size.title = "File size";
      info.appendChild(size);
    }

    if ((item.fromSearch && options.hasSearchQuery) || item.fromWatchedView) {
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
    row.setAttribute("aria-label", item.isDir
      ? `Open folder ${item.name}`
      : `${QuickFoldersView.getDisplayName(item)}, ${isSelected ? "selected" : "not selected"}`);
    row.title = item.isDir
      ? "Open folder"
      : "Open file, or drag to the queue. Hold Command, Control, or Shift to select.";
    row.draggable = !item.isDir;
    row.tabIndex = options.focusedPath === item.path ? 0 : -1;
    row.classList.toggle("watched", Boolean(item.watched));
    row.classList.toggle("selected", isSelected);

    const thumbnail = document.createElement("div");
    thumbnail.className = "thumb";
    options.mediaPreview.loadThumbnail(thumbnail, item.path, item.isDir);

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
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (item.isDir) options.onOpenFolder(item);
        else options.onOpenFile(item);
      } else if (!item.isDir && (event.key === " " || event.key === "Spacebar")) {
        event.preventDefault();
        event.stopPropagation();
        options.onSelectFile(item, event, { additive: true, restoreFocus: true });
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
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

  return { create, getFileActivation };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersItemView;
}
