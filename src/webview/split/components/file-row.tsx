import { memo } from "preact/compat";
import type { ComponentChild } from "preact";
import type { FileStatusType } from "../../../types";
import {
  getFileCheckState,
  getHunkCheckState,
  getLineChecked,
  getModeChecked,
  getRenameChecked,
} from "../../../split/hunk-model";
import type { SplitCheckState, SplitLine } from "../../../split/hunk-model";
import {
  checkState,
  collapsedHunks,
  expandedFiles,
  selectedRow,
  setModeCheckState,
  setRenameCheckState,
  toggleFileChecked,
  toggleFileExpanded,
  toggleHunkChecked,
  toggleHunkCollapsed,
  toggleLineChecked,
  toggleModeChecked,
  toggleRenameChecked,
} from "../signals";
import type { SplitChangeCounts, SplitFileViewModel, SplitHunkGroup, SplitRowId } from "../view-model";
import { hasExpandableSplitEntries, hunkKey, modeChangeOf, sameSplitRow, splitFileChangeCounts } from "../view-model";
import { TriStateCheckbox } from "./tri-state-checkbox";

const STATUS_COLORS: Record<FileStatusType, string> = {
  A: "var(--vscode-jjDecoration-addedResourceForeground, #81b88b)",
  M: "var(--vscode-jjDecoration-modifiedResourceForeground, #e2c08d)",
  D: "var(--vscode-jjDecoration-deletedResourceForeground, #c74e39)",
  R: "var(--vscode-jjDecoration-renamedResourceForeground, #73c991)",
  C: "var(--vscode-jjDecoration-renamedResourceForeground, #73c991)",
  X: "var(--vscode-jjDecoration-conflictingResourceForeground, #e4676b)",
  "?": "var(--vscode-jjDecoration-untrackedResourceForeground, #b4b4b4)",
};

/** Strips the line terminator kept by the hunk model so lines render as single rows. */
function lineText(text: string): string {
  return text.replace(/(?:\r\n|\r|\n)$/, "");
}

/** Mouse movement (in px) beyond this between mousedown and click counts as a drag selection. */
const DRAG_THRESHOLD = 3;

/** Where the mouse was pressed last, used to tell drag selections apart from clicks. */
let lastPointerDown: { x: number; y: number } | undefined;

function wasDragSelection(e: MouseEvent): boolean {
  const down = lastPointerDown;
  lastPointerDown = undefined;
  return (
    down !== undefined &&
    (Math.abs(e.clientX - down.x) > DRAG_THRESHOLD || Math.abs(e.clientY - down.y) > DRAG_THRESHOLD)
  );
}

function lineCount(count: number): string {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

/** Maps a tri-state check state to the `aria-checked` value of a row acting as a checkbox. */
export function ariaChecked(state: SplitCheckState): "true" | "mixed" | "false" {
  return state === true ? "true" : state === false ? "false" : "mixed";
}

/** The class suffix marking `id` as the selected row of the arrow-key navigation. */
function selectedClass(id: SplitRowId): string {
  return sameSplitRow(selectedRow.value, id) ? " splitSelected" : "";
}

/** The `+N -M` added/removed line counts; a count of 0 is omitted entirely. */
export function ChangeCounts({ counts }: { counts: SplitChangeCounts }) {
  if (counts.added <= 0 && counts.removed <= 0) {
    return null;
  }
  return (
    <span class="splitLeafDetail">
      {counts.added > 0 && <span class="splitAdded">+{counts.added}</span>}
      {counts.added > 0 && counts.removed > 0 && " "}
      {counts.removed > 0 && <span class="splitRemoved">-{counts.removed}</span>}
    </span>
  );
}

/**
 * The vertical line spanning a section's contents; a real button that toggles the collapse
 * like the header chevron (keyboard accessible) and is rendered only while expanded.
 */
function CollapseLine({ label, onClick }: { label: string; onClick: () => void }) {
  const title = `Collapse ${label}`;
  return <button type="button" class="splitCollapseLine" title={title} aria-label={title} onClick={onClick} />;
}

/**
 * The expand/collapse chevron of a file or section row: a real button wrapping the codicon
 * glyph (title/aria-label, focus, Enter/Space). Its activation must not reach the row's own
 * click handler.
 */
function Chevron({ expanded, title, onClick }: { expanded: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="splitChevron"
      title={title}
      aria-label={title}
      aria-expanded={expanded}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <i class={expanded ? "codicon codicon-chevron-down" : "codicon codicon-chevron-right"} aria-hidden="true" />
    </button>
  );
}

export const FileRow = memo(function FileRow({ file }: { file: SplitFileViewModel }) {
  const { entry } = file;
  const expandable = hasExpandableSplitEntries(file);
  const expanded = expandedFiles.value.has(entry.path);
  const fileState = getFileCheckState(entry, checkState.value);
  const label = entry.renamedFrom ? `${entry.renamedFrom} → ${entry.path}` : entry.path;
  const id: SplitRowId = { kind: "file", path: entry.path };

  return (
    <div class="splitFile">
      <div
        class={"splitRow splitFileRow" + (expandable ? " splitExpandable" : "") + selectedClass(id)}
        role="checkbox"
        aria-checked={ariaChecked(fileState)}
        aria-label={label}
        title={label}
        onClick={() => toggleFileChecked(file)}
      >
        {expandable ? (
          <Chevron
            expanded={expanded}
            title={expanded ? "Collapse file" : "Expand file"}
            onClick={() => toggleFileExpanded(entry.path)}
          />
        ) : (
          <ChevronPlaceholder />
        )}
        <TriStateCheckbox state={fileState} onChange={() => toggleFileChecked(file)} />
        <span class="splitStatus" style={`color: ${STATUS_COLORS[entry.status]}`}>
          {entry.status}
        </span>
        <span class="splitPath">{entry.path}</span>
        {entry.renamedFrom !== undefined && <span class="splitLeafDetail">← {entry.renamedFrom}</span>}
        {entry.conflict && (
          <span class="splitLeafDetail splitConflict" title="Conflicted">
            <i class="codicon codicon-warning" /> conflicted
          </span>
        )}
        {entry.binary && <span class="splitLeafDetail">binary</span>}
        <ChangeCounts counts={splitFileChangeCounts(file)} />
      </div>
      {expandable && expanded && <HunkList file={file} />}
    </div>
  );
});

function HunkList({ file }: { file: SplitFileViewModel }) {
  const children: ComponentChild[] = [];
  // A file's mode change is its own checkable, listed ahead of the rename and content hunks.
  const modeChange = modeChangeOf(file.entry);
  if (modeChange !== undefined) {
    children.push(<ModeRow key="mode" path={file.entry.path} mode={modeChange} />);
  }
  // A renamed file's rename is its own checkable, listed ahead of the content hunks.
  if (file.entry.renamedFrom !== undefined) {
    children.push(<RenameRow key="rename" path={file.entry.path} renamedFrom={file.entry.renamedFrom} />);
  }
  file.hunkGroups.forEach((group, index) => {
    const contextCount = file.contextCounts[index] ?? 0;
    if (contextCount > 0) {
      children.push(<ContextSeparator key={`sep-${index}`} count={contextCount} />);
    }
    children.push(<HunkRow key={`hunk-${index}`} path={file.entry.path} group={group} index={index} />);
  });
  const trailingCount = file.contextCounts[file.hunkGroups.length] ?? 0;
  if (trailingCount > 0) {
    children.push(<ContextSeparator key={`sep-${file.hunkGroups.length}`} count={trailingCount} />);
  }
  return (
    <div class="splitHunks">
      <CollapseLine label="file" onClick={() => toggleFileExpanded(file.entry.path)} />
      {children}
    </div>
  );
}

function ContextSeparator({ count }: { count: number }) {
  return <div class="splitRow splitSeparator">⋯ {lineCount(count)} unchanged ⋯</div>;
}

/** Hidden chevron reserving the exact expand/collapse slot of hunk rows so the checkbox lines up. */
function ChevronPlaceholder() {
  return <i class="codicon codicon-chevron-right splitChevronPlaceholder" aria-hidden="true" />;
}

/** The "File Renamed" checkbox row: decides which commit the rename itself lands in. */
function RenameRow({ path, renamedFrom }: { path: string; renamedFrom: string }) {
  const checked = getRenameChecked(path, checkState.value);
  const id: SplitRowId = { kind: "rename", path };
  return (
    <div class="splitRename">
      <div
        class={"splitRow splitHunkRow splitRenameRow" + selectedClass(id)}
        role="checkbox"
        aria-checked={ariaChecked(checked)}
        aria-label={`File Renamed: ${renamedFrom} → ${path}`}
        title={`${renamedFrom} → ${path}`}
        onClick={() => toggleRenameChecked(path)}
      >
        <ChevronPlaceholder />
        <TriStateCheckbox
          state={checked}
          title="File Renamed"
          onChange={(nextChecked) => setRenameCheckState(path, nextChecked)}
        />
        <span class="splitHunkHeader">File Renamed</span>
        <span class="splitLeafDetail">← {renamedFrom}</span>
      </div>
    </div>
  );
}

/** The "File mode changed" checkbox row: decides which commit the mode change lands in. */
function ModeRow({ path, mode }: { path: string; mode: string }) {
  const checked = getModeChecked(path, checkState.value);
  const title = `File mode changed to ${mode}`;
  const id: SplitRowId = { kind: "mode", path };
  return (
    <div class="splitRename">
      <div
        class={"splitRow splitHunkRow splitRenameRow" + selectedClass(id)}
        role="checkbox"
        aria-checked={ariaChecked(checked)}
        aria-label={title}
        title={title}
        onClick={() => toggleModeChecked(path)}
      >
        <ChevronPlaceholder />
        <TriStateCheckbox
          state={checked}
          title={`File mode changed to ${mode}`}
          onChange={(nextChecked) => setModeCheckState(path, nextChecked)}
        />
        <span class="splitHunkHeader">File mode changed to {mode}</span>
      </div>
    </div>
  );
}

function HunkRow({ path, group, index }: { path: string; group: SplitHunkGroup; index: number }) {
  const hunkState = getHunkCheckState(path, group.hunk, checkState.value);
  const collapsed = collapsedHunks.value.has(hunkKey(path, index));
  const id: SplitRowId = { kind: "hunk", path, index };
  return (
    <div class="splitHunk">
      <div
        class={"splitRow splitHunkRow" + selectedClass(id)}
        role="checkbox"
        aria-checked={ariaChecked(hunkState)}
        aria-label={`Section ${index + 1}`}
        title={hunkState === false ? "Include section" : "Exclude section"}
        onClick={() => toggleHunkChecked(path, group.hunk)}
      >
        <Chevron
          expanded={!collapsed}
          title={collapsed ? "Expand section" : "Collapse section"}
          onClick={() => toggleHunkCollapsed(path, index)}
        />
        <TriStateCheckbox
          state={hunkState}
          title={`Section ${index + 1}`}
          onChange={() => toggleHunkChecked(path, group.hunk)}
        />
        <span class="splitHunkHeader">Section {index + 1}</span>
        <ChangeCounts counts={{ added: group.addedCount, removed: group.removedCount }} />
      </div>
      {!collapsed && (
        <div class="splitLines">
          <CollapseLine label="section" onClick={() => toggleHunkCollapsed(path, index)} />
          {group.hunk.lines.map((line, lineIndex) => (
            <LineRow key={lineIndex} path={path} line={line} hunkIndex={index} lineIndex={lineIndex} />
          ))}
        </div>
      )}
    </div>
  );
}

function LineRow({
  path,
  line,
  hunkIndex,
  lineIndex,
}: {
  path: string;
  line: SplitLine;
  hunkIndex: number;
  lineIndex: number;
}) {
  const checked = getLineChecked(path, line, checkState.value);
  const added = line.kind === "add";
  const id: SplitRowId = { kind: "line", path, hunkIndex, lineIndex };
  return (
    <div
      class={`splitRow splitLineRow ${added ? "splitLineAdded" : "splitLineRemoved"}${checked ? "" : " splitUnchecked"}${selectedClass(id)}`}
      role="checkbox"
      aria-checked={ariaChecked(checked)}
      aria-label={`${added ? "+" : "-"}${lineText(line.text)}`}
      title={checked ? "Exclude line" : "Include line"}
      onMouseDown={(e) => {
        lastPointerDown = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        // Ignore clicks that end a drag selection so copying line text keeps working.
        if (wasDragSelection(e)) {
          return;
        }
        // Double/triple clicks select a word/line incidentally; drop such (possibly stale)
        // selections so rapid clicks always toggle the line.
        window.getSelection()?.removeAllRanges();
        toggleLineChecked(path, line);
      }}
    >
      <TriStateCheckbox state={checked} onChange={() => toggleLineChecked(path, line)} />
      <span class={`splitLinePrefix ${added ? "splitAdded" : "splitRemoved"}`}>{added ? "+" : "-"}</span>
      <span class="splitLineText">{lineText(line.text)}</span>
    </div>
  );
}
