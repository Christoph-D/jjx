import styles from "./stale-state.module.css";

export function JJNotFoundState() {
  return (
    <div id="jj-not-found-state" class={styles.staleState} style="display: flex">
      <div class={styles.staleStateIcon}>
        <i class="codicon codicon-error"></i>
      </div>
      <div class={styles.staleStateMessage} data-role="message">
        No jj Binary Found
      </div>
      <div class={styles.staleStateDescription}>The jj binary could not be found on your system.</div>
      <div class={styles.staleStateDescription}>
        <b>Solution:</b> Install jj in a common location or set the path to the jj binary in the settings.
      </div>
      <a
        href="https://docs.jj-vcs.dev/latest/install-and-setup/"
        class={styles.actionButton}
        style="text-decoration: none"
      >
        <i class="codicon codicon-link-external"></i>
        How to Install jj
      </a>
    </div>
  );
}
