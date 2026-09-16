import { useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import {
  currentChanges,
  currentGraph,
  changeIdHorizontalOffset,
  connectedHighlight,
  type HighlightState,
} from "../signals";
import type { FullChangeId } from "../../../graph-protocol";
import { getLaneColor } from "../svg-utils";
import { buildEdgeSegments, buildVisiblePathDs, type PathSegment } from "../connection-segments";
import { cx } from "../utils";
import styles from "./connection-lines.module.css";

interface PathData {
  key: string;
  segments: PathSegment[];
  fromId: FullChangeId;
  toId: FullChangeId;
  color: string;
}

interface OverlayEntry {
  /** Whether the path belongs to the current highlight and stays fully opaque. */
  active: boolean;
  /** Mount fading in so newly highlighted lines brighten like the node circles. */
  animateIn: boolean;
}

export function ConnectionLines() {
  const paths = useSignal<PathData[]>([]);
  const overlayEntries = useRef(new Map<string, OverlayEntry>());
  const prevHighlight = useRef<HighlightState | null>(null);

  useSignalEffect(() => {
    void currentChanges.value;
    void changeIdHorizontalOffset.value;

    const graph = currentGraph.value;
    if (!graph?.edges) {
      paths.value = [];
      return;
    }

    const nodes = document.querySelectorAll(`#nodes > [data-change-id]`);
    const svg = document.getElementById("connections");
    if (!svg) {
      paths.value = [];
      return;
    }

    const svgRect = svg.getBoundingClientRect();
    const rowYList: number[] = [];
    nodes.forEach((node, i) => {
      const isElided = currentChanges.value[i]?.branchType === "~";
      const changeIdEl = node.querySelector(`[data-role="change-id"]`);
      const refEl = (isElided ? node : (changeIdEl ?? node)) as HTMLElement;
      const refRect = refEl.getBoundingClientRect();
      rowYList.push(refRect.top - svgRect.top + refRect.height / 2);
    });
    const bottomY = Math.max(...rowYList, 0) + 50;

    const sortedEdges = [...graph.edges].sort((a, b) => {
      if (a.lanePath[0] !== b.lanePath[0]) {
        return b.lanePath[0] - a.lanePath[0];
      }
      return b.lanePath[b.lanePath.length - 1] - a.lanePath[a.lanePath.length - 1];
    });

    const result: PathData[] = [];
    const pairOccurrences = new Map<string, number>();
    for (const edge of sortedEdges) {
      const segments = buildEdgeSegments(edge, rowYList, bottomY, 12);
      if (segments) {
        const base = `${edge.fromId}->${edge.toId}`;
        const occurrence = pairOccurrences.get(base) ?? 0;
        pairOccurrences.set(base, occurrence + 1);
        result.push({
          key: occurrence === 0 ? base : `${base}#${occurrence}`,
          segments,
          fromId: edge.fromId,
          toId: edge.toId,
          color: getLaneColor(edge.colorIndex),
        });
      }
    }
    paths.value = result;
  });

  const highlight = connectedHighlight.value;
  const isHighlighted = (p: PathData) =>
    highlight !== null &&
    ((p.fromId === highlight.focalId && highlight.connectedIds.has(p.toId)) ||
      (p.toId === highlight.focalId && highlight.connectedIds.has(p.fromId)));

  const allPaths = paths.value;
  const pathByKey = new Map(allPaths.map((p) => [p.key, p]));

  // Highlighted lines are kept fully opaque in an overlay above the dimmed
  // group. Entries persist across renders so their opacity transitions run:
  // lines entering or leaving a highlight crossfade over their dimmed twins,
  // matching how the node circles dim and brighten. When the highlight is
  // cleared the entries are left as they are, so highlighted lines stay bright
  // while the group fades back in.
  if (highlight !== null) {
    for (const entry of overlayEntries.current.values()) {
      entry.active = false;
    }
    for (const p of allPaths) {
      if (!isHighlighted(p)) {
        continue;
      }
      const existing = overlayEntries.current.get(p.key);
      if (existing) {
        existing.active = true;
      } else {
        overlayEntries.current.set(p.key, {
          active: true,
          // When a highlight starts from none, the twin underneath starts at
          // full opacity, so the copy can appear instantly; when swapping
          // between highlights the twin is dimmed, so the copy fades in.
          animateIn: prevHighlight.current !== null,
        });
      }
    }
  }
  for (const key of overlayEntries.current.keys()) {
    if (!pathByKey.has(key)) {
      overlayEntries.current.delete(key);
    }
  }
  prevHighlight.current = highlight;

  // Skip straight vertical segments that a segment painted above them in the
  // same lane fully covers.
  const visibleDs = buildVisiblePathDs(allPaths.map((p) => p.segments));

  return (
    <g id="connection-lines">
      <g class={cx(styles.linesGroup, highlight !== null && styles.dimmedGroup)}>
        {allPaths.map((p, i) => {
          const d = visibleDs[i];
          if (d === null) {
            return null;
          }
          return <path key={p.key} d={d} class={styles.connectionLine} style={{ stroke: p.color }} />;
        })}
      </g>
      <g>
        {[...overlayEntries.current].map(([key, entry]) => {
          const p = pathByKey.get(key);
          if (!p) {
            return null;
          }
          return (
            <path
              key={p.key}
              d={p.segments.map((segment) => segment.d).join(" ")}
              class={cx(
                styles.overlayLine,
                entry.active && styles.overlayLineActive,
                entry.animateIn && styles.overlayLineAnimateIn,
              )}
              style={{ stroke: p.color }}
            />
          );
        })}
      </g>
    </g>
  );
}
