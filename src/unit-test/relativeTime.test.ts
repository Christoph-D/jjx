/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { relativeTime } from "../relativeTime";

const NOW = new Date("2025-06-15T12:00:00Z").getTime();
let originalDateNow: typeof Date.now;

beforeEach(() => {
  originalDateNow = Date.now;
  Date.now = () => NOW;
});

afterEach(() => {
  Date.now = originalDateNow;
});

describe("relativeTime", () => {
  it("formats seconds ago", () => {
    const d = new Date(NOW - 30_000);
    assert.match(relativeTime(d), /30 seconds? ago/);
  });

  it("formats 1 second ago", () => {
    const d = new Date(NOW - 1000);
    assert.match(relativeTime(d), /1 second ago/);
  });

  it("formats minutes ago", () => {
    const d = new Date(NOW - 5 * 60_000);
    assert.match(relativeTime(d), /5 minutes? ago/);
  });

  it("formats 1 minute ago", () => {
    const d = new Date(NOW - 60_000);
    assert.match(relativeTime(d), /1 minute ago/);
  });

  it("formats hours ago", () => {
    const d = new Date(NOW - 3 * 3600_000);
    assert.match(relativeTime(d), /3 hours? ago/);
  });

  it("formats 1 hour ago", () => {
    const d = new Date(NOW - 3600_000);
    assert.match(relativeTime(d), /1 hour ago/);
  });

  it("formats days ago", () => {
    const d = new Date(NOW - 7 * 86400_000);
    assert.match(relativeTime(d), /7 days? ago/);
  });

  it("formats 1 day ago", () => {
    const d = new Date(NOW - 86400_000);
    assert.match(relativeTime(d), /yesterday|1 day ago/);
  });

  it("formats months ago", () => {
    const d = new Date(NOW - 90 * 86400_000);
    assert.match(relativeTime(d), /3 months? ago/);
  });

  it("formats years ago", () => {
    const d = new Date(NOW - 400 * 86400_000);
    assert.match(relativeTime(d), /1 year ago|last year/);
  });

  it("formats multiple years ago", () => {
    const d = new Date(NOW - 800 * 86400_000);
    assert.match(relativeTime(d), /2 years? ago/);
  });

  it("accepts a date string", () => {
    const result = relativeTime("2025-06-15T11:55:00Z");
    assert.match(result, /\d+ minutes? ago/);
  });

  it("parses date string as UTC", () => {
    const result = relativeTime("2025-06-15T12:00:00Z");
    assert.match(result, /now|0 seconds? ago/);
  });

  it("handles future dates", () => {
    const d = new Date(NOW + 5 * 60_000);
    assert.match(relativeTime(d), /in 5 minutes?/);
  });

  it("handles very recent past (0 seconds)", () => {
    const d = new Date(NOW);
    assert.match(relativeTime(d), /now|0 seconds? ago/);
  });
});
