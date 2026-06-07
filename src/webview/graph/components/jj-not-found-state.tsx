export function JJNotFoundState() {
  return (
    <div id="jj-not-found-state" class="stale-state" style="display: flex">
      <div class="stale-state-icon">
        <i class="codicon codicon-error"></i>
      </div>
      <div class="stale-state-message">No jj Binary Found</div>
      <div class="stale-state-description">The jj binary could not be found on your system.</div>
      <div class="stale-state-description">
        <b>Solution:</b> Install jj in a common location or set the path to the jj binary in the settings.
      </div>
      <a href="https://docs.jj-vcs.dev/latest/install-and-setup/" class="action-button" style="text-decoration: none">
        <i class="codicon codicon-link-external"></i>
        How to Install jj
      </a>
    </div>
  );
}
