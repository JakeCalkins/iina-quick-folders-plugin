const QuickFoldersResponsiveLayout = (() => {
  // Below this width, a 340 px queue leaves too little room for a useful
  // multi-column hierarchy beside the active 340 px detail column.
  const DEFAULT_WIDE_BREAKPOINT = 1280;

  function create(options) {
    const {
      windowObject,
      shell,
      queueController,
      onWideChange = () => {},
      wideBreakpoint = DEFAULT_WIDE_BREAKPOINT,
    } = options;
    let isWide = false;
    let queueWasAutoOpened = false;

    function sync() {
      const nextWide = Number(windowObject.innerWidth) >= wideBreakpoint;
      shell.classList.toggle("wide-layout", nextWide);
      if (nextWide !== isWide) onWideChange(nextWide);

      if (nextWide && !isWide && !queueController.isOpen()) {
        queueController.setOpen(true, { notify: false, focus: false });
        queueWasAutoOpened = true;
      } else if (!nextWide && isWide && queueWasAutoOpened && queueController.isOpen()) {
        queueController.setOpen(false, { notify: false, focus: false });
        queueWasAutoOpened = false;
      }
      isWide = nextWide;
    }

    function noteManualQueueChange() {
      queueWasAutoOpened = false;
    }

    windowObject.addEventListener("resize", sync);
    sync();

    return {
      isWide: () => isWide,
      noteManualQueueChange,
      sync,
    };
  }

  return { create, DEFAULT_WIDE_BREAKPOINT };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersResponsiveLayout;
}
