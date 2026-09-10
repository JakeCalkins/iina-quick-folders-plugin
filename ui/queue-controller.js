// Owns the queue panel's selection, keyboard, and drag/drop behavior. The
// backend remains authoritative for queue contents and native IINA playback.
const QuickFoldersQueueController = (() => {
  const DRAG_TYPE = "application/x-quick-folders-paths";

  function readDraggedPaths(event, fallback = []) {
    const transfer = event && event.dataTransfer;
    if (!transfer) return fallback;
    try {
      const encoded = transfer.getData(DRAG_TYPE);
      if (encoded) return QuickFoldersQueueState.normalizePaths(JSON.parse(encoded));
      return QuickFoldersQueueState.normalizePaths(transfer.getData("text/plain").split("\n"));
    } catch (err) {
      return fallback;
    }
  }

  function writeDraggedPaths(event, paths) {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
    event.dataTransfer.setData("text/plain", paths.join("\n"));
  }

  function createDragPreview({ label, count, mode }) {
    const preview = document.createElement("div");
    preview.className = `drag-preview drag-preview-${mode}`;

    const icon = document.createElement("span");
    icon.className = "drag-preview-icon";
    icon.textContent = mode === "reorder" ? "↕" : "+";
    icon.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "drag-preview-copy";
    const title = document.createElement("strong");
    title.textContent = count > 1 ? `${count} selected items` : label;
    const detail = document.createElement("span");
    detail.textContent = mode === "reorder" ? "Reorder queue" : "Add to queue";
    copy.appendChild(title);
    copy.appendChild(detail);

    preview.appendChild(icon);
    preview.appendChild(copy);
    if (count > 1) {
      const badge = document.createElement("span");
      badge.className = "drag-preview-count";
      badge.textContent = String(count);
      preview.appendChild(badge);
    }
    return preview;
  }

  function create(options) {
    const {
      panel, toggleButton, badge, list, count, clearButton, removeButton,
      closeButton, playButton, sendMessage, onOpenChange,
    } = options;
    let items = [];
    let selectedPaths = new Set();
    let anchorPath = null;
    let focusedPath = null;
    let externalDragPaths = [];
    let queueDragPaths = [];
    let dragDepth = 0;
    let dragPreview = null;
    let dropMarkerRow = null;

    function removeDragPreview() {
      if (!dragPreview) return;
      if (typeof dragPreview.remove === "function") dragPreview.remove();
      else if (dragPreview.parentNode) dragPreview.parentNode.removeChild(dragPreview);
      dragPreview = null;
    }

    function setDragPreview(event, paths, label, mode) {
      const transfer = event && event.dataTransfer;
      if (!transfer || typeof transfer.setDragImage !== "function" || !document.body) return;
      removeDragPreview();
      dragPreview = createDragPreview({
        label: label || "Media item",
        count: paths.length,
        mode,
      });
      document.body.appendChild(dragPreview);
      // WebKit snapshots this node synchronously. Keeping it in the document
      // until dragend avoids a brief fallback to the oversized native ghost.
      transfer.setDragImage(dragPreview, 24, 24);
    }

    function clearDropMarkers() {
      if (dropMarkerRow) dropMarkerRow.classList.remove("drop-before", "drop-after");
      dropMarkerRow = null;
    }

    function clearDragChrome() {
      dragDepth = 0;
      toggleButton.classList.remove("drag-active");
      list.classList.remove("reordering");
      if (document.body) document.body.classList.remove("dragging-media", "dragging-queue");
      clearDropMarkers();
      removeDragPreview();
    }

    function orderedPaths() {
      return items.map((item) => item.path);
    }

    function isOpen() {
      return !panel.classList.contains("hidden");
    }

    function setOpen(open, { notify = true } = {}) {
      const nextOpen = Boolean(open);
      panel.classList.toggle("hidden", !nextOpen);
      toggleButton.setAttribute("aria-expanded", String(nextOpen));
      toggleButton.classList.toggle("active", nextOpen);
      if (notify) onOpenChange(nextOpen);
      // The native window resize completes after WebKit's next animation
      // frame. Delay focus until the newly revealed panel can accept it.
      if (nextOpen) setTimeout(() => {
        const target = list.querySelector(".queue-row[tabindex='0']") || closeButton;
        target.focus();
      }, 220);
    }

    function focusRow(path) {
      focusedPath = path;
      const rows = Array.from(list.querySelectorAll(".queue-row[data-path]"));
      rows.forEach((row) => { row.tabIndex = row.dataset.path === path ? 0 : -1; });
      const row = rows.find((candidate) => candidate.dataset.path === path);
      if (row) row.focus();
    }

    function selectPath(path, event = {}, { additive = false, range = false } = {}) {
      const result = QuickFoldersBrowseState.updateSelection({
        visiblePaths: orderedPaths(),
        selectedPaths: Array.from(selectedPaths),
        anchorPath,
        targetPath: path,
        additive: Boolean(additive || event.metaKey || event.ctrlKey),
        range: Boolean(range || event.shiftKey),
      });
      selectedPaths = new Set(result.selectedPaths);
      anchorPath = result.anchorPath;
      focusedPath = path;
      refreshSelectionPresentation();
      focusRow(path);
    }

    function moveFocus(path, key, extendSelection) {
      const currentPath = path || focusedPath;
      const target = QuickFoldersInteractions.getNavigationTarget(items, currentPath, key);
      if (!target) return;
      if (extendSelection) {
        // Start a keyboard range at the currently focused row, matching the
        // main browser list even when the queue has no prior selection.
        if (!anchorPath) anchorPath = currentPath || target.path;
        selectPath(target.path, { shiftKey: true }, { range: true });
      }
      else focusRow(target.path);
    }

    function removePaths(paths) {
      const normalized = QuickFoldersQueueState.normalizePaths(paths);
      if (normalized.length > 0) sendMessage("queue-remove", { paths: normalized });
    }

    function createRow(item, index) {
      const row = document.createElement("div");
      const selected = selectedPaths.has(item.path);
      row.className = "queue-row";
      row.dataset.path = item.path;
      row.draggable = true;
      row.tabIndex = focusedPath === item.path || (!focusedPath && index === 0) ? 0 : -1;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(selected));
      row.setAttribute("aria-label", `${QuickFoldersView.getDisplayName(item)}, queue position ${index + 1}`);
      row.classList.toggle("selected", selected);

      const grip = document.createElement("span");
      grip.className = "queue-grip";
      grip.textContent = "⠿";
      grip.setAttribute("aria-hidden", "true");

      const position = document.createElement("span");
      position.className = "queue-position";
      position.textContent = String(index + 1);

      const details = document.createElement("div");
      details.className = "queue-details";
      const title = document.createElement("span");
      title.className = "queue-title";
      title.textContent = QuickFoldersView.getDisplayName(item);
      title.title = item.name;
      const metadata = document.createElement("span");
      metadata.className = "queue-metadata";
      const extension = QuickFoldersFileTypes.getExtension(item.name) || "file";
      metadata.textContent = `${extension.toUpperCase()} · ${QuickFoldersView.getContainingFolder(item.path)}`;
      details.appendChild(title);
      details.appendChild(metadata);

      const remove = document.createElement("button");
      remove.className = "queue-remove-btn";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = `Remove ${QuickFoldersView.getDisplayName(item)} from queue`;
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removePaths([item.path]);
      });

      row.appendChild(grip);
      row.appendChild(position);
      row.appendChild(details);
      row.appendChild(remove);
      row.addEventListener("click", (event) => selectPath(item.path, event));
      row.addEventListener("focus", () => { focusedPath = item.path; });
      row.addEventListener("keydown", (event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          moveFocus(item.path, event.key, event.shiftKey);
        } else if (event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          event.stopPropagation();
          selectPath(item.path, event, { additive: true });
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          event.stopPropagation();
          removePaths(selectedPaths.has(item.path) ? Array.from(selectedPaths) : [item.path]);
        } else if (event.key === "Escape") {
          event.stopPropagation();
          selectedPaths.clear();
          anchorPath = null;
          refreshSelectionPresentation();
          focusRow(item.path);
        } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
          event.preventDefault();
          event.stopPropagation();
          selectedPaths = new Set(orderedPaths());
          anchorPath = items[0] ? items[0].path : null;
          refreshSelectionPresentation();
          focusRow(item.path);
        }
      });
      row.addEventListener("dragstart", (event) => {
        queueDragPaths = QuickFoldersQueueState.getDraggedPaths(
          orderedPaths(), Array.from(selectedPaths), item.path,
        );
        if (!selectedPaths.has(item.path)) {
          selectedPaths = new Set([item.path]);
          anchorPath = item.path;
          focusedPath = item.path;
          refreshSelectionPresentation();
        }
        writeDraggedPaths(event, queueDragPaths);
        setDragPreview(event, queueDragPaths, QuickFoldersView.getDisplayName(item), "reorder");
        row.classList.add("dragging");
        list.classList.add("reordering");
        if (document.body) document.body.classList.add("dragging-queue");
      });
      row.addEventListener("dragend", () => {
        queueDragPaths = [];
        row.classList.remove("dragging");
        clearDragChrome();
      });
      row.addEventListener("dragover", (event) => {
        if (queueDragPaths.length === 0) return;
        event.preventDefault();
        clearDropMarkers();
        const bounds = row.getBoundingClientRect();
        const positionName = event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before";
        row.classList.toggle("drop-before", positionName === "before");
        row.classList.toggle("drop-after", positionName === "after");
        dropMarkerRow = row;
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });
      row.addEventListener("dragleave", () => {
        if (dropMarkerRow === row) clearDropMarkers();
      });
      row.addEventListener("drop", (event) => {
        if (queueDragPaths.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = row.getBoundingClientRect();
        const positionName = event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before";
        sendMessage("queue-reorder", { paths: queueDragPaths, targetPath: item.path, position: positionName });
        row.classList.remove("drop-before", "drop-after");
      });
      return row;
    }

    function updateControls() {
      const selectedCount = selectedPaths.size;
      count.textContent = selectedCount > 0
        ? `${selectedCount} selected`
        : `${items.length} item${items.length === 1 ? "" : "s"}`;
      badge.textContent = String(items.length);
      badge.classList.toggle("hidden", items.length === 0);
      toggleButton.title = items.length === 0 ? "Queue is empty — drop media here" : `Open queue (${items.length})`;
      toggleButton.setAttribute("aria-label", toggleButton.title);
      clearButton.disabled = items.length === 0;
      playButton.disabled = items.length === 0;
      removeButton.classList.toggle("hidden", selectedCount === 0);
      removeButton.textContent = `Remove ${selectedCount}`;
    }

    function refreshSelectionPresentation() {
      list.querySelectorAll(".queue-row[data-path]").forEach((row) => {
        const selected = selectedPaths.has(row.dataset.path);
        row.classList.toggle("selected", selected);
        row.setAttribute("aria-selected", String(selected));
      });
      updateControls();
    }

    function render() {
      const paths = new Set(orderedPaths());
      selectedPaths = new Set(Array.from(selectedPaths).filter((path) => paths.has(path)));
      if (anchorPath && !paths.has(anchorPath)) anchorPath = null;
      if (focusedPath && !paths.has(focusedPath)) focusedPath = null;

      list.innerHTML = "";
      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "queue-empty";
        const icon = document.createElement("span");
        icon.className = "queue-empty-icon";
        icon.textContent = "+";
        icon.setAttribute("aria-hidden", "true");
        const title = document.createElement("strong");
        title.textContent = "Build your queue";
        const detail = document.createElement("span");
        detail.textContent = "Drag media onto the queue button below.";
        empty.appendChild(icon);
        empty.appendChild(title);
        empty.appendChild(detail);
        list.appendChild(empty);
      } else {
        const fragment = document.createDocumentFragment();
        items.forEach((item, index) => fragment.appendChild(createRow(item, index)));
        list.appendChild(fragment);
      }

      updateControls();
    }

    function setItems(nextItems) {
      const normalizedItems = Array.isArray(nextItems)
        ? nextItems.filter((item) => item && item.path)
        : [];
      const unchanged = normalizedItems.length === items.length
        && normalizedItems.every((item, index) => {
          const current = items[index];
          return current
            && item.path === current.path
            && item.name === current.name
            && Boolean(item.watched) === Boolean(current.watched);
        });
      if (unchanged) return;
      items = normalizedItems;
      render();
    }

    toggleButton.addEventListener("click", () => setOpen(!isOpen()));
    closeButton.addEventListener("click", () => setOpen(false));
    clearButton.addEventListener("click", () => sendMessage("queue-clear"));
    removeButton.addEventListener("click", () => removePaths(Array.from(selectedPaths)));
    playButton.addEventListener("click", () => sendMessage("queue-play"));

    toggleButton.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dragDepth++;
      toggleButton.classList.add("drag-active");
    });
    toggleButton.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    toggleButton.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) toggleButton.classList.remove("drag-active");
    });
    toggleButton.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      const paths = readDraggedPaths(event, externalDragPaths);
      externalDragPaths = [];
      clearDragChrome();
      if (paths.length > 0) sendMessage("queue-add", { paths });
    });
    list.addEventListener("dragover", (event) => {
      if (queueDragPaths.length === 0 || event.target !== list) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    list.addEventListener("drop", (event) => {
      if (queueDragPaths.length === 0 || event.target !== list) return;
      event.preventDefault();
      sendMessage("queue-reorder", { paths: queueDragPaths, targetPath: null, position: "after" });
    });

    render();
    return {
      endExternalDrag() {
        externalDragPaths = [];
        clearDragChrome();
      },
      isOpen,
      startExternalDrag(event, paths, label) {
        externalDragPaths = QuickFoldersQueueState.normalizePaths(paths);
        writeDraggedPaths(event, externalDragPaths);
        setDragPreview(event, externalDragPaths, label, "add");
        if (document.body) document.body.classList.add("dragging-media");
      },
      setItems,
      setOpen,
      writeDraggedPaths,
    };
  }

  return { create, readDraggedPaths, writeDraggedPaths };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersQueueController;
}
