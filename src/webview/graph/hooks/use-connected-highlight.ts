import { isDragging } from "../signals";

interface GraphElementCache {
  nodeByChangeId: Map<string, HTMLElement>;
  childrenOf: Map<string, string[]>;
  nodeCircleByChangeId: Map<string, HTMLElement>;
  connectionLines: HTMLElement[];
  allNodes: HTMLElement[];
  allCircles: HTMLElement[];
}

let cache: GraphElementCache | null = null;

function buildCache(): GraphElementCache {
  const nodeByChangeId = new Map<string, HTMLElement>();
  const childrenOf = new Map<string, string[]>();
  const allNodes: HTMLElement[] = [];

  const nodes = Array.from(document.querySelectorAll(".change-node"));
  for (const node of nodes) {
    const el = node as HTMLElement;
    const changeId = el.dataset.changeId!;
    nodeByChangeId.set(changeId, el);
    allNodes.push(el);
    const parentIds: string[] = JSON.parse(el.dataset.parentIds || "[]") as string[];
    for (const parentId of parentIds) {
      let children = childrenOf.get(parentId);
      if (!children) {
        children = [];
        childrenOf.set(parentId, children);
      }
      children.push(changeId);
    }
  }

  const nodeCircleByChangeId = new Map<string, HTMLElement>();
  const allCircles: HTMLElement[] = [];
  const circles = Array.from(document.querySelectorAll("#node-circles .node-circle"));
  for (const circle of circles) {
    const el = circle as HTMLElement;
    nodeCircleByChangeId.set(el.dataset.changeId!, el);
    allCircles.push(el);
  }

  const connectionLines = Array.from(document.querySelectorAll(".connection-line")) as HTMLElement[];

  return { nodeByChangeId, childrenOf, nodeCircleByChangeId, connectionLines, allNodes, allCircles };
}

export function invalidateHighlightCache() {
  cache = null;
}

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
  if (!cache) {
    cache = buildCache();
  }
  const { nodeByChangeId, childrenOf, nodeCircleByChangeId, connectionLines, allNodes, allCircles } = cache;

  if (highlight) {
    const childIds = childrenOf.get(nodeId) ?? [];

    for (const node of allNodes) {
      node.classList.add("dimmed");
    }
    for (const circle of allCircles) {
      circle.classList.add("dimmed");
    }
    for (const line of connectionLines) {
      line.classList.add("dimmed");
    }

    const selfNode = nodeByChangeId.get(nodeId);
    if (selfNode) {
      selfNode.classList.remove("dimmed");
      selfNode.classList.add("highlighted");
    }

    for (const parentId of parentIds) {
      const parentNode = nodeByChangeId.get(parentId);
      if (parentNode) {
        parentNode.classList.remove("dimmed");
        parentNode.classList.add("highlighted");
      }
    }

    for (const childId of childIds) {
      const childNode = nodeByChangeId.get(childId);
      if (childNode) {
        childNode.classList.remove("dimmed");
        childNode.classList.add("highlighted");
      }
    }

    const connectedIds = new Set([nodeId, ...parentIds, ...childIds]);
    for (const [changeId, circle] of nodeCircleByChangeId) {
      if (connectedIds.has(changeId)) {
        circle.classList.remove("dimmed");
      }
    }

    for (const line of connectionLines) {
      const fromId = line.dataset.fromId!;
      const toId = line.dataset.toId!;
      if ((fromId === nodeId && connectedIds.has(toId)) || (toId === nodeId && connectedIds.has(fromId))) {
        line.classList.remove("dimmed");
        line.classList.add("highlighted");
      }
    }
  } else {
    for (const node of allNodes) {
      node.classList.remove("dimmed", "highlighted");
    }
    for (const circle of allCircles) {
      circle.classList.remove("dimmed");
    }
    for (const line of connectionLines) {
      line.classList.remove("highlighted", "dimmed");
    }
  }
}
