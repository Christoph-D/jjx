/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTreeInfo } from "../conflictParser";

const COMMIT_INFO = `Commit {
    parents: [
        CommitId(
            "6256eaaf8954c4befc0daa49bbe662fd83731b2d",
        ),
    ],
    predecessors: [],
    root_tree: Conflicted(
        [
            TreeId(
                "467a12229ba6f02ee750b3ed95bf07bf8cbe48ed",
            ),
            TreeId(
                "774d1be61b289a1f585b294b4f4fd0b05d88ee14",
            ),
            TreeId(
                "02714ccc52f6939de2bde3a99c2155c47511ad95",
            ),
        ],
    ),
    conflict_labels: Conflicted(
        [
            "pzwypnzu d940889f \\"A\\" (rebase destination)",
            "syspynks 2c0f9eea \\"foo2\\" (parents of rebased revision)",
            "wuzwlkyn 2c50ddb5 \\"B\\" (rebased revision)",
        ],
    ),
    change_id: ChangeId(
        "a1e0192d4adb697ea60faab2ccdc11c5",
    ),
    description: "",
    author: Signature {
        name: "Christoph Dittmann",
        email: "code@yozora.eu",
        timestamp: Timestamp {
            timestamp: MillisSinceEpoch(
                1773527024000,
            ),
            tz_offset: 60,
        },
    },
    committer: Signature {
        name: "Christoph Dittmann",
        email: "code@yozora.eu",
        timestamp: Timestamp {
            timestamp: MillisSinceEpoch(
                1773527024000,
            ),
            tz_offset: 60,
        },
    },
    secure_sig: None,
}`;

describe("conflictResolver", () => {
  it("parseTreeInfo extracts tree IDs from commit info", () => {
    const result = parseTreeInfo(COMMIT_INFO);

    assert.deepEqual(result.treeIds, [
      "467a12229ba6f02ee750b3ed95bf07bf8cbe48ed",
      "774d1be61b289a1f585b294b4f4fd0b05d88ee14",
      "02714ccc52f6939de2bde3a99c2155c47511ad95",
    ]);
  });

  it("parseTreeInfo extracts conflict labels from commit info", () => {
    const result = parseTreeInfo(COMMIT_INFO);

    assert.deepEqual(result.labels, [
      'pzwypnzu d940889f "A" (rebase destination)',
      'syspynks 2c0f9eea "foo2" (parents of rebased revision)',
      'wuzwlkyn 2c50ddb5 "B" (rebased revision)',
    ]);
  });

  it("parseTreeInfo throws when fewer than 3 tree IDs", () => {
    const invalidCommitInfo = `Commit {
        root_tree: Conflicted(
            [
                TreeId(
                    "467a12229ba6f02ee750b3ed95bf07bf8cbe48ed",
                ),
            ],
        ),
    }`;

    assert.throws(() => parseTreeInfo(invalidCommitInfo), /Could not parse tree IDs from commit info/);
  });

  it("parseTreeInfo uses default labels when conflict_labels not found", () => {
    const noLabelsCommitInfo = `Commit {
        root_tree: Conflicted(
            [
                TreeId(
                    "467a12229ba6f02ee750b3ed95bf07bf8cbe48ed",
                ),
                TreeId(
                    "774d1be61b289a1f585b294b4f4fd0b05d88ee14",
                ),
                TreeId(
                    "02714ccc52f6939de2bde3a99c2155c47511ad95",
                ),
            ],
        ),
    }`;

    const result = parseTreeInfo(noLabelsCommitInfo);

    assert.deepEqual(result.labels, ["left", "base", "right"]);
  });
});
