import { StateDescription, StateDisplay } from "./state-display";

export function ErrorState() {
  return (
    <StateDisplay id="error-state" icon="error" message="Unknown Error">
      <StateDescription>An error occurred while refreshing the graph.</StateDescription>
      <StateDescription>See the error log for details.</StateDescription>
    </StateDisplay>
  );
}
