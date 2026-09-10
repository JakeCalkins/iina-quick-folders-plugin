function createAsyncResourceLoader(options) {
  const cache = new Map();
  const pending = new Set();
  const queue = [];
  const versions = new Map();
  const concurrency = Math.max(1, options.concurrency || 1);
  const maxEntries = Math.max(1, options.maxEntries || 100);
  let activeJobs = 0;

  function deliver(key, value) {
    try {
      options.deliver(key, value);
    } catch (err) {
      // A closed standalone window must not stall the worker queue.
    }
  }

  function remember(key, value) {
    if (!cache.has(key) && cache.size >= maxEntries) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, value == null ? null : value);
  }

  function processQueue() {
    while (activeJobs < concurrency && queue.length > 0) {
      const job = queue.shift();
      const { key, version } = job;
      activeJobs++;
      Promise.resolve()
        .then(() => options.load(key))
        .catch(() => null)
        .then((value) => {
          if (versions.get(key) !== version) return;
          remember(key, value);
          deliver(key, value);
        })
        .finally(() => {
          if (versions.get(key) === version) pending.delete(key);
          activeJobs--;
          processQueue();
        });
    }
  }

  function request(key) {
    if (!options.isValid(key)) return false;
    if (cache.has(key)) {
      deliver(key, cache.get(key));
      return true;
    }
    if (pending.has(key)) return true;
    const version = versions.get(key) || 0;
    versions.set(key, version);
    pending.add(key);
    queue.push({ key, version });
    processQueue();
    return true;
  }

  function remove(key) {
    versions.set(key, (versions.get(key) || 0) + 1);
    cache.delete(key);
    pending.delete(key);
    const queuedIndex = queue.findIndex((job) => job.key === key);
    if (queuedIndex !== -1) queue.splice(queuedIndex, 1);
  }

  return { remove, request };
}

module.exports = { createAsyncResourceLoader };
