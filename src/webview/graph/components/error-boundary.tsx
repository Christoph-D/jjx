import { Component, type ComponentChildren } from "preact";
import { vscode } from "../signals";
import styles from "./stale-state.module.css";

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
        <div id="error-state" class={styles.staleState} style="display: flex">
          <div class={styles.staleStateIcon}>
            <i class="codicon codicon-error"></i>
          </div>
          <div class={styles.staleStateMessage}>Something Went Wrong</div>
          <div class={styles.staleStateDescription}>An unexpected error occurred in the graph view.</div>
          <button class={styles.actionButton} onClick={() => this.setState({ error: null })}>
            <i class="codicon codicon-refresh"></i>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
