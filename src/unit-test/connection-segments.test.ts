/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEdgeSegments, buildVisiblePathDs, type PathSegment } from "../webview/graph/connection-segments";
import type { ChangeIdGraph } from "../graph-protocol";
import { fullChangeIdFromString } from "../utils";

function makeEdge(overrides: Partial<ChangeIdGraph["edges"][number]> = {}): ChangeIdGraph["edges"][number] {
  return {
    fromRow: 0,
    toRow: 1,
    lanePath: [0, 0],
    fromId: fullChangeIdFromString("a".repeat(32)),
    toId: fullChangeIdFromString("b".repeat(32)),
    colorIndex: 0,
    ...overrides,
  };
}

function vertical(lane: number, topY: number, bottomY: number, d: string): PathSegment {
  return { d, vertical: { lane, topY, bottomY } };
}

function bend(d: string): PathSegment {
  return { d, vertical: null };
}

describe("buildEdgeSegments", () => {
  it("records a vertical span for straight vertical segments", () => {
    const segments = buildEdgeSegments(makeEdge({ lanePath: [1, 1], fromRow: 2, toRow: 3 }), [0, 10, 20, 30], 100, 12);

    assert.ok(segments);
    assert.strictEqual(segments.length, 1);
    assert.deepStrictEqual(segments[0].vertical, { lane: 1, topY: 20, bottomY: 30 });
    assert.strictEqual(segments[0].d, "M 34 20 V 30");
  });

  it("does not record a vertical span for lane-changing segments", () => {
    const adjacent = buildEdgeSegments(makeEdge({ lanePath: [0, 1], fromRow: 0, toRow: 1 }), [0, 10], 100, 12);
    assert.ok(adjacent);
    assert.strictEqual(adjacent[0].vertical, null);

    const distant = buildEdgeSegments(makeEdge({ lanePath: [0, 3], fromRow: 0, toRow: 1 }), [0, 10], 100, 12);
    assert.ok(distant);
    assert.strictEqual(distant[0].vertical, null);
  });

  it("extends the last segment to the bottom for edges leaving the visible set", () => {
    const segments = buildEdgeSegments(
      makeEdge({ lanePath: [0, 0], fromRow: 0, toRow: 1, extendsToBottom: true }),
      [0, 10],
      100,
      12,
    );

    assert.ok(segments);
    assert.deepStrictEqual(segments[0].vertical, { lane: 0, topY: 0, bottomY: 100 });
  });

  it("returns null when no segment has valid rows", () => {
    const segments = buildEdgeSegments(makeEdge({ lanePath: [0, 0], fromRow: 5, toRow: 6 }), [0, 10], 100, 12);
    assert.strictEqual(segments, null);
  });
});

describe("buildVisiblePathDs", () => {
  it("drops a vertical segment fully covered by a segment painted above it", () => {
    const paths: PathSegment[][] = [[vertical(1, 20, 40, "M 34 20 V 40")], [vertical(1, 10, 50, "M 34 10 V 50")]];

    assert.deepStrictEqual(buildVisiblePathDs(paths), [null, "M 34 10 V 50"]);
  });

  it("drops a covered segment but keeps the other segments of the same path", () => {
    const paths: PathSegment[][] = [
      [vertical(0, 0, 10, "M 20 0 V 10"), vertical(1, 20, 40, "M 34 20 V 40")],
      [vertical(1, 10, 50, "M 34 10 V 50")],
    ];

    assert.deepStrictEqual(buildVisiblePathDs(paths), ["M 20 0 V 10", "M 34 10 V 50"]);
  });

  it("keeps segments covered only partially", () => {
    const paths: PathSegment[][] = [[vertical(1, 20, 60, "M 34 20 V 60")], [vertical(1, 10, 50, "M 34 10 V 50")]];

    assert.deepStrictEqual(buildVisiblePathDs(paths), ["M 34 20 V 60", "M 34 10 V 50"]);
  });

  it("keeps segments covered by a segment painted below them", () => {
    const paths: PathSegment[][] = [[vertical(1, 10, 50, "M 34 10 V 50")], [vertical(1, 20, 40, "M 34 20 V 40")]];

    assert.deepStrictEqual(buildVisiblePathDs(paths), ["M 34 10 V 50", "M 34 20 V 40"]);
  });

  it("drops covered segments based on the z order, not the graph order", () => {
    const paths: PathSegment[][] = [[vertical(1, 10, 50, "M 34 10 V 50")], [vertical(1, 10, 50, "M 34 10 V 50")]];

    // Without a highlight the later path paints on top.
    assert.deepStrictEqual(buildVisiblePathDs(paths), [null, "M 34 10 V 50"]);

    // When a highlight moves the first path on top, it is the one that stays.
    assert.deepStrictEqual(buildVisiblePathDs([...paths].reverse()), [null, "M 34 10 V 50"]);
  });

  it("ignores coverage between different lanes", () => {
    const paths: PathSegment[][] = [[vertical(0, 20, 40, "M 20 20 V 40")], [vertical(1, 10, 50, "M 34 10 V 50")]];

    assert.deepStrictEqual(buildVisiblePathDs(paths), ["M 20 20 V 40", "M 34 10 V 50"]);
  });

  it("never drops lane-changing segments", () => {
    const paths: PathSegment[][] = [[bend("M 20 20 C 20 38 34 2 34 10")], [vertical(0, 0, 100, "M 20 0 V 100")]];

    assert.deepStrictEqual(buildVisiblePathDs(paths), ["M 20 20 C 20 38 34 2 34 10", "M 20 0 V 100"]);
  });

  it("drops equal-span segments below the topmost one", () => {
    const paths: PathSegment[][] = [
      [vertical(1, 10, 50, "M 34 10 V 50")],
      [vertical(1, 10, 50, "M 34 10 V 50")],
      [vertical(1, 10, 50, "M 34 10 V 50")],
    ];

    assert.deepStrictEqual(buildVisiblePathDs(paths), [null, null, "M 34 10 V 50"]);
  });

  it("handles a chain of covered segments", () => {
    const paths: PathSegment[][] = [
      [vertical(1, 0, 10, "M 34 0 V 10")],
      [vertical(1, 0, 20, "M 34 0 V 20")],
      [vertical(1, 0, 30, "M 34 0 V 30")],
    ];

    assert.deepStrictEqual(buildVisiblePathDs(paths), [null, null, "M 34 0 V 30"]);
  });

  it("drops a covered segment covered by a union of separate segments only when one fully covers it", () => {
    const paths: PathSegment[][] = [
      [vertical(1, 0, 30, "M 34 0 V 30")],
      [vertical(1, 0, 10, "M 34 0 V 10")],
      [vertical(1, 20, 30, "M 34 20 V 30")],
    ];

    assert.deepStrictEqual(buildVisiblePathDs(paths), ["M 34 0 V 30", "M 34 0 V 10", "M 34 20 V 30"]);
  });

  it("returns an empty array for no paths", () => {
    assert.deepStrictEqual(buildVisiblePathDs([]), []);
  });
});
