import * as vscode from "vscode";
import { diffArrays } from "diff";

export interface LineChange {
  readonly originalStartLineNumber: number;
  readonly originalEndLineNumber: number;
  readonly modifiedStartLineNumber: number;
  readonly modifiedEndLineNumber: number;
}

export function computeLineChanges(originalLines: string[], modifiedLines: string[]): LineChange[] {
  const changes = diffArrays(originalLines, modifiedLines);
  const result: LineChange[] = [];

  let originalLine = 1;
  let modifiedLine = 1;

  let i = 0;
  while (i < changes.length) {
    const change = changes[i];
    const count = change.value.length;

    if (!change.added && !change.removed) {
      originalLine += count;
      modifiedLine += count;
      i++;
    } else if (change.removed) {
      const next = changes[i + 1];
      const origStart = originalLine;
      const origEnd = originalLine + count - 1;
      originalLine += count;

      if (next && next.added) {
        const addedCount = next.value.length;
        result.push({
          originalStartLineNumber: origStart,
          originalEndLineNumber: origEnd,
          modifiedStartLineNumber: modifiedLine,
          modifiedEndLineNumber: modifiedLine + addedCount - 1,
        });
        modifiedLine += addedCount;
        i += 2;
      } else {
        result.push({
          originalStartLineNumber: origStart,
          originalEndLineNumber: origEnd,
          modifiedStartLineNumber: modifiedLine - 1,
          modifiedEndLineNumber: 0,
        });
        i++;
      }
    } else {
      result.push({
        originalStartLineNumber: originalLine - 1,
        originalEndLineNumber: 0,
        modifiedStartLineNumber: modifiedLine,
        modifiedEndLineNumber: modifiedLine + count - 1,
      });
      modifiedLine += count;
      i++;
    }
  }

  return result;
}

export function toLineRanges(
  selections: readonly vscode.Selection[],
  textDocument: vscode.TextDocument,
): vscode.Range[] {
  const lineRanges = selections.map((s) => {
    const startLine = textDocument.lineAt(s.start.line);
    const endLine = textDocument.lineAt(s.end.line);
    return new vscode.Range(startLine.range.start, endLine.range.end);
  });

  lineRanges.sort((a, b) => a.start.line - b.start.line);

  const result = lineRanges.reduce((result, l) => {
    if (result.length === 0) {
      result.push(l);
      return result;
    }

    const [last, ...rest] = result;
    const intersection = l.intersection(last);

    if (intersection) {
      return [intersection, ...rest];
    }

    if (l.start.line === last.end.line + 1) {
      const merge = new vscode.Range(last.start, l.end);
      return [merge, ...rest];
    }

    return [l, ...result];
  }, [] as vscode.Range[]);

  result.reverse();

  return result;
}

export function intersectDiffWithRange(
  textDocument: vscode.TextDocument,
  diff: LineChange,
  range: vscode.Range,
): LineChange | null {
  const modifiedRange = getModifiedRange(textDocument, diff);
  const intersection = range.intersection(modifiedRange);

  if (!intersection) {
    return null;
  }

  if (diff.modifiedEndLineNumber === 0) {
    return diff;
  } else {
    const modifiedStartLineNumber = intersection.start.line + 1;
    const modifiedEndLineNumber = intersection.end.line + 1;

    if (
      diff.originalEndLineNumber - diff.originalStartLineNumber ===
      diff.modifiedEndLineNumber - diff.modifiedStartLineNumber
    ) {
      const delta = modifiedStartLineNumber - diff.modifiedStartLineNumber;
      const length = modifiedEndLineNumber - modifiedStartLineNumber;

      return {
        originalStartLineNumber: diff.originalStartLineNumber + delta,
        originalEndLineNumber: diff.originalStartLineNumber + delta + length,
        modifiedStartLineNumber,
        modifiedEndLineNumber,
      };
    } else {
      return {
        originalStartLineNumber: diff.originalStartLineNumber,
        originalEndLineNumber: diff.originalEndLineNumber,
        modifiedStartLineNumber,
        modifiedEndLineNumber,
      };
    }
  }
}

export function getModifiedRange(textDocument: vscode.TextDocument, diff: LineChange): vscode.Range {
  if (diff.modifiedEndLineNumber === 0) {
    if (diff.modifiedStartLineNumber === 0) {
      return new vscode.Range(
        textDocument.lineAt(diff.modifiedStartLineNumber).range.end,
        textDocument.lineAt(diff.modifiedStartLineNumber).range.start,
      );
    } else if (textDocument.lineCount === diff.modifiedStartLineNumber) {
      return new vscode.Range(
        textDocument.lineAt(diff.modifiedStartLineNumber - 1).range.end,
        textDocument.lineAt(diff.modifiedStartLineNumber - 1).range.end,
      );
    } else {
      return new vscode.Range(
        textDocument.lineAt(diff.modifiedStartLineNumber - 1).range.end,
        textDocument.lineAt(diff.modifiedStartLineNumber).range.start,
      );
    }
  } else {
    return new vscode.Range(
      textDocument.lineAt(diff.modifiedStartLineNumber - 1).range.start,
      textDocument.lineAt(diff.modifiedEndLineNumber - 1).range.end,
    );
  }
}

export function applyLineChanges(
  original: vscode.TextDocument,
  modified: vscode.TextDocument,
  diffs: LineChange[],
): string {
  const result: string[] = [];
  let currentLine = 0;

  for (const diff of diffs) {
    const isInsertion = diff.originalEndLineNumber === 0;
    const isDeletion = diff.modifiedEndLineNumber === 0;

    let endLine = isInsertion ? diff.originalStartLineNumber : diff.originalStartLineNumber - 1;
    let endCharacter = 0;

    if (isDeletion && diff.originalEndLineNumber === original.lineCount) {
      endLine -= 1;
      endCharacter = original.lineAt(endLine).range.end.character;
    }

    result.push(original.getText(new vscode.Range(currentLine, 0, endLine, endCharacter)));

    if (!isDeletion) {
      let fromLine = diff.modifiedStartLineNumber - 1;
      let fromCharacter = 0;

      if (isInsertion && diff.originalStartLineNumber === original.lineCount) {
        fromLine -= 1;
        fromCharacter = modified.lineAt(fromLine).range.end.character;
      }

      result.push(modified.getText(new vscode.Range(fromLine, fromCharacter, diff.modifiedEndLineNumber, 0)));
    }

    currentLine = isInsertion ? diff.originalStartLineNumber : diff.originalEndLineNumber;
  }

  result.push(original.getText(new vscode.Range(currentLine, 0, original.lineCount, 0)));

  return result.join("");
}
