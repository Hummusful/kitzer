import assert from "node:assert/strict";
import test from "node:test";
import { findHeroFeedCover } from "../hero-cover.mjs";

const hero = (article = {}) => ({
  cluster: { title: "Artist releases a new album" },
  article: { title: "Artist releases a new album", url: "https://example.com/story?utm_source=rss", ...article }
});

test("Hero cover fallback matches the feed by normalized URL before title", () => {
  const cover = findHeroFeedCover(hero(), [
    { link: "https://example.com/story", title: "Other title", cover: "https://images.example.com/url-match.jpg" },
    { link: "https://example.com/other", title: "Artist releases a new album", cover: "https://images.example.com/title-match.jpg" }
  ]);
  assert.equal(cover, "https://images.example.com/url-match.jpg");
});

test("Hero cover fallback uses a normalized title only when URL does not match", () => {
  const cover = findHeroFeedCover(hero({ url: "https://example.com/missing" }), [
    { link: "https://example.com/other", title: "ARTIST: releases a new album", cover: "https://images.example.com/title-match.jpg" }
  ]);
  assert.equal(cover, "https://images.example.com/title-match.jpg");
});

test("Hero cover fallback rejects missing and unsafe feed covers", () => {
  assert.equal(findHeroFeedCover(hero(), [{ link: "https://example.com/story", cover: "javascript:alert(1)" }]), null);
});
