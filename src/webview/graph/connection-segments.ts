import type { ChangeIdGraph } from "../../graph-protocol";
import { getLaneX } from "./svg-utils";
import { EDGE_EXTENSION } from "./types";

export interface VerticalSpan {
  lane: number;
  topY: number;
  bottomY: number;
}

export interface PathSegment {
  d: string;
  vertical: VerticalSpan | null;
}

export function buildEdgeSegments(
  edge: ChangeIdGraph["edges"][number],
  rowYList: number[],
  bottomY: number,
  arcRadius: number,
): PathSegment[] | null {
  const segments: PathSegment[] = [];

  const lastSegmentIndex = edge.lanePath.length - 2;
  for (let i = 0; i <= lastSegmentIndex; i++) {
    const segFromLane = edge.lanePath[i];
    const segToLane = edge.lanePath[i + 1];
    const segFromRow = edge.fromRow + i;
    const segToRow = edge.fromRow + i + 1;
    const segFromY = rowYList[segFromRow];

    let segToY: number;
    if (edge.extendsToBottom && i === lastSegmentIndex) {
      segToY = bottomY;
    } else {
      segToY = rowYList[segToRow];
    }

    if (segFromY === undefined || segToY === undefined) {
      continue;
    }

    const fromX = getLaneX(segFromLane);
    const toX = getLaneX(segToLane);

    if (segFromLane === segToLane) {
      segments.push({
        d: `M ${fromX} ${segFromY} V ${segToY}`,
        vertical: {
          lane: segFromLane,
          topY: Math.min(segFromY, segToY),
          bottomY: Math.max(segFromY, segToY),
        },
      });
    } else if (Math.abs(segFromLane - segToLane) === 1) {
      const c = 18;
      segments.push({
        d: `M ${fromX} ${segFromY} C ${fromX} ${segFromY + c} ${toX} ${segToY - c} ${toX} ${segToY}`,
        vertical: null,
      });
    } else {
      const prevToY = segToRow > 0 ? rowYList[segToRow - 1] : segToY - EDGE_EXTENSION;
      const horizontalY = (segToY + prevToY) / 2;
      const r = arcRadius;
      const goingRight = toX > fromX;

      const d: string[] = [`M ${fromX} ${segFromY} V ${horizontalY - r}`];
      if (goingRight) {
        d.push(`A ${r} ${r} 0 0 0 ${fromX + r} ${horizontalY}`);
        d.push(`H ${toX - r}`);
        d.push(`A ${r} ${r} 0 0 1 ${toX} ${horizontalY + r}`);
      } else {
        d.push(`A ${r} ${r} 0 0 1 ${fromX - r} ${horizontalY}`);
        d.push(`H ${toX + r}`);
        d.push(`A ${r} ${r} 0 0 0 ${toX} ${horizontalY + r}`);
      }
      d.push(`V ${segToY}`);
      segments.push({ d: d.join(" "), vertical: null });
    }
  }

  return segments.length > 0 ? segments : null;
}

export function buildVisiblePathDs(paths: PathSegment[][]): (string | null)[] {
  const obscured = paths.map((segments) => segments.map(() => false));

  const laneSegments = new Map<number, { pathIndex: number; segmentIndex: number; span: VerticalSpan }[]>();
  paths.forEach((segments, pathIndex) => {
    segments.forEach((segment, segmentIndex) => {
      if (!segment.vertical) {
        return;
      }
      const list = laneSegments.get(segment.vertical.lane) ?? [];
      list.push({ pathIndex, segmentIndex, span: segment.vertical });
      laneSegments.set(segment.vertical.lane, list);
    });
  });

  for (const segments of laneSegments.values()) {
    for (const under of segments) {
      const isCovered = segments.some(
        (over) =>
          over.pathIndex > under.pathIndex &&
          over.span.topY <= under.span.topY &&
          under.span.bottomY <= over.span.bottomY,
      );
      if (isCovered) {
        obscured[under.pathIndex][under.segmentIndex] = true;
      }
    }
  }

  return paths.map((segments, pathIndex) => {
    const d = segments
      .filter((_, segmentIndex) => !obscured[pathIndex][segmentIndex])
      .map((segment) => segment.d)
      .join(" ");
    return d.length > 0 ? d : null;
  });
}
