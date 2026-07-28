/**
 * Escapes invisible (ASCII control) characters in a name the same way the jj CLI
 * does, so that e.g. a newline renders as `\n` instead of vanishing.
 */
export function escapeInvisibleChars(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 0) {
      result += "\\0";
    } else if (code === 9) {
      result += "\\t";
    } else if (code === 10) {
      result += "\\n";
    } else if (code === 13) {
      result += "\\r";
    } else if (code <= 0x1f || code === 0x7f) {
      result += "\\x" + code.toString(16).padStart(2, "0");
    } else {
      result += char;
    }
  }
  return result;
}

export function abbreviateName(name: string, maxLength = 20): string {
  if (name.length <= maxLength) {
    return escapeInvisibleChars(name);
  }
  const prefixLength = Math.ceil((maxLength - 3) / 2);
  const suffixLength = Math.floor((maxLength - 3) / 2);
  return (
    escapeInvisibleChars(name.substring(0, prefixLength)) +
    "..." +
    escapeInvisibleChars(name.substring(name.length - suffixLength))
  );
}

export function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}
