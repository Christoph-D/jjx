export function NoRepoFoundState() {
  return (
    <div id="no-repo-found-state" class="stale-state" style="display: flex">
      <div class="stale-state-icon">
        <i class="codicon codicon-error"></i>
      </div>
      <div class="stale-state-message">No jj Repository Found</div>
      <div class="stale-state-description">No jj repository exists in the current workspace.</div>
      <div class="stale-state-description">
        <b>Solution:</b> Open a workspace that contains a jj repository, or initialize one with <code>jj git init</code>
        .
      </div>
      <a href="https://docs.jj-vcs.dev/latest/tutorial/" class="action-button" style="text-decoration: none">
        <i class="codicon codicon-link-external"></i>
        How to Create a jj Repository
      </a>
    </div>
  );
}
