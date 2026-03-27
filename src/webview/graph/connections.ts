import { state, type ChangeIdGraph } from "./types";
import { getLaneX, createPath } from "./svg";

export function updateCirclePositions() {
  const svg = document.getElementById("connections");
  if (!svg) {return;}
  const svgRect = svg.getBoundingClientRect();

  if (!state.currentGraph || !state.currentGraph.nodes) {return;}

  document.querySelectorAll(".node-circle").forEach((circle, index) => {
    const nodeData = state.currentGraph!.nodes[index];
    if (!nodeData) {return;}

    const changeId = (circle as HTMLElement).dataset.changeId;
    const node = document.querySelector(`.change-node[data-change-id="${changeId}"]`);

    if (!node) {return;}

    const nodeRect = node.getBoundingClientRect();
    const x = getLaneX(nodeData.lane);
    const y = nodeRect.top - svgRect.top + nodeRect.height / 2;

    circle.setAttribute("transform", `translate(${x}, ${y})`);
  });
}

export function updateConnections() {
  const connectionLines = document.getElementById("connection-lines")!;
  connectionLines.innerHTML = "";

  if (!state.currentGraph || !state.currentGraph.edges) {return;}

  const nodes = document.querySelectorAll(".change-node");
  const svg = document.getElementById("connections")!;
  const svgRect = svg.getBoundingClientRect();

  const rowYList: number[] = [];
  nodes.forEach((node) => {
    const nodeRect = node.getBoundingClientRect();
    const y = nodeRect.top - svgRect.top + nodeRect.height / 2;
    rowYList.push(y);
  });

  const bottomY = Math.max(...rowYList) + 50;
  const ARC_RADIUS = 12;

  const sortedEdges = [...state.currentGraph.edges].sort((a, b) => {
    const aStart = a.lanePath[0];
    const bStart = b.lanePath[0];
    if (aStart !== bStart) {return bStart - aStart;}
    const aEnd = a.lanePath[a.lanePath.length - 1];
    const bEnd = b.lanePath[b.lanePath.length - 1];
    return bEnd - aEnd;
  });

  for (const edge of sortedEdges) {
    const fromY = rowYList[edge.fromRow];
    if (fromY === undefined) {continue;}
    if (!edge.lanePath || edge.lanePath.length < 2) {continue;}

    const path = buildConnectionPath(edge, rowYList, bottomY, ARC_RADIUS);
    connectionLines.appendChild(path);
  }
}

function buildConnectionPath(
  edge: ChangeIdGraph["edges"][number],
  rowYList: number[],
  bottomY: number,
  arcRadius: number,
): SVGPathElement {
  const path = createPath(edge.colorIndex, edge.fromId, edge.toId);
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

    if (segFromY === undefined || segToY === undefined) {continue;}

    const fromX = getLaneX(segFromLane);
    const toX = getLaneX(segToLane);

    if (segFromLane === segToLane) {
      d.push(`M ${fromX} ${segFromY} V ${segToY}`);
    } else if (Math.abs(segFromLane - segToLane) === 1) {
      const c = 18;
      d.push(`M ${fromX} ${segFromY}`);
      d.push(`C ${fromX} ${segFromY + c} ${toX} ${segToY - c} ${toX} ${segToY}`);
    } else {
      let prevToY: number;
      if (edge.extendsToBottom && i === lastSegmentIndex) {
        prevToY = segToRow > 0 ? rowYList[segToRow - 1] : segToY - 20;
      } else {
        prevToY = segToRow > 0 ? rowYList[segToRow - 1] : segToY - 20;
      }
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

  path.setAttribute("d", d.join(" "));
  return path;
}
