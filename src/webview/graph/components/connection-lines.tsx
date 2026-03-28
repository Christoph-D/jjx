import { useSignal, useSignalEffect } from "@preact/signals";
import { currentChanges, currentGraph, changeIdHorizontalOffset } from "../signals";
import { EDGE_EXTENSION } from "../types";
import type { ChangeIdGraph } from "../../../graph-protocol";
import { getLaneColor, getLaneX } from "../svg-utils";

interface PathData {
  d: string;
  fromId: string;
  toId: string;
  color: string;
}

function buildPathD(
  edge: ChangeIdGraph["edges"][number],
  rowYList: number[],
  bottomY: number,
  arcRadius: number,
): string | null {
  const d: string[] = [];

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
      d.push(`M ${fromX} ${segFromY} V ${segToY}`);
    } else if (Math.abs(segFromLane - segToLane) === 1) {
      const c = 18;
      d.push(`M ${fromX} ${segFromY}`);
      d.push(`C ${fromX} ${segFromY + c} ${toX} ${segToY - c} ${toX} ${segToY}`);
    } else {
      const prevToY = segToRow > 0 ? rowYList[segToRow - 1] : segToY - EDGE_EXTENSION;
      const horizontalY = (segToY + prevToY) / 2;
      const r = arcRadius;
      const goingRight = toX > fromX;

      d.push(`M ${fromX} ${segFromY}`);
      d.push(`V ${horizontalY - r}`);
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
    }
  }

  return d.length > 0 ? d.join(" ") : null;
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

    const nodes = document.querySelectorAll(".change-node");
    const svg = document.getElementById("connections");
    if (!svg) {
      paths.value = [];
      return;
    }

    const svgRect = svg.getBoundingClientRect();
    const rowYList: number[] = [];
    nodes.forEach((node) => {
      const nodeRect = node.getBoundingClientRect();
      rowYList.push(nodeRect.top - svgRect.top + nodeRect.height / 2);
    });
    const bottomY = Math.max(...rowYList, 0) + 50;

    const sortedEdges = [...graph.edges].sort((a, b) => {
      if (a.lanePath[0] !== b.lanePath[0]) {
        return b.lanePath[0] - a.lanePath[0];
      }
      return b.lanePath[b.lanePath.length - 1] - a.lanePath[a.lanePath.length - 1];
    });

    const result: PathData[] = [];
    for (const edge of sortedEdges) {
      const d = buildPathD(edge, rowYList, bottomY, 12);
      if (d) {
        result.push({
          d,
          fromId: edge.fromId,
          toId: edge.toId,
          color: getLaneColor(edge.colorIndex),
        });
      }
    }
    paths.value = result;
  });

  return (
    <g id="connection-lines">
      {paths.value.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke-width="2"
          stroke-linecap="round"
          class="connection-line"
          data-from-id={p.fromId}
          data-to-id={p.toId}
          style={{ stroke: p.color }}
        />
      ))}
    </g>
  );
}
