import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMediaForestChart } from "./worker.js";

test("weekly chart rows are numbered consecutively from source order", () => {
  const entries = normalizeMediaForestChart({
    entries: [
      { title: "First", artist: "Artist A", thisweek: 12, lastweek: 2, peak: 2 },
      { title: "Second", artist: "Artist B", thisweek: 17, lastweek: 1, peak: 1 }
    ]
  }, "songs");

  assert.deepEqual(entries.map(({ position }) => position), [1, 2]);
  assert.deepEqual(entries.map(({ peak }) => peak), [1, 1]);
});

test("an artist's peak cannot be below their current chart rank", () => {
  const entries = normalizeMediaForestChart({
    entries: [{ artist: "Bob Dylan", thisweek: 129, peak: 129 }]
  }, "artists");

  assert.equal(entries[0].position, 1);
  assert.equal(entries[0].peak, 1);
});
