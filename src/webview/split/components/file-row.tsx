import { memo } from "preact/compat";
import type { ComponentChild } from "preact";
import type { FileStatusType } from "../../../types";
import { getFileCheckState, getHunkCheckState, getLineChecked, splitFileLines } from "../../../split/hunk-model";
import type { SplitLine } from "../../../split/hunk-model";
import {
  checkState,
  expandedFiles,
  setFileCheckState,
  setHunkCheckState,
  toggleFileExpanded,
  toggleLineChecked,
} from "../signals";
import type { SplitFileViewModel, SplitHunkGroup } from "../view-model";
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

function lineCount(count: number): string {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

export const FileRow = memo(function FileRow({ file }: { file: SplitFileViewModel }) {
  const { entry } = file;
  const expandable = file.hunkGroups.length > 0;
  const expanded = expandedFiles.value.has(entry.path);
  const fileState = getFileCheckState(entry, checkState.value);

  return (
    <div class="splitFile">
      <div
        class={"splitRow splitFileRow" + (expandable ? " splitExpandable" : "")}
        title={entry.renamedFrom ? `${entry.renamedFrom} → ${entry.path}` : entry.path}
        onClick={() => expandable && toggleFileExpanded(entry.path)}
      >
        {expandable && <i class={expanded ? "codicon codicon-chevron-down" : "codicon codicon-chevron-right"} />}
        <TriStateCheckbox state={fileState} onChange={(checked) => setFileCheckState(entry.path, checked)} />
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
  return <div class="splitHunks">{children}</div>;
}

function ContextSeparator({ count }: { count: number }) {
  return <div class="splitRow splitSeparator">⋯ {lineCount(count)} unchanged ⋯</div>;
}

function HunkRow({ path, group, index }: { path: string; group: SplitHunkGroup; index: number }) {
  const hunkState = getHunkCheckState(path, group.hunk, checkState.value);
  return (
    <div class="splitHunk">
      <div class="splitRow splitHunkRow">
        <TriStateCheckbox
          state={hunkState}
          title={`Hunk ${index + 1}`}
          onChange={(checked) => setHunkCheckState(path, group.hunk, checked)}
        />
        <span class="splitHunkHeader">
          @@ <span class="splitAdded">+{group.addedCount}</span> <span class="splitRemoved">-{group.removedCount}</span>
        </span>
      </div>
      {group.hunk.lines.map((line, lineIndex) => (
        <LineRow key={lineIndex} path={path} line={line} />
      ))}
    </div>
  );
}

function LineRow({ path, line }: { path: string; line: SplitLine }) {
  const checked = getLineChecked(path, line, checkState.value);
  const added = line.kind === "add";
  return (
    <div
      class={`splitRow splitLineRow ${added ? "splitLineAdded" : "splitLineRemoved"}${checked ? "" : " splitUnchecked"}`}
    >
      <TriStateCheckbox state={checked} onChange={() => toggleLineChecked(path, line)} />
      <span class={`splitLinePrefix ${added ? "splitAdded" : "splitRemoved"}`}>{added ? "+" : "-"}</span>
      <span class="splitLineText">{lineText(line.text)}</span>
    </div>
  );
}
