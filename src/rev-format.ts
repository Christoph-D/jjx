export function formatChangeIdShort(changeId: string, changeOffset: string | null): string {
  const prefix = changeId.substring(0, 8);
  return changeOffset ? `${prefix}/${changeOffset}` : prefix;
}

export function formatComparisonRev(
  changeId: string,
  changeOffset: string | null,
  isWorkingCopy: boolean,
  workingCopyLabel = "@",
): string {
  return isWorkingCopy ? workingCopyLabel : formatChangeIdShort(changeId, changeOffset);
}
