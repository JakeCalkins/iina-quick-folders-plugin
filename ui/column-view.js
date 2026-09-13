// Renders compact ancestor columns. The active folder keeps using ItemView so
// previews, selection, and metadata have a single authoritative implementation.
const QuickFoldersColumnView = (() => {
  function createItem(item, selectedPath, options) {
    const button = document.createElement("button");
    button.className = "column-item";
    button.type = "button";
    button.dataset.path = item.path;
    button.classList.toggle("selected", item.path === selectedPath);
    if (item.path === selectedPath) button.setAttribute("aria-current", "location");

    const icon = document.createElement("span");
    icon.className = "column-item-icon";
    icon.textContent = QuickFoldersView.getFileIcon(item.name, item.isDir);
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "column-item-label";
    label.textContent = QuickFoldersView.getDisplayName(item);

    const accessory = document.createElement("span");
    accessory.className = "column-item-accessory";
    accessory.textContent = item.isDir ? "›" : (QuickFoldersFileTypes.getExtension(item.name) || "").toUpperCase();
    accessory.setAttribute("aria-hidden", "true");

    button.appendChild(icon);
    button.appendChild(label);
    button.appendChild(accessory);
    button.title = item.path;
    button.setAttribute("aria-label", item.isDir ? `Open folder ${item.name}` : `Open ${item.name}`);
    button.addEventListener("click", () => {
      if (item.isDir) options.onOpenFolder(item);
      else options.onOpenFile(item);
    });
    return button;
  }

  function create(options) {
    const { element, scrollContainer, schedule = (callback) => callback() } = options;

    function revealActive() {
      if (!scrollContainer) return;
      schedule(() => { scrollContainer.scrollLeft = scrollContainer.scrollWidth; });
    }

    function render(columns) {
      element.innerHTML = "";
      const entries = Array.isArray(columns) ? columns : [];
      element.classList.toggle("hidden", entries.length === 0);
      const fragment = document.createDocumentFragment();
      entries.forEach((column) => {
        const section = document.createElement("section");
        section.className = "browser-column";
        section.setAttribute("aria-label", column.title || "Folder");

        const heading = document.createElement("div");
        heading.className = "browser-column-heading";
        heading.textContent = column.title || "Folder";
        section.appendChild(heading);

        const list = document.createElement("div");
        list.className = "browser-column-list";
        (Array.isArray(column.items) ? column.items : []).forEach((item) => {
          list.appendChild(createItem(item, column.selectedPath, options));
        });
        section.appendChild(list);
        fragment.appendChild(section);
      });
      element.appendChild(fragment);
      if (entries.length > 0) revealActive();
    }

    return { render, revealActive };
  }

  return { create };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersColumnView;
}
