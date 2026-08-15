import { useEffect } from "preact/hooks";
import { computed } from "@preact/signals";
import {
  applyExtensionMessage,
  checkState,
  entries,
  expandedFiles,
  collapsedHunks,
  metadata,
  postMessage,
  selectSplitRow,
  selectedRow,
  setAllFilesCheckState,
  setAllFilesExpanded,
  setFileExpanded,
  setHunkCollapsed,
  toggleFileChecked,
  toggleHunkChecked,
  toggleLineChecked,
  toggleModeChecked,
  toggleRenameChecked,
} from "./signals";
import {
  buildSplitFileViewModels,
  buildSplitRows,
  hasExpandableSplitEntries,
  sameSplitRow,
  splitChangeCountsTotal,
  stepSplitRow,
  type SplitFileViewModel,
  type SplitRowId,
} from "./view-model";
import { getAllFilesCheckState } from "../../split/hunk-model";
import { ChangeCounts, FileRow, ariaChecked } from "./components/file-row";
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

// Every row of the view in display order, with the visibility flag that hides the contents
// of collapsed files and sections from arrow-key navigation.
const splitRows = computed(() => buildSplitRows(fileModels.value, expandedFiles.value, collapsedHunks.value));

const allRowId: SplitRowId = { kind: "all" };

/** Looks up the view model of the file `path`, if it is still part of the view. */
function fileModelOf(path: string): SplitFileViewModel | undefined {
  return fileModels.value.find((file) => file.entry.path === path);
}

/** Up/Down: selects the previous/next visible row, wrapping around at both ends. */
function moveSelection(delta: 1 | -1): void {
  selectSplitRow(stepSplitRow(splitRows.value, selectedRow.value, delta));
}

/** Space: toggles the selected row's checkbox like a click on the row. */
function toggleSelectedRow(): void {
  const id = selectedRow.value;
  if (id === null) {
    return;
  }
  switch (id.kind) {
    case "all":
      setAllFilesCheckState(entries.value, allFilesState.value !== true);
      return;
    case "file": {
      const file = fileModelOf(id.path);
      if (file !== undefined) {
        toggleFileChecked(file);
      }
      return;
    }
    case "rename":
      toggleRenameChecked(id.path);
      return;
    case "mode":
      toggleModeChecked(id.path);
      return;
    case "hunk": {
      const group = fileModelOf(id.path)?.hunkGroups[id.index];
      if (group !== undefined) {
        toggleHunkChecked(id.path, group.hunk);
      }
      return;
    }
    case "line": {
      const line = fileModelOf(id.path)?.hunkGroups[id.hunkIndex]?.hunk.lines[id.lineIndex];
      if (line !== undefined) {
        toggleLineChecked(id.path, line);
      }
      return;
    }
  }
}

/**
 * Left/Right: collapses/expands the selected row. A file row collapses and expands the file,
 * a section row the section; every other row (and the direction the row already sits in) is
 * a no-op, so neither key ever moves the selection.
 */
function setSelectedRowExpanded(expanded: boolean): void {
  const id = selectedRow.value;
  if (id === null) {
    return;
  }
  if (id.kind === "file") {
    const file = fileModelOf(id.path);
    if (file !== undefined && hasExpandableSplitEntries(file)) {
      setFileExpanded(id.path, expanded);
    }
    return;
  }
  if (id.kind === "hunk") {
    setHunkCollapsed(id.path, id.index, !expanded);
  }
}

/**
 * True when the key event belongs to one of the view's real controls (the header buttons and
 * the chevrons, collapse lines, and checkboxes). Those keep their native keys — Space toggles
 * a focused checkbox, Tab and Enter work the buttons — so the row navigation must not claim them.
 */
function fromInteractiveControl(e: KeyboardEvent): boolean {
  return e.target instanceof Element && e.target.closest("button, input, textarea, select") !== null;
}

/**
 * The arrow-key row navigation. The rows themselves are not focusable, so the keys are heard
 * on the window and steer the selection signal instead of DOM focus; arrow keys and Space
 * (which would scroll the view) are claimed to keep them from doing anything else.
 */
function onNavigationKeyDown(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return;
  }
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      moveSelection(1);
      return;
    case "ArrowUp":
      e.preventDefault();
      moveSelection(-1);
      return;
    case "ArrowLeft":
      e.preventDefault();
      setSelectedRowExpanded(false);
      return;
    case "ArrowRight":
      e.preventDefault();
      setSelectedRowExpanded(true);
      return;
    case " ":
      if (fromInteractiveControl(e)) {
        return;
      }
      e.preventDefault();
      toggleSelectedRow();
      return;
    case "Tab":
      if (fromInteractiveControl(e)) {
        return;
      }
      // Tab has no role in the row navigation; it is only claimed so it cannot move focus
      // into the view's controls while the user navigates with the arrow keys.
      e.preventDefault();
      return;
  }
}

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

    window.addEventListener("keydown", onNavigationKeyDown);

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
          class={"splitRow splitSelectAllRow" + (sameSplitRow(selectedRow.value, allRowId) ? " splitSelected" : "")}
          role="checkbox"
          aria-checked={ariaChecked(allFilesState.value)}
          aria-label="Select Everything"
          title="Select Everything"
          onClick={() => {
            selectSplitRow(allRowId);
            setAllFilesCheckState(entries.value, allFilesState.value !== true);
          }}
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
