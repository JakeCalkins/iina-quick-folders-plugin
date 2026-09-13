const test = require("node:test");
const assert = require("node:assert/strict");
const ResponsiveLayout = require("../ui/responsive-layout.js");

function createHarness(width, queueOpen = false) {
  const listeners = new Map();
  const classes = new Set();
  let open = queueOpen;
  const changes = [];
  const wideChanges = [];
  const windowObject = {
    innerWidth: width,
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const queueController = {
    isOpen() { return open; },
    setOpen(nextOpen, options) {
      open = nextOpen;
      changes.push({ open: nextOpen, options });
    },
  };
  const layout = ResponsiveLayout.create({
    windowObject,
    shell: {
      classList: {
        toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      },
    },
    queueController,
    onWideChange(wide) { wideChanges.push(wide); },
  });
  return { changes, classes, layout, listeners, wideChanges, windowObject };
}

test("wide windows enable columns and reveal the queue without resizing or stealing focus", () => {
  const harness = createHarness(1280);
  assert.equal(harness.classes.has("wide-layout"), true);
  assert.deepEqual(harness.wideChanges, [true]);
  assert.deepEqual(harness.changes, [{
    open: true,
    options: { notify: false, focus: false },
  }]);
});

test("responsive queue state follows breakpoint crossings but preserves manual choices", () => {
  const harness = createHarness(500);
  assert.equal(harness.classes.has("wide-layout"), false);
  assert.deepEqual(harness.wideChanges, []);
  assert.deepEqual(harness.changes, []);

  harness.windowObject.innerWidth = 1280;
  harness.listeners.get("resize")();
  assert.deepEqual(harness.changes.at(-1), {
    open: true,
    options: { notify: false, focus: false },
  });

  harness.windowObject.innerWidth = 900;
  harness.listeners.get("resize")();
  assert.deepEqual(harness.changes.at(-1), {
    open: false,
    options: { notify: false, focus: false },
  });

  harness.windowObject.innerWidth = 1320;
  harness.listeners.get("resize")();
  harness.layout.noteManualQueueChange();
  harness.windowObject.innerWidth = 900;
  harness.listeners.get("resize")();
  assert.equal(harness.changes.at(-1).open, true, "a manually retained queue should remain open");
});
