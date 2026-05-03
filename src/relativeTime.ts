const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function parseAsUTCDate(date: Date | string): Date {
  if (date instanceof Date) {
    return date;
  }
  return new Date(date);
}

export function relativeTime(date: Date | string): string {
  const now = Date.now();
  const then = parseAsUTCDate(date).getTime();
  const diffMs = now - then;
  const absDiffSec = Math.abs(diffMs) / 1000;

  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;

  if (absDiffSec < 60) {
    value = Math.round(absDiffSec);
    unit = "second";
  } else if (absDiffSec < 3600) {
    value = Math.round(absDiffSec / 60);
    unit = "minute";
  } else if (absDiffSec < 86400) {
    value = Math.round(absDiffSec / 3600);
    unit = "hour";
  } else if (absDiffSec < 2592000) {
    value = Math.round(absDiffSec / 86400);
    unit = "day";
  } else if (absDiffSec < 31536000) {
    value = Math.round(absDiffSec / 2592000);
    unit = "month";
  } else {
    value = Math.round(absDiffSec / 31536000);
    unit = "year";
  }

  return relativeTimeFormatter.format(diffMs < 0 ? value : -value, unit);
}
