const QuickFoldersMessaging = (() => {
  const browserHandlers = new Map();
  let browserListenerWindow = null;

  function ensureBrowserListener() {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    if (browserListenerWindow === window) return;
    browserListenerWindow = window;
    window.addEventListener("message", (event) => {
      const origin = window.location && window.location.origin;
      const trustedOrigin = !origin || origin === "null" || event.origin === origin;
      if (event.source !== window || !trustedOrigin) return;
      const message = event.data;
      if (!message || typeof message.type !== "string") return;
      const handlers = browserHandlers.get(message.type) || [];
      handlers.forEach((handler) => handler(message.data));
    });
  }

  function send(type, data = null) {
    if (typeof iina !== "undefined" && typeof iina.postMessage === "function") {
      iina.postMessage(type, data);
    } else if (typeof window.postMessage === "function") {
      const targetOrigin = window.location.origin === "null" ? "*" : window.location.origin;
      window.postMessage({ type, data }, targetOrigin);
    }
  }

  function onMessage(type, callback) {
    if (typeof iina !== "undefined" && iina.onMessage) {
      iina.onMessage(type, callback);
      return;
    }
    if (typeof type !== "string" || typeof callback !== "function") return;
    if (!browserHandlers.has(type)) browserHandlers.set(type, []);
    browserHandlers.get(type).push(callback);
    ensureBrowserListener();
  }

  return { onMessage, send };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersMessaging;
}
