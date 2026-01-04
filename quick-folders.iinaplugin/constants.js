const FILE_TYPES = {
  VIDEO: "video",
  AUDIO: "audio",
  IMAGE: "image",
  OTHER: "other",
};

const VIDEO_EXTENSIONS = /\.(mp4|mkv|avi|mov|flv|wmv|webm|m4v|3gp|ts|mts|m2ts|mxf)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|aac|flac|ogg|wav|wma|aiff|opus|m4a)$/i;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff|ico)$/i;

const VIDEO_EXTENSION_LIST = "mp4|mkv|avi|mov|flv|wmv|webm|m4v|3gp|ts|mts|m2ts|mxf";
const AUDIO_EXTENSION_LIST = "mp3|aac|flac|ogg|wav|wma|aiff|opus|m4a";
const IMAGE_EXTENSION_LIST = "jpg|jpeg|png|gif|bmp|webp|svg|tiff|ico";

const SKIP_DIRECTORIES = new Set([
  '.app', '.bundle', '.framework', '.plugin', '.component',
  'node_modules', '__pycache__', '.venv', 'venv',
  '.git', '.svn', '.hg', '.idea', '.vscode',
  'build', 'dist', 'out', 'bin', 'target',
  '.logicx', '.band', '.serato', '.xcodeproj', '.xcworkspace',
  'Caches', '.cache', 'vendor', '.gem', 'Databases', 'Tags', '.Trash', 'Library', '.Spotlight-V100',
]);

const SKIP_EXTENSIONS = new Set([
  'ds_store', 'localized', 'plist', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf',
  'txt', 'md', 'pdf', 'doc', 'docx', 'rtf', 'pages',
  'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'swift', 'sh', 'bash',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'db', 'sqlite', 'sql', 'cache', 'tmp', 'temp',
  'tagset', 'tagpool', 'asd', 'als', 'logic', 'ptx', 'sessiondata',
  'log', 'bak', 'old', 'swp', 'swo',
]);

const FILE_TYPE_ICONS = {
  video: "􀎶",
  audio: "􀑪",
  image: "🖼",
  folder: "􀈖",
  file: "📄",
};

function getFileTypeByExt(ext) {
  ext = ext.toLowerCase();
  if (VIDEO_EXTENSIONS.test("." + ext)) return FILE_TYPES.VIDEO;
  if (AUDIO_EXTENSIONS.test("." + ext)) return FILE_TYPES.AUDIO;
  if (IMAGE_EXTENSIONS.test("." + ext)) return FILE_TYPES.IMAGE;
  return FILE_TYPES.OTHER;
}

function isVideoExtension(filename) {
  return VIDEO_EXTENSIONS.test(filename);
}

function isAudioExtension(filename) {
  return AUDIO_EXTENSIONS.test(filename);
}

function isImageExtension(filename) {
  return IMAGE_EXTENSIONS.test(filename);
}
