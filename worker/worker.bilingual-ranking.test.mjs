import assert from "node:assert/strict";
import test from "node:test";
import { bilingualStoryBoost, selectBalancedMusicItems, sortMusicItems } from "./worker.js";

const sameStoryInTwoLanguages = [
  { title: "Ed Sheeran announces a new tour", lang: "EN", date: "2026-09-20T11:00:00Z", music_score: 7 },
  { title: "אד שירן הכריז על סיבוב הופעות חדש", lang: "HE", date: "2026-09-20T10:30:00Z", music_score: 7 }
];

test("coverage in Hebrew and English boosts a shared artist story", () => {
  assert.equal(bilingualStoryBoost(sameStoryInTwoLanguages[0], sameStoryInTwoLanguages), 1);
  assert.equal(bilingualStoryBoost(sameStoryInTwoLanguages[1], sameStoryInTwoLanguages), 1);
});

test("a newer one-language item outranks an older bilingual story", () => {
  const newerSingleLanguage = { title: "New electronic festival lineup", lang: "EN", date: "2026-09-20T11:15:00Z", music_score: 8 };
  const sorted = sortMusicItems([...sameStoryInTwoLanguages, newerSingleLanguage]);
  assert.equal(sorted[0], newerSingleLanguage);
});

test("today's news outranks a bilingual story from two days ago", () => {
  const today = { title: "New electronic festival lineup", lang: "EN", date: "2026-09-22T19:00:00Z", music_score: 7 };
  const sorted = sortMusicItems([...sameStoryInTwoLanguages, today]);
  assert.equal(sorted[0], today);
});

test("all-news reserves room for Hebrew and electronic news while staying newest-first", () => {
  const international = Array.from({ length: 40 }, (_, index) => ({ genre: "international", date: new Date(Date.UTC(2026, 8, 22, 20, 40 - index)).toISOString() }));
  const hebrew = Array.from({ length: 13 }, (_, index) => ({ genre: "hebrew", date: new Date(Date.UTC(2026, 8, 22, 14, 40 - index)).toISOString() }));
  const electronic = Array.from({ length: 11 }, (_, index) => ({ genre: "electronic", date: new Date(Date.UTC(2026, 8, 22, 9, 40 - index)).toISOString() }));
  const selected = selectBalancedMusicItems(sortMusicItems([...international, ...hebrew, ...electronic]), 40);
  assert.equal(selected.length, 40);
  assert.equal(selected.filter(item => item.genre === "hebrew").length, 10);
  assert.equal(selected.filter(item => item.genre === "electronic").length, 6);
  assert.deepEqual(selected, sortMusicItems(selected));
});

test("all-news fills missing reserved slots with other current stories", () => {
  const items = [
    { genre: "international", date: "2026-09-22T20:00:00Z" },
    { genre: "international", date: "2026-09-22T19:00:00Z" },
    { genre: "hebrew", date: "2026-09-22T18:00:00Z" }
  ];
  assert.deepEqual(selectBalancedMusicItems(sortMusicItems(items), 3), sortMusicItems(items));
});

test("an unrelated Hebrew story does not create a bilingual boost", () => {
  const unrelated = { title: "להקה ישראלית הוציאה אלבום חדש", lang: "HE", date: "2026-09-20T11:00:00Z", music_score: 8 };
  assert.equal(bilingualStoryBoost(sameStoryInTwoLanguages[0], [sameStoryInTwoLanguages[0], unrelated]), 0);
});
