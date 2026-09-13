// Accessible command-palette behavior. Markup, the command registry, and the
// dialog/focus implementation are injected so this remains testable in Node.
const QuickFoldersCommandPalette = (() => {
  let nextPaletteId = 1;

  function create(options) {
    const element = options.element;
    const input = options.input;
    const list = options.list;
    const empty = options.empty || null;
    const registry = options.registry;
    const dialog = options.dialog || null;
    const documentObject = options.documentObject
      || (typeof document !== "undefined" ? document : null);
    const getContext = typeof options.getContext === "function" ? options.getContext : () => ({});
    const createElement = options.createElement
      || ((tagName) => documentObject.createElement(tagName));
    const idPrefix = options.idPrefix || `command-palette-${nextPaletteId++}`;
    let results = [];
    let activeIndex = -1;
    let open = false;
    let previousFocus = null;

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    list.id = list.id || `${idPrefix}-list`;
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "false");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", options.listLabel || "Available commands");

    function clearList() {
      if (typeof list.replaceChildren === "function") list.replaceChildren();
      else list.innerHTML = "";
    }

    function setActive(index, { scroll = true } = {}) {
      if (results.length === 0) activeIndex = -1;
      else activeIndex = Math.max(0, Math.min(results.length - 1, index));
      const nodes = Array.from(list.querySelectorAll("[role='option']"));
      nodes.forEach((node, nodeIndex) => {
        const selected = nodeIndex === activeIndex;
        node.setAttribute("aria-selected", String(selected));
        node.classList.toggle("active", selected);
        if (selected && scroll && typeof node.scrollIntoView === "function") {
          node.scrollIntoView({ block: "nearest" });
        }
      });
      if (activeIndex >= 0 && nodes[activeIndex]) {
        input.setAttribute("aria-activedescendant", nodes[activeIndex].id);
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function execute(command) {
      if (!command) return false;
      const context = getContext() || {};
      const outcome = typeof options.onExecute === "function"
        ? options.onExecute(command, context)
        : registry.execute(command.id, context);
      if (outcome === false || (outcome && outcome.executed === false)) return false;
      close();
      return true;
    }

    function createOption(command, index) {
      const option = createElement("div");
      option.id = `${idPrefix}-option-${index}`;
      option.className = "command-option";
      option.dataset.commandId = command.id;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");

      const copy = createElement("span");
      copy.className = "command-option-copy";
      const label = createElement("span");
      label.className = "command-option-label";
      label.textContent = command.label;
      const group = createElement("span");
      group.className = "command-option-group";
      group.textContent = command.group;
      copy.appendChild(label);
      copy.appendChild(group);
      option.appendChild(copy);

      if (command.shortcut) {
        const shortcut = createElement("kbd");
        shortcut.className = "command-option-shortcut";
        shortcut.textContent = command.shortcut;
        shortcut.setAttribute("aria-label", `Shortcut ${command.shortcut}`);
        option.appendChild(shortcut);
      }

      option.addEventListener("mousemove", () => setActive(index, { scroll: false }));
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => execute(command));
      return option;
    }

    function refresh() {
      results = registry.search(input.value || "", getContext() || {}, {
        limit: options.maxResults || 30,
      });
      clearList();
      const fragment = documentObject && typeof documentObject.createDocumentFragment === "function"
        ? documentObject.createDocumentFragment()
        : null;
      const parent = fragment || list;
      results.forEach((command, index) => parent.appendChild(createOption(command, index)));
      if (fragment) list.appendChild(fragment);
      if (empty) empty.classList.toggle("hidden", results.length > 0);
      list.classList.toggle("hidden", results.length === 0);
      setActive(results.length > 0 ? 0 : -1, { scroll: false });
      return results.slice();
    }

    function show() {
      if (open) {
        refresh();
        input.focus();
        input.select();
        return;
      }
      open = true;
      previousFocus = documentObject && documentObject.activeElement;
      input.value = "";
      input.setAttribute("aria-expanded", "true");
      if (dialog && typeof dialog.open === "function") dialog.open();
      else element.classList.remove("hidden");
      refresh();
      input.focus();
      if (typeof options.onOpenChange === "function") options.onOpenChange(true);
    }

    function close() {
      if (!open) return;
      open = false;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      if (dialog && typeof dialog.close === "function") {
        dialog.close();
      } else {
        element.classList.add("hidden");
        if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
      }
      previousFocus = null;
      if (typeof options.onOpenChange === "function") options.onOpenChange(false);
    }

    function handleInputKeydown(event) {
      if (event.isComposing) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive(activeIndex < results.length - 1 ? activeIndex + 1 : 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive(activeIndex > 0 ? activeIndex - 1 : results.length - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        setActive(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setActive(results.length - 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        execute(results[activeIndex]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }

    function handleElementKeydown(event) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close();
    }

    input.addEventListener("input", refresh);
    input.addEventListener("keydown", handleInputKeydown);
    element.addEventListener("keydown", handleElementKeydown);

    return {
      close,
      getActiveCommand: () => results[activeIndex] || null,
      isOpen: () => open,
      refresh,
      show,
    };
  }

  return { create };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersCommandPalette;
}
