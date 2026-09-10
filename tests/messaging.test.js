const test = require("node:test");
const assert = require("node:assert/strict");
const messaging = require("../ui/messaging.js");

test("sends messages through IINA when the plugin bridge is available", () => {
  const messages = [];
  global.iina = {
    postMessage(type, data) {
      messages.push({ type, data });
    },
  };
  try {
    messaging.send("go-back");
    assert.deepEqual(messages, [{ type: "go-back", data: null }]);
  } finally {
    delete global.iina;
  }
});

test("browser fallback calls the native window channel once without recursion", () => {
  const messages = [];
  global.window = {
    location: { origin: "http://127.0.0.1:4175" },
    postMessage(message, targetOrigin) {
      messages.push({ message, targetOrigin });
    },
  };
  try {
    messaging.send("request-state", { refresh: true });
    assert.deepEqual(messages, [{
      message: { type: "request-state", data: { refresh: true } },
      targetOrigin: "http://127.0.0.1:4175",
    }]);
  } finally {
    delete global.window;
  }
});
