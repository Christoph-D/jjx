# Updating Vendored VS Code Sources

`src/vendor/vscode/` contains TypeScript source files copied from the
[VS Code repository](https://github.com/microsoft/vscode) (MIT licensed). These files provide the line-diffing engine
used by the extension for SCM features (partial staging, partial undo, etc.).

## Quick Reference

```bash
npm run update-vendor              # Update to latest VS Code release
npm run update-vendor -- --tag 1.97.0  # Update to a specific tag
```

## What the Script Does

`scripts/update-vendor.mjs` automates the full vendor update process:

1. Clones or fetches the VS Code repo into `.vscode-repo/` in the project root
2. Checks out the desired tag (latest release if `--tag` is not specified)
3. Walks the import graph starting from entry points defined in the manifest
4. Copies only files within the allowed scope
5. Reports external dependencies that are not vendored
6. Removes orphaned files left over from previous updates
7. Updates the manifest with the new VS Code ref and file list
8. Runs `npm run check-types` to validate

## Scope

The script only follows imports within these directories:

| Directory               | Contents                                      |
| ----------------------- | --------------------------------------------- |
| `editor/common/core/**` | Core types (Range, Position, LineRange, etc.) |
| `editor/common/diff/**` | Diff algorithms                               |
| `base/common/`          | Only files on an explicit allowlist           |

### base/common/ Allowlist

Only these files are vendored from `base/common/`:

- `arrays.ts`, `arraysFind.ts`, `assert.ts`, `charCode.ts`
- `diff/` (directory)
- `equals.ts`
- `errors.ts`, `hash.ts`, `map.ts`, `strings.ts`, `uint.ts`

Everything else in `base/common/` is excluded because it pulls in large frameworks (event system, observable,
cancellation, URI handling, buffers, streams).

## Entry Points

The extension imports vendored code through these entry points:

```
src/main.ts -> editor/common/diff/linesDiffComputers.ts
src/main.ts -> editor/common/diff/linesDiffComputer.ts
src/diffUtils.ts -> editor/common/diff/linesDiffComputer.ts (type-only)
```

Entry points are defined in `src/vendor/manifest.json`.

## Manifest

`src/vendor/manifest.json` tracks:

- `vscodeRef` — The VS Code git tag currently vendored (e.g. `1.113.0`)
- `repoUrl` — The VS Code repository URL
- `entryPoints` — Root files from which the import graph is walked
- `files` — Complete list of all vendored files

## Patching Vendored Files

After running the update script, the vendored `base/common/` files need manual patches to strip out unused imports and
code that depends on non-vendored modules. Only a small subset of each module is used by the diff engine.

### Files That Need Patching

#### `arrays.ts`

- Remove `cancellation.js` and `sequence.js` imports
- Inline the `ISplice<T>` interface (previously from `sequence.js`)
- Change `topAsync` to use inline `{ isCancellationRequested: boolean }` instead of `CancellationToken`
- Change `CancellationError` throw to generic `Error('Cancelled')`

#### `hash.ts`

- Remove `buffer.js` import (`encodeHex`, `VSBuffer`)
- Remove `hashAsync` function entirely (depends on `VSBuffer`, `crypto.subtle`, and `encodeHex`)
- Remove the `ArrayBuffer` overload of `toHexString` (depends on `encodeHex`/`VSBuffer`)
- Only `stringHash` (used by `base/common/diff/diff.ts`) should remain functional

#### `map.ts`

- Remove `uri.js` import
- Remove `ResourceMap` and `ResourceSet` classes entirely (depend on `URI`, not used by diff engine)
- Remove `implements Map<K, V>` from `LinkedMap` (fixes `MapIterator` vs `IterableIterator` `[Symbol.dispose]`
  incompatibilities with newer TypeScript)
- `SetMap` (the only symbol used from `map.ts`, by `computeMovedLines.ts`) is unaffected

#### `strings.ts`

- Remove `cache.js` and `lazy.js` imports
- Remove the `AmbiguousCharacters` class (depends on `Lazy` and `LRUCachedFunction`)
- Remove the `InvisibleCharacters` class (large embedded JSON data, not used by diff engine)
- Remove any orphaned lines left by partial edits (duplicated exports, leftover class remnants)

#### `equals.ts`

- Create `base/common/equals.ts` with the `IEquatable<T>` interface (type-only export)
- Imported by `editor/common/core/edits/textEdit.ts`
- No external dependencies

### Symbols Actually Used from base/common/

| File                 | Symbols                                                                                                                                                                                      | Used by                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `arrays.ts`          | `compareBy`, `numberComparator`, `reverseOrder`, `forEachWithNeighbors`, `pushMany`, `forEachAdjacent`, `sumBy`, `equals`, `groupAdjacentBy`, `Comparator`, `findFirstIdxMonotonousOrArrLen` | `computeMovedLines.ts`, `defaultLinesDiffComputer.ts`, `lineRange.ts`, `edit.ts`, etc. |
| `arraysFind.ts`      | `MonotonousArray`, `findLastMonotonous`, `findLastIdxMonotonous`, `findFirstMonotonous`, `findFirstIdxMonotonousOrArrLen`                                                                    | `computeMovedLines.ts`, `linesSliceCharSequence.ts`, etc.                              |
| `assert.ts`          | `assertFn`, `checkAdjacentItems`, `assert`                                                                                                                                                   | `defaultLinesDiffComputer.ts`, `textEdit.ts`, etc.                                     |
| `charCode.ts`        | `CharCode` (const enum, inlined at compile time)                                                                                                                                             | `lineSequence.ts`, etc.                                                                |
| `errors.ts`          | `BugIndicatingError`                                                                                                                                                                         | `diffAlgorithm.ts`, `edit.ts`, `offsetRange.ts`, etc.                                  |
| `hash.ts`            | `stringHash`                                                                                                                                                                                 | `base/common/diff/diff.ts`                                                             |
| `map.ts`             | `SetMap`                                                                                                                                                                                     | `computeMovedLines.ts`                                                                 |
| `strings.ts`         | `commonPrefixLength`, `commonSuffixLength`, `splitLines`, `firstNonWhitespaceIndex`, `lastNonWhitespaceIndex`                                                                                | `stringEdit.ts`, `textEdit.ts`, `legacyLinesDiffComputer.ts`, `abstractText.ts`        |
| `uint.ts`            | `Constants` (const enum, inlined at compile time)                                                                                                                                            | `base/common/diff/diff.ts`                                                             |
| `diff/diff.ts`       | `IDiffChange`, `ISequence`, `LcsDiff`, `IDiffResult`                                                                                                                                         | `legacyLinesDiffComputer.ts`                                                           |
| `diff/diffChange.ts` | `DiffChange`                                                                                                                                                                                 | `base/common/diff/diff.ts`                                                             |
| `equals.ts`          | `IEquatable<T>`                                                                                                                                                                              | `textEdit.ts`                                                                          |

## Post-Update Validation

After updating vendor sources and applying patches, run:

```bash
npm run check-types   # Must pass with 0 errors
npm run lint           # No lint errors
npm run unit-test      # All tests must pass
```

## Directory Structure

```
src/vendor/vscode/
  base/common/
    arrays.ts, arraysFind.ts, assert.ts, charCode.ts
    diff/diff.ts, diff/diffChange.ts
    equals.ts, errors.ts, hash.ts, map.ts, strings.ts, uint.ts
  editor/common/
    core/
      editOperation.ts, position.ts, range.ts
      edits/edit.ts, edits/stringEdit.ts, edits/textEdit.ts
      ranges/lineRange.ts, ranges/offsetRange.ts
      text/abstractText.ts, text/positionToOffsetImpl.ts, text/textLength.ts
    diff/
      defaultLinesDiffComputer/
        algorithms/diffAlgorithm.ts, algorithms/dynamicProgrammingDiffing.ts, algorithms/myersDiffAlgorithm.ts
        computeMovedLines.ts, defaultLinesDiffComputer.ts
        heuristicSequenceOptimizations.ts, lineSequence.ts, linesSliceCharSequence.ts, utils.ts
      legacyLinesDiffComputer.ts
      linesDiffComputer.ts, linesDiffComputers.ts, rangeMapping.ts
```

## External Dependency Chains (Excluded)

These modules are not vendored because they pull in far more code than needed:

```
event.ts -> observable.ts -> observableInternal/ (large framework)
cancellation.ts -> event.ts -> ...
uri.ts -> marshallingIds.ts, path.ts, platform.ts
buffer.ts -> lazy.ts, stream.ts
```
