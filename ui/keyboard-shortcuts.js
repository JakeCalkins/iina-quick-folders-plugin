const QuickFoldersKeyboard = (() => {
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

  function formatShortcut(shortcut, fallback = "Not set") {
    const keys = String(shortcut || "")
      .split("+")
      .map((key) => key.trim())
      .filter(Boolean)
      .map((key) => KEY_LABELS[key.toLowerCase()] || (key.length === 1 ? key.toUpperCase() : key));
    return keys.length > 0 ? keys.join(" ") : fallback;
  }

  return { formatShortcut };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = QuickFoldersKeyboard;
}
