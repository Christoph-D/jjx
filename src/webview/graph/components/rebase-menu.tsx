import { currentChanges, rebaseMenu, postMessage } from "../signals";
import { ImmutableIcon } from "./immutable-icon";
import { Menu, MenuItem, MenuSeparator, Submenu, SubmenuItem } from "./menu-container";

export function RebaseMenu() {
  const state = rebaseMenu.value;
  if (!state) {
    return null;
  }

  const { sourceId, sourceIds, targetId, targetChange } = state;
  const isImmutable = targetChange.branchType === "◆";
  const sourceChange = currentChanges.value.find((c) => c.branchType !== "~" && c.id.changeId === sourceId);
  const isSourceImmutable = sourceChange?.branchType === "◆";
  const isTargetAlreadyParent = !!sourceChange?.parentChangeIds?.includes(targetId);
  const immutableIcon = isImmutable || isSourceImmutable ? <ImmutableIcon /> : null;
  const hasImmutableChild = currentChanges.value.some(
    (c) => c.parentChangeIds?.includes(targetId) && (c.branchType === "◆" || c.branchType === "~"),
  );
  const afterImmutableIcon = hasImmutableChild || isSourceImmutable ? <ImmutableIcon /> : null;
  const sourceImmutableIcon = isSourceImmutable ? <ImmutableIcon /> : null;
  const isMultiSource = sourceIds.length > 1;

  const sendCommand = (
    command:
      | "rebaseOnto"
      | "rebaseAfter"
      | "rebaseBefore"
      | "rebaseAddParent"
      | "rebaseRemoveParent"
      | "squashInto"
      | "duplicateOnto"
      | "duplicateAfter"
      | "duplicateBefore"
      | "revertOnto"
      | "revertAfter"
      | "revertBefore",
    withDescendants = false,
  ) => {
    if (command === "rebaseAddParent" || command === "rebaseRemoveParent") {
      // These remain single-source operations.
      postMessage({ command, changeId: sourceId, targetChangeId: targetId });
    } else {
      postMessage({ command, changeIds: sourceIds, targetChangeId: targetId, withDescendants });
    }
    rebaseMenu.value = null;
  };

  return (
    <Menu id="rebase-menu" state={state} onClick={(e) => e.stopPropagation()}>
      <Submenu action="rebase" label="Rebase">
        <SubmenuItem action="rebaseOnto" onClick={() => sendCommand("rebaseOnto")}>
          Onto{sourceImmutableIcon}
        </SubmenuItem>
        <SubmenuItem action="rebaseAfter" onClick={() => sendCommand("rebaseAfter")}>
          After{afterImmutableIcon}
        </SubmenuItem>
        <SubmenuItem action="rebaseBefore" onClick={() => sendCommand("rebaseBefore")}>
          Before{immutableIcon}
        </SubmenuItem>
      </Submenu>
      <Submenu action="rebaseWithDescendants" label="Rebase With Descendants">
        <SubmenuItem action="rebaseOntoWithDescendants" onClick={() => sendCommand("rebaseOnto", true)}>
          Onto{sourceImmutableIcon}
        </SubmenuItem>
        {!isMultiSource && !isTargetAlreadyParent && (
          <SubmenuItem action="rebaseAddParentWithDescendants" onClick={() => sendCommand("rebaseAddParent")}>
            Add Parent{sourceImmutableIcon}
          </SubmenuItem>
        )}
        {!isMultiSource && isTargetAlreadyParent && (sourceChange?.parentChangeIds?.length ?? 0) >= 2 && (
          <SubmenuItem action="rebaseRemoveParentWithDescendants" onClick={() => sendCommand("rebaseRemoveParent")}>
            Remove Parent{sourceImmutableIcon}
          </SubmenuItem>
        )}
        <SubmenuItem action="rebaseAfterWithDescendants" onClick={() => sendCommand("rebaseAfter", true)}>
          After{afterImmutableIcon}
        </SubmenuItem>
        <SubmenuItem action="rebaseBeforeWithDescendants" onClick={() => sendCommand("rebaseBefore", true)}>
          Before{immutableIcon}
        </SubmenuItem>
      </Submenu>
      <MenuSeparator />
      <MenuItem action="squashInto" onClick={() => sendCommand("squashInto")}>
        Squash Into{immutableIcon}
      </MenuItem>
      <Submenu action="duplicate" label="Duplicate">
        <SubmenuItem action="duplicateOnto" onClick={() => sendCommand("duplicateOnto")}>
          Onto{sourceImmutableIcon}
        </SubmenuItem>
        <SubmenuItem action="duplicateAfter" onClick={() => sendCommand("duplicateAfter")}>
          After{afterImmutableIcon}
        </SubmenuItem>
        <SubmenuItem action="duplicateBefore" onClick={() => sendCommand("duplicateBefore")}>
          Before{immutableIcon}
        </SubmenuItem>
      </Submenu>
      <Submenu action="revert" label="Revert">
        <SubmenuItem action="revertOnto" onClick={() => sendCommand("revertOnto")}>
          Onto{sourceImmutableIcon}
        </SubmenuItem>
        <SubmenuItem action="revertAfter" onClick={() => sendCommand("revertAfter")}>
          After{afterImmutableIcon}
        </SubmenuItem>
        <SubmenuItem action="revertBefore" onClick={() => sendCommand("revertBefore")}>
          Before{immutableIcon}
        </SubmenuItem>
      </Submenu>
    </Menu>
  );
}
