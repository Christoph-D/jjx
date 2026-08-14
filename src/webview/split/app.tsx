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
      // Everything starts checked; files start collapsed so the user first gets an
      // overview of the changes and can expand the ones they care about.
      expandedFiles.value = new Set();
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
