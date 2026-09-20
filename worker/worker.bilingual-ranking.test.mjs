import assert from "node:assert/strict";
import test from "node:test";
import { bilingualStoryBoost, sortMusicItems } from "./worker.js";

const sameStoryInTwoLanguages = [
  { title: "Ed Sheeran announces a new tour", lang: "EN", date: "2026-09-20T11:00:00Z", music_score: 7 },
  { title: "אד שירן הכריז על סיבוב הופעות חדש", lang: "HE", date: "2026-09-20T10:30:00Z", music_score: 7 }
];

test("coverage in Hebrew and English boosts a shared artist story", () => {
  assert.equal(bilingualStoryBoost(sameStoryInTwoLanguages[0], sameStoryInTwoLanguages), 1);
  assert.equal(bilingualStoryBoost(sameStoryInTwoLanguages[1], sameStoryInTwoLanguages), 1);
});

test("a bilingual story outranks a newer one-language item", () => {
  const newerSingleLanguage = { title: "New electronic festival lineup", lang: "EN", date: "2026-09-20T11:15:00Z", music_score: 8 };
  const sorted = sortMusicItems([...sameStoryInTwoLanguages, newerSingleLanguage]);
  assert.match(sorted[0].title, /Ed Sheeran|אד שירן/);
});

test("an unrelated Hebrew story does not create a bilingual boost", () => {
  const unrelated = { title: "להקה ישראלית הוציאה אלבום חדש", lang: "HE", date: "2026-09-20T11:00:00Z", music_score: 8 };
  assert.equal(bilingualStoryBoost(sameStoryInTwoLanguages[0], [sameStoryInTwoLanguages[0], unrelated]), 0);
});
