import { isDragging } from "../signals";

export function useConnectedHighlight(changeId: string, parentChangeIds: string[] | undefined) {
  return {
    onMouseEnter: () => {
      if (isDragging.value) {
        return;
      }
      highlightConnectedNodes(changeId, parentChangeIds ?? [], true);
    },
    onMouseLeave: () => {
      highlightConnectedNodes(changeId, parentChangeIds ?? [], false);
    },
  };
}

function highlightConnectedNodes(nodeId: string, parentIds: string[], highlight: boolean) {
  const nodes = document.querySelectorAll(".change-node");
  const nodeCircles = document.querySelectorAll("#node-circles .node-circle");

  if (highlight) {
    const childNodes = Array.from(nodes).filter((node) => {
      const nodeParentIds: string[] = JSON.parse((node as HTMLElement).dataset.parentIds || "[]") as string[];
      return nodeParentIds.includes(nodeId);
    });
    const childIds = childNodes.map((node) => (node as HTMLElement).dataset.changeId!);

    nodes.forEach((node) => node.classList.add("dimmed"));
    nodeCircles.forEach((circle) => circle.classList.add("dimmed"));
    document.querySelectorAll(".connection-line").forEach((line) => line.classList.add("dimmed"));

    const selfNode = document.querySelector(`.change-node[data-change-id="${nodeId}"]`);
    if (selfNode) {
      selfNode.classList.remove("dimmed");
      selfNode.classList.add("highlighted");
    }

    parentIds.forEach((parentId) => {
      const parentNode = document.querySelector(`.change-node[data-change-id="${parentId}"]`);
      if (parentNode) {
        parentNode.classList.remove("dimmed");
        parentNode.classList.add("highlighted");
      }
    });

    childNodes.forEach((node) => {
      node.classList.remove("dimmed");
      node.classList.add("highlighted");
    });

    nodeCircles.forEach((circle) => {
      const circleData = (circle as HTMLElement).dataset.changeId!;
      if (circleData === nodeId || parentIds.includes(circleData) || childIds.includes(circleData)) {
        circle.classList.remove("dimmed");
      }
    });

    const connectedIds = new Set([...parentIds, ...childIds]);
    document.querySelectorAll(".connection-line").forEach((line) => {
      const fromId = (line as HTMLElement).dataset.fromId!;
      const toId = (line as HTMLElement).dataset.toId!;

      if ((fromId === nodeId && connectedIds.has(toId)) || (toId === nodeId && connectedIds.has(fromId))) {
        line.classList.remove("dimmed");
        line.classList.add("highlighted");
      }
    });
  } else {
    nodes.forEach((node) => {
      node.classList.remove("dimmed", "highlighted");
    });
    nodeCircles.forEach((circle) => {
      circle.classList.remove("dimmed");
    });
    document.querySelectorAll(".connection-line").forEach((line) => {
      line.classList.remove("highlighted", "dimmed");
    });
  }
}
