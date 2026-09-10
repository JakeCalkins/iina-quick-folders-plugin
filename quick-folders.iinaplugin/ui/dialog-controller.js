// Shared modal behavior keeps focus and keyboard rules consistent.
const QuickFoldersDialogs = (() => {
  const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  function create(options) {
    const element = options.element;
    const trigger = options.trigger || null;
    const inertTarget = options.inertTarget || null;
    const initialFocus = options.initialFocus || null;
    const closeButtons = options.closeButtons || [];
    const toggleKey = options.toggleKey || null;

    let returnFocus = null;

    function isOpen() {
      return Boolean(element && !element.classList.contains("hidden"));
    }

    function open() {
      if (!element || isOpen()) return false;
      returnFocus = document.activeElement;
      element.classList.remove("hidden");
      if (inertTarget) inertTarget.setAttribute("inert", "");
      if (trigger) trigger.setAttribute("aria-expanded", "true");
      if (initialFocus) initialFocus.focus();
      return true;
    }

    function close({ restoreFocus = true } = {}) {
      if (!element || !isOpen()) return false;
      element.classList.add("hidden");
      if (inertTarget) inertTarget.removeAttribute("inert");
      if (trigger) trigger.setAttribute("aria-expanded", "false");

      const target = returnFocus;
      returnFocus = null;
      if (restoreFocus && target && document.contains(target) && typeof target.focus === "function") {
        target.focus();
      }
      return true;
    }

    function trapFocus(event) {
      const focusable = Array.from(element.querySelectorAll(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (focusable.length === 1 || !element.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    // Returns true whenever this open modal consumed the event, preventing
    // background keyboard commands from firing through a dialog.
    function handleKeydown(event) {
      if (!isOpen()) return false;
      if (event.key === "Escape" || (toggleKey && event.key === toggleKey)) {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        trapFocus(event);
      }
      return true;
    }

    if (element) {
      element.addEventListener("click", (event) => {
        if (event.target === element) close();
      });
    }
    closeButtons.forEach((button) => {
      if (button) button.addEventListener("click", () => close());
    });

    return { close, handleKeydown, isOpen, open };
  }

  return { create };
})();
