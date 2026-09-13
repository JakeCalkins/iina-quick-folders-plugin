const QuickFoldersKeyboard = (() => {
  const MODIFIER_ALIASES = {
    alt: "Alt",
    cmd: "Meta",
    command: "Meta",
    control: "Ctrl",
    ctrl: "Ctrl",
    meta: "Meta",
    option: "Alt",
    shift: "Shift",
    super: "Meta",
  };
  const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"];
  const SPECIAL_KEYS = {
    backspace: "BS",
    bs: "BS",
    del: "DEL",
    delete: "DEL",
    down: "DOWN",
    end: "END",
    enter: "ENTER",
    esc: "ESC",
    escape: "ESC",
    home: "HOME",
    ins: "INS",
    insert: "INS",
    left: "LEFT",
    plus: "PLUS",
    pgdown: "PGDWN",
    pgdwn: "PGDWN",
    pgup: "PGUP",
    pagedown: "PGDWN",
    pageup: "PGUP",
    return: "ENTER",
    right: "RIGHT",
    space: "SPACE",
    tab: "TAB",
    up: "UP",
  };
  const SPECIAL_KEY_NAMES = new Set(Object.values(SPECIAL_KEYS));
  const KEY_LABELS = {
    alt: "⌥",
    backspace: "⌫",
    cmd: "⌘",
    command: "⌘",
    control: "⌃",
    ctrl: "⌃",
    delete: "Delete",
    enter: "Return",
    esc: "Esc",
    escape: "Esc",
    meta: "⌘",
    option: "⌥",
    return: "Return",
    shift: "⇧",
    space: "Space",
  };

  /**
   * Convert friendly macOS names into the normalized mpv key syntax expected by
   * IINA's menu API. IINA does not normalize plugin menu shortcuts itself, so a
   * value such as "cmd+shift+a" otherwise becomes an unmodified "a" key.
   */
  function normalizeMenuShortcut(shortcut) {
    const parts = String(shortcut || "")
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;

    const modifiers = new Set();
    for (const part of parts.slice(0, -1)) {
      const modifier = MODIFIER_ALIASES[part.toLowerCase()];
      if (!modifier) return null;
      modifiers.add(modifier);
    }

    const rawKey = parts[parts.length - 1];
    const lowerKey = rawKey.toLowerCase();
    let key = SPECIAL_KEYS[lowerKey] || rawKey;
    if (/^f(?:[1-9]|1[0-2])$/i.test(key)) key = key.toUpperCase();
    if (key.length > 1 && !SPECIAL_KEY_NAMES.has(key) && !/^F(?:[1-9]|1[0-2])$/.test(key)) {
      return null;
    }

    if (/^[a-z]$/i.test(key) && modifiers.has("Shift")) {
      key = key.toUpperCase();
      modifiers.delete("Shift");
    }

    return MODIFIER_ORDER
      .filter((modifier) => modifiers.has(modifier))
      .concat(key)
      .join("+");
  }

  function resolveMenuShortcut(shortcut, fallback) {
    return normalizeMenuShortcut(shortcut) || normalizeMenuShortcut(fallback);
  }

  function formatShortcut(shortcut, fallback = "Not set") {
    const rawKeys = String(shortcut || "")
      .split("+")
      .map((key) => key.trim())
      .filter(Boolean);
    const keys = rawKeys
      .map((key) => KEY_LABELS[key.toLowerCase()] || (key.length === 1 ? key.toUpperCase() : key));
    const finalKey = rawKeys[rawKeys.length - 1];
    const hasExplicitShift = rawKeys.slice(0, -1).some((key) => key.toLowerCase() === "shift");
    if (finalKey && /^[A-Z]$/.test(finalKey) && !hasExplicitShift) {
      keys.splice(keys.length - 1, 0, KEY_LABELS.shift);
    }
    return keys.length > 0 ? keys.join(" ") : fallback;
  }

  function getQueuePaths(items, selectedPaths, focusedPath) {
    const files = (Array.isArray(items) ? items : [])
      .filter((item) => item && !item.isDir && typeof item.path === "string");
    const selected = new Set(Array.isArray(selectedPaths) ? selectedPaths : []);
    const selectedInOrder = files.filter((item) => selected.has(item.path)).map((item) => item.path);
    if (selectedInOrder.length > 0) return selectedInOrder;

    const focused = files.find((item) => item.path === focusedPath);
    return focused ? [focused.path] : [];
  }

  return { formatShortcut, getQueuePaths, normalizeMenuShortcut, resolveMenuShortcut };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersKeyboard;
}
