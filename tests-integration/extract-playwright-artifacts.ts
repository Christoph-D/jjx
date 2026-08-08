/**
 * Extract a human-readable test log from a Playwright HTML report.
 *
 * A Playwright HTML report (`index.html`) embeds the entire report as a base64
 * ZIP archive inside a `<template id="playwrightReportBase64">` element. The ZIP
 * contains a `report.json` (metadata, stats and the list of files) plus one
 * `{fileId}.json` shard per test file. This script decodes that blob, walks the
 * report and produces a plain-text log with three sections:
 *
 *   1. Header   - commit/CI metadata, worker count, duration and a pass/fail
 *                  summary.
 *   2. Test status - one line per test (pass / pass* / FAIL / FLAKY / skip)
 *                  grouped by file, in report order.
 *   3. Detailed logs - captured stdout and error messages for every result that
 *                  produced output or failed.
 *
 * The output is written verbatim (with ANSI escapes stripped) so it is suitable
 * for posting into a CI log or an issue.
 *
 * This is a TypeScript port of `ci-results/extract_log.py` exposed as a CLI.
 *
 * @example
 *   pnpm exec tsx tests-integration/extract-playwright-artifacts.ts \
 *       ci-results/index.html ci-results/test.log
 *
 * Usage:
 *   extract-playwright-artifacts.ts <report.html> <output.log>
 *
 *   <report.html>  Path to the Playwright HTML report (the file containing the
 *                  `<template id="playwrightReportBase64">` blob).
 *   <output.log>   Path the extracted test log is written to. Parent
 *                  directories are created automatically.
 *
 * Options:
 *   -h, --help     Show this help and exit.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";

/** Width of the section separator / banner lines, matching the original script. */
const BANNER_WIDTH = 78;

/** Data-URI prefix Playwright uses for the embedded report ZIP. */
const DATA_URI_PREFIX = "data:application/zip;base64,";

/** Matches ANSI CSI escape sequences (e.g. terminal colours) for stripping. */
// eslint-disable-next-line no-control-regex -- matching the ESC control byte is intentional
const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]/g;

// --- Playwright report JSON types ------------------------------------------------

/** `metadata.gitCommit` from `report.json`. */
interface ReportGitCommit {
  subject?: string;
  hash?: string;
  shortHash?: string;
  branch?: string;
  author?: { name?: string };
}

/** `metadata.ci` from `report.json`. */
interface ReportCi {
  buildHref?: string;
  commitHref?: string;
}

/** `metadata` from `report.json`. */
interface ReportMetadata {
  gitCommit?: ReportGitCommit;
  ci?: ReportCi;
  actualWorkers?: number;
}

/** Aggregate pass/fail counts from `report.json`. */
interface ReportStats {
  total?: number;
  expected?: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
}

interface ReportLocation {
  file?: string;
  line?: number;
  column?: number;
}

interface ReportAttachment {
  name: string;
  contentType?: string;
  /** Inline attachment body (text). Absent when the attachment is a file ref. */
  body?: string;
  path?: string;
}

interface ReportError {
  message?: string;
}

/** A single execution attempt of a test (one per retry). */
interface ReportResult {
  status?: string;
  retry?: number;
  duration?: number;
  errors?: ReportError[];
  attachments?: ReportAttachment[];
}

interface ReportTest {
  title: string;
  outcome?: string;
  duration?: number;
  location?: ReportLocation;
  results?: ReportResult[];
}

/** A file entry. Playwright shards each file into its own `{fileId}.json`. */
interface ReportFile {
  fileId: string;
  fileName?: string;
  /** Present when the report embeds tests directly in `report.json`. */
  tests?: ReportTest[];
}

/** Top-level shape of `report.json` inside the HTML report ZIP. */
interface Report {
  metadata?: ReportMetadata;
  startTime?: number | string;
  duration?: number;
  stats?: ReportStats;
  files?: ReportFile[];
}

// --- Formatting helpers ----------------------------------------------------------

/** Remove ANSI CSI escape sequences from `text`. */
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, "");
}

/**
 * Format a duration given in milliseconds: `< 60s` as `12.3s`, otherwise
 * `2m5s`. Returns `"-"` when the duration is missing.
 */
function formatDuration(ms?: number | null): string {
  if (ms === null || ms === undefined) {
    return "-";
  }
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const wholeSeconds = Math.trunc(totalSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}m${seconds}s`;
}

/** Strip trailing whitespace. */
function rstrip(text: string): string {
  return text.replace(/\s+$/, "");
}

// --- Spawn log de-noising --------------------------------------------------------

/** Value substituted for an environment variable that repeats a prior spawn. */
const ENV_UNCHANGED = "<unchanged>";

/** Env values this length or shorter are always shown in full, never abbreviated. */
const ENV_ABBREVIATE_MIN_LENGTH = 20;

/** Matches the fixed prefix of a spawn trace line: `<timestamp> [trace] spawn: `. */
const SPAWN_LINE_PREFIX = /^(.*\[trace\] spawn: )/;

/**
 * Return the index just past the JSON object or array starting at `text[start]`,
 * correctly tracking nesting, string literals and backslash escapes. Returns -1
 * when the value is not a balanced object/array or cannot be scanned.
 */
function scanBalancedValue(text: string, start: number): number {
  let i = start;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) {
    i++;
  }
  if (i >= text.length) {
    return -1;
  }
  const opener = text[i];
  if (opener !== "{" && opener !== "[") {
    return -1;
  }
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
    } else if (c === '"') {
      inString = true;
    } else if (c === opener) {
      depth++;
    } else if (c === closer) {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return -1;
}

/** Shape of the spawn-options JSON parsed out of a spawn trace line. */
interface ParsedSpawnOptions {
  spawnOptions?: { env?: Record<string, unknown> | string };
}

/**
 * Canonical, order-independent serialization of an env object, used to detect
 * when a spawn repeats the exact same environment as the previous one.
 */
function serializeEnv(env: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Rewrites spawn trace lines so repeated environment-variable values read
 * `<unchanged>` instead of being printed in full on every call.
 *
 * Spawn logs embed the entire `env` object on every invocation; on Windows the
 * PATH alone runs to thousands of characters and is identical across nearly
 * every spawn. This collapses those repeats at two levels: when the whole `env`
 * tuple matches the previous spawn it is replaced wholesale by a single
 * `<unchanged>`, and otherwise each long value that repeats a prior spawn is
 * collapsed individually while still being shown in full the first time it
 * appears and whenever it subsequently changes.
 */
class SpawnEnvAbbreviator {
  /** Last value observed for each environment variable. */
  private readonly lastValue = new Map<string, string>();
  /** Serialized form of the previous spawn's entire env object. */
  private lastEnv: string | undefined;

  /**
   * Return the value to display for one env entry: short values, and long values
   * the first time they are seen (or when they change), in full; otherwise
   * `<unchanged>` when a long value repeats the prior spawn.
   */
  private abbreviate(key: string, value: string): string {
    if (value.length <= ENV_ABBREVIATE_MIN_LENGTH) {
      return value;
    }
    if (this.lastValue.get(key) === value) {
      return ENV_UNCHANGED;
    }
    this.lastValue.set(key, value);
    return value;
  }

  /**
   * Collapse repeated env values in a single log line. Non-spawn lines, and
   * spawn lines whose JSON cannot be parsed or lacks an env object, are
   * returned unchanged. When the entire env matches the previous spawn it is
   * replaced by a single `<unchanged>`.
   */
  abbreviateLine(line: string): string {
    const match = SPAWN_LINE_PREFIX.exec(line);
    if (!match) {
      return line;
    }
    const prefix = match[1];
    const rest = line.slice(prefix.length);

    const argsEnd = scanBalancedValue(rest, 0);
    if (argsEnd === -1) {
      return line;
    }

    let sep = argsEnd;
    while (sep < rest.length && (rest[sep] === " " || rest[sep] === "\t")) {
      sep++;
    }
    const optionsJson = rest.slice(sep);

    let options: ParsedSpawnOptions;
    try {
      options = JSON.parse(optionsJson) as ParsedSpawnOptions;
    } catch {
      return line;
    }

    const spawnOptions = options?.spawnOptions;
    const env = spawnOptions?.env;
    if (!spawnOptions || !env || typeof env !== "object") {
      return line;
    }

    const serialized = serializeEnv(env);
    if (this.lastEnv !== undefined && this.lastEnv === serialized) {
      spawnOptions.env = ENV_UNCHANGED;
      return `${prefix}${rest.slice(0, argsEnd)} ${JSON.stringify(options)}`;
    }
    this.lastEnv = serialized;

    for (const [key, raw] of Object.entries(env)) {
      env[key] = this.abbreviate(key, typeof raw === "string" ? raw : JSON.stringify(raw));
    }

    return `${prefix}${rest.slice(0, argsEnd)} ${JSON.stringify(options)}`;
  }
}

// --- Report extraction -----------------------------------------------------------

/** Signature constants for the parts of the ZIP format we read. */
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATE = 8;
/** Fixed size of the end-of-central-directory record (without the comment). */
const ZIP_EOCD_SIZE = 22;
/** Maximum length of an archive comment, which bounds the EOCD search window. */
const ZIP_MAX_COMMENT = 0xffff;
/** Fixed size of a central-directory file header (before the variable fields). */
const ZIP_CD_HEADER_SIZE = 46;
/** Fixed size of a local file header (before the variable fields). */
const ZIP_LOCAL_HEADER_SIZE = 30;

/**
 * Read every entry out of a ZIP archive buffer into a map keyed by entry name.
 *
 * This is a minimal, dependency-free reader that walks the central directory
 * (which always carries the correct sizes and offsets) and supports both the
 * `stored` (0) and `deflate` (8) compression methods Playwright produces. ZIP64
 * archives are not supported, but Playwright reports are far smaller than the
 * 4 GiB 32-bit limit.
 */
function readZipEntries(blob: Buffer): Map<string, Buffer> {
  if (blob.length < ZIP_EOCD_SIZE) {
    throw new Error("extract-playwright-artifacts: archive is too small to be a zip");
  }

  // The end-of-central-directory record sits at the end of the file, optionally
  // followed by a variable-length comment. Scan backwards for its signature.
  const searchStart = Math.max(0, blob.length - (ZIP_EOCD_SIZE + ZIP_MAX_COMMENT));
  let eocdOffset = -1;
  for (let i = blob.length - ZIP_EOCD_SIZE; i >= searchStart; i--) {
    if (blob.readUInt32LE(i) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("extract-playwright-artifacts: no end-of-central-directory record found");
  }

  const entries = new Map<string, Buffer>();
  // Offset of the first central-directory file header.
  let cursor = blob.readUInt32LE(eocdOffset + 16);

  while (cursor + ZIP_CD_HEADER_SIZE <= blob.length) {
    if (blob.readUInt32LE(cursor) !== ZIP_CENTRAL_DIR_SIGNATURE) {
      break;
    }

    const method = blob.readUInt16LE(cursor + 10);
    const compressedSize = blob.readUInt32LE(cursor + 20);
    const uncompressedSize = blob.readUInt32LE(cursor + 24);
    const fileNameLength = blob.readUInt16LE(cursor + 28);
    const extraFieldLength = blob.readUInt16LE(cursor + 30);
    const fileCommentLength = blob.readUInt16LE(cursor + 32);
    const localHeaderOffset = blob.readUInt32LE(cursor + 42);

    const nameOffset = cursor + ZIP_CD_HEADER_SIZE;
    const name = blob.subarray(nameOffset, nameOffset + fileNameLength).toString("utf8");

    // Skip directory entries (names ending in `/`).
    if (!name.endsWith("/")) {
      entries.set(name, decompressEntry(blob, localHeaderOffset, method, compressedSize, uncompressedSize, name));
    }

    // Advance to the next central-directory entry.
    cursor += ZIP_CD_HEADER_SIZE + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

/** Decompress a single entry given its local file header offset. */
function decompressEntry(
  blob: Buffer,
  localHeaderOffset: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
  name: string,
): Buffer {
  if (blob.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`extract-playwright-artifacts: local header missing for "${name}"`);
  }

  // The local header's own filename/extra lengths can differ from the central
  // directory copy, so read them here to locate the payload precisely.
  const localFileNameLength = blob.readUInt16LE(localHeaderOffset + 26);
  const localExtraFieldLength = blob.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + ZIP_LOCAL_HEADER_SIZE + localFileNameLength + localExtraFieldLength;
  const compressed = blob.subarray(dataStart, dataStart + compressedSize);

  let content: Buffer;
  if (method === ZIP_METHOD_STORED) {
    content = Buffer.from(compressed);
  } else if (method === ZIP_METHOD_DEFLATE) {
    content = zlib.inflateRawSync(compressed);
  } else {
    throw new Error(`extract-playwright-artifacts: unsupported compression method ${method} for "${name}"`);
  }

  if (content.length !== uncompressedSize) {
    throw new Error(`extract-playwright-artifacts: size mismatch for "${name}"`);
  }
  return content;
}

/** Pull the base64 ZIP payload out of the Playwright HTML report. */
function extractReportZip(html: string): Buffer {
  const match = /<template id="playwrightReportBase64">([\s\S]*?)<\/template>/.exec(html);
  if (!match) {
    throw new Error(
      'extract-playwright-artifacts: <template id="playwrightReportBase64"> not found; ' +
        "is this a Playwright HTML report?",
    );
  }
  const dataUri = match[1].trim();
  if (!dataUri.startsWith(DATA_URI_PREFIX)) {
    throw new Error(`extract-playwright-artifacts: expected a "${DATA_URI_PREFIX}" data URI inside the template`);
  }
  return Buffer.from(dataUri.slice(DATA_URI_PREFIX.length), "base64");
}

/** Return a test file's full record, preferring its shard and falling back to the embedded copy. */
function readFileReport(entries: Map<string, Buffer>, fileRef: ReportFile): ReportFile {
  const shard = entries.get(`${fileRef.fileId}.json`);
  if (shard) {
    return JSON.parse(shard.toString("utf8")) as ReportFile;
  }
  return fileRef;
}

/**
 * Collapse a test's outcome into a fixed-width status label, mirroring the
 * original script: `pass` for cleanly expected tests, `pass*` when an expected
 * test still recorded a non-passing attempt, plus `FAIL`, `FLAKY` and `skip`.
 */
function statusMark(test: ReportTest): string {
  switch (test.outcome) {
    case "expected": {
      const allPassed = (test.results ?? []).every((r) => r.status === "passed");
      return allPassed ? "pass" : "pass*";
    }
    case "unexpected":
      return "FAIL";
    case "flaky":
      return "FLAKY";
    case "skipped":
      return "skip";
    default:
      return test.outcome ?? "?";
  }
}

/** Build the full text log from a Playwright HTML report string. */
export function extractPlaywrightLog(html: string): string {
  const entries = readZipEntries(extractReportZip(html));

  const reportBuf = entries.get("report.json");
  if (!reportBuf) {
    throw new Error("extract-playwright-artifacts: report.json missing from report archive");
  }
  const report = JSON.parse(reportBuf.toString("utf8")) as Report;

  const metadata = report.metadata ?? {};
  const git = metadata.gitCommit ?? {};
  const ci = metadata.ci ?? {};
  const stats = report.stats ?? {};
  const lines: string[] = [];
  const spawnEnv = new SpawnEnvAbbreviator();

  // --- Header --------------------------------------------------------------------
  lines.push("=".repeat(BANNER_WIDTH));
  lines.push("PLAYWRIGHT TEST LOG");
  lines.push("=".repeat(BANNER_WIDTH));
  lines.push(`Repo / branch : ${git.subject ?? ""}`);
  lines.push(`Commit        : ${git.hash ?? ""} (${git.shortHash ?? ""})`);
  if (git.author) {
    lines.push(`Author        : ${git.author.name ?? ""}`);
  }
  lines.push(`Branch        : ${git.branch ?? ""}`);
  if (metadata.ci) {
    lines.push(`Build         : ${ci.buildHref ?? ""}`);
    lines.push(`Commit URL    : ${ci.commitHref ?? ""}`);
  }
  lines.push(`Workers       : ${metadata.actualWorkers ?? ""}`);
  lines.push(`Duration      : ${formatDuration(report.duration)} (started ${report.startTime ?? ""})`);
  lines.push("");
  lines.push(
    "Summary       : " +
      `${stats.total ?? 0} total | ${stats.expected ?? 0} passed | ` +
      `${stats.unexpected ?? 0} failed | ${stats.flaky ?? 0} flaky | ` +
      `${stats.skipped ?? 0} skipped`,
  );
  lines.push("");

  // --- Test status (grouped by file, in report order) ----------------------------
  lines.push("-".repeat(BANNER_WIDTH));
  lines.push("TEST STATUS");
  lines.push("-".repeat(BANNER_WIDTH));
  for (const fileRef of report.files ?? []) {
    const fileData = readFileReport(entries, fileRef);
    const fileName = fileData.fileName ?? fileRef.fileName ?? fileRef.fileId;
    lines.push("");
    lines.push(`  ${fileName}`);
    for (const test of fileData.tests ?? []) {
      const location = test.location ?? {};
      lines.push(
        `    [${statusMark(test).padEnd(5)}] ${test.title}  ` +
          `(${formatDuration(test.duration)}, ${location.file ?? ""}:${location.line ?? ""})`,
      );
    }
  }

  // --- Detailed logs for any result with output or a failure ---------------------
  lines.push("");
  lines.push("=".repeat(BANNER_WIDTH));
  lines.push("DETAILED LOGS (captured stdout / errors for non-clean results)");
  lines.push("=".repeat(BANNER_WIDTH));
  for (const fileRef of report.files ?? []) {
    const fileData = readFileReport(entries, fileRef);
    const fileName = fileData.fileName ?? fileRef.fileName ?? fileRef.fileId;
    for (const test of fileData.tests ?? []) {
      for (const result of test.results ?? []) {
        const status = result.status;
        const stdout =
          (result.attachments ?? [])
            .filter((a) => a.name === "stdout" && a.body !== undefined)
            .map((a) => a.body ?? "")
            .pop() ?? "";
        const errors = result.errors ?? [];

        // Skip clean results that captured nothing.
        if ((status === "passed" || status === "skipped") && stdout === "" && errors.length === 0) {
          continue;
        }

        lines.push("");
        lines.push("-".repeat(BANNER_WIDTH));
        lines.push(`${fileName} > ${test.title}  (attempt ${result.retry ?? 0}, status: ${status ?? ""})`);
        lines.push("-".repeat(BANNER_WIDTH));

        for (const error of errors) {
          const message = rstrip(stripAnsi(error.message ?? ""));
          if (message) {
            lines.push("");
            lines.push("[error]");
            lines.push(message);
          }
        }
        if (stdout) {
          lines.push("");
          lines.push("[stdout]");
          const body = stripAnsi(stdout)
            .split(/\r?\n/)
            .map((line) => spawnEnv.abbreviateLine(line))
            .join("\n");
          lines.push(rstrip(body));
        }
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

// --- CLI entry point -------------------------------------------------------------

/** Usage text shown for `--help` and invalid invocations. */
const USAGE = [
  "Usage: tsx tests-integration/extract-playwright-artifacts.ts <report.html> <output.log>",
  "",
  "Extract a human-readable test log from a Playwright HTML report.",
  "",
  "Arguments:",
  "  <report.html>  Path to the Playwright HTML report (the file containing the",
  '                 <template id="playwrightReportBase64"> blob).',
  "  <output.log>   Path the extracted test log is written to. Parent directories",
  "                 are created automatically.",
  "",
  "Options:",
  "  -h, --help     Show this help and exit.",
].join("\n");

function main(): void {
  const args = process.argv.slice(2);
  if (args.some((a) => a === "-h" || a === "--help")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const [inputPath, outputPath] = args;
  if (!inputPath || !outputPath) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const html = fs.readFileSync(inputPath, "utf8");
    const log = extractPlaywrightLog(html);
    const directory = path.dirname(outputPath);
    if (directory) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(outputPath, log, "utf8");
    process.stdout.write(`Wrote ${log.length} chars to ${outputPath}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`extract-playwright-artifacts: ${message}\n`);
    process.exitCode = 1;
  }
}

main();
