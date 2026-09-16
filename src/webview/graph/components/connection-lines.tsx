import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { currentChanges, currentGraph, changeIdHorizontalOffset, connectedHighlight } from "../signals";
import type { FullChangeId } from "../../../graph-protocol";
import { getLaneColor } from "../svg-utils";
import { buildEdgeSegments, buildVisiblePathDs, type PathSegment } from "../connection-segments";
import styles from "./connection-lines.module.css";

interface PathData {
  key: string;
  segments: PathSegment[];
  fromId: FullChangeId;
  toId: FullChangeId;
  color: string;
}

export function ConnectionLines() {
  const paths = useSignal<PathData[]>([]);

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

  // Put a highlighted path on top in the z order so it's unobscured.
  const renderPaths = highlight
    ? [...paths.value.filter((p) => !isHighlighted(p)), ...paths.value.filter(isHighlighted)]
    : paths.value;

  // Skip straight vertical segments that a segment painted above them in the
  // same lane fully covers.
  const visibleDs = buildVisiblePathDs(renderPaths.map((p) => p.segments));

  const dimmedPaths: JSX.Element[] = [];
  const activePaths: JSX.Element[] = [];
  renderPaths.forEach((p, i) => {
    const d = visibleDs[i];
    if (d === null) {
      return;
    }
    const element = <path key={p.key} d={d} class={styles.connectionLine} style={{ stroke: p.color }} />;
    if (highlight !== null && !isHighlighted(p)) {
      dimmedPaths.push(element);
    } else {
      activePaths.push(element);
    }
  });

  // Dimmed lines share a group so the opacity applies once to the whole set
  // instead of compounding where the lines overlap or cross.
  return (
    <g id="connection-lines">
      {dimmedPaths.length > 0 && <g class={styles.dimmedGroup}>{dimmedPaths}</g>}
      {activePaths}
    </g>
  );
}
