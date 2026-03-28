import { Component, type ComponentChildren } from "preact";
import { vscode } from "../signals";

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
        <div id="error-state" class="stale-state" style="display: flex">
          <div class="stale-state-icon">
            <i class="codicon codicon-error"></i>
          </div>
          <div class="stale-state-message">Something Went Wrong</div>
          <div class="stale-state-description">An unexpected error occurred in the graph view.</div>
          <button class="update-stale-button" onClick={() => this.setState({ error: null })}>
            <i class="codicon codicon-refresh"></i>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
