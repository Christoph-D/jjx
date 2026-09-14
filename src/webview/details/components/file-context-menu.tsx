import { useEffect, useRef } from "preact/hooks";
import { closeFileContextMenu, fileContextMenu, formatShortChangeId, postMessage } from "../signals";
import { positionMenu } from "./position-menu";

// Mirrors the graph view's changed-file context menu (which in turn mirrors the
// scm/resourceState/context menu contributions): the working-copy change shows "Open File"
// (the working-copy file itself) while other changes additionally offer "Open File in
// Working Copy". "Open File" is omitted for deleted files outside the working copy because
// they do not exist at their own revision.
export function FileContextMenu() {
  const state = fileContextMenu.value;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) {
      return;
    }
    const menu = ref.current;
    let raf: number | undefined;
    if (menu) {
      menu.style.visibility = "hidden";
      raf = requestAnimationFrame(() => {
        if (!ref.current) {
          return;
        }
        positionMenu(ref.current, state.clientX, state.clientY);
        ref.current.style.visibility = "";
      });
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        closeFileContextMenu();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeFileContextMenu();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", closeFileContextMenu);
    return () => {
      if (raf !== undefined) {
        cancelAnimationFrame(raf);
      }
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", closeFileContextMenu);
    };
  }, [state]);

  if (!state) {
    return null;
  }

  const { change, file } = state;
  const isWorkingCopy = change.currentWorkingCopy;

  return (
    <div id="file-context-menu" class="detailsContextMenu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div
        class="detailsContextMenuItem"
        data-action="openFileDiff"
        onClick={() => {
          postMessage({
            command: "openFileDiff",
            commitId: change.commitId,
            shortChangeId: formatShortChangeId(change.changeId),
            path: file.path,
            status: file.type,
            ...(file.renamedFrom !== undefined ? { renamedFrom: file.renamedFrom } : {}),
          });
          closeFileContextMenu();
        }}
      >
        View as Diff
      </div>
      {(isWorkingCopy || file.type !== "D") && (
        <div
          class="detailsContextMenuItem"
          data-action="openFileAtRevision"
          onClick={() => {
            postMessage({
              command: "openFileAtRevision",
              commitId: change.commitId,
              shortChangeId: formatShortChangeId(change.changeId),
              currentWorkingCopy: change.currentWorkingCopy,
              path: file.path,
            });
            closeFileContextMenu();
          }}
        >
          Open File
        </div>
      )}
      {!isWorkingCopy && (
        <div
          class="detailsContextMenuItem"
          data-action="openFileInWorkingCopy"
          onClick={() => {
            postMessage({ command: "openFileInWorkingCopy", path: file.path });
            closeFileContextMenu();
          }}
        >
          Open File in Working Copy
        </div>
      )}
      <div class="detailsContextMenuSeparator" />
      <div
        class="detailsContextMenuItem"
        data-action="copyPath"
        onClick={() => {
          postMessage({ command: "copyPath", path: file.path });
          closeFileContextMenu();
        }}
      >
        Copy Path
      </div>
      <div
        class="detailsContextMenuItem"
        data-action="copyRelativePath"
        onClick={() => {
          postMessage({ command: "copyRelativePath", path: file.path });
          closeFileContextMenu();
        }}
      >
        Copy Relative Path
      </div>
    </div>
  );
}
