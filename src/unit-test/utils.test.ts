/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeFileText,
  filepathToFileset,
  filepathToRootFileset,
  formatAtRevTitle,
  formatChangeIdShort,
  formatChangeIdShortStandalone,
  formatChangeIdShortWithUnknownOffset,
  formatDiffTitle,
  formatWorkingCopyLabel,
  formatWorkingCopyTitle,
  remapPathSpelling,
  shouldOpenWorkingCopyRightSide,
} from "../utils";
import type { FullChangeId } from "../types";

describe("filepathToFileset Test Suite", () => {
  it("wraps a plain path in an exact-file fileset", () => {
    assert.equal(filepathToFileset("example"), 'file:"example"');
  });

  it("escapes backslashes and double quotes", () => {
    assert.equal(filepathToFileset('a"b\\c'), 'file:"a\\"b\\\\c"');
  });
});

describe("filepathToRootFileset Test Suite", () => {
  it("wraps a plain path in a path-prefix fileset that recurses into directories", () => {
    assert.equal(filepathToRootFileset("example"), 'root:"example"');
  });

  it("escapes backslashes and double quotes", () => {
    assert.equal(filepathToRootFileset('a"b\\c'), 'root:"a\\"b\\\\c"');
  });
});

describe("remapPathSpelling Test Suite", () => {
  it("re-spells a path under a mapped prefix", () => {
    const mappings = [{ from: "/var/folders/ab/repo", to: "/private/var/folders/ab/repo" }];
    assert.equal(
      remapPathSpelling("/var/folders/ab/repo/sub/file.txt", mappings),
      "/private/var/folders/ab/repo/sub/file.txt",
    );
  });

  it("maps a path that is the prefix itself", () => {
    const mappings = [{ from: "/var/folders/ab/repo", to: "/private/var/folders/ab/repo" }];
    assert.equal(remapPathSpelling("/var/folders/ab/repo", mappings), "/private/var/folders/ab/repo");
  });

  it("returns undefined for paths outside all mapped prefixes", () => {
    const mappings = [{ from: "/var/folders/ab/repo", to: "/private/var/folders/ab/repo" }];
    assert.equal(remapPathSpelling("/var/folders/ab/other/file.txt", mappings), undefined);
    assert.equal(remapPathSpelling("/home/user/repo/file.txt", mappings), undefined);
  });

  it("prefers the most specific mapping", () => {
    const mappings = [
      { from: "/ws", to: "/real/ws" },
      { from: "/ws/repo", to: "/real/ws/repo" },
    ];
    assert.equal(remapPathSpelling("/ws/repo/file.txt", mappings), "/real/ws/repo/file.txt");
  });

  it("skips mappings whose from side only matches case-insensitively", () => {
    const mappings = [{ from: "/Users/John/repo", to: "/Users/john/repo" }];
    if (process.platform === "win32") {
      // path.win32.relative is case-insensitive, so the mapping applies.
      assert.equal(remapPathSpelling("/Users/john/repo/file.txt", mappings), "/Users/john/repo/file.txt");
    } else {
      assert.equal(remapPathSpelling("/Users/john/repo/file.txt", mappings), undefined);
    }
  });

  it("returns undefined when no mappings exist", () => {
    assert.equal(remapPathSpelling("/any/file.txt", []), undefined);
  });
});

describe("formatDiffTitle Test Suite", () => {
  it("formats a diff title with only a target rev", () => {
    assert.equal(formatDiffTitle(undefined, "new.ts", undefined, "Working Copy"), "new.ts (Parent → Working Copy)");
  });

  it("formats a diff title between two revs", () => {
    assert.equal(formatDiffTitle(undefined, "new.ts", "rev-a", "rev-b"), "new.ts (rev-a → rev-b)");
  });

  it("prefixes the rename source basename when the file was renamed", () => {
    assert.equal(formatDiffTitle("src/foo/old.ts", "new.ts", "rev-a", "rev-b"), "old.ts → new.ts (rev-a → rev-b)");
  });

  it("keeps a top-level rename source as-is", () => {
    assert.equal(formatDiffTitle("old.ts", "new.ts", undefined, "xy1234"), "old.ts → new.ts (Parent → xy1234)");
  });

  it("supports a custom label such as Interdiff", () => {
    assert.equal(
      formatDiffTitle(undefined, "new.ts", "rev-a", "rev-b", "interdiff"),
      "new.ts (Interdiff rev-a → rev-b)",
    );
  });

  it("formats a commit-parent to working-copy diff title", () => {
    assert.equal(formatDiffTitle(undefined, "new.ts", "xy1234 Parent", "@"), "new.ts (xy1234 Parent → @)");
  });
});

describe("shouldOpenWorkingCopyRightSide Test Suite", () => {
  it("opens the editable working-copy right side for a file unchanged in the working copy", () => {
    assert.equal(shouldOpenWorkingCopyRightSide("xy1234" as FullChangeId, "M", true), true);
  });

  it("opens the editable working-copy right side for an added file unchanged in the working copy", () => {
    assert.equal(shouldOpenWorkingCopyRightSide("xy1234" as FullChangeId, "A", true), true);
  });

  it("keeps the read-only revision right side when the working copy changes the file", () => {
    assert.equal(shouldOpenWorkingCopyRightSide("xy1234" as FullChangeId, "M", false), false);
  });

  it("keeps the read-only revision right side for deleted files", () => {
    assert.equal(shouldOpenWorkingCopyRightSide("xy1234" as FullChangeId, "D", true), false);
  });

  it("keeps the existing behavior when the clicked commit is the working copy", () => {
    assert.equal(shouldOpenWorkingCopyRightSide("@", "M", true), false);
  });

  it("opens the editable working-copy right side for an unknown file status", () => {
    assert.equal(shouldOpenWorkingCopyRightSide("xy1234" as FullChangeId, undefined, true), true);
  });
});

describe("formatAtRevTitle Test Suite", () => {
  it("formats an at-revision file title", () => {
    assert.equal(formatAtRevTitle("atrev.ts", "rev-a"), "atrev.ts (rev-a)");
  });
});

describe("Rev Label Test Suite", () => {
  it("formats the working copy label", () => {
    assert.equal(formatWorkingCopyLabel(), "Working Copy");
  });

  it("formats the working copy title", () => {
    assert.equal(formatWorkingCopyTitle(), "@");
  });

  it("formats a change ID label", () => {
    assert.equal(
      formatChangeIdShort({
        changeId: "xy1234" as FullChangeId,
        changeIdPrefix: "xy",
        changeIdSuffix: "1234",
        changeOffset: null,
      }),
      "xy1234",
    );
  });

  it("formats a change ID label with a real offset", () => {
    assert.equal(
      formatChangeIdShort({
        changeId: "xy1234/2" as FullChangeId,
        changeIdPrefix: "xy",
        changeIdSuffix: "1234",
        changeOffset: "2",
      }),
      "xy1234/2",
    );
  });

  it("formats a change ID label with an unknown offset", () => {
    assert.equal(
      formatChangeIdShortWithUnknownOffset({
        changeId: "xy1234/2" as FullChangeId,
        changeIdPrefix: "xy",
        changeIdSuffix: "1234",
        changeOffset: "2",
      }),
      "xy1234/?",
    );
  });

  it("prints an unknown offset even when the matched change has none", () => {
    assert.equal(
      formatChangeIdShortWithUnknownOffset({
        changeId: "xy1234" as FullChangeId,
        changeIdPrefix: "xy",
        changeIdSuffix: "1234",
        changeOffset: null,
      }),
      "xy1234/?",
    );
  });

  it("ignores a graph-padded suffix and renders at the per-change width", () => {
    // The graph pads suffixes to its global prefix width (here 6), which would render
    // "xy1234" even though a standalone lookup of this change only needs "xy".
    assert.equal(
      formatChangeIdShortStandalone({
        changeId: "xy1234567890" as FullChangeId,
        changeIdPrefix: "xy",
        changeIdSuffix: "1234",
        changeOffset: null,
      }),
      "xy12",
    );
  });

  it("keeps a suffix that is shorter than the minimum width", () => {
    assert.equal(
      formatChangeIdShortStandalone({
        changeId: "xy1234567890" as FullChangeId,
        changeIdPrefix: "xy123456",
        changeIdSuffix: "",
        changeOffset: null,
      }),
      "xy123456",
    );
  });

  it("keeps the offset of a divergent change and ignores it when deriving affixes", () => {
    assert.equal(
      formatChangeIdShortStandalone({
        changeId: "xy1234567890/2" as FullChangeId,
        changeIdPrefix: "xy",
        changeIdSuffix: "1234",
        changeOffset: "2",
      }),
      "xy12/2",
    );
  });
});

describe("decodeFileText Test Suite", () => {
  it("decodes UTF-8 text including multibyte characters", () => {
    assert.equal(decodeFileText(Buffer.from("héllo wörld\nsecond line\n", "utf-8")), "héllo wörld\nsecond line\n");
  });

  it("decodes empty content to an empty string", () => {
    assert.equal(decodeFileText(Buffer.alloc(0)), "");
  });

  it("returns undefined for content containing a NUL byte", () => {
    assert.equal(decodeFileText(Buffer.from([0x74, 0x65, 0x78, 0x74, 0x00, 0x74, 0x65, 0x78, 0x74])), undefined);
  });

  it("returns undefined for content with invalid UTF-8 sequences", () => {
    assert.equal(decodeFileText(Buffer.from([0xc3, 0x28])), undefined);
  });
});
