const QuickFoldersMediaMetadata = (() => {
  const ATTRIBUTE_MAP = {
    kMDItemDurationSeconds: "duration",
    kMDItemPixelHeight: "height",
    kMDItemPixelWidth: "width",
  };

  function parseMdlsOutput(output) {
    const metadata = {};
    String(output || "").split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*(kMDItem\w+)\s*=\s*(.*?)\s*$/);
      if (!match || !ATTRIBUTE_MAP[match[1]] || match[2] === "(null)") return;
      const value = Number(match[2]);
      if (Number.isFinite(value) && value > 0) metadata[ATTRIBUTE_MAP[match[1]]] = value;
    });
    return metadata;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainingSeconds = rounded % 60;
    const paddedSeconds = String(remainingSeconds).padStart(2, "0");
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
      : `${minutes}:${paddedSeconds}`;
  }

  function formatResolution(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
    return `${Math.round(width)}×${Math.round(height)}`;
  }

  return { formatDuration, formatResolution, parseMdlsOutput };
})();

if (typeof module !== "undefined") {
  module.exports = QuickFoldersMediaMetadata;
}
