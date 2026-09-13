const test = require("node:test");
const assert = require("node:assert/strict");

const series = require("../series-state.js");

test("recognizes explicit SxxExx and NxNN episode forms", () => {
  assert.deepEqual(
    series.parseEpisode({ path: "/media/Shows/Example.Show.S02E03.Part.2.mkv", rootPath: "/media" }),
    {
      seriesKey: "/media\u0000/media/Shows\u0000example-show",
      seriesTitle: "Example Show",
      seriesPath: "/media/Shows",
      seasonNumber: 2,
      episodeNumber: 3,
      episodePart: 2,
    },
  );
  const alternate = series.parseEpisode("/media/Shows/Another Show/Another.Show.2x03.Title.mp4");
  assert.equal(alternate.seriesTitle, "Another Show");
  assert.equal(alternate.seasonNumber, 2);
  assert.equal(alternate.episodeNumber, 3);
});

test("recognizes episodes inside explicit season folders", () => {
  const numbered = series.parseEpisode({
    path: "/media/Example Show/Season 2/03 - The Return.mkv",
    rootPath: "/media",
  });
  assert.equal(numbered.seriesTitle, "Example Show");
  assert.equal(numbered.seriesPath, "/media/Example Show");
  assert.equal(numbered.seasonNumber, 2);
  assert.equal(numbered.episodeNumber, 3);

  const labeled = series.parseEpisode("/media/Example Show/S00/Episode 01 - Special.mp4");
  assert.equal(labeled.seasonNumber, 0);
  assert.equal(labeled.episodeNumber, 1);
});

test("declines ambiguous standalone numbers and ordinary movie names", () => {
  assert.equal(series.parseEpisode("/media/Movies/Movie 2024.mp4"), null);
  assert.equal(series.parseEpisode("/media/Shows/Example/1080p encode.mkv"), null);
  assert.equal(series.parseEpisode("/media/Shows/Example/03 - Maybe.mkv"), null);
  assert.equal(series.parseEpisode("/media/Shows/../Private/Show.S01E01.mkv"), null);
});

test("orders episodes naturally across seasons, multipart files, and multi-episode files", () => {
  const episodes = [
    { path: "/media/s2e1.mp4", seasonNumber: 2, episodeNumber: 1 },
    { path: "/media/s1e2p2.mp4", seasonNumber: 1, episodeNumber: 2, episodePart: 2 },
    { path: "/media/s1e2p1.mp4", seasonNumber: 1, episodeNumber: 2, episodePart: 1 },
    { path: "/media/s1e1.mp4", seasonNumber: 1, episodeNumber: 1 },
  ];
  assert.deepEqual(episodes.sort(series.compareEpisodes).map((episode) => episode.path), [
    "/media/s1e1.mp4",
    "/media/s1e2p1.mp4",
    "/media/s1e2p2.mp4",
    "/media/s2e1.mp4",
  ]);

  const multi = series.parseEpisode("/media/Show/Show.S01E02E03.mkv");
  assert.equal(multi.endEpisodeNumber, 3);
});

test("next recommendation never skips an in-progress episode or an unwatched gap", () => {
  const episodes = [
    { path: "/media/s01e01.mp4", seasonNumber: 1, episodeNumber: 1, state: "watched" },
    { path: "/media/s01e02.mp4", seasonNumber: 1, episodeNumber: 2, state: "new" },
    { path: "/media/s01e03.mp4", seasonNumber: 1, episodeNumber: 3, state: "watched" },
    { path: "/media/s02e01.mp4", seasonNumber: 2, episodeNumber: 1, state: "new" },
  ];
  assert.equal(series.recommendNextEpisode(episodes).path, "/media/s01e02.mp4");

  episodes[3].state = "in-progress";
  assert.equal(series.recommendNextEpisode(episodes).path, "/media/s02e01.mp4");
  episodes[3].state = "watched";
  episodes[1].state = "watched";
  assert.equal(series.recommendNextEpisode(episodes), null);
});

test("series keys keep identical show names in separate source folders distinct", () => {
  const grouped = series.groupEpisodes([
    { path: "/media/one/Show.S01E01.mp4", rootPath: "/media" },
    { path: "/media/two/Show.S01E01.mp4", rootPath: "/media" },
  ]);
  assert.equal(grouped.size, 2);
});
