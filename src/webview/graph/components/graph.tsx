import { useEffect, useRef } from "preact/hooks";
import {
  currentChanges,
  currentGraph,
  graphStyle,
  maxPrefixLength,
  offsetWidth,
  changeIdHorizontalOffset,
  scrollY,
  showChangedFiles,
} from "../signals";
import { ChangeNodeRow } from "./change-node";
import { NodeCircles } from "./node-circle";
import { ConnectionLines } from "./connection-lines";

export function Graph() {
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
  const showingFiles = showChangedFiles.value;
  const compact = style === "compact";

  return (
    <div
      id="graph"
      data-mode={compact ? "compact" : "full"}
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
              key={change.id.changeId}
              change={change}
              index={index}
              nodeData={nodeData ?? null}
              changeIdRef={index === 0 ? firstChangeIdRef : undefined}
              compact={compact}
              showingFiles={showingFiles}
            />
          );
        })}
      </div>
    </div>
  );
}
