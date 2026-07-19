import { StateActionLink, StateDescription, StateDisplay } from "./state-display";

export function JJNotFoundState() {
  return (
    <StateDisplay id="jj-not-found-state" icon="error" message="No jj Binary Found">
      <StateDescription>The jj binary could not be found on your system.</StateDescription>
      <StateDescription>
        <b>Solution:</b> Install jj in a common location or set the path to the jj binary in the settings.
      </StateDescription>
      <StateActionLink href="https://docs.jj-vcs.dev/latest/install-and-setup/">
        <i class="codicon codicon-link-external"></i>
        How to Install jj
      </StateActionLink>
    </StateDisplay>
  );
}
