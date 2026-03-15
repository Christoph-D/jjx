export interface TreeInfo {
  treeIds: [string, string, string];
  labels: [string, string, string];
}

const STRING_PATTERN = /"((?:[^"\\]|\\.)*)"/g;

export function parseTreeInfo(commitInfo: string): TreeInfo {
  const treeIds: [string, string, string] = ["", "", ""];
  const treeIdPattern = /TreeId\s*\(\s*"([a-f0-9]+)"/g;
  const matches = [...commitInfo.matchAll(treeIdPattern)];

  if (matches.length < 3) {
    throw new Error(
      `Could not parse tree IDs from commit info. Found ${matches.length} TreeIds, expected at least 3. The file may not have a 2-sided conflict.`,
    );
  }

  for (let i = 0; i < 3; i++) {
    treeIds[i] = matches[i][1];
  }

  const labels: [string, string, string] = ["left", "base", "right"];
  const labelsSectionMatch = commitInfo.match(/conflict_labels:\s*Conflicted\(\s*\[([\s\S]*?)\]/);

  if (labelsSectionMatch) {
    const labelsContent = labelsSectionMatch[1];
    STRING_PATTERN.lastIndex = 0;
    const labelValues = [...labelsContent.matchAll(STRING_PATTERN)];
    for (let i = 0; i < Math.min(3, labelValues.length); i++) {
      labels[i] = unescapeString(labelValues[i][1]);
    }
  }

  return { treeIds, labels };
}

function unescapeString(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}
