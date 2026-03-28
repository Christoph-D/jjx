# Preact Migration Plan

## Background

The webview (`src/webview/graph/`) is ~2200 lines of imperative vanilla TypeScript across 7 modules. The core
performance problem is in `updateGraph()` (`nodes.ts:36-37`):

```js
nodesContainer.innerHTML = "";
circlesContainer.innerHTML = "";
```

**Every refresh destroys and recreates all DOM nodes.** With Preact, the virtual DOM diff will only update nodes whose
data actually changed. Unchanged nodes stay in the DOM.

## Decisions

- **Framework**: Preact (React-compatible, ~3KB runtime)
- **State**: `@preact/signals` (fine-grained reactivity)
- **Approach**: All-at-once rewrite

---

## Phase 1: Build & Dependency Setup

### 1.1 Install dependencies

```sh
npm install preact @preact/signals
```

### 1.2 Update `esbuild.js`

Add JSX config to the webview build context (around line 91). Change:

```js
createContext("src/webview/graph/main.ts", "dist/webview/graph.js", {
  format: "iife",
  platform: "browser",
}),
```

To:

```js
createContext("src/webview/graph/main.ts", "dist/webview/graph.js", {
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  jsxImportSource: "preact",
}),
```

### 1.3 Update `src/webview/tsconfig.json`

Add JSX compiler options:

```jsonc
{
  "compilerOptions": {
    "module": "Preserve",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "noEmit": true,
    // Add these:
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
  },
  "include": ["graph/**/*"],
  "exclude": ["node_modules", "dist"],
}
```

### 1.4 Simplify `src/webview/graph.html`

Replace the entire file with a minimal shell. All UI is rendered by Preact into `#root`:

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="${cssUri}" />
    <link rel="stylesheet" href="${codiconUri}" />
  </head>
  <body>
    <div id="root"></div>
    <script src="${graphJsUri}"></script>
  </body>
</html>
```

This removes all static markup: the context menu (`#context-menu`), rebase menu (`#rebase-menu`), tooltip (`#tooltip`),
and stale state overlay (`#stale-state`). These become Preact components.

---

## Phase 2: State Management (Signals)

### 2.1 Create `src/webview/graph/signals.ts`

Replace the mutable `state` object in `types.ts` with signals:

```ts
import { signal } from "@preact/signals";
import type { ChangeNode, ChangeIdGraph, VSCodeAPI } from "./types";

export let vscode: VSCodeAPI;

export function initVsCodeApi() {
  vscode = acquireVsCodeApi();
}

export const currentChanges = signal<ChangeNode[]>([]);
export const currentGraph = signal<ChangeIdGraph | null>(null);
export const selectedNodes = signal<Set<string>>(new Set());
export const isDragging = signal(false);
export const dragStartChangeId = signal<string | null>(null);
export const dropTargetId = signal<string | null>(null);
export const justFinishedDrag = signal(false);
export const maxPrefixLength = signal(4);
export const changeIdHorizontalOffset = signal(0);
export const isStale = signal(false);
export const graphStyle = signal("full");
export const changeEditAction = signal("edit");
export const scrollY = signal(0);
export const offsetWidth = signal(0);

export interface ContextMenuState {
  change: ChangeNode;
  pageX: number;
  pageY: number;
  changeEditAction: string;
}

export interface RebaseMenuState {
  sourceId: string;
  targetId: string;
  targetChange: ChangeNode;
  pageX: number;
  pageY: number;
}

export interface TooltipState {
  change: ChangeNode;
  pageX: number;
  pageY: number;
}

export const contextMenu = signal<ContextMenuState | null>(null);
export const rebaseMenu = signal<RebaseMenuState | null>(null);
export const tooltip = signal<TooltipState | null>(null);
```

### 2.2 Update `types.ts`

Remove the `state` export and `VSCodeAPI` (move to signals). Keep only type definitions and constants:

```ts
export const rootChangeId = "z".repeat(32);
export const SWIMLANE_WIDTH = 14;
export const CIRCLE_RADIUS = 5;
export const EDGE_EXTENSION = 20;
export const CHANGE_ID_RIGHT_PADDING = 6;

export interface VSCodeAPI {
  postMessage(message: unknown): void;
}

export const colorRegistry = [
  "rgba(from var(--vscode-charts-blue) r g b / 100%)",
  "rgba(from var(--vscode-charts-purple) r g b / 100%)",
  "rgba(from var(--vscode-charts-orange) r g b / 100%)",
  "rgba(from var(--vscode-charts-green) r g b / 100%)",
  "rgba(from var(--vscode-charts-red) r g b / 100%)",
];

// ... all interfaces stay (LaneNode, LaneEdge, ChangeIdGraph, ChangeNode)
```

---

## Phase 3: Component Structure

### 3.1 Directory layout

```
src/webview/graph/
├── main.tsx                  # Entry: render(<App />) into #root
├── app.tsx                   # Top-level: message handling, layout
├── signals.ts                # All signals
├── types.ts                  # Type definitions + constants (no mutable state)
├── utils.ts                  # Keep as-is (escapeHtml, abbreviateName, cleanupSeparators)
├── components/
│   ├── graph.tsx             # SVG + node list container
│   ├── change-node.tsx       # Single commit row
│   ├── node-circle.tsx       # SVG circle/diamond/@ for a node
│   ├── connection-lines.tsx  # All SVG connection paths
│   ├── context-menu.tsx      # Right-click context menu
│   ├── rebase-menu.tsx       # Drag-drop rebase menu
│   ├── tooltip.tsx           # Hover tooltip
│   └── stale-state.tsx       # Stale working copy overlay
├── hooks/
│   ├── use-drag-drop.ts      # Drag & drop logic
│   └── use-connected-highlight.ts  # Highlight connected nodes on hover
└── graph.css                 # Keep as-is (minimal changes)
```

### 3.2 `main.tsx` — Entry point

```tsx
import { render } from "preact";
import { App } from "./app";
import { initVsCodeApi } from "./signals";

declare function acquireVsCodeApi(): import("./types").VSCodeAPI;

initVsCodeApi();
render(<App />, document.getElementById("root")!);
```

### 3.3 `app.tsx` — Top-level component

Handles VS Code message routing and renders all child components:

```tsx
import { useEffect } from "preact/hooks";
import {
  currentChanges,
  currentGraph,
  graphStyle,
  changeEditAction,
  maxPrefixLength,
  offsetWidth,
  scrollY,
  isStale,
  selectedNodes,
  contextMenu,
  rebaseMenu,
  tooltip,
  isDragging,
  justFinishedDrag,
} from "./signals";
import { Graph } from "./components/graph";
import { ContextMenu } from "./components/context-menu";
import { RebaseMenu } from "./components/rebase-menu";
import { Tooltip } from "./components/tooltip";
import { StaleState } from "./components/stale-state";
import type { ChangeNode, ChangeIdGraph } from "./types";

export function App() {
  useEffect(() => {
    window.addEventListener("message", (event) => {
      const message = event.data as { command: string; [key: string]: unknown };
      switch (message.command) {
        case "updateGraph":
          isStale.value = false;
          selectedNodes.value = new Set();
          currentChanges.value = message.changes as ChangeNode[];
          currentGraph.value = message.laneInfo as ChangeIdGraph;
          changeEditAction.value = message.changeEditAction as string;
          graphStyle.value = message.graphStyle as string;
          maxPrefixLength.value = message.maxPrefixLength as number;
          offsetWidth.value = message.offsetWidth as number;
          scrollY.value = message.preserveScroll ? window.scrollY : 0;
          break;
        case "showStaleState":
          isStale.value = true;
          break;
      }
    });

    const hideMenus = () => {
      contextMenu.value = null;
      rebaseMenu.value = null;
    };

    document.addEventListener("click", hideMenus);
    window.addEventListener("blur", hideMenus);

    window.addEventListener("resize", () => {
      // Trigger re-render of connections via signal change
      currentGraph.value = { ...currentGraph.value! };
    });

    vscode.postMessage({ command: "webviewReady" });
  }, []);

  return (
    <>
      {isStale.value ? <StaleState /> : <Graph />}
      <ContextMenu />
      <RebaseMenu />
      <Tooltip />
    </>
  );
}
```

### 3.4 `components/graph.tsx` — Main graph container

Renders the SVG overlay (connections + circles) and the node list. Handles post-render measurements:

```tsx
import { useEffect, useRef } from "preact/hooks";
import {
  currentChanges,
  currentGraph,
  graphStyle,
  maxPrefixLength,
  offsetWidth,
  changeIdHorizontalOffset,
  scrollY,
} from "../signals";
import { SWIMLANE_WIDTH, CHANGE_ID_RIGHT_PADDING } from "../types";
import { ChangeNodeRow } from "./change-node";
import { NodeCircles } from "./node-circle";
import { ConnectionLines } from "./connection-lines";

export function Graph() {
  const graphRef = useRef<HTMLDivElement>(null);
  const firstChangeIdRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.fonts.ready.then(() => {
      if (firstChangeIdRef.current) {
        changeIdHorizontalOffset.value = firstChangeIdRef.current.offsetWidth;
      }
      if (scrollY.value > 0) {
        window.scrollTo(0, scrollY.value);
      }
    });
  }, [currentChanges.value]);

  const changes = currentChanges.value;
  const graph = currentGraph.value;
  const style = graphStyle.value;

  return (
    <div
      id="graph"
      ref={graphRef}
      class={style === "compact" ? "compact" : ""}
      style={{
        "--change-id-ch-width": `${maxPrefixLength.value}ch`,
        "--change-id-offset-width": `${offsetWidth.value}ch`,
      }}
    >
      <svg id="connections">
        <defs id="svg-defs"></defs>
        <ConnectionLines />
        <NodeCircles />
      </svg>
      <div id="nodes">
        {changes.map((change, index) => {
          const nodeData = graph?.nodes[index];
          return (
            <ChangeNodeRow
              key={change.changeId}
              change={change}
              index={index}
              nodeData={nodeData ?? null}
              changeIdRef={index === 0 ? firstChangeIdRef : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
```

### 3.5 `components/change-node.tsx` — Single commit row

Replaces the bulk of `nodes.ts`. Uses JSX to declaratively render node content with event handlers:

```tsx
import { type RefObject } from "preact";
import { useDragDrop } from "../hooks/use-drag-drop";
import { useConnectedHighlight } from "../hooks/use-connected-highlight";
import {
  selectedNodes,
  changeEditAction,
  contextMenu,
  rebaseMenu,
  tooltip,
  isDragging,
  justFinishedDrag,
} from "../signals";
import { SWIMLANE_WIDTH, CHANGE_ID_RIGHT_PADDING, rootChangeId } from "../types";
import { abbreviateName } from "../utils";

interface Props {
  change: ChangeNode;
  index: number;
  nodeData: LaneNode | null;
  changeIdRef?: RefObject<HTMLDivElement>;
}

export function ChangeNodeRow({ change, index, nodeData, changeIdRef }: Props) {
  const dragProps = useDragDrop(change);
  const highlightProps = useConnectedHighlight(change);
  const isElided = change.branchType === "~";
  const graphW = SWIMLANE_WIDTH * (nodeData?.numLanesActiveVisually ?? 0);

  const handleClick = (e: MouseEvent) => {
    if (isDragging.value || justFinishedDrag.value) return;
    if (isElided) return;

    const newSelected = new Set(selectedNodes.value);
    if (e.shiftKey) {
      if (newSelected.has(change.changeId)) {
        newSelected.delete(change.changeId);
      } else {
        newSelected.add(change.changeId);
      }
    } else {
      newSelected.clear();
      newSelected.add(change.changeId);
    }
    selectedNodes.value = newSelected;
  };

  const handleDoubleClick = () => {
    if (change.currentWorkingCopy) return;
    vscode.postMessage({ command: "editChange", changeId: change.changeId });
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (change.changeId === rootChangeId || isElided) return;
    contextMenu.value = {
      change,
      pageX: e.pageX,
      pageY: e.pageY,
      changeEditAction: changeEditAction.value,
    };
  };

  const handleEdit = (e: Event) => {
    e.stopPropagation();
    vscode.postMessage({ command: "editChange", changeId: change.changeId });
  };

  // Build change ID display
  const changeIdDisplay = (
    <div class="change-id-left" ref={changeIdRef}>
      {change.conflict && <span class="conflict-indicator">✗</span>}
      <span class="change-id-prefix">{change.changeIdPrefix}</span>
      <span class="change-id-suffix">{change.changeIdSuffix}</span>
      {change.changeOffset && <span class="change-id-offset">/{change.changeOffset}</span>}
    </div>
  );

  // Build pills
  const pills = (
    <>
      {change.workingCopies?.map((wc) => <span class="pill workspace-pill">{wc}</span>)}
      {change.localBookmarks.map((b) => (
        <span
          class={"pill bookmark-pill" + (b.conflict ? " conflicted" : b.synced ? "" : " unsynced")}
          data-bookmark={b.name}
        >
          {abbreviateName(b.name)}
        </span>
      ))}
      {/* ... remote bookmarks, local tags, remote tags follow same pattern */}
    </>
  );

  // Build label line
  const label = (
    <div>
      {pills}
      <span>{change.label}</span>
      {graphStyle.value === "compact" && !change.mine && change.authorName && (
        <span class="author-subdued">{change.authorName}</span>
      )}
    </div>
  );

  const showEditButton =
    !change.currentWorkingCopy && !(changeEditAction.value === "edit" && change.changeId === rootChangeId);

  return (
    <div
      class={
        "change-node" +
        (change.currentWorkingCopy ? " working-copy" : "") +
        (isElided ? " elided-node" : "") +
        (selectedNodes.value.has(change.changeId) ? " selected" : "")
      }
      data-change-id={change.changeId}
      data-parent-ids={JSON.stringify(change.parentChangeIds ?? [])}
      data-branch-type={change.branchType ?? ""}
      onClick={handleClick}
      onDblClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      {...highlightProps}
      {...dragProps}
    >
      {changeIdDisplay}
      <div
        class="text-content"
        style={{
          "--graph-width": `${graphW}px`,
          "--change-id-right-padding": `${CHANGE_ID_RIGHT_PADDING}px`,
        }}
      >
        {label}
        {graphStyle.value !== "compact" && <div class="description">{change.description}</div>}
      </div>
      {showEditButton && (
        <button class="edit-button" onClick={handleEdit} title="Edit This Change">
          <i class="codicon codicon-log-in"></i>
        </button>
      )}
    </div>
  );
}
```

### 3.6 `components/node-circle.tsx` — SVG node shapes

Replaces `createCircle` from `svg.ts`. Returns JSX based on `branchType`:

```tsx
import { useEffect, useRef } from "preact/hooks";
import { currentChanges, currentGraph, changeIdHorizontalOffset, selectedNodes } from "../signals";
import {
  CIRCLE_RADIUS,
  CHANGE_ID_RIGHT_PADDING,
  SWIMLANE_WIDTH,
  colorRegistry,
  type ChangeNode,
  type LaneNode,
} from "../types";
import { getLaneColor, getLaneX } from "../svg-utils";

function Circle({ change, colorIndex }: { change: ChangeNode; colorIndex: number }) {
  const laneColor = getLaneColor(colorIndex);

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

  // Position circles after render
  useEffect(() => {
    if (!gRef.current || !currentGraph.value) return;
    const svg = document.getElementById("connections");
    if (!svg) return;
    const svgRect = svg.getBoundingClientRect();

    const circles = gRef.current.querySelectorAll(".node-circle");
    circles.forEach((circle, index) => {
      const nodeData = currentGraph.value!.nodes[index];
      if (!nodeData) return;
      const changeId = (circle as HTMLElement).dataset.changeId!;
      const node = document.querySelector(`.change-node[data-change-id="${changeId}"]`);
      if (!node) return;
      const nodeRect = node.getBoundingClientRect();
      const x = getLaneX(nodeData.lane);
      const y = nodeRect.top - svgRect.top + nodeRect.height / 2;
      circle.setAttribute("transform", `translate(${x}, ${y})`);
    });
  }, [currentChanges.value, changeIdHorizontalOffset.value]);

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
```

### 3.7 `components/connection-lines.tsx` — SVG edge paths

Moves the path-building logic from `connections.ts` into JSX. The algorithm stays the same, but outputs `<path>`
elements:

```tsx
import { useEffect, useRef } from "preact/hooks";
import { currentChanges, currentGraph, changeIdHorizontalOffset } from "../signals";
import { EDGE_EXTENSION, type ChangeIdGraph } from "../types";
import { getLaneColor, getLaneX } from "../svg-utils";

function buildPathD(
  edge: ChangeIdGraph["edges"][number],
  rowYList: number[],
  bottomY: number,
  arcRadius: number,
): string {
  // Same algorithm as current buildConnectionPath in connections.ts
  // Returns the "d" attribute string
  // ... (ported verbatim from connections.ts:83-147)
}

export function ConnectionLines() {
  const gRef = useRef<SVGGElement>(null);
  const graph = currentGraph.value;
  const changes = currentChanges.value;

  useEffect(() => {
    // Trigger re-render when layout changes
  }, [currentChanges.value, changeIdHorizontalOffset.value]);

  if (!graph?.edges) return <g id="connection-lines" ref={gRef}></g>;

  const nodes = document.querySelectorAll(".change-node");
  const svg = document.getElementById("connections");
  if (!svg) return <g id="connection-lines" ref={gRef}></g>;

  const svgRect = svg.getBoundingClientRect();
  const rowYList: number[] = [];
  nodes.forEach((node) => {
    const nodeRect = node.getBoundingClientRect();
    rowYList.push(nodeRect.top - svgRect.top + nodeRect.height / 2);
  });
  const bottomY = Math.max(...rowYList, 0) + 50;

  const sortedEdges = [...graph.edges].sort((a, b) => {
    if (a.lanePath[0] !== b.lanePath[0]) return b.lanePath[0] - a.lanePath[0];
    return b.lanePath[b.lanePath.length - 1] - a.lanePath[a.lanePath.length - 1];
  });

  return (
    <g id="connection-lines" ref={gRef}>
      {sortedEdges.map((edge, i) => {
        const d = buildPathD(edge, rowYList, bottomY, 12);
        if (!d) return null;
        return (
          <path
            key={`${edge.fromId}-${edge.toId}-${i}`}
            d={d}
            fill="none"
            stroke-width="2"
            stroke-linecap="round"
            class="connection-line"
            style={{ stroke: getLaneColor(edge.colorIndex) }}
            data-from-id={edge.fromId}
            data-to-id={edge.toId}
          />
        );
      })}
    </g>
  );
}
```

### 3.8 `components/context-menu.tsx` — Right-click menu

Replaces the static HTML menu and the imperative show/hide logic in `menu.ts`. The menu items are rendered declaratively
based on `contextMenu` signal state:

```tsx
import { useEffect, useRef } from "preact/hooks";
import { contextMenu, rebaseMenu, currentChanges } from "../signals";
import { abbreviateName, cleanupSeparators } from "../utils";

export function ContextMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = contextMenu.value;
  if (!state) return null;

  const { change } = state;
  const isImmutable = change.branchType === "◆";

  // Compute available bookmarks from all changes
  const allBookmarks = [
    ...new Set(
      currentChanges.value
        .filter((c) => c.localBookmarks?.length > 0)
        .flatMap((c) => c.localBookmarks.map((b) => b.name)),
    ),
  ].sort();

  // Position after render
  useEffect(() => {
    if (!menuRef.current) return;
    positionMenu(menuRef.current, state.pageX, state.pageY);
  }, [state]);

  return (
    <div
      id="context-menu"
      class="context-menu"
      ref={menuRef}
      style="display: block"
      onClick={(e) => e.stopPropagation()}
      data-change-id={change.changeId}
    >
      {!change.currentWorkingCopy && (
        <div
          class="context-menu-item"
          data-action="edit"
          onClick={() => {
            vscode.postMessage({ command: "editChangeDirect", changeId: change.changeId });
            contextMenu.value = null;
          }}
        >
          Edit This Change
        </div>
      )}
      <div
        class="context-menu-item"
        data-action="describe"
        onClick={() => {
          vscode.postMessage({ command: "describeChange", changeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Describe Change...
      </div>
      <div class="context-menu-separator"></div>
      <div
        class={"context-menu-item has-submenu" + (allBookmarks.length === 0 ? " disabled" : "")}
        data-action="moveBookmark"
      >
        Move Bookmark Here
        <div class="context-submenu">
          {allBookmarks.map((name) => (
            <div
              class="context-submenu-item"
              data-bookmark={name}
              onClick={() => {
                vscode.postMessage({ command: "moveBookmark", bookmark: name, targetChangeId: change.changeId });
                contextMenu.value = null;
              }}
            >
              {abbreviateName(name)}
            </div>
          ))}
        </div>
      </div>
      {/* createBookmark, deleteBookmark, createTag, deleteTag, copyUrl, copyId, abandon follow same pattern */}
    </div>
  );
}
```

### 3.9 `components/rebase-menu.tsx` — Drag-drop rebase menu

Same pattern as context-menu. Renders conditionally based on `rebaseMenu` signal:

```tsx
import { useEffect, useRef } from "preact/hooks";
import { rebaseMenu } from "../signals";

export function RebaseMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = rebaseMenu.value;
  if (!state) return null;

  const { sourceId, targetId, targetChange } = state;
  const isDivergent = !!( /* same logic as current configureRebaseMenuItems */ );
  const isImmutable = targetChange.branchType === "◆";

  useEffect(() => {
    if (!menuRef.current) return;
    positionMenu(menuRef.current, state.pageX, state.pageY);
  }, [state]);

  const sendRebase = (command: string, withDescendants = false) => {
    vscode.postMessage({ command, changeId: sourceId, targetChangeId: targetId, withDescendants });
    rebaseMenu.value = null;
  };

  return (
    <div id="rebase-menu" class="context-menu" ref={menuRef} style="display: block"
      onClick={(e) => e.stopPropagation()}>
      {/* Rebase, Rebase With Descendants, Squash Into, Duplicate, Revert sections */}
      {/* Each item calls sendRebase with appropriate command */}
    </div>
  );
}
```

### 3.10 `components/tooltip.tsx` — Hover tooltip

```tsx
import { useEffect, useRef } from "preact/hooks";
import { tooltip } from "../signals";
import { escapeHtml } from "../utils";

export function Tooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const state = tooltip.value;
  if (!state) return <div id="tooltip" ref={ref} style="display: none"></div>;

  const { change } = state;

  useEffect(() => {
    if (!ref.current) return;
    // Same positioning logic as current showTooltip in interaction.ts
    positionTooltip(ref.current, state.pageX, state.pageY);
  }, [state]);

  return (
    <div id="tooltip" class="tooltip" ref={ref} style="display: block">
      {/* Same HTML structure as current showTooltip builds */}
      <div class="tooltip-header">
        <span class="tooltip-author">{change.authorName}</span>
        {change.authorEmail && <span class="tooltip-email">&lt;{change.authorEmail}&gt;</span>}
      </div>
      {/* ... bookmarks, tags, diff stats, full description */}
    </div>
  );
}
```

### 3.11 `components/stale-state.tsx` — Stale working copy overlay

Simple component replacing the static HTML:

```tsx
import { vscode } from "../signals";

export function StaleState() {
  return (
    <div id="stale-state" class="stale-state" style="display: flex">
      <div class="stale-state-icon">
        <i class="codicon codicon-refresh"></i>
      </div>
      <div class="stale-state-message">Working Copy Is Stale</div>
      <div class="stale-state-description">The working copy state is outdated and needs to be refreshed.</div>
      <button
        id="update-stale-button"
        class="update-stale-button"
        onClick={() => vscode.postMessage({ command: "updateStale" })}
      >
        <i class="codicon codicon-sync"></i>
        Update Working Copy
      </button>
    </div>
  );
}
```

---

## Phase 4: Hooks

### 4.1 `hooks/use-drag-drop.ts`

Extracts drag/drop event handlers from `nodes.ts` (lines 320-406). Returns props to spread onto the node element:

```tsx
import { dragStartChangeId, isDragging, dropTargetId, justFinishedDrag, rebaseMenu } from "../signals";
import { rootChangeId } from "../types";
import type { ChangeNode } from "../types";

export function useDragDrop(change: ChangeNode) {
  const isElided = change.branchType === "~";
  const isRoot = change.branchType === "◆" || change.branchType === "~";

  if (isElided) {
    return {};
  }

  return {
    draggable: !isRoot,
    onDragStart: isRoot
      ? undefined
      : (e: DragEvent) => {
          if (e.shiftKey) {
            e.preventDefault();
            return;
          }
          dragStartChangeId.value = change.changeId;
          isDragging.value = true;
          e.dataTransfer!.setData("text/plain", change.changeId);
          e.dataTransfer!.effectAllowed = "move";

          const ghost = document.createElement("div");
          ghost.className = "drag-ghost";
          ghost.textContent = change.changeId.substring(0, 8);
          document.body.appendChild(ghost);
          e.dataTransfer!.setDragImage(ghost, 0, 0);
          setTimeout(() => ghost.remove(), 0);
        },
    onDragEnd: isRoot
      ? undefined
      : () => {
          isDragging.value = false;
          dragStartChangeId.value = null;
          dropTargetId.value = null;
        },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
    },
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      if (!isDragging.value || !dragStartChangeId.value) return;
      if (change.changeId === dragStartChangeId.value) return;
      dropTargetId.value = change.changeId;
    },
    onDragLeave: (e: DragEvent) => {
      dropTargetId.value = null;
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const sourceId = e.dataTransfer!.getData("text/plain");
      const targetId = change.changeId;
      if (!sourceId || !targetId || sourceId === targetId) return;

      justFinishedDrag.value = true;
      rebaseMenu.value = {
        sourceId,
        targetId,
        targetChange: change,
        pageX: e.pageX,
        pageY: e.pageY,
      };

      setTimeout(() => {
        justFinishedDrag.value = false;
      }, 100);
    },
  };
}
```

### 4.2 `hooks/use-connected-highlight.ts`

Extracts the highlight logic from `interaction.ts`. Manages mouseenter/mouseleave that dims unrelated nodes:

```tsx
import { isDragging } from "../signals";
import type { ChangeNode } from "../types";

export function useConnectedHighlight(change: ChangeNode) {
  return {
    onMouseEnter: () => {
      if (isDragging.value) return;
      highlightConnectedNodes(change.changeId, true);
    },
    onMouseLeave: () => {
      highlightConnectedNodes(change.changeId, false);
    },
  };
}

function highlightConnectedNodes(nodeId: string, highlight: boolean) {
  // Same logic as current highlightConnectedNodes in interaction.ts
  // Uses querySelectorAll to find and toggle dimmed/highlighted classes
  // ...ported from interaction.ts:4-66
}
```

---

## Phase 5: SVG Utilities

### 5.1 Create `svg-utils.ts`

Extract pure functions from `svg.ts` that don't create DOM elements (they're no longer needed since JSX handles that):

```ts
import { CHANGE_ID_RIGHT_PADDING, SWIMLANE_WIDTH, colorRegistry } from "./types";
import { changeIdHorizontalOffset } from "./signals";

export function getLaneColor(colorIndex: number): string {
  return colorRegistry[colorIndex % colorRegistry.length];
}

export function getLaneX(laneIndex: number): number {
  return changeIdHorizontalOffset.value + CHANGE_ID_RIGHT_PADDING + SWIMLANE_WIDTH * (laneIndex + 1);
}
```

Delete `svg.ts` — `createCircle` and `createPath` are replaced by JSX in `node-circle.tsx` and `connection-lines.tsx`.

---

## Phase 6: CSS Changes

Minimal changes to `graph.css`:

- Existing class names are preserved in JSX, so most CSS works unchanged
- Remove the `#context-menu`, `#rebase-menu`, `#tooltip`, `#stale-state` selectors that referenced static HTML IDs —
  they still work because the components render elements with the same IDs/classes
- No other CSS changes expected

---

## Phase 7: Files to Delete

After migration, delete these files (replaced by the new structure):

| Old file                           | Replaced by                                                   |
| ---------------------------------- | ------------------------------------------------------------- |
| `src/webview/graph/main.ts`        | `main.tsx`                                                    |
| `src/webview/graph/nodes.ts`       | `components/change-node.tsx` + `components/graph.tsx`         |
| `src/webview/graph/connections.ts` | `components/connection-lines.tsx`                             |
| `src/webview/graph/svg.ts`         | `svg-utils.ts` + `components/node-circle.tsx`                 |
| `src/webview/graph/interaction.ts` | `hooks/use-connected-highlight.ts` + `components/tooltip.tsx` |
| `src/webview/graph/menu.ts`        | `components/context-menu.tsx` + `components/rebase-menu.tsx`  |

**Keep unchanged:**

- `src/webview/graph/types.ts` — remove `state` export, keep types + constants
- `src/webview/graph/utils.ts` — keep as-is
- `src/webview/graph.css` — keep as-is

---

## Phase 8: No Changes Required Outside Webview

The following files need **no changes**:

- `src/graphWebview.ts` — continues to send `postMessage` with `updateGraph`/`showStaleState` commands
- `src/laneAssigner.ts` — unchanged
- `src/elidedEdges.ts` — unchanged
- `esbuild.js` — only the JSX config change noted in Phase 1
- The message protocol between extension host and webview is unchanged

---

## Key Implementation Details

### Scroll preservation

On `updateGraph` message, store `window.scrollY` into `scrollY` signal before render. After Preact renders, a
`useEffect` in `Graph` restores scroll position:

```ts
useEffect(() => {
  if (scrollY.value > 0) {
    window.scrollTo(0, scrollY.value);
  }
}, [currentChanges.value]);
```

### SVG measurements after render

Connection lines and circle positions depend on `getBoundingClientRect()` of rendered HTML nodes. Use `useEffect` hooks
in `NodeCircles` and `ConnectionLines` that run after Preact's DOM commit. Wrap in `document.fonts.ready.then(...)` to
ensure text is laid out:

```ts
useEffect(() => {
  document.fonts.ready.then(() => {
    requestAnimationFrame(() => {
      // measure DOM, compute positions
    });
  });
}, [currentChanges.value, changeIdHorizontalOffset.value]);
```

### Connection line rendering note

Because connections depend on measured DOM positions (not just data), they cannot be pure functions of state. The
`ConnectionLines` component reads DOM after render via `useEffect` and updates its own local state with computed Y
positions. Alternatively, use refs to read DOM positions synchronously during render (since Preact renders synchronously
to DOM).

### Performance expectations

- **Current**: Every refresh = destroy + recreate ~100 DOM nodes
- **After**: Preact diffs the virtual DOM and only patches nodes whose props (change data) actually changed
- A node whose bookmark moved will get a pill update; unchanged nodes are untouched
- SVG connections still need full recalculation (positions change when any node changes), but this is unavoidable

---

## Migration Execution Order

Within the all-at-once PR, implement in this order:

1. `npm install preact @preact/signals`
2. Update `esbuild.js` (JSX config)
3. Update `src/webview/tsconfig.json` (JSX config)
4. Create `signals.ts`
5. Create `svg-utils.ts` (extract from `svg.ts`)
6. Create `hooks/use-drag-drop.ts` (extract from `nodes.ts`)
7. Create `hooks/use-connected-highlight.ts` (extract from `interaction.ts`)
8. Create all components (`stale-state.tsx`, `tooltip.tsx`, `node-circle.tsx`, `change-node.tsx`,
   `connection-lines.tsx`, `context-menu.tsx`, `rebase-menu.tsx`, `graph.tsx`)
9. Create `app.tsx`
10. Create `main.tsx`
11. Simplify `graph.html`
12. Clean up `types.ts` (remove `state` export)
13. Delete old files (`main.ts`, `nodes.ts`, `connections.ts`, `svg.ts`, `interaction.ts`, `menu.ts`)
14. Run `npm run check-types` — fix type errors
15. Run `npm run lint` — fix lint errors
16. Run `npm run build` — verify build succeeds
17. Run `npm run playwright-test` — verify all integration tests pass
