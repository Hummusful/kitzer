import assert from "node:assert/strict";
import test from "node:test";
import { areRelatedStories, isRecentPublication, mergeRelatedStories } from "./worker.js";

const now = Date.parse("2026-09-23T15:00:00Z");
const cutoff = now - 3 * 24 * 60 * 60 * 1000;

test("future-dated stories do not appear before they are published", () => {
  assert.equal(isRecentPublication("2026-09-23T15:41:00Z", cutoff, now), false);
  assert.equal(isRecentPublication("2026-09-23T15:04:00Z", cutoff, now), true);
  assert.equal(isRecentPublication("2026-09-23T14:59:00Z", cutoff, now), true);
});

test("different reports of the OutKast lawsuit merge into one story", () => {
  const stories = [
    { title: "OutKast File Lawsuit Against Ovrkast, Claiming Malicious Intent With His Chosen Name", date: "2026-09-23T06:00:00Z", source: "A", link: "https://example.com/a" },
    { title: "Outkast Sue Rapper Ovrkast for Allegedly Hijacking Its Famous Name", date: "2026-09-23T05:00:00Z", source: "B", link: "https://example.com/b" },
    { title: "Outkast Sue Ovrkast for Having Similar Rap Name", date: "2026-09-23T04:00:00Z", source: "C", link: "https://example.com/c" },
    { title: "Outkast Sue Ovrkast for Having Nearly Identical Name", date: "2026-09-23T03:00:00Z", source: "D", link: "https://example.com/d" }
  ];
  const merged = mergeRelatedStories(stories);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source_count, 4);
});

test("different releases by the same artist stay separate", () => {
  assert.equal(areRelatedStories(
    { title: "Ed Sheeran announces new album", date: "2026-09-23T10:00:00Z" },
    { title: "Ed Sheeran announces new tour", date: "2026-09-23T10:00:00Z" }
  ), false);
});
