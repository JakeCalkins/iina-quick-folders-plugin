const test = require("node:test");
const assert = require("node:assert/strict");
const search = require("../quick-folders.iinaplugin/ui/search.js");

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
