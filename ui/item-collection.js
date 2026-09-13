// Bounded list/grid windowing shared by every item layout. Geometry is fixed
// within a layout so large collections never require per-item measurements.
const QuickFoldersItemCollection = (() => {
  const LAYOUTS = new Set(["list", "grid"]);
  const DEFAULT_GEOMETRY = Object.freeze({
    list: Object.freeze({ itemHeight: 64, gap: 2, minColumnWidth: Infinity }),
    grid: Object.freeze({ itemHeight: 218, gap: 10, minColumnWidth: 132 }),
  });

  function normalizeLayout(layout) {
    return LAYOUTS.has(layout) ? layout : "list";
  }

  function finiteNumber(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function getColumnCount(layout, viewportWidth, geometry = DEFAULT_GEOMETRY) {
    if (normalizeLayout(layout) === "list") return 1;
    const width = Math.max(0, finiteNumber(viewportWidth));
    const { gap, minColumnWidth } = geometry.grid;
    return Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
  }

  function getMetrics({ layout, viewportWidth, itemCount, geometry = DEFAULT_GEOMETRY }) {
    const normalizedLayout = normalizeLayout(layout);
    const layoutGeometry = geometry[normalizedLayout];
    const columns = getColumnCount(normalizedLayout, viewportWidth, geometry);
    const count = Math.max(0, Math.trunc(finiteNumber(itemCount)));
    const rowCount = Math.ceil(count / columns);
    const stride = layoutGeometry.itemHeight + layoutGeometry.gap;
    return {
      columns,
      itemHeight: layoutGeometry.itemHeight,
      rowCount,
      stride,
      totalHeight: rowCount === 0 ? 0 : rowCount * stride - layoutGeometry.gap,
    };
  }

  function getWindow(options) {
    const metrics = getMetrics(options);
    const viewportHeight = Math.max(0, finiteNumber(options.viewportHeight));
    const maximumScroll = Math.max(0, metrics.totalHeight - viewportHeight);
    const scrollTop = Math.min(Math.max(0, finiteNumber(options.scrollTop)), maximumScroll);
    const overscanRows = Math.max(0, Math.trunc(finiteNumber(options.overscanRows, 3)));
    const firstVisibleRow = Math.floor(scrollTop / metrics.stride);
    const visibleRowCount = Math.max(1, Math.ceil(viewportHeight / metrics.stride) + 1);
    const startRow = Math.max(0, firstVisibleRow - overscanRows);
    const endRow = Math.min(metrics.rowCount, firstVisibleRow + visibleRowCount + overscanRows);
    const startIndex = startRow * metrics.columns;
    const endIndex = Math.min(Math.max(0, Math.trunc(finiteNumber(options.itemCount))), endRow * metrics.columns);
    return {
      ...metrics,
      endIndex,
      endRow,
      firstVisibleRow,
      scrollTop,
      startIndex,
      startRow,
    };
  }

  function getNavigationIndex(currentIndex, key, options) {
    const itemCount = Math.max(0, Math.trunc(finiteNumber(options.itemCount)));
    if (itemCount === 0) return -1;
    const layout = normalizeLayout(options.layout);
    const columns = getColumnCount(layout, options.viewportWidth, options.geometry || DEFAULT_GEOMETRY);
    const index = Math.min(Math.max(0, Math.trunc(finiteNumber(currentIndex))), itemCount - 1);
    if (key === "Home") return 0;
    if (key === "End") return itemCount - 1;
    if (key === "ArrowUp") return Math.max(0, index - columns);
    if (key === "ArrowDown") return Math.min(itemCount - 1, index + columns);
    if (layout === "grid" && key === "ArrowLeft") return Math.max(0, index - 1);
    if (layout === "grid" && key === "ArrowRight") return Math.min(itemCount - 1, index + 1);
    return index;
  }

  function createModel(options = {}) {
    const geometry = options.geometry || DEFAULT_GEOMETRY;
    const overscanRows = options.overscanRows == null ? 3 : options.overscanRows;
    let items = [];
    let layout = normalizeLayout(options.layout);
    let viewportWidth = Math.max(0, finiteNumber(options.viewportWidth));
    let viewportHeight = Math.max(0, finiteNumber(options.viewportHeight));
    let scrollTop = Math.max(0, finiteNumber(options.scrollTop));
    let pathIndexes = new Map();

    function rebuildPathIndexes() {
      pathIndexes = new Map();
      items.forEach((item, index) => {
        if (item && typeof item.path === "string" && !pathIndexes.has(item.path)) {
          pathIndexes.set(item.path, index);
        }
      });
    }

    function metrics() {
      return getMetrics({ geometry, itemCount: items.length, layout, viewportWidth });
    }

    function windowState() {
      return getWindow({
        geometry,
        itemCount: items.length,
        layout,
        overscanRows,
        scrollTop,
        viewportHeight,
        viewportWidth,
      });
    }

    function captureAnchor() {
      if (items.length === 0) return null;
      const current = windowState();
      const index = Math.min(items.length - 1, current.firstVisibleRow * current.columns);
      const item = items[index];
      return item && typeof item.path === "string"
        ? { path: item.path, offset: scrollTop - current.firstVisibleRow * current.stride }
        : null;
    }

    function restoreAnchor(anchor) {
      if (!anchor || typeof anchor.path !== "string") return false;
      const index = pathIndexes.get(anchor.path);
      if (index == null) return false;
      const currentMetrics = metrics();
      const row = Math.floor(index / currentMetrics.columns);
      const maximumScroll = Math.max(0, currentMetrics.totalHeight - viewportHeight);
      scrollTop = Math.min(maximumScroll, Math.max(0, row * currentMetrics.stride + finiteNumber(anchor.offset)));
      return true;
    }

    function setItems(nextItems, { preserveAnchor = true } = {}) {
      const anchor = preserveAnchor ? captureAnchor() : null;
      items = Array.isArray(nextItems) ? nextItems : [];
      rebuildPathIndexes();
      if (!restoreAnchor(anchor)) {
        const currentMetrics = metrics();
        scrollTop = Math.min(scrollTop, Math.max(0, currentMetrics.totalHeight - viewportHeight));
      }
      return windowState();
    }

    function setLayout(nextLayout, { preserveAnchor = true } = {}) {
      const anchor = preserveAnchor ? captureAnchor() : null;
      layout = normalizeLayout(nextLayout);
      restoreAnchor(anchor);
      return windowState();
    }

    function setViewport(nextViewport = {}) {
      viewportWidth = Math.max(0, finiteNumber(nextViewport.width, viewportWidth));
      viewportHeight = Math.max(0, finiteNumber(nextViewport.height, viewportHeight));
      if (nextViewport.scrollTop != null) scrollTop = Math.max(0, finiteNumber(nextViewport.scrollTop));
      const currentMetrics = metrics();
      scrollTop = Math.min(scrollTop, Math.max(0, currentMetrics.totalHeight - viewportHeight));
      return windowState();
    }

    function ensureIndexVisible(index) {
      if (items.length === 0) return 0;
      const currentMetrics = metrics();
      const boundedIndex = Math.min(Math.max(0, index), items.length - 1);
      const row = Math.floor(boundedIndex / currentMetrics.columns);
      const top = row * currentMetrics.stride;
      const bottom = top + currentMetrics.itemHeight;
      if (top < scrollTop) scrollTop = top;
      else if (bottom > scrollTop + viewportHeight) scrollTop = bottom - viewportHeight;
      const maximumScroll = Math.max(0, currentMetrics.totalHeight - viewportHeight);
      scrollTop = Math.min(maximumScroll, Math.max(0, scrollTop));
      return scrollTop;
    }

    function ensurePathVisible(path) {
      const index = pathIndexes.get(path);
      if (index == null) return false;
      ensureIndexVisible(index);
      return true;
    }

    function movePath(path, key) {
      const currentIndex = pathIndexes.get(path);
      const targetIndex = getNavigationIndex(currentIndex == null ? 0 : currentIndex, key, {
        geometry,
        itemCount: items.length,
        layout,
        viewportWidth,
      });
      if (targetIndex < 0) return null;
      ensureIndexVisible(targetIndex);
      return items[targetIndex] || null;
    }

    function getItems() { return items; }
    function getLayout() { return layout; }
    function getScrollTop() { return scrollTop; }

    setItems(options.items || [], { preserveAnchor: false });
    return {
      captureAnchor,
      ensureIndexVisible,
      ensurePathVisible,
      getItems,
      getLayout,
      getScrollTop,
      getWindow: windowState,
      movePath,
      restoreAnchor,
      setItems,
      setLayout,
      setViewport,
    };
  }

  function create(options) {
    const container = options.container;
    const createItem = options.createItem;
    const schedule = options.schedule || ((callback) => callback());
    const model = createModel({
      geometry: options.geometry,
      items: options.items,
      layout: options.layout,
      overscanRows: options.overscanRows,
      viewportHeight: container.clientHeight,
      viewportWidth: container.clientWidth,
    });
    let scheduled = false;
    let itemRevision = 0;
    let renderedKey = null;

    function findRenderedElement(path) {
      const candidates = typeof container.querySelectorAll === "function"
        ? Array.from(container.querySelectorAll("[data-path]"))
        : [];
      return candidates.find((candidate) => candidate.dataset.path === path) || null;
    }

    function containsNode(node) {
      if (!node) return false;
      if (typeof container.contains === "function") return container.contains(node);
      let current = node;
      while (current) {
        if (current === container) return true;
        current = current.parentElement;
      }
      return false;
    }

    function clearContainer() {
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    function render() {
      scheduled = false;
      model.setViewport({
        height: container.clientHeight,
        scrollTop: container.scrollTop,
        width: container.clientWidth,
      });
      const current = model.getWindow();
      const items = model.getItems();
      const layout = model.getLayout();
      const nextRenderKey = [layout, current.columns, current.startIndex, current.endIndex, itemRevision].join(":");
      if (renderedKey === nextRenderKey) {
        container.scrollTop = current.scrollTop;
        return current;
      }
      if (options.onBeforeRender) options.onBeforeRender(current);
      const documentObject = container.ownerDocument || document;
      const activePath = containsNode(documentObject.activeElement) && documentObject.activeElement.dataset
        ? documentObject.activeElement.dataset.path
        : null;
      clearContainer();
      container.classList.toggle("item-collection-list", layout === "list");
      container.classList.toggle("item-collection-grid", layout === "grid");
      container.style.setProperty("--item-columns", String(current.columns));
      container.style.setProperty("--item-height", `${current.itemHeight}px`);
      container.style.setProperty("--item-gap", `${current.stride - current.itemHeight}px`);

      const before = documentObject.createElement("div");
      before.className = "item-collection-spacer";
      before.style.height = `${current.startRow * current.stride}px`;
      before.setAttribute("aria-hidden", "true");
      container.appendChild(before);

      const windowElement = documentObject.createElement("div");
      windowElement.className = `item-collection-window item-collection-window-${layout}`;
      const renderedRows = current.endRow - current.startRow;
      windowElement.style.height = `${Math.max(0, renderedRows * current.stride - (renderedRows ? current.stride - current.itemHeight : 0))}px`;
      items.slice(current.startIndex, current.endIndex).forEach((item, offset) => {
        const index = current.startIndex + offset;
        const element = createItem(item, index, layout);
        element.setAttribute("aria-posinset", String(index + 1));
        element.setAttribute("aria-setsize", String(items.length));
        windowElement.appendChild(element);
      });
      container.appendChild(windowElement);

      const after = documentObject.createElement("div");
      after.className = "item-collection-spacer";
      after.style.height = `${Math.max(0, current.rowCount - current.endRow) * current.stride}px`;
      after.setAttribute("aria-hidden", "true");
      container.appendChild(after);
      // Clearing a scroll container can momentarily clamp scrollTop to zero.
      // Restore the model's bounded position after the spacers are mounted.
      container.scrollTop = current.scrollTop;
      renderedKey = nextRenderKey;
      const restoredFocus = activePath ? findRenderedElement(activePath) : null;
      if (restoredFocus && typeof restoredFocus.focus === "function") {
        restoredFocus.focus({ preventScroll: true });
      } else {
        const renderedElements = typeof container.querySelectorAll === "function"
          ? Array.from(container.querySelectorAll("[data-path]"))
          : [];
        const rovingTarget = renderedElements.find((element) => element.tabIndex === 0)
          || renderedElements[0];
        if (rovingTarget) rovingTarget.tabIndex = 0;
        if (activePath && rovingTarget && typeof rovingTarget.focus === "function") {
          rovingTarget.focus({ preventScroll: true });
        }
      }
      if (options.onRender) options.onRender(current);
      return current;
    }

    function requestRender() {
      if (scheduled) return;
      scheduled = true;
      schedule(render);
    }

    function syncScrollAndRender() {
      container.scrollTop = model.getScrollTop();
      return render();
    }

    function setItems(items, behavior) {
      model.setViewport({ scrollTop: container.scrollTop });
      model.setItems(items, behavior);
      itemRevision++;
      return syncScrollAndRender();
    }

    function setLayout(layout, behavior) {
      model.setViewport({ scrollTop: container.scrollTop });
      model.setLayout(layout, behavior);
      return syncScrollAndRender();
    }

    function focusPath(path, { focus = true } = {}) {
      if (!model.ensurePathVisible(path)) return false;
      syncScrollAndRender();
      const element = findRenderedElement(path);
      if (options.onEnsureVisible) options.onEnsureVisible(path, element || null);
      if (focus && element && typeof element.focus === "function") element.focus();
      return true;
    }

    function moveFocus(path, key, behavior) {
      const target = model.movePath(path, key);
      if (!target) return null;
      focusPath(target.path, behavior);
      return target;
    }

    container.addEventListener("scroll", requestRender);
    render();
    return {
      captureAnchor: model.captureAnchor,
      destroy() {
        if (typeof container.removeEventListener === "function") {
          container.removeEventListener("scroll", requestRender);
        }
      },
      focusPath,
      getLayout: model.getLayout,
      getWindow: model.getWindow,
      moveFocus,
      render,
      restoreAnchor(anchor) {
        const restored = model.restoreAnchor(anchor);
        if (restored) syncScrollAndRender();
        return restored;
      },
      setItems,
      setLayout,
    };
  }

  return {
    DEFAULT_GEOMETRY,
    create,
    createModel,
    getColumnCount,
    getMetrics,
    getNavigationIndex,
    getWindow,
    normalizeLayout,
  };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersItemCollection;
}
