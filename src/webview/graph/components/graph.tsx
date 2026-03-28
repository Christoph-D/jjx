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
import { ChangeNodeRow } from "./change-node";
import { NodeCircles } from "./node-circle";
import { ConnectionLines } from "./connection-lines";
import { invalidateHighlightCache } from "../hooks/use-connected-highlight";

export function Graph() {
  const firstChangeIdRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invalidateHighlightCache();
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
