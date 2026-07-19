import { vscode } from "../signals";
import styles from "./stale-state.module.css";

export function StaleState() {
  return (
    <div id="stale-state" class={styles.staleState} style="display: flex">
      <div class={styles.staleStateIcon}>
        <i class="codicon codicon-refresh"></i>
      </div>
      <div class={styles.staleStateMessage} data-role="message">
        Working Copy Is Stale
      </div>
      <div class={styles.staleStateDescription}>The working copy state is outdated and needs to be refreshed.</div>
      <button
        id="update-stale-button"
        class={styles.actionButton}
        onClick={() => vscode.postMessage({ command: "updateStale" })}
      >
        <i class="codicon codicon-sync"></i>
        Update Working Copy
      </button>
    </div>
  );
}
