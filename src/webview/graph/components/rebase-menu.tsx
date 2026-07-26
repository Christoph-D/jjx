import { currentChanges, rebaseMenu, vscode } from "../signals";
import { Menu, MenuItem, MenuSeparator, Submenu, SubmenuItem } from "./menu-container";

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
              After
            </SubmenuItem>
            {!isImmutable && (
              <SubmenuItem action="rebaseBefore" onClick={() => sendCommand("rebaseBefore")}>
                Before
              </SubmenuItem>
            )}
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
            <SubmenuItem action="rebaseAfterWithDescendants" onClick={() => sendCommand("rebaseAfter", true)}>
              After
            </SubmenuItem>
            {!isImmutable && (
              <SubmenuItem action="rebaseBeforeWithDescendants" onClick={() => sendCommand("rebaseBefore", true)}>
                Before
              </SubmenuItem>
            )}
          </Submenu>
          <MenuSeparator />
          {!isImmutable && (
            <MenuItem action="squashInto" onClick={() => sendCommand("squashInto")}>
              Squash Into
            </MenuItem>
          )}
        </>
      )}
      <Submenu action="duplicate" label="Duplicate">
        <SubmenuItem action="duplicateOnto" onClick={() => sendCommand("duplicateOnto")}>
          Onto
        </SubmenuItem>
        <SubmenuItem action="duplicateAfter" onClick={() => sendCommand("duplicateAfter")}>
          After
        </SubmenuItem>
        {(!isDivergent ? !isImmutable : true) && (
          <SubmenuItem action="duplicateBefore" onClick={() => sendCommand("duplicateBefore")}>
            Before
          </SubmenuItem>
        )}
      </Submenu>
      <Submenu action="revert" label="Revert">
        <SubmenuItem action="revertOnto" onClick={() => sendCommand("revertOnto")}>
          Onto
        </SubmenuItem>
        <SubmenuItem action="revertAfter" onClick={() => sendCommand("revertAfter")}>
          After
        </SubmenuItem>
        {(!isDivergent ? !isImmutable : true) && (
          <SubmenuItem action="revertBefore" onClick={() => sendCommand("revertBefore")}>
            Before
          </SubmenuItem>
        )}
      </Submenu>
    </Menu>
  );
}
