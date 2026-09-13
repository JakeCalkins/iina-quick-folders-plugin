import {
  clearMessages,
  createState,
  emitBackendMessage,
  expect,
  messagesOfType,
  openQuickFolders,
  test,
} from "./fixtures.mjs";

test("renders the backend state without overflowing the default window", async ({ page }) => {
  await openQuickFolders(page);

  await expect(page.locator("#breadcrumb").getByText("media", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: /Alpha, not selected, In Progress/ })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "25% watched" })).toHaveAttribute("aria-valuenow", "25");
  await expect(page.getByRole("button", { name: "Open queue (2)" })).toBeVisible();

  const geometry = await page.evaluate(() => ({
    bodyWidth: document.body.getBoundingClientRect().width,
    clientWidth: document.documentElement.clientWidth,
    paneLeft: document.querySelector(".pane").getBoundingClientRect().left,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry).toEqual({ bodyWidth: 500, clientWidth: 500, paneLeft: 0, scrollWidth: 500 });
});

test("keyboard focus, selection, playback, and queue commands follow the active row", async ({ page }) => {
  const state = createState();
  await openQuickFolders(page, createState({ items: state.items.slice(1) }));
  const alpha = page.locator('#item-list .row[data-path="/media/Alpha.mkv"]');
  const beta = page.locator('#item-list .row[data-path="/media/Beta.mp3"]');

  await expect(alpha).toHaveClass(/focused/);
  await alpha.focus();
  await page.keyboard.press("ArrowDown");
  await expect(beta).toBeFocused();
  await expect(beta).toHaveClass(/focused/);
  await expect(alpha).not.toHaveClass(/focused/);

  await page.keyboard.press("Enter");
  await expect(beta).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();

  await clearMessages(page);
  await page.keyboard.press("Space");
  await expect.poll(async () => messagesOfType(page, "open-item")).toEqual([
    { type: "open-item", data: { path: "/media/Beta.mp3", isDir: false } },
  ]);

  await clearMessages(page);
  await page.keyboard.press("q");
  await expect.poll(async () => messagesOfType(page, "queue-add")).toEqual([
    { type: "queue-add", data: { paths: ["/media/Beta.mp3"] } },
  ]);
});

test("search and file-type filters compose while folders remain navigable", async ({ page }) => {
  await openQuickFolders(page);
  const search = page.getByRole("combobox", { name: "Search files" });
  const filter = page.getByRole("combobox", { name: "Filter by file type" });

  await search.fill("is:progress");
  await expect(page.getByRole("option", { name: /Alpha/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Beta/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Open folder Shows/ })).toBeVisible();

  await search.fill("");
  await filter.selectOption("video");
  await expect(page.getByRole("option", { name: /Alpha/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Gamma Finale/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Beta/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Open folder Shows/ })).toBeVisible();

  await search.fill("gamma");
  await expect(page.getByRole("option", { name: /Gamma Finale/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Alpha/ })).toHaveCount(0);
});

test("queue controls distinguish collapse from removal and emit exact actions", async ({ page }) => {
  await openQuickFolders(page);
  await page.getByRole("button", { name: "Open queue (2)" }).click();

  const panel = page.locator("#queue-panel");
  const collapse = page.getByRole("button", { name: "Collapse queue" });
  const removeAlpha = page.getByRole("button", { name: "Remove Alpha from queue" });
  await expect(panel).toBeVisible();
  await expect(collapse).toBeVisible();
  await expect(removeAlpha).toBeVisible();
  await expect(collapse).toHaveClass(/queue-close-btn/);
  await expect(removeAlpha).toHaveClass(/queue-remove-btn/);

  await clearMessages(page);
  await removeAlpha.click();
  await expect.poll(async () => messagesOfType(page, "queue-remove")).toEqual([
    { type: "queue-remove", data: { paths: ["/media/Alpha.mkv"] } },
  ]);
  await emitBackendMessage(page, "queue-action-result", {
    action: "removed",
    succeeded: ["/media/Alpha.mkv"],
    failed: [],
  });
  const state = createState();
  await emitBackendMessage(page, "update-items", {
    ...state,
    queueItems: [state.queueItems[1]],
  });
  await expect(page.getByRole("button", { name: "Remove Alpha from queue" })).toHaveCount(0);
  await expect(page.locator("#queue-badge")).toHaveText("1");
  await expect(page.locator("#toast")).toHaveText("1 item removed from queue");

  await clearMessages(page);
  await page.getByRole("button", { name: "Watch Queue" }).click();
  await expect.poll(async () => messagesOfType(page, "queue-play")).toEqual([
    { type: "queue-play", data: null },
  ]);
  await collapse.click();
  await expect(panel).toBeHidden();
});

test("delete confirmation traps focus, cancels safely, and confirms selected paths", async ({ page }) => {
  const state = createState();
  await openQuickFolders(page, createState({ items: state.items.slice(1) }));
  const alpha = page.locator('#item-list .row[data-path="/media/Alpha.mkv"]');
  await alpha.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Delete");

  const dialog = page.getByRole("dialog", { name: "Move to Trash?" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Move to Trash" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(alpha).toBeFocused();

  await page.keyboard.press("Delete");
  await clearMessages(page);
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect.poll(async () => messagesOfType(page, "delete-items")).toEqual([
    { type: "delete-items", data: { paths: ["/media/Alpha.mkv"] } },
  ]);
  await emitBackendMessage(page, "item-action-result", {
    action: "trashed",
    succeeded: [],
    failed: [{ path: "/media/Alpha.mkv", reason: "Read only" }],
  });
  await expect(page.locator("#toast")).toHaveText("1 file could not be updated");
  await expect(alpha).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Delete");
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await emitBackendMessage(page, "update-items", {
    ...state,
    items: state.items.slice(2),
  });
  await emitBackendMessage(page, "item-action-result", {
    action: "trashed",
    succeeded: ["/media/Alpha.mkv"],
    failed: [],
  });
  await expect(alpha).toHaveCount(0);
  await expect(page.locator("#toast")).toHaveText("1 file moved to Trash");
});

test("narrow drag state keeps the queue label inside its button", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  const state = createState();
  await openQuickFolders(page, createState({ items: state.items.slice(1) }));
  const row = page.locator("#item-list .row").first();
  const bucket = page.locator("#queue-bucket");
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await row.dispatchEvent("dragstart", { dataTransfer: transfer });

  const label = page.locator(".queue-drop-label");
  await expect(label).toHaveText("Drop to queue");
  await expect(label).toBeVisible();
  const geometry = await page.evaluate(() => {
    const button = document.querySelector("#queue-bucket").getBoundingClientRect();
    const text = document.querySelector(".queue-drop-label").getBoundingClientRect();
    return {
      fits: text.left >= button.left && text.right <= button.right,
      viewportFits: document.documentElement.scrollWidth === document.documentElement.clientWidth,
    };
  });
  expect(geometry).toEqual({ fits: true, viewportFits: true });

  await clearMessages(page);
  await bucket.dispatchEvent("dragenter", { dataTransfer: transfer });
  await bucket.dispatchEvent("dragover", { dataTransfer: transfer });
  await bucket.dispatchEvent("drop", { dataTransfer: transfer });
  await row.dispatchEvent("dragend", { dataTransfer: transfer });
  await expect.poll(async () => messagesOfType(page, "queue-add")).toEqual([
    { type: "queue-add", data: { paths: ["/media/Alpha.mkv"] } },
  ]);
  await expect(page.locator("body")).not.toHaveClass(/dragging-media/);
  await expect(label).toBeHidden();
});
