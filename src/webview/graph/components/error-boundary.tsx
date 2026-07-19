import { Component, type ComponentChildren } from "preact";
import { vscode } from "../signals";
import { StateActionButton, StateDescription, StateDisplay } from "./state-display";

interface ErrorBoundaryProps {
  children: ComponentChildren;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, _info: unknown) {
    vscode.postMessage({
      command: "reportError",
      message: error.message,
      stack: error.stack,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <StateDisplay id="error-state" icon="error" message="Something Went Wrong">
          <StateDescription>An unexpected error occurred in the graph view.</StateDescription>
          <StateActionButton onClick={() => this.setState({ error: null })}>
            <i class="codicon codicon-refresh"></i>
            Try Again
          </StateActionButton>
        </StateDisplay>
      );
    }
    return this.props.children;
  }
}
