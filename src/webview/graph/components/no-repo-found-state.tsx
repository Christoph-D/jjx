import { StateActionLink, StateDescription, StateDisplay } from "./state-display";

export function NoRepoFoundState() {
  return (
    <StateDisplay id="no-repo-found-state" icon="error" message="No jj Repository Found">
      <StateDescription>No jj repository exists in the current workspace.</StateDescription>
      <StateDescription>
        <b>Solution:</b> Open a workspace that contains a jj repository, or initialize one with <code>jj git init</code>
        .
      </StateDescription>
      <StateActionLink href="https://docs.jj-vcs.dev/latest/tutorial/">
        <i class="codicon codicon-link-external"></i>
        How to Create a jj Repository
      </StateActionLink>
    </StateDisplay>
  );
}
