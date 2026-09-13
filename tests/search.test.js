const test = require("node:test");
const assert = require("node:assert/strict");
const search = require("../ui/search.js");

function matches(name, query, isDir = false) {
  const record = search.createRecord({ name, isDir });
  return search.match(record, search.compileQuery(query)).matches;
}

test("plain terms support substrings, subsequences, and small typos", () => {
  assert.equal(matches("My Summer Vacation.mp4", "summer"), true);
  assert.equal(matches("My Summer Vacation.mp4", "smr vctn"), true);
  assert.equal(matches("My Summer Vacation.mp4", "vacatoin"), true);
  assert.equal(matches("My Summer Vacation.mp4", "winter"), false);
});

test("multiple positive terms must all match", () => {
  assert.equal(matches("Summer Vacation Final.mp4", "summer final"), true);
  assert.equal(matches("Summer Vacation.mp4", "summer final"), false);
});

test("quotes are literal and support spaces and escaped quotes", () => {
  assert.equal(matches("My Summer Trip.mp4", '"summer trip"'), true);
  assert.equal(matches("Summer Family Trip.mp4", '"summer trip"'), false);
  assert.equal(matches('A "Special" Cut.mp4', '"\\"special\\""'), true);
  assert.equal(matches("star*cut.mp4", '"star*cut"'), true);
});

test("wildcards match filenames", () => {
  assert.equal(matches("Summer Holiday 01.mp4", "summer*01.mp?"), true);
  assert.equal(matches("Summer Holiday 010.mp4", "summer*01.mp?"), false);
});

test("leading minus excludes fuzzy, literal, wildcard, and extension matches", () => {
  assert.equal(matches("Summer Draft.mp4", "summer -draft"), false);
  assert.equal(matches("Summer Final.mp4", 'summer -"rough cut"'), true);
  assert.equal(matches("Summer Rough Cut.mp4", 'summer -"rough cut"'), false);
  assert.equal(matches("Summer Final.mp4", "summer -*final*"), false);
  assert.equal(matches("Summer Final.mov", "summer -ext:mov"), false);
});

test("extension terms target extensions and positive clauses are alternatives", () => {
  assert.equal(matches("Summer Final.MP4", "ext:mp4"), true);
  assert.equal(matches("Summer Final.MP4", "ext:.mp4"), true);
  assert.equal(matches("Summer Final.mov", "ext:mp4"), false);
  assert.equal(matches("mp4 documentary.mov", "ext:mp4"), false);
  assert.equal(matches("Summer Final.mkv", "ext:m*"), true);
  assert.equal(matches("Summer Final.mp4", "ext:mp"), false);
  assert.equal(matches("Summer Final.mkv", "ext:mp4 ext:mkv"), true);
  assert.equal(matches("Summer Final.avi", "ext:mp4 ext:mkv"), false);
  assert.equal(matches("Summer Final.mov", 'ext:"mov"'), true);
  assert.equal(matches("Summer", "ext:mp4", true), false);
});

test("matching is case- and accent-insensitive", () => {
  assert.equal(matches("CAFÉ À PARIS.MP4", '"cafe a paris" ext:mp4'), true);
});

test("exact matches rank above fuzzy matches", () => {
  const query = search.compileQuery("summer");
  const exact = search.match(search.createRecord({ name: "Summer.mp4" }), query);
  const fuzzy = search.match(search.createRecord({ name: "Smmer.mp4" }), query);
  assert.equal(exact.matches, true);
  assert.equal(fuzzy.matches, true);
  assert.ok(exact.score > fuzzy.score);
});

function itemMatches(item, query) {
  return search.match(search.createRecord(item), search.compileQuery(query)).matches;
}

test("playback-state clauses derive new, progress, watched, and unwatched states", () => {
  const fresh = { name: "Fresh.mp4", path: "/media/Fresh.mp4" };
  const started = { name: "Started.mp4", path: "/media/Started.mp4", position: 15 };
  const watched = { name: "Done.mp4", path: "/media/Done.mp4", watched: true };
  const explicitProgress = { name: "Explicit.mp4", path: "/media/Explicit.mp4", playbackState: "in-progress" };

  assert.equal(itemMatches(fresh, "is:new"), true);
  assert.equal(itemMatches(started, "is:progress"), true);
  assert.equal(itemMatches(explicitProgress, "is:progress"), true);
  assert.equal(itemMatches(watched, "is:watched"), true);
  assert.equal(itemMatches(fresh, "is:unwatched"), true);
  assert.equal(itemMatches(started, "is:new is:progress"), true, "positive state clauses are alternatives");
  assert.equal(itemMatches(watched, "-is:watched"), false);
});

test("duration and resolution clauses support comparisons and normalized units", () => {
  const item = {
    name: "Feature.mkv",
    path: "/media/Feature.mkv",
    metadata: { duration: 5400, width: 3840, height: 2160 },
  };
  assert.equal(itemMatches(item, "duration:>=1h duration:<2h"), true);
  assert.equal(itemMatches(item, "duration:<90m"), false);
  assert.equal(itemMatches(item, "resolution:4k"), true);
  assert.equal(itemMatches(item, "resolution:>=1080p"), true);
  assert.equal(itemMatches(item, "resolution:<1920x1080"), false);
  assert.equal(itemMatches({ name: "Started.mp4", progress: { duration: 1200 } }, "duration:20m"), true);
});

test("date-added and folder clauses compose with ordinary fuzzy text", () => {
  const item = {
    name: "Summer Finale.mp4",
    path: "/media/Series One/Season 2/Summer Finale.mp4",
    firstSeenAt: "2026-09-12T18:30:00Z",
  };
  assert.equal(itemMatches(item, 'summer folder:"series one" added:=2026-09-12'), true);
  assert.equal(itemMatches(item, "summer folder:season* added:>=2026-09-01"), true);
  assert.equal(itemMatches(item, "added:<2026-09-12"), false);
});

test("malformed known clauses are reported and ignored without losing valid text", () => {
  const compiled = search.compileQuery("summer duration:soon added:2026-02-31");
  assert.equal(compiled.errors.length, 2);
  assert.deepEqual(compiled.invalidTerms.map((term) => term.raw), ["duration:soon", "added:2026-02-31"]);
  assert.deepEqual(compiled.errors.map((error) => compiled.raw.substring(error.start, error.end)), [
    "duration:soon",
    "added:2026-02-31",
  ]);
  assert.equal(search.match(search.createRecord({ name: "Summer.mp4" }), compiled).matches, true);
  assert.equal(itemMatches({ name: "camera:raw.mp4" }, "camera:raw"), true, "unknown fields stay filename text");
});

test("navigation matching ignores file-only clauses but keeps text and folder narrowing", () => {
  const folder = search.createRecord({ name: "Shows", path: "/media/Shows", isDir: true });
  assert.equal(search.matchNavigation(folder, search.compileQuery("is:progress duration:<20m" )).matches, true);
  assert.equal(search.matchNavigation(folder, search.compileQuery("shows is:progress")).matches, true);
  assert.equal(search.matchNavigation(folder, search.compileQuery("movies is:progress")).matches, false);
});

test("structured suggestions describe replacements at the active token", () => {
  const states = search.getSuggestions("summer is:pr");
  const progress = states.find((entry) => entry.insertion === "is:progress");
  assert.ok(progress);
  assert.equal(progress.replaceStart, 7);
  assert.equal(progress.replaceEnd, 12);
  assert.deepEqual(search.applySuggestion("summer is:pr", progress), {
    value: "summer is:progress",
    cursor: 18,
  });

  const folders = search.getSuggestions("folder:", { folders: ["Series One"] });
  assert.equal(folders[0].insertion, 'folder:"Series One"');

  const added = search.getSuggestions("added:").find((entry) => entry.insertion.startsWith("added:"));
  assert.ok(added);
  assert.deepEqual(search.compileQuery(added.insertion).errors, []);
});

test("source spans support removing structured-clause chips without disturbing text", () => {
  const query = "summer  is:progress duration:<20m";
  const compiled = search.compileQuery(query);
  assert.equal(compiled.source, query);
  assert.equal(search.removeTerm(query, compiled.terms[1]), "summer duration:<20m");
  assert.equal(search.removeTerm(query, compiled.terms[0]), "is:progress duration:<20m");
});
