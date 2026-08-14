import { useEffect } from "preact/hooks";
import { computed } from "@preact/signals";
import { applyExtensionMessage, checkState, entries, expandedFiles, metadata, postMessage } from "./signals";
import { buildSplitFileViewModels } from "./view-model";
import { FileRow } from "./components/file-row";
import type { SplitExtensionToWebviewMessage } from "../../split-protocol";

const fileModels = computed(() => buildSplitFileViewModels(entries.value));

export function App() {
  useEffect(() => {
    window.addEventListener("message", (event) => {
      const message = event.data as SplitExtensionToWebviewMessage;
      if (message.command !== "updateSplitFiles") {
        return;
      }
      applyExtensionMessage(message);
      // Everything starts checked and expandable text files (modified, added, or deleted) start expanded.
      expandedFiles.value = new Set(
        buildSplitFileViewModels(message.entries)
          .filter((file) => file.hunkGroups.length > 0)
          .map((file) => file.entry.path),
      );
    });

    postMessage({ command: "webviewReady" });
  }, []);

  const info = metadata.value;

  return (
    <div class="splitRoot">
      <div class="splitHeader">
        <div class="splitHeaderButtons">
          <button
            class="splitButton splitPrimaryButton"
            onClick={() => postMessage({ command: "split", state: checkState.value })}
          >
            Split
          </button>
          <button class="splitButton" onClick={() => postMessage({ command: "cancel" })}>
            Cancel
          </button>
        </div>
        <div class="splitHeaderInfo">
          {info && (
            <>
              <span class="splitHeaderChangeId">{info.shortChangeId}</span>
              <span class="splitHeaderDescription">{info.descriptionFirstLine}</span>
            </>
          )}
        </div>
      </div>
      <div class="splitContent">
        {fileModels.value.map((file) => (
          <FileRow key={file.entry.path} file={file} />
        ))}
      </div>
    </div>
  );
}
