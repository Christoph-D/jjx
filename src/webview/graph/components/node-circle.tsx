import { useSignal, useSignalEffect } from "@preact/signals";
import { currentChanges, currentGraph, changeIdHorizontalOffset, selectedNodes, hoveredChangeId } from "../signals";
import { CIRCLE_RADIUS } from "../types";
import type { ChangeNode } from "../../../graph-protocol";
import { getLaneColor, getLaneX } from "../svg-utils";
import styles from "./node-circle.module.css";

function Circle({ change, colorIndex: _colorIndex }: { change: ChangeNode; colorIndex: number }) {
  if (change.branchType === "~") {
    return (
      <g>
        <rect x="-8" y="-6" width="16" height="10" class={styles.circleBg} />
        <rect x="-8" y="-6" width="16" height="10" class={styles.bgMatch} />
        <text x="0" y="0" class={styles.elidedSymbol}>
          ~
        </text>
      </g>
    );
  }

  if (change.branchType === "◆") {
    const size = 5;
    const d = `M 0 ${-size} L ${size} 0 L 0 ${size} L ${-size} 0 Z`;
    return (
      <g>
        <path d={d} class={`${styles.circleBg} ${styles.noStroke}`} />
        <path d={d} class={styles.diamondPath} />
      </g>
    );
  }

  if (change.currentWorkingCopy) {
    return (
      <g>
        <circle cx="0" cy="0" r="10" class={`${styles.noStroke} ${styles.circleBg}`} />
        <circle cx="0" cy="0" r="10" class={`${styles.noStroke} ${styles.bgMatch}`} />
        <text x="0" y="0" class={styles.workingCopy}>
          @
        </text>
      </g>
    );
  }

  const isOpen = change.branchType === "○";
  const r = CIRCLE_RADIUS;
  return (
    <g>
      <circle cx="0" cy="0" r={r} class={styles.circleBg + (isOpen ? " " + styles.thinStroke : "")} />
      <circle cx="0" cy="0" r={r} class={isOpen ? `${styles.bgMatch} ${styles.thinStroke}` : ""} />
    </g>
  );
}

interface NodePosition {
  x: number;
  y: number;
}

export function NodeCircles() {
  const nodePositions = useSignal<NodePosition[]>([]);

  useSignalEffect(() => {
    void currentChanges.value;
    void changeIdHorizontalOffset.value;

    const graph = currentGraph.value;
    if (!graph) {
      nodePositions.value = [];
      return;
    }
    const svg = document.getElementById("connections");
    if (!svg) {
      nodePositions.value = [];
      return;
    }
    const svgRect = svg.getBoundingClientRect();

    const domNodes = document.querySelectorAll(`#nodes > [data-change-id]`);
    const newPositions: NodePosition[] = [];
    domNodes.forEach((node, i) => {
      const nodeData = graph.nodes[i];
      const x = getLaneX(nodeData?.lane ?? 0);
      const isElided = currentChanges.value[i]?.branchType === "~";
      const changeIdEl = node.querySelector(`[data-role="change-id"]`);
      const refEl = (isElided ? node : (changeIdEl ?? node)) as HTMLElement;
      const refRect = refEl.getBoundingClientRect();
      const y = refRect.top - svgRect.top + refRect.height / 2;
      newPositions.push({ x, y });
    });
    nodePositions.value = newPositions;
  });

  const changes = currentChanges.value;
  const graph = currentGraph.value;

  return (
    <g id="node-circles">
      {changes.map((change, i) => {
        const nodeData = graph?.nodes[i];
        const pos = nodePositions.value[i];
        return (
          <g
            key={change.changeId}
            class={
              styles.nodeCircle +
              (selectedNodes.value.has(change.changeId) ? " " + styles.selected : "") +
              (hoveredChangeId.value === change.changeId ? " " + styles.hovered : "")
            }
            data-change-id={change.changeId}
            data-node-lane={nodeData?.lane ?? 0}
            style={{ "--lane-color": getLaneColor(nodeData?.colorIndex ?? 0) }}
            transform={pos ? `translate(${pos.x}, ${pos.y})` : undefined}
          >
            <Circle change={change} colorIndex={nodeData?.colorIndex ?? 0} />
          </g>
        );
      })}
    </g>
  );
}
