const QuickFoldersMessaging = (() => {
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
    }
  }

  return { onMessage, send };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersMessaging;
}
