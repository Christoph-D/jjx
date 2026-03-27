import { state, CIRCLE_RADIUS, CHANGE_ID_RIGHT_PADDING, SWIMLANE_WIDTH, colorRegistry, type ChangeNode } from "./types";

export function getLaneColor(colorIndex: number): string {
  return colorRegistry[colorIndex % colorRegistry.length];
}

export function getLaneX(laneIndex: number): number {
  return state.changeIdHorizontalOffset + CHANGE_ID_RIGHT_PADDING + SWIMLANE_WIDTH * (laneIndex + 1);
}

export function createCircle(change: ChangeNode, colorIndex: number): SVGGElement {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", "node-circle");
  g.style.setProperty("--lane-color", getLaneColor(colorIndex));

  const radius = change.currentWorkingCopy ? 7 : CIRCLE_RADIUS;

  if (change.branchType === "~") {
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", "-8");
    bgRect.setAttribute("y", "-6");
    bgRect.setAttribute("width", "16");
    bgRect.setAttribute("height", "10");
    bgRect.classList.add("bg-match", "circle-bg");
    g.appendChild(bgRect);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "-8");
    rect.setAttribute("y", "-6");
    rect.setAttribute("width", "16");
    rect.setAttribute("height", "10");
    rect.setAttribute("class", "elided-bg bg-match");
    g.appendChild(rect);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "0");
    text.setAttribute("y", "0");
    text.setAttribute("class", "elided-symbol");
    text.textContent = "~";
    g.appendChild(text);
  } else if (change.branchType === "◆") {
    const size = 5;
    const d = `M 0 ${-size} L ${size} 0 L 0 ${size} L ${-size} 0 Z`;

    const bgDiamond = document.createElementNS("http://www.w3.org/2000/svg", "path");
    bgDiamond.setAttribute("d", d);
    bgDiamond.classList.add("bg-match", "circle-bg");
    bgDiamond.classList.add("no-stroke");
    g.appendChild(bgDiamond);

    const diamond = document.createElementNS("http://www.w3.org/2000/svg", "path");
    diamond.setAttribute("d", d);
    diamond.setAttribute("class", "diamond-path");
    g.appendChild(diamond);
  } else if (change.currentWorkingCopy) {
    const bgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    bgCircle.setAttribute("cx", "0");
    bgCircle.setAttribute("cy", "0");
    bgCircle.setAttribute("r", String(radius + 3));
    bgCircle.classList.add("no-stroke");
    bgCircle.classList.add("bg-match", "circle-bg");
    g.appendChild(bgCircle);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "0");
    circle.setAttribute("cy", "0");
    circle.setAttribute("r", String(radius + 3));
    circle.classList.add("no-stroke");
    circle.classList.add("bg-match");
    g.appendChild(circle);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "0");
    text.setAttribute("y", "0");
    text.setAttribute("class", "working-copy");
    text.textContent = "@";
    g.appendChild(text);
  } else {
    const isOpen = change.branchType === "○";
    const bgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    bgCircle.setAttribute("cx", "0");
    bgCircle.setAttribute("cy", "0");
    bgCircle.setAttribute("r", String(radius));
    bgCircle.classList.add("bg-match", "circle-bg");
    if (isOpen) {
      bgCircle.classList.add("thin-stroke");
    }
    g.appendChild(bgCircle);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "0");
    circle.setAttribute("cy", "0");
    circle.setAttribute("r", String(radius));
    if (isOpen) {
      circle.classList.add("bg-match", "thin-stroke");
    }
    g.appendChild(circle);
  }

  return g;
}

export function createPath(colorIndex: number, fromId: string, toId: string): SVGPathElement {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.classList.add("connection-line");
  path.style.stroke = getLaneColor(colorIndex);
  if (fromId) {
    path.dataset.fromId = fromId;
  }
  if (toId) {
    path.dataset.toId = toId;
  }
  return path;
}
