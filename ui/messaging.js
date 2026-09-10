function postMessage(type, data = null) {
  if (typeof iina !== "undefined" && typeof iina.postMessage === "function") {
    iina.postMessage(type, data);
  } else if (typeof window.postMessage === "function") {
    window.postMessage({ type, data });
  }
}

function onWindowMessage(type, callback) {
  if (typeof iina !== "undefined" && iina.onMessage) {
    iina.onMessage(type, callback);
  }
}
