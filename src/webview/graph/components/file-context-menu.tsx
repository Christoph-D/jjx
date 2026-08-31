import { fileContextMenu, postMessage } from "../signals";
import { Menu, MenuItem, MenuSeparator } from "./menu-container";

// Mirrors the scm/resourceState/context menu contributions in package.json:
// the working-copy group shows "Open File" (the working-copy file itself) while
// other groups additionally offer "Open File in Working Copy".
export function FileContextMenu() {
  const state = fileContextMenu.value;
  if (!state) {
    return null;
  }

  const { change, file } = state;
  const isWorkingCopy = change.currentWorkingCopy;

  return (
    <Menu id="file-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
      <MenuItem
        action="openFileDiff"
        onClick={() => {
          postMessage({
            command: "openFileDiff",
            changeId: change.id.changeId,
            path: file.path,
            status: file.type,
            ...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
          });
          fileContextMenu.value = null;
        }}
      >
        View as Diff
      </MenuItem>
      <MenuItem
        action="openFileAtRevision"
        onClick={() => {
          postMessage({ command: "openFileAtRevision", changeId: change.id.changeId, path: file.path });
          fileContextMenu.value = null;
        }}
      >
        Open File
      </MenuItem>
      {!isWorkingCopy && (
        <MenuItem
          action="openFileInWorkingCopy"
          onClick={() => {
            postMessage({ command: "openFileInWorkingCopy", path: file.path });
            fileContextMenu.value = null;
          }}
        >
          Open File in Working Copy
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem
        action="copyPath"
        onClick={() => {
          postMessage({ command: "copyPath", path: file.path });
          fileContextMenu.value = null;
        }}
      >
        Copy Path
      </MenuItem>
      <MenuItem
        action="copyRelativePath"
        onClick={() => {
          postMessage({ command: "copyRelativePath", path: file.path });
          fileContextMenu.value = null;
        }}
      >
        Copy Relative Path
      </MenuItem>
    </Menu>
  );
}
