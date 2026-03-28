export function abbreviateName(name: string, maxLength = 20): string {
  if (name.length <= maxLength) {
    return name;
  }
  const prefixLength = Math.ceil((maxLength - 3) / 2);
  const suffixLength = Math.floor((maxLength - 3) / 2);
  return name.substring(0, prefixLength) + "..." + name.substring(name.length - suffixLength);
}
