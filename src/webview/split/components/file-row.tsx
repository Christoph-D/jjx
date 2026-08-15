import { memo } from "preact/compat";
import type { ComponentChild } from "preact";
import type { FileStatusType } from "../../../types";
import {
  getFileCheckState,
  getHunkCheckState,
  getLineChecked,
  getModeChecked,
  getRenameChecked,
  splitFileLines,
} from "../../../split/hunk-model";
import type { SplitLine } from "../../../split/hunk-model";
import {
  checkState,
  collapsedHunks,
  expandedFiles,
  hunkKey,
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
import type { SplitFileViewModel, SplitHunkGroup } from "../view-model";
import { hasExpandableSplitEntries, modeChangeOf } from "../view-model";
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

/**
 * The vertical line running down a section's contents, horizontally centered under the
 * section's chevron. Clicking it toggles the section's collapse state (the same toggle as its
 * header chevron); being a real button, it also works with the keyboard, which the chevrons
 * do not. Only rendered while the section is expanded: a collapsed section has no contents
 * for the line to span.
 */
function CollapseLine({ label, onClick }: { label: string; onClick: () => void }) {
  const title = `Collapse ${label}`;
  return <button type="button" class="splitCollapseLine" title={title} aria-label={title} onClick={onClick} />;
}

export const FileRow = memo(function FileRow({ file }: { file: SplitFileViewModel }) {
  const { entry } = file;
  const expandable = hasExpandableSplitEntries(file);
  const expanded = expandedFiles.value.has(entry.path);
  const fileState = getFileCheckState(entry, checkState.value);

  return (
    <div class="splitFile">
      <div
        class={"splitRow splitFileRow" + (expandable ? " splitExpandable" : "")}
        title={entry.renamedFrom ? `${entry.renamedFrom} → ${entry.path}` : entry.path}
        onClick={() => toggleFileChecked(file)}
      >
        {expandable && (
          <i
            class={expanded ? "codicon codicon-chevron-down" : "codicon codicon-chevron-right"}
            title={expanded ? "Collapse file" : "Expand file"}
            onClick={(e) => {
              // The chevron is the dedicated expand/collapse affordance; the row itself toggles
              // the selection, so the click must not reach the row handler.
              e.stopPropagation();
              toggleFileExpanded(entry.path);
            }}
          />
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
        {!expandable && !entry.binary && leafSummary(entry) !== undefined && (
          <span class="splitLeafDetail">{leafSummary(entry)}</span>
        )}
      </div>
      {expandable && expanded && <HunkList file={file} />}
    </div>
  );
});

function leafSummary(entry: SplitFileViewModel["entry"]): string | undefined {
  const text = entry.status === "A" ? entry.rightText : entry.status === "D" ? entry.leftText : undefined;
  if (text === undefined) {
    return undefined;
  }
  const count = splitFileLines(text).length;
  return entry.status === "A" ? `+${lineCount(count)}` : `-${lineCount(count)}`;
}

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
  return (
    <div class="splitRename">
      <div
        class="splitRow splitHunkRow splitRenameRow"
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
  return (
    <div class="splitRename">
      <div
        class="splitRow splitHunkRow splitRenameRow"
        title={`File mode changed to ${mode}`}
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
  return (
    <div class="splitHunk">
      <div
        class="splitRow splitHunkRow"
        title={hunkState === false ? "Include hunk" : "Exclude hunk"}
        onClick={() => toggleHunkChecked(path, group.hunk)}
      >
        <i
          class={collapsed ? "codicon codicon-chevron-right" : "codicon codicon-chevron-down"}
          title={collapsed ? "Expand hunk" : "Collapse hunk"}
          onClick={(e) => {
            // The chevron is the dedicated collapse/expand affordance; the row itself toggles
            // the selection, so the click must not reach the row handler.
            e.stopPropagation();
            toggleHunkCollapsed(path, index);
          }}
        />
        <TriStateCheckbox
          state={hunkState}
          title={`Hunk ${index + 1}`}
          onChange={() => toggleHunkChecked(path, group.hunk)}
        />
        <span class="splitHunkHeader">
          @@ <span class="splitAdded">+{group.addedCount}</span> <span class="splitRemoved">-{group.removedCount}</span>
        </span>
      </div>
      {!collapsed && (
        <div class="splitLines">
          <CollapseLine label="hunk" onClick={() => toggleHunkCollapsed(path, index)} />
          {group.hunk.lines.map((line, lineIndex) => (
            <LineRow key={lineIndex} path={path} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}

function LineRow({ path, line }: { path: string; line: SplitLine }) {
  const checked = getLineChecked(path, line, checkState.value);
  const added = line.kind === "add";
  return (
    <div
      class={`splitRow splitLineRow ${added ? "splitLineAdded" : "splitLineRemoved"}${checked ? "" : " splitUnchecked"}`}
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
