import assert from "node:assert/strict";
import test from "node:test";
import { chooseStoryHero, isEligibleStoryHero } from "./worker.js";

const now = new Date("2026-09-20T12:00:00.000Z");
const candidate = (id, score, { sources = 3, updatedAt = "2026-09-20T11:00:00.000Z", status = "hero_candidate" } = {}) => ({ id, story_score: score, source_count: sources, last_updated: updatedAt, status });

test("Hero eligibility requires hero_candidate, three sources, and a fresh update", () => {
  assert.equal(isEligibleStoryHero(candidate("a", 100), now), true);
  assert.equal(isEligibleStoryHero(candidate("a", 100, { sources: 2 }), now), false);
  assert.equal(isEligibleStoryHero(candidate("a", 100, { status: "trending" }), now), false);
  assert.equal(isEligibleStoryHero(candidate("a", 100, { updatedAt: "2026-09-17T11:59:59.000Z" }), now), false);
});

test("Hero is held for two hours, then replaced only with a 15 point lead", () => {
  const current = candidate("current", 100);
  const close = candidate("close", 114);
  const leading = candidate("leading", 115);
  assert.equal(chooseStoryHero([current, leading], { cluster_id: "current", selected_at: "2026-09-20T10:30:00.000Z" }, now).id, "current");
  assert.equal(chooseStoryHero([current, close], { cluster_id: "current", selected_at: "2026-09-20T09:00:00.000Z" }, now).id, "current");
  assert.equal(chooseStoryHero([current, leading], { cluster_id: "current", selected_at: "2026-09-20T09:00:00.000Z" }, now).id, "leading");
});

test("an invalid current Hero is replaced immediately and no eligible Hero returns null", () => {
  const fresh = candidate("fresh", 120);
  assert.equal(chooseStoryHero([fresh], { cluster_id: "stale", selected_at: "2026-09-20T11:30:00.000Z" }, now).id, "fresh");
  assert.equal(chooseStoryHero([candidate("bad", 120, { sources: 2 })], null, now), null);
});
