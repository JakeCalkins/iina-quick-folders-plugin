import { expect, test as base } from "@playwright/test";

const mediaItems = [
  {
    name: "Alpha.mkv",
    path: "/media/Alpha.mkv",
    type: "video",
    ext: "mkv",
    size: 1_048_576,
    duration: 1_200,
    width: 1920,
    height: 1080,
    playbackState: "in-progress",
    progress: { state: "in-progress", position: 300, duration: 1_200, fraction: 0.25 },
  },
  {
    name: "Beta.mp3",
    path: "/media/Beta.mp3",
    type: "audio",
    ext: "mp3",
    duration: 240,
    playbackState: "new",
  },
  {
    name: "Gamma Finale.mp4",
    path: "/media/Gamma Finale.mp4",
    type: "video",
    ext: "mp4",
    duration: 5_400,
    playbackState: "watched",
    watched: true,
  },
];

export function createState(overrides = {}) {
  return {
    atRoot: false,
    currentPath: "/media",
    currentRootPath: "/media",
    currentView: null,
    folderDepth: 0,
    indexRevision: 7,
    indexedFiles: mediaItems,
    isIndexing: false,
    items: [
      { name: "Shows", path: "/media/Shows", isDir: true },
      ...mediaItems,
    ],
    navigationColumns: [{
      id: "quick-folders",
      title: "Quick Folders",
      items: [{ name: "media", path: "/media", isDir: true, isRoot: true }],
      selectedPath: "/media",
    }],
    queueItems: [mediaItems[0], mediaItems[2]],
    availableExtensions: ["mkv", "mp3", "mp4"],
    preferences: {
      completionThreshold: 0.9,
      filterAudio: false,
      filterImages: false,
      hideWatched: false,
      maxIndexDepth: 3,
      showBitrateChips: false,
      videoOnly: false,
    },
    ...overrides,
  };
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("requestfailed", (request) => {
      errors.push(`request: ${request.url()} (${request.failure()?.errorText || "failed"})`);
    });
    page.on("response", (response) => {
      if (response.url().startsWith("http://127.0.0.1:4173/") && response.status() >= 400) {
        errors.push(`response: ${response.status()} ${response.url()}`);
      }
    });
    await use(page);
    expect(errors, "browser errors during the functional test").toEqual([]);
  },
});

export { expect } from "@playwright/test";

export async function openQuickFolders(page, state = createState()) {
  await page.addInitScript((initialState) => {
    const handlers = new Map();
    const messages = [];
    let backendState = initialState;

    function emit(type, data) {
      (handlers.get(type) || []).forEach((handler) => handler(data));
    }

    window.__quickFoldersTest = {
      clearMessages() { messages.length = 0; },
      emit,
      getMessages() { return messages.slice(); },
      setState(nextState) { backendState = nextState; },
    };
    window.iina = {
      onMessage(type, callback) {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(callback);
      },
      postMessage(type, data) {
        messages.push({ type, data });
        if (type === "request-state") queueMicrotask(() => emit("update-items", backendState));
      },
    };
  }, state);
  await page.goto("/ui/index.html");
  await expect(page.locator("#item-list .row")).toHaveCount(state.items.length);
}

export async function clearMessages(page) {
  await page.evaluate(() => window.__quickFoldersTest.clearMessages());
}

export async function emitBackendMessage(page, type, data) {
  await page.evaluate(({ messageType, messageData }) => {
    window.__quickFoldersTest.emit(messageType, messageData);
  }, { messageType: type, messageData: data });
}

export async function messagesOfType(page, type) {
  return page.evaluate((messageType) => (
    window.__quickFoldersTest.getMessages().filter((message) => message.type === messageType)
  ), type);
}
