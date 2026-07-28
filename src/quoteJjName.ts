/**
 * Wraps a tag/bookmark name in a jj string literal so it can be passed safely to jj commands
 * that parse names as revset/name-pattern symbols. Without this, names containing special
 * characters (e.g. a leading `#`) are misinterpreted by jj's argument parser.
 */
export function quoteJjName(name: string): string {
  const escaped = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}"`;
}
