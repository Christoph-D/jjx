import { useEffect } from "preact/hooks";
import { computed } from "@preact/signals";
import {
  applyExtensionMessage,
  checkState,
  entries,
  metadata,
  postMessage,
  setAllFilesCheckState,
  setAllFilesExpanded,
} from "./signals";
import { buildSplitFileViewModels, hasExpandableSplitEntries, splitChangeCountsTotal } from "./view-model";
import { getAllFilesCheckState } from "../../split/hunk-model";
import { ChangeCounts, FileRow } from "./components/file-row";
import { TriStateCheckbox } from "./components/tri-state-checkbox";
import type { SplitExtensionToWebviewMessage } from "../../split-protocol";

const fileModels = computed(() => buildSplitFileViewModels(entries.value));

// Paths of the files that have a hunk or mode-change breakdown (the expandable ones).
const expandablePaths = computed(() =>
  fileModels.value.filter(hasExpandableSplitEntries).map((file) => file.entry.path),
);

// Checkbox state of the "Select Everything" row above every file row.
const allFilesState = computed(() =>
  getAllFilesCheckState(
    fileModels.value.map((file) => file.entry),
    checkState.value,
  ),
);

// Aggregate added/removed line counts shown on the "Select Everything" row.
const allFilesCounts = computed(() => splitChangeCountsTotal(fileModels.value));

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
      setAllFilesExpanded(expandablePaths.value, false);
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
          <button
            class="splitButton"
            title="Expand every file entry"
            onClick={() => setAllFilesExpanded(expandablePaths.value, true)}
          >
            Expand All
          </button>
          <button
            class="splitButton"
            title="Collapse every file entry"
            onClick={() => setAllFilesExpanded(expandablePaths.value, false)}
          >
            Collapse All
          </button>
          <span class="splitHint">
            Selected changes will be put into the first commit,
            <br />
            the rest into the second commit.
          </span>
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
        <div
          class="splitRow splitSelectAllRow"
          title="Select Everything"
          onClick={() => setAllFilesCheckState(entries.value, allFilesState.value !== true)}
        >
          <TriStateCheckbox
            state={allFilesState.value}
            title="Select Everything"
            onChange={(checked) => setAllFilesCheckState(entries.value, checked)}
          />
          <span class="splitSelectAllLabel">Select Everything</span>
          <ChangeCounts counts={allFilesCounts.value} />
        </div>
        {fileModels.value.map((file) => (
          <FileRow key={file.entry.path} file={file} />
        ))}
      </div>
    </div>
  );
}
