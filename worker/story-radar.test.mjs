import assert from "node:assert/strict";
import test from "node:test";
import { calculateStoryScore, clusterMetrics, isStrongStoryMatch } from "./story-radar.mjs";

const NOW = new Date("2026-09-19T12:00:00.000Z");

test("two articles about the same story match", () => {
  assert.equal(isStrongStoryMatch(
    { title: "Kendrick Lamar drops GNX deluxe edition", publishedAt: NOW.toISOString() },
    { title: "Kendrick Lamar announces GNX deluxe album", main_entity: "kendrick lamar", last_updated: "2026-09-19T10:00:00.000Z" }
  ), true);
});

test("different stories about one artist do not match", () => {
  assert.equal(isStrongStoryMatch(
    { title: "Kendrick Lamar announces world tour dates", publishedAt: NOW.toISOString() },
    { title: "Kendrick Lamar releases new studio album", main_entity: "kendrick lamar", last_updated: "2026-09-19T10:00:00.000Z" }
  ), false);
});

test("a duplicate source is counted once", () => {
  const metrics = clusterMetrics([
    { source: "Source A", title: "Artist festival headline announced", created_at: "2026-09-19T11:00:00.000Z" },
    { source: "Source A", title: "Artist festival headline update", created_at: "2026-09-19T10:00:00.000Z" },
    { source: "Source B", title: "Artist festival headline update", created_at: "2026-09-19T09:00:00.000Z" }
  ], NOW);
  assert.equal(metrics.uniqueSources, 2);
});

test("story-score thresholds map to the documented statuses", () => {
  assert.equal(calculateStoryScore({ uniqueSources: 4, articlesLast6Hours: 0, followUps: 0, freshnessScore: 0, israelHipHopBonus: 0 }).status, "normal");
  assert.equal(calculateStoryScore({ uniqueSources: 5, articlesLast6Hours: 0, followUps: 0, freshnessScore: 0, israelHipHopBonus: 0 }).status, "watching");
  assert.equal(calculateStoryScore({ uniqueSources: 9, articlesLast6Hours: 0, followUps: 0, freshnessScore: 0, israelHipHopBonus: 0 }).status, "trending");
  assert.equal(calculateStoryScore({ uniqueSources: 13, articlesLast6Hours: 0, followUps: 0, freshnessScore: 0, israelHipHopBonus: 0 }).status, "hero_candidate");
});
