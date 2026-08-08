import { currentChanges, rebaseMenu, vscode } from "../signals";
import { Menu, MenuItem, MenuSeparator, Submenu, SubmenuItem } from "./menu-container";

function ImmutableIcon() {
  return (
    <svg
      width="0.8em"
      height="0.8em"
      viewBox="-6 -6 12 12"
      style={{ verticalAlign: "middle", marginLeft: "4px", position: "relative", top: "-1px" }}
      aria-hidden="true"
    >
      <path d="M 0 -5 L 5 0 L 0 5 L -5 0 Z" fill="currentColor" />
    </svg>
  );
}

export function RebaseMenu() {
  const state = rebaseMenu.value;
  if (!state) {
    return null;
  }

  const { sourceId, targetId, targetChange } = state;
  const isDivergent = !!targetChange.changeOffset && targetChange.changeOffset !== "";
  const isImmutable = targetChange.branchType === "◆";
  const sourceChange = currentChanges.value.find((c) => c.changeId === sourceId);
  const isTargetAlreadyParent = !!sourceChange?.parentChangeIds?.includes(targetId);
  const immutableIcon = isImmutable ? <ImmutableIcon /> : null;
  const hasImmutableChild = currentChanges.value.some(
    (c) => c.parentChangeIds?.includes(targetId) && (c.branchType === "◆" || c.branchType === "~"),
  );
  const afterImmutableIcon = hasImmutableChild ? <ImmutableIcon /> : null;

  const sendCommand = (command: string, withDescendants = false) => {
    vscode.postMessage({ command, changeId: sourceId, targetChangeId: targetId, withDescendants });
    rebaseMenu.value = null;
  };

  return (
    <Menu id="rebase-menu" state={state} onClick={(e) => e.stopPropagation()}>
      {!isDivergent && (
        <>
          <Submenu action="rebase" label="Rebase">
            <SubmenuItem action="rebaseOnto" onClick={() => sendCommand("rebaseOnto")}>
              Onto
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
              Onto
            </SubmenuItem>
            {!isTargetAlreadyParent && (
              <SubmenuItem action="rebaseAddParentWithDescendants" onClick={() => sendCommand("rebaseAddParent")}>
                Add Parent
              </SubmenuItem>
            )}
            {isTargetAlreadyParent && (sourceChange?.parentChangeIds?.length ?? 0) >= 2 && (
              <SubmenuItem action="rebaseRemoveParentWithDescendants" onClick={() => sendCommand("rebaseRemoveParent")}>
                Remove Parent
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
        </>
      )}
      <Submenu action="duplicate" label="Duplicate">
        <SubmenuItem action="duplicateOnto" onClick={() => sendCommand("duplicateOnto")}>
          Onto
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
          Onto
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
