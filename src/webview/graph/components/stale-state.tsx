import { postMessage } from "../signals";
import { StateActionButton, StateDescription, StateDisplay } from "./state-display";

export function StaleState() {
  return (
    <StateDisplay id="stale-state" icon="refresh" message="Working Copy Is Stale">
      <StateDescription>The working copy state is outdated and needs to be refreshed.</StateDescription>
      <StateActionButton id="update-stale-button" onClick={() => postMessage({ command: "updateStale" })}>
        <i class="codicon codicon-sync"></i>
        Update Working Copy
      </StateActionButton>
    </StateDisplay>
  );
}
