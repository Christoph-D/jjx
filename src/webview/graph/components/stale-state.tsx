import { vscode } from "../signals";

export function StaleState() {
  return (
    <div id="stale-state" class="stale-state" style="display: flex">
      <div class="stale-state-icon">
        <i class="codicon codicon-refresh"></i>
      </div>
      <div class="stale-state-message">Working Copy Is Stale</div>
      <div class="stale-state-description">The working copy state is outdated and needs to be refreshed.</div>
      <button
        id="update-stale-button"
        class="update-stale-button"
        onClick={() => vscode.postMessage({ command: "updateStale" })}
      >
        <i class="codicon codicon-sync"></i>
        Update Working Copy
      </button>
    </div>
  );
}
