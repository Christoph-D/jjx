# jj Merge Workflow: Getting Base/Left/Right File Contents via CLI

This document describes how a third-party tool can use only the jj CLI to obtain the base, left, and right file contents for a conflicted file, enabling integration with external 3-way merge tools.

## Overview

For a 2-sided conflict (3-way merge), jj stores the conflict as:
- **left (add₀)**: First parent's version
- **base (remove₀)**: Common ancestor's version  
- **right (add₁)**: Second parent's version

## Complete Workflow

### Step 1: Get Commit ID from Change ID

```bash
jj show -r @ -T 'commit_id' --no-patch
```

**Output:**
```
bf9da5a0b9ddb439a1dcccf6c066e36a908707f0
```

Replace `@` with any change ID (e.g., `pzwypnz`) to get its full commit ID.

### Step 2: Get Tree IDs from Commit

```bash
jj debug object commit bf9da5a0b9ddb439a1dcccf6c066e36a908707f0
```

**Output:**
```
Commit {
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
            "pzwypnzu d940889f \"A\" (rebase destination)",
            "syspynks 2c0f9eea \"foo2\" (parents of rebased revision)",
            "wuzwlkyn 2c50ddb5 \"B\" (rebased revision)",
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
}
```

**Key fields:**
- `root_tree: Conflicted([...])` contains 3 tree IDs in order: **[left, base, right]**
- `conflict_labels: Conflicted([...])` contains human-readable labels for each side

**Mapping for this example:**

| Index | Tree ID | Label | Role |
|-------|---------|-------|------|
| 0 | `467a12229ba6f02ee750b3ed95bf07bf8cbe48ed` | "A" (rebase destination) | left |
| 1 | `774d1be61b289a1f585b294b4f4fd0b05d88ee14` | "foo2" (parents of rebased revision) | base |
| 2 | `02714ccc52f6939de2bde3a99c2155c47511ad95` | "B" (rebased revision) | right |

### Step 3: Get File IDs from Each Tree

For each tree ID from step 2, query the specific file:

**Tree 0 (left):**
```bash
jj debug tree --id 467a12229ba6f02ee750b3ed95bf07bf8cbe48ed -- foo
```

**Output:**
```
foo: Ok(Resolved(Some(File { id: FileId("9a4da346f3e74eacd2adb312290fed716108b985"), executable: false, copy_id: CopyId("") })))
```

**Tree 1 (base):**
```bash
jj debug tree --id 774d1be61b289a1f585b294b4f4fd0b05d88ee14 -- foo
```

**Output:**
```
foo: Ok(Resolved(Some(File { id: FileId("3bd1f0e29744a1f32b08d5650e62e2e62afb177c"), executable: false, copy_id: CopyId("") })))
```

**Tree 2 (right):**
```bash
jj debug tree --id 02714ccc52f6939de2bde3a99c2155c47511ad95 -- foo
```

**Output:**
```
foo: Ok(Resolved(Some(File { id: FileId("bbfe2090d15a03c0aae1e59db2a5cf849d3ddb48"), executable: false, copy_id: CopyId("") })))
```

**File ID mapping for `foo`:**

| Side | File ID |
|------|---------|
| left | `9a4da346f3e74eacd2adb312290fed716108b985` |
| base | `3bd1f0e29744a1f32b08d5650e62e2e62afb177c` |
| right | `bbfe2090d15a03c0aae1e59db2a5cf849d3ddb48` |

### Step 4: Read File Contents

```bash
jj debug object file -- <path> <file_id>
```

The output is the raw file content (binary safe). For example:

**Left version:**
```bash
jj debug object file -- foo 9a4da346f3e74eacd2adb312290fed716108b985
```

**Base version:**
```bash
jj debug object file -- foo 3bd1f0e29744a1f32b08d5650e62e2e62afb177c
```

**Right version:**
```bash
jj debug object file -- foo bbfe2090d15a03c0aae1e59db2a5cf849d3ddb48
```

## Summary

A third-party tool can obtain base/left/right file contents using this 4-step CLI workflow:

1. `jj show -r <change_id> -T 'commit_id' --no-patch` → commit ID
2. `jj debug object commit <commit_id>` → tree IDs [left, base, right]
3. `jj debug tree --id <tree_id> -- <path>` → file ID (for each tree)
4. `jj debug object file -- <path> <file_id>` → raw file content (for each side)

With these three file versions, you can invoke any external 3-way merge tool.
