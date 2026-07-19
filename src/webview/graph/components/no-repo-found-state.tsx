import styles from "./stale-state.module.css";

export function NoRepoFoundState() {
  return (
    <div id="no-repo-found-state" class={styles.staleState} style="display: flex">
      <div class={styles.staleStateIcon}>
        <i class="codicon codicon-error"></i>
      </div>
      <div class={styles.staleStateMessage} data-role="message">
        No jj Repository Found
      </div>
      <div class={styles.staleStateDescription}>No jj repository exists in the current workspace.</div>
      <div class={styles.staleStateDescription}>
        <b>Solution:</b> Open a workspace that contains a jj repository, or initialize one with <code>jj git init</code>
        .
      </div>
      <a href="https://docs.jj-vcs.dev/latest/tutorial/" class={styles.actionButton} style="text-decoration: none">
        <i class="codicon codicon-link-external"></i>
        How to Create a jj Repository
      </a>
    </div>
  );
}
