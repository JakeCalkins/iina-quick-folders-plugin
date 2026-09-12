// Lazy media loading and caches are isolated from list rendering.
const QuickFoldersMediaPreview = (() => {
  const DEFAULT_THUMBNAIL_CACHE_LIMIT = 200;
  const DEFAULT_METADATA_CACHE_LIMIT = 500;

  function create(options) {
    const rootElement = options.rootElement;
    const sendMessage = options.sendMessage;
    const thumbnailCache = new Map();
    const metadataCache = new Map();
    const pendingThumbnails = new Set();
    const pendingMetadata = new Set();
    const thumbnailElements = new Map();
    const metadataElements = new Map();
    const thumbnailCacheLimit = options.thumbnailCacheLimit || DEFAULT_THUMBNAIL_CACHE_LIMIT;
    const metadataCacheLimit = options.metadataCacheLimit || DEFAULT_METADATA_CACHE_LIMIT;
    const getPreferences = options.getPreferences || (() => ({}));

    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(handleIntersections, {
        root: rootElement,
        rootMargin: "100px 0px",
      });

    // Map lookups avoid scanning every rendered row whenever one asynchronous
    // thumbnail or metadata response arrives.
    function remember(cache, key, value, limit) {
      if (!cache.has(key) && cache.size >= limit) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(key, value || null);
    }

    function showThumbnail(element, dataUrl) {
      if (!element || !dataUrl) return;
      const previousImage = element.querySelector(".thumbnail-image");
      if (previousImage) previousImage.remove();
      const image = document.createElement("img");
      image.className = "thumbnail-image";
      image.alt = "";
      image.draggable = false;
      image.addEventListener("error", () => {
        image.remove();
        element.classList.remove("has-thumbnail");
      }, { once: true });
      // Keep the generated file-type icon underneath the image. It remains a
      // useful fallback while decoding and if WebKit rejects a damaged image.
      element.appendChild(image);
      element.classList.add("has-thumbnail");
      image.src = dataUrl;
    }

    function requestThumbnail(path) {
      if (thumbnailCache.has(path) || pendingThumbnails.has(path)) return;
      pendingThumbnails.add(path);
      sendMessage("request-thumbnail", { path });
    }

    function requestMetadata(path) {
      if (metadataCache.has(path) || pendingMetadata.has(path)) return;
      pendingMetadata.add(path);
      sendMessage("request-media-metadata", { path });
    }

    function requestMedia(path) {
      // Metadata is inexpensive and makes rows useful while native thumbnail
      // extraction continues in the background.
      requestMetadata(path);
      requestThumbnail(path);
    }

    function handleIntersections(entries) {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        requestMedia(entry.target.dataset.thumbnailPath);
      });
    }

    function requestVisible() {
      if (!rootElement || typeof rootElement.getBoundingClientRect !== "function") return;
      const rootBounds = rootElement.getBoundingClientRect();
      if (rootBounds.width <= 0 || rootBounds.height <= 0) return;
      const preloadMargin = 100;
      thumbnailElements.forEach((element, path) => {
        if (!element || typeof element.getBoundingClientRect !== "function") return;
        const bounds = element.getBoundingClientRect();
        if (bounds.bottom < rootBounds.top - preloadMargin || bounds.top > rootBounds.bottom + preloadMargin) return;
        if (observer) observer.unobserve(element);
        requestMedia(path);
      });
    }

    function renderMetadata(element, path) {
      element.querySelectorAll(".dynamic-metadata-chip").forEach((chip) => chip.remove());
      const metadata = metadataCache.get(path);
      if (!metadata) return;

      const fileType = QuickFoldersFileTypes.getFileTypeByExt(path);
      const chips = QuickFoldersMediaMetadata.getMetadataChips(metadata, fileType, {
        showBitrate: Boolean(getPreferences().showBitrateChips),
      });
      const insertionPoint = element.querySelector(".watched-tag, .size-chip, .path-metadata");
      chips.forEach(({ key, text, title }) => {
        const chip = document.createElement("span");
        chip.className = `metadata-chip dynamic-metadata-chip ${key}-chip`;
        chip.textContent = text;
        chip.title = title;
        if (insertionPoint) element.insertBefore(chip, insertionPoint);
        else element.appendChild(chip);
      });
    }

    function beginRender() {
      if (observer) observer.disconnect();
      // A hidden or replaced IINA WebView can lose an in-flight reply. Allow
      // the new render to ask again; the backend loader still deduplicates and
      // serves completed work from its bounded cache.
      pendingThumbnails.clear();
      pendingMetadata.clear();
      thumbnailElements.clear();
      metadataElements.clear();
    }

    function loadThumbnail(element, path, isDirectory) {
      const filename = path.split("/").pop();
      element.textContent = QuickFoldersView.getFileIcon(filename, isDirectory);
      if (isDirectory) return;

      const extension = QuickFoldersFileTypes.getExtension(filename);
      element.classList.add(QuickFoldersView.getExtensionClass(extension));
      element.dataset.thumbnailPath = path;
      thumbnailElements.set(path, element);

      if (thumbnailCache.has(path)) {
        showThumbnail(element, thumbnailCache.get(path));
      } else if (observer) {
        observer.observe(element);
      } else {
        requestMedia(path);
      }
    }

    function attachMetadata(element, path) {
      element.dataset.mediaPath = path;
      metadataElements.set(path, element);
      renderMetadata(element, path);
    }

    function handleThumbnailReady(data) {
      if (!data || typeof data.path !== "string") return;
      pendingThumbnails.delete(data.path);
      remember(thumbnailCache, data.path, data.dataUrl, thumbnailCacheLimit);
      showThumbnail(thumbnailElements.get(data.path), data.dataUrl);
    }

    function handleMetadataReady(data) {
      if (!data || typeof data.path !== "string") return;
      pendingMetadata.delete(data.path);
      remember(metadataCache, data.path, data.metadata, metadataCacheLimit);
      const element = metadataElements.get(data.path);
      if (element) renderMetadata(element, data.path);
    }

    function remove(path) {
      thumbnailCache.delete(path);
      metadataCache.delete(path);
      pendingThumbnails.delete(path);
      pendingMetadata.delete(path);
      thumbnailElements.delete(path);
      metadataElements.delete(path);
    }

    return {
      attachMetadata,
      beginRender,
      handleMetadataReady,
      handleThumbnailReady,
      loadThumbnail,
      remove,
      requestVisible,
    };
  }

  return { create };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersMediaPreview;
}
