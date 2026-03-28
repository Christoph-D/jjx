import { useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import { currentChanges, currentGraph, changeIdHorizontalOffset, selectedNodes } from "../signals";
import { CIRCLE_RADIUS } from "../types";
import type { ChangeNode } from "../../../graph-protocol";
import { getLaneColor, getLaneX } from "../svg-utils";

function Circle({ change, colorIndex: _colorIndex }: { change: ChangeNode; colorIndex: number }) {
  if (change.branchType === "~") {
    return (
      <g>
        <rect x="-8" y="-6" width="16" height="10" class="bg-match circle-bg" />
        <rect x="-8" y="-6" width="16" height="10" class="elided-bg bg-match" />
        <text x="0" y="0" class="elided-symbol">
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
        <path d={d} class="bg-match circle-bg no-stroke" />
        <path d={d} class="diamond-path" />
      </g>
    );
  }

  if (change.currentWorkingCopy) {
    return (
      <g>
        <circle cx="0" cy="0" r="10" class="no-stroke bg-match circle-bg" />
        <circle cx="0" cy="0" r="10" class="no-stroke bg-match" />
        <text x="0" y="0" class="working-copy">
          @
        </text>
      </g>
    );
  }

  const isOpen = change.branchType === "○";
  const r = CIRCLE_RADIUS;
  return (
    <g>
      <circle cx="0" cy="0" r={r} class={"bg-match circle-bg" + (isOpen ? " thin-stroke" : "")} />
      <circle cx="0" cy="0" r={r} class={isOpen ? "bg-match thin-stroke" : ""} />
    </g>
  );
}

export function NodeCircles() {
  const gRef = useRef<SVGGElement>(null);

  useSignalEffect(() => {
    void currentChanges.value;
    void changeIdHorizontalOffset.value;

    if (!gRef.current || !currentGraph.value) {
      return;
    }
    const svg = document.getElementById("connections");
    if (!svg) {
      return;
    }
    const svgRect = svg.getBoundingClientRect();

    const circles = gRef.current.querySelectorAll(".node-circle");
    circles.forEach((circle, index) => {
      const nodeData = currentGraph.value!.nodes[index];
      if (!nodeData) {
        return;
      }
      const changeId = (circle as HTMLElement).dataset.changeId!;
      const node = document.querySelector(`.change-node[data-change-id="${changeId}"]`);
      if (!node) {
        return;
      }
      const nodeRect = node.getBoundingClientRect();
      const x = getLaneX(nodeData.lane);
      const y = nodeRect.top - svgRect.top + nodeRect.height / 2;
      circle.setAttribute("transform", `translate(${x}, ${y})`);
    });
  });

  const changes = currentChanges.value;
  const graph = currentGraph.value;

  return (
    <g id="node-circles" ref={gRef}>
      {changes.map((change, i) => {
        const nodeData = graph?.nodes[i];
        return (
          <g
            key={change.changeId}
            class={"node-circle" + (selectedNodes.value.has(change.changeId) ? " selected" : "")}
            data-change-id={change.changeId}
            data-node-lane={nodeData?.lane ?? 0}
            style={{ "--lane-color": getLaneColor(nodeData?.colorIndex ?? 0) }}
          >
            <Circle change={change} colorIndex={nodeData?.colorIndex ?? 0} />
          </g>
        );
      })}
    </g>
  );
}
