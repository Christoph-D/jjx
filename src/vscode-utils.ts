import { Event, Disposable, window, TabInputTextDiff } from "vscode";

export function showErrorMessage(message: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  window.showErrorMessage(errorMessage ? `${message}: ${errorMessage}` : message);
}

export function toDisposable(dispose: () => void): Disposable {
  return { dispose };
}

export const EmptyDisposable = toDisposable(() => {});

export function filterEvent<T>(event: Event<T>, filter: (e: T) => boolean): Event<T> {
  return (
    listener: (e: T) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
    thisArgs?: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    disposables?: Disposable[],
  ) => event((e) => filter(e) && listener.call(thisArgs, e), null, disposables); // eslint-disable-line @typescript-eslint/no-unsafe-return
}

export function anyEvent<T>(...events: Event<T>[]): Event<T> {
  return (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => {
    const subscriptions = events.map((event) => event((i) => listener.call(thisArgs, i)));
    const result: Disposable = { dispose: () => subscriptions.forEach((d) => void d.dispose()) };

    disposables?.push(result);

    return result;
  };
}

export function eventToPromise<T>(event: Event<T>): Promise<T> {
  return new Promise<T>((c) => {
    const d = event((e) => {
      d.dispose();
      c(e);
    });
  });
}

export function getActiveTextEditorDiff(): TabInputTextDiff | undefined {
  const activeTextEditor = window.activeTextEditor;
  if (!activeTextEditor) {
    return undefined;
  }

  const activeTab = window.tabGroups.activeTabGroup.activeTab;
  if (!activeTab) {
    return undefined;
  }

  // detecting a diff editor: https://github.com/microsoft/vscode/issues/15513
  const isDiff =
    activeTab.input instanceof TabInputTextDiff &&
    (activeTab.input.modified?.toString() === activeTextEditor.document.uri.toString() ||
      activeTab.input.original?.toString() === activeTextEditor.document.uri.toString());

  if (!isDiff) {
    return undefined;
  }

  return activeTab.input;
}
