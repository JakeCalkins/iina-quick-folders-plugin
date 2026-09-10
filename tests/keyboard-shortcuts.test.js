const test = require("node:test");
const assert = require("node:assert/strict");
const keyboard = require("../quick-folders.iinaplugin/ui/keyboard-shortcuts.js");

test("formats configured shortcuts as compact macOS key labels", () => {
  assert.equal(keyboard.formatShortcut("cmd+shift+a"), "⌘ ⇧ A");
  assert.equal(keyboard.formatShortcut("ctrl+option+enter"), "⌃ ⌥ Return");
  assert.equal(keyboard.formatShortcut("escape"), "Esc");
});

test("formats custom keys and falls back for blank shortcuts", () => {
  assert.equal(keyboard.formatShortcut("cmd+F12"), "⌘ F12");
  assert.equal(keyboard.formatShortcut("", "Not configured"), "Not configured");
});
