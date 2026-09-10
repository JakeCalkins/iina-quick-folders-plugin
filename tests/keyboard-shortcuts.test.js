const test = require("node:test");
const assert = require("node:assert/strict");
const keyboard = require("../ui/keyboard-shortcuts.js");

test("formats configured shortcuts as compact macOS key labels", () => {
  assert.equal(keyboard.formatShortcut("cmd+shift+a"), "⌘ ⇧ A");
  assert.equal(keyboard.formatShortcut("Meta+A"), "⌘ ⇧ A");
  assert.equal(keyboard.formatShortcut("ctrl+option+enter"), "⌃ ⌥ Return");
  assert.equal(keyboard.formatShortcut("escape"), "Esc");
});

test("formats custom keys and falls back for blank shortcuts", () => {
  assert.equal(keyboard.formatShortcut("cmd+F12"), "⌘ F12");
  assert.equal(keyboard.formatShortcut("", "Not configured"), "Not configured");
});

test("normalizes friendly macOS shortcuts for IINA's mpv-style menu API", () => {
  assert.equal(keyboard.normalizeMenuShortcut("cmd+shift+a"), "Meta+A");
  assert.equal(keyboard.normalizeMenuShortcut("Control + Option + Enter"), "Ctrl+Alt+ENTER");
  assert.equal(keyboard.normalizeMenuShortcut("shift+F12"), "Shift+F12");
  assert.equal(keyboard.normalizeMenuShortcut("n"), "n");
});

test("rejects malformed shortcuts and can fall back to a valid default", () => {
  assert.equal(keyboard.normalizeMenuShortcut("cmd+hyper+a"), null);
  assert.equal(keyboard.normalizeMenuShortcut("cmd+F13"), null);
  assert.equal(keyboard.resolveMenuShortcut("not-a-key", "cmd+shift+a"), "Meta+A");
});
