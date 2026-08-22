# Change Log

## 1.14.1

### Internal

- Split the release workflow into parallel GitHub Release and Marketplace publishing jobs so they can be retried
  independently

## 1.14.0

### New Features

- **Range in the graph view** - Shift+click now selects a range of changes. Selecting individual changes moved to
  Ctrl+click (Cmd+click on macOS)
- **Editable working-copy side for parent-commit diffs** - Opening the diff of a parent-commit file that is unchanged in
  the working copy now shows the editable working-copy file on the right side

### Bug Fixes

**Conflict handling**

- Fall back to a plain editor for conflicts with more than 2 sides
- Perform the standard click action instead of opening the merge editor for conflicted files in a selected commit
  because such conflicts cannot be merged in the working copy
- Show conflicted file status correctly in the selected commit
- Show conflicted file status correctly in the graph view for changed files
- Show the conflict badge for files whose path casing differs on case-insensitive file systems

**Merge editor side titles**

- Use the shortest change IDs in merge editor side titles
- Disambiguate divergent changes in merge editor side titles
- Parse conflict marker labels for changes without a description

**Editor titles**

- Show the short change ID in file-at-revision editor titles so they match the corresponding diff editor titles

**File paths**

- Fix path case normalization on macOS for file decorations
- Preserve file names containing literal backslashes on macOS and Linux instead

**Graph view and menus**

- Move Add/Remove Parent items to the end of the Rebase With Descendants submenu
- Show "All" in rebase menu labels for multi-selection
- Better align the status letters of changed files

**SCM view**

- Show repo-relative paths instead of absolute paths when the workspace root is a symlinked directory

**Performance**

- Memoize `show()`/`showAll()` results per (revset, operation id) so concurrent resolution of the same revision spawns
  at most one `jj log` process

### Internal

- **More robust path handling** - Distinguish resolved and workspace-folder paths in the type system

## 1.13.0

### New Features

- **Interactive `jj split`** - A new "Split" action in the graph context menu runs `jj split` interactively.
- **Workspace pill context menu** - Right-click a workspace pill to forget the workspace (optionally deleting its
  directory) or copy its path.

### Bug Fixes

- Make custom context-menu text non-selectable so menu items cannot be accidentally highlighted or drag-selected

### Internal

- **Read diff-tool snapshots from disk** - The `jjx-vscode-diff` subprocess now reports only its snapshot directory
  paths; the extension reads the files it needs directly from disk instead of serializing whole file trees as base64
  JSON over IPC. This removes per-file serialization and speeds up single-file diffs and the Split view.

## 1.12.6

### Bug Fixes

- **Delete untracked directories recursively** - Deleting an untracked directory from the SCM view now removes it and
  its contents recursively (after confirmation)

## 1.12.5

### New Features

- **Drag & drop multiple selected changes** - Select multiple changes to rebase/squash/etc. them all at once
- **Immutable icon on destructive context menu items** - Context menu items that modify the target change now show an
  immutable icon

## 1.12.4

### Bug Fixes

- **Track untracked directories recursively** - Tracking an untracked directory from the SCM view now tracks its
  contents recursively instead of failing silently.

## 1.12.3

### New Features

- **Cancel in-flight push of bookmarks/tags** - While a bookmark or tag is being pushed (spinning indicator shown),
  dragging the pill is disabled and its context menu is replaced with a single "Cancel Push" action. Cancelling kills
  the running `jj`/`git` push child process.
- **Cancel in-flight deletion of remote bookmarks/tags** - While a bookmark or tag is being deleted from a remote, the
  remote-ref pill shows a "Deleting..." spinner and offers a "Cancel Deletion" action that aborts the running process.

### Bug Fixes

- (Only jj 0.44+) Track a tag on a remote before pushing it there, so pushing a tag to a second, untracked remote
  succeeds
- Show the spinning indicator when initiating a push from the bookmark/tag pill context menu

## 1.12.2

### Bug Fixes

- **Clean short change IDs** - Render correctly computed short change IDs everywhere: graph, source control, editor
  titles, quick-picks, and confirmation dialogs
- **Diff editor titles** - Unify and improve diff editor titles
- **Toggle Diff View** - Support toggling added-file diffs
- Make the working copy side editable in from/to diffs
- Ignore double-click on elided graph nodes

### Internal

- **Type-safe change IDs** - Replace raw `string` change IDs with proper types throughout the protocol, extension host,
  and webview
- Route extension↔webview messages through typed `postMessage` wrappers

## 1.12.1

### New Features

- **Consistent local tag pill context menu** - Right-clicking a local tag pill now shows a unified menu independent of
  the jj version, allowing pushing the tag to remotes and deleting the local tag. Tag tracking, supported by jj 0.44+,
  is used internally but not surfaced in this menu.

### Bug Fixes

- Maintain the force-refresh flag when coalescing update checks in `checkForUpdates`
- Fall back to the active editor URI for the Open Parent/Child Change commands when the resource argument is undefined,
  fixing a timing-dependent race (most visible on Windows) where the editor stayed on the working copy
- Raise the diff-tool subprocess timeout for slow Windows CI

### Internal

- Shard integration test workflows to reduce runtime
- Add a helper script to extract the test log from a downloaded Playwright HTML report

## 1.12.0

### New Features

- **Remote bookmark/tag pill context menu** - Right-clicking a remote bookmark or tag pill (`<name>@<remote>`) now opens
  a context menu with remote-specific actions such as deleting a locally-deleted bookmark from the remote.
- **Tag tracking on remotes (jj 0.44+)** - Tags now support tracking on remotes, mirroring bookmarks. Older jj versions
  keep the previous behavior of pushing tags directly via `git push`.
- **From/to diff for two-change selection** - Selecting two changes in the graph now shows a from/to diff
  (`jj diff --from --to`) by default instead of an interdiff. A button toggles the diff to an interdiff.
- **Allow immutable changes as drag sources** - Immutable changes can now be used as drag sources in the graph.

### Bug Fixes

- Prompt before modifying immutable commits when using Duplicate and Revert drag&drop, consistent with other
  target-modifying operations
- Show an "immutable" icon in the rebase menu items to indicate operations that are guaranteed to change immutable
  changes
- Use modal dialogs for all confirmation prompts for consistency
- Hide the Open Parent/Child Change buttons in complex (two-change) diffs where they are meaningless

## 1.11.0

### New Features

- **Toggle Diff View command** - A new "Toggle Diff View" command switches the active editor between a file view and a
  diff view, replacing the separate "View as File" and "View as Diff" commands with a single toggle.

## 1.10.1

### Bug Fixes

- Force a full refresh of the SCM view when clicking the "Refresh" button
- Refresh the SCM view when deleting an untracked file
- Hide the "Select Repository" button in the graph and operation log views when only one repository exists
- Remove an unnecessary warning log emitted during normal diff operations

## 1.10.0

### New Features

- **Handle untracked files in the SCM view** - Show files that jj does not ignore but also does not track (e.g. files
  exceeding jj's max file size or excluded by `snapshot.auto-track`) in a new "Untracked Files" section below the
  working copy.

### Bug Fixes

- Surface jj export-failure warnings (e.g. "Failed to export some bookmarks") as a VS Code warning popup
- Fix failures with bookmark/tag/workspace names containing special characters
- Escape invisible characters in bookmark/tag/workspace names in the graph view
- Show an error in the graph webview when a refresh fails, instead of leaving a stale graph visible
- Use `operation.attributes()` instead of `operation.tags()`, the latter was deprecated in jj 0.41

### Internal

- Rename source and test files to kebab-case
- Remove unnecessary exports

## 1.9.2

### New Features

- **Add and remove parents via drag and drop** - Quickly modify a change's parents with drag&drop through a new item
  under the "Rebase With Descendants" submenu.

### Bug Fixes

- Handle binary files in the diff tool IPC, which fixes diff view of images
- Clear the "Selected Change" and "Interdiff" sections in the change view after abandoning changes
- Keep the "Selected Commit" and "Interdiff" resource groups below the "Parent Commits" group

## 1.9.1

### Bug Fixes

- Include the change in the abandon confirmation dialog
- Return per-URI size and mtime from `JJFileSystemProvider.stat()`
- Keep cache entries alive for open `jj://` diff documents instead of evicting them after three minutes

### Internal

- Add integration tests for multi-root workspace/repository selection, the colocated repo warning, abandoning changes,
  and the absorb change command
- Increase the integration test worker count from 4 to 5
- Inline the esbuild problem matcher instead of relying on an extension dependency
- Some cleanups

## 1.9.0

### New Features

- **Compare two changes with an interdiff** - Shift-select two changes in the graph to see an "Interdiff" section in the
  change view (`jj interdiff`), with side-by-side diffs showing how the selected changes differ.

### Bug Fixes

- Prevent operation reconciliation cascades on shared repositories (e.g. a host and a VM over virtiofs). This fixes the
  symptom of the op log quickly growing to hundreds of MB when two Jujutsu X instances were pointed at the same repo
- Trim files included in the vsix

### Internal

- Remove unnecessary dependencies

## 1.8.7

### Bug Fixes

- Forward `SSH_AUTH_SOCK` and `SSH_AGENT_PID` to `jj` invocations so agent-based SSH authentication works

## 1.8.6

### Bug Fixes

- Open merge editor reliably on first click after a conflict appears (fixes a race condition)
- Vertically align nodes with commit message in the graph
- Restrict environment forwarded to `jj` invocations to prevent unexpected behavior

### Internal

- Split monolithic CSS into modules for type safety and modularity
- Drive graph view presentation (hover, highlight, status color, tooltips, context menu) from signals and stable
  selectors instead of cross-module CSS class queries
- Harden integration tests against races

## 1.8.5

### New Features

- **Show changed files in graph** - Optionally show each commit's changed files inline in the graph (like `jj log -s`),
  with one-click diff opening (⚠️ experimental, enable with `jjx.showChangedFiles`)

### Bug Fixes

- Preserve jj's parent ordering in the change view
- Fix Windows path handling, which should fix some diff issues on Windows

### Internal

- Update jj to 0.43 in CI and devcontainer
- Move pnpm config from `package.json` to `pnpm-workspace.yaml`
- Make unit tests run on Windows
- Update dependencies
- Add `DEBUGGING.md`

## 1.8.4

### Bug Fixes

- Show 'No jj Repository Found' when binary exists but no repo is present

## 1.8.3

### Bug Fixes

- Allow double-click on non-empty working copy in new mode
- Show commit detail tooltip when hovering over a pill
- Dim circles in graph view when hovering a commit
- Update status cache on graph refresh to ensure consistency

## 1.8.2

### Bug Fixes

- Handle concurrent conflict resolutions by making the merge tool subprocess exit immediately to prevent divergent
  commits

## 1.8.1

### Bug Fixes

- Show nicer labels in the merge editor instead of "left", "right"
- Show relative time in file annotations
- Invalidate annotation cache when working copy changes
- React to `jjx.enableAnnotations` setting changes immediately
- Set `conflict-marker-style = "diff"` explicitly to prevent misbehavior when user overrides the setting
- Prevent stale annotation decorations from overwriting current ones after cursor moves

### Internal

- Add macOS CI runner
- Add integration tests for blame annotations feature
- Use long change IDs internally in a few more places

## 1.8.0

### New Features

- **Fetch from graph view** - Fetch from the default remote, from all remotes, or a chosen remote directly from the
  graph view quick actions
- **Move fetch button to graph view** - The fetch button has moved from the status bar to the graph view quick actions
- **Push tags to remotes** - Right-click a tag pill to push it to a specific remote
- **Windows support** - Editing change descriptions, diffing, merging now works on Windows
- **Recover description if `jj` fails** - If `jj` fails after editing a change description, the description will be
  reopened to not lose work

### Bug Fixes

- Activate the extension on `*` instead of `workspaceContains` to fix unreliable activation in devcontainers
- Only show Push to Remote for unsynced remotes in bookmark context menu
- Use correct decoration colors for renamed and copied files
- Exclude `.jj` and `.git` directories at any depth from repo watcher to avoid unnecessary refreshes
- Keep circle background mask opaque to prevent highlighted graph lines showing through on hover on Windows

### Internal

- Add integration tests for fetching from remotes and pushing tags to remotes
- Add Windows CI workflow
- Various refactoring: simplify graph.css, consolidate repository lookup, deduplicate command registrations, extract
  shared error handling, and inline single-use helpers

## 1.7.1

### New Features

- **Track/untrack bookmarks from context menu** - Right-click a bookmark pill to track or untrack it on specific remotes

### Internal

- Use the system jj identity for generating screenshots to avoid hardcoding the identity

## 1.7.0

### New Features

- **Drag and drop for bookmarks** - Drag bookmark pills onto commits to move them, replacing the old "Move Bookmark"
  context menu
- **New quick upload button for bookmarks** - A new button "push to all tracking remotes" shows up next to out of sync
  bookmarks
- **New right-click context menu for bookmarks** - Push a bookmark to a chosen remote or delete the bookmark directly
  from its context menu
- **New right-click context menu for tags** - Delete a tag directly from its context menu
- **New error views when jj binary is not found** - Show clear errors in the graph and SCM panel when the jj binary is
  missing at activation
- **Auto-update stale workspaces by default** - The `jjx.autoUpdateStaleWorkspace` setting now defaults to true
- **Position graph tooltip to avoid obstructing the view** - Tooltips now better position themselves to minimize overlap

### Bug Fixes

- Ensure only one context menu is open at a time in graph view
- Show commit tooltip only when hovering over label or description
- Re-fetch diff stats for active tooltip after graph refresh to prevent stuck "Loading..." message
- Shorten context menu labels for Describe and Edit actions
- Remove move/delete bookmark and delete tag from graph context menu (moved to pill context menus)
- Match drag ghost change ID formatting and positioning to graph view
- Hide uninteresting @git refs in tooltip when corresponding local ref exists on same commit
- Increase default log limit to 500
- Call "jj op revert" instead of "jj op undo" for forward compatibility

### Internal

- Update dependencies (TypeScript 6.0.3, diff v9, minor/patch updates)
- Add integration tests for push bookmark and bookmark drag&drop
- Configure user identity in test repos for reliable test behavior
- Add "check" script for running type check, lint, format, and unit tests together
- Preserve stdout/stderr/exit code in structured ProcessError type
- Make formatter and unit tests less noisy

## 1.6.3

### Bug Fixes

- Fix diff of renamed files missing the left side of the diff

## 1.6.2

### Bug Fixes

- Restrict diff to requested file instead of diffing all files, significantly improving diff performance
- Cancel in-flight operations when the extension deactivates
- Fix a graph view glitch: Synchronize dimming transition speed across all graph elements (diamonds and elided symbols)

### Internal

- Automate screenshots for divergent changes, conflicts, workspaces, and op log for the README file
- Incrementally update repos in refresh() instead of full teardown/rebuild
- Break up monolithic activate() into modules
- More code cleanup

## 1.6.1

This is a bug fix release. See 1.6.0 for the full release notes.

### Internal

- Fix flaky integration test for commit action by waiting for settings to be applied
- Pin VS Code version to 1.114.0 in integration tests for reproducible CI runs

## 1.6.0

### New Features

- **Undo/Redo buttons in graph view** - Added undo and redo buttons to the graph view title bar for quick operation
  management
- **Ctrl+Shift+Enter to commit with editor** - Press Ctrl+Shift+Enter to open the commit message in the full VS Code
  editor; empty commit messages are now allowed with Ctrl+Enter without opening an editor
- **jjx.autoUpdateStaleWorkspace** - New config option to automatically run `jj workspace update-stale` when the working
  copy is stale
- **jjx.pollIntervalSeconds** - Renamed from `jjx.pollInterval`; the value is now in seconds instead of milliseconds
  (default: 30)
- **Migrated from npm to pnpm** for better security, faster installs, and higher disk efficiency

### Bug Fixes

- More reliably show the stale working copy message in graph view when polling fails
- Check minimum jj version (0.38.0) at startup and show a warning if the installed version is too old
- Exclude unnecessary files (playwright-report, images/togif.sh, .vscode/) from the VSIX package

### Internal

- Add integration tests for workspaces
- Add integration tests for committing via SCM input box with and without editor

## 1.5.1

### Bug Fixes

- Bump `engines.vscode` minimum to `^1.110.0` to match `@types/vscode` to fix error when packaging the sources

### Internal

- Cache jj binary in GitHub workflows to speed up CI

## 1.5.0

### New Features

- **Preact JSX for graph rendering** - Converted imperative SVG construction to declarative Preact JSX for better
  maintainability and easier component composition
- **Replace vendored diff engine with `diff` package** - Removed the vendored VS Code diff engine (~30 files) in favor
  of the `diff` npm package, significantly reducing code complexity and maintenance burden

### Bug Fixes

- Merge editor now works for conflicts in divergent commits
- Refresh graph view and operation log after operation undo/restore
- Ensure Selected Commit section always appears last in change view
- Use basename instead of relative path for diff editor titles
- Preserve graph view selection across refreshes
- Replace useEffect with useSignalEffect for signal deps to avoid unnecessary re-renders
- Split ChangeNodeRow into sub-components to avoid O(n) re-renders on signal changes
- Cache DOM queries in use-connected-highlight to avoid full traversal per hover
- Extract tooltip timeout management into useTooltipTimers hook
- Kill spawned jj processes on extension deactivation
- Cancel filesystem provider event firing on dispose
- Force-close IPC server connections on shutdown

### Internal

- Add integration tests for many more commands:
  - Squash selected ranges
  - Operation log generic undo/redo via buttons or command palette
  - Undo or restore a specific operation
  - Update change description
  - Move Changes to Parent/Working Copy
  - Create new change via command palette and SCM input box
  - Edit this change
  - Create new change with selected changes as parents
  - Discard changes
- Update npm package versions
- Automate screenshots for light theme and the full graph style
- Install jj version 0.38 in GitHub workflows
- Fix the Playwright browser path for caching
- Retry Xvfb display number allocation on conflict in the integration test setup
- Remove unused CSS classes

## 1.4.0

### New Features

- **Preact migration** - Rewrote the graph webview from vanilla TypeScript to Preact with JSX and signals for a more
  maintainable component architecture and improved performance
- **On-demand diff stat fetching** - Greatly improved jj graph performance by making tooltips fetch diff stats on demand
  with prefetching
- **Absorb Into Parents** - New context menu option to absorb selected changes into their parent commits
- **Abandon All Selected Changes** - New context menu option to abandon all selected changes at once
- **New Child** - New context menu option to create a new child change from a selected commit
- **Hoverable tooltips** - Tooltips can now be hovered to scroll through long descriptions before they hide
- **Double-click opens new change** - Changed the default double-click action to create a new child change instead of
  editing to prevent accidentally editing past changes
- **Deferred graph updates during drag & drop** - Graph no longer refreshes during drag operations to preserve the drop
  target
- **jjx.showTooltips** - New config option to control whether tooltips are shown in the graph view

### Bug Fixes

- Hard-wrap long name and email in tooltip
- Reduce tooltip hover delays for snappier interaction
- Prevent tooltip from overlapping change IDs in graph view
- Remove angle brackets around email address in tooltip
- Remove quick action buttons from graph change nodes to have more space for the description

### Internal

- Share message protocol types between extension and webview
- Enable eslint for the webview files
- Add integration tests for rebase with descendants
- Suppress tooltips in integration tests for more reliable tests
- Exclude development and CI paths from VSIX package
- Many smaller cleanups

## 1.3.0

### New Features

- **jjx.logLimit** - New config option to control the number of commits shown in the graph view
- **Improved elided commits** - The `jjx.elidedVisibleImmutableParents` setting now only applies to elided (collapsed)
  immutable commits, and the setting has been renamed from `jjx.numberOfImmutableParentsInLog`

### Performance

- Faster elided edge computation (replaced O(N\*G) ancestry DFS with single reverse BFS)

### Bug Fixes

- Show commits that have local bookmarks/tags in the graph
- Fix rendering bug where some parent edges were missing
- Fix missing synthetic node IDs causing incorrect graph rendering

### Internal

- Extract webview graph inline script into 8 focused TypeScript modules for type checking and linting
- Deduplicate esbuild build configurations
- Replace unmaintained npm-run-all with npm-run-all2
- Enable stricter TypeScript checking (noImplicitReturns, noFallthroughCasesInSwitch)
- Add CI caching for node_modules and Playwright browsers
- Various cleanup and fixes (stale files, broken tasks, source maps, duplicate tests)

## 1.2.2

### Bug Fixes

- Fix graph rendering bug where indirect edges where incorrectly rendered as direct edges to missing nodes

### Internal

- Collect Playwright artifacts on test failure (CI)
- Replace hardcoded timeout with proper polling in graphFrame fixture, reducing test runtime by 25%
- Add Playwright script to update a screenshot

## 1.2.1

### Bug Fixes

- Fix graph node circles using incorrect background color on hover and selection
- Fix graph lines bleeding through node circles when adjacent commits are dimmed

## 1.2.0

### New Features

- **Confirmation dialog for bookmark and tag deletion** - Prevents accidental deletion
- **Copy URL** - New context menu item to copy a web URL, for example a github URL, for the selected commit
- **jjx.baseWebURL** - New config setting to override `git_web_url()` for generating commit URLs

### Improvements

- Rename graph views to "JJ Graph" and "JJ Operation Log"
- Bookmark context menu items reordered for better UX
- Simplify change view section headers
- Make diff icon consistent across all diff actions

### Bug Fixes

- Use proper error message extraction in error handlers
- Use optional chaining for child process stream access
- Use case-insensitive path comparison in parseFileStatuses
- Remove parseJJError wrapper in new() and commit() to preserve typed errors

### Internal

- Automatically add release notes from CHANGELOG.md to GitHub releases (CI)
- Various code cleanup and refactorings

## 1.1.1

### Documentation

- Updated README with clearer feature descriptions and improved formatting

## 1.1.0

### New Features

#### Support Conflicted Bookmarks and Tags

- **Conflicted bookmarks/tags** - Shown with `??` suffix when conflicted

#### New File Context Menu

- **View as Diff** - Open the file as a diff comparing to its parent
- **Open File at Revision** - Open the file as it exists at the selected revision
- **Open File in Working Copy** - Open the current working copy version of the file
- **Copy Path** - Copy the full absolute path to the clipboard
- **Copy Relative Path** - Copy the path relative to the repository root

#### New File View Options

- **Configurable file click action** - Choose between diff, at-revision, or working-copy view (default changed to diff)
- **View file at revision** - Open files at their specific revision
- **View file in working copy** - Open the working copy version of any file

#### Drag & Drop Enhancements

- **HTML5 drag&drop API** - Modern drag&drop implementation for better reliability
- **Reorganized context menu** - Submenus for "Onto, After, Before" options
- **Revert a change** - New revert action in the drag&drop menu
- **Improved tooltips** - Tooltips hide during drag&drop or when menus are open

#### More Reliable Editor Integration

- **IPC-based editor** - VS Code editor integration for jj commands through IPC

#### Configuration

- `jjx.fileClickAction` - Renamed from `openDiffAction`, now with three options: `diff` (default), `at-revision`, or
  `working-copy`
- `jjx.elidedVisibleImmutableParents` - New setting to control the number of immutable parent commits to show in the log
  (default: 1)

### Bug Fixes

- Context menu submenus stay open while hovered
- Submenus positioned vertically within visible area
- Proper diff view for added and deleted files
- Consistent Title Case capitalization for UI elements
- Hidden "Selected Commit" section when already shown as Parent
- Include revision in tab title when opening files at a specific revision

### Testing

- Added comprehensive Playwright integration tests for all major features
- Tests for drag&drop, bookmarks, tags, rebase, duplicate, and more

### Removed

- **Zig build dependency** - No longer needed for building the extension
- **Fakeeditor binary** - Replaced with IPC-based VS Code editor integration for jj commands
- **Old vscode-test suite** - Replaced with Playwright integration tests
- `jjx.fakeEditorPath` configuration option - No longer needed

## 1.0.0 - Initial Release

Jujutsu X is a fork of [Jujutsu Kaizen](https://github.com/keanemind/jjk), a VS Code extension for the
[Jujutsu (jj)](https://github.com/jj-vcs/jj) version control system.

### New Features

#### Compact Graph View

- **Compact graph mode** - A high-information-density graph view showing minimal change IDs, no unnecessary information,
  and hiding author names for your own commits
- **Elided commits** - Sequences of immutable commits are automatically collapsed, with a button to expand them when
  needed
- **Tooltips** - Hover over any change to see full details including bookmarks, tags, and remote tracking info

#### Drag & Drop Operations

- **Rebase changes** - Drag a change onto another to rebase it (with or without descendants) onto/after/before the
  target change
- **Squash into** - Squash one change into another via drag & drop
- **Duplicate changes** - Duplicate a change onto/after/before any other change

#### Conflict Resolution

- **Conflict indicators** - Conflicts are shown in both the graph view and change view
- **VS Code merge editor** - Open the merge editor to resolve conflicts directly
- **Conflicted files** - Shown with "X" indicator in the change view

#### Divergent Changes Support

- Full support for divergent changes in the graph and change views
- Include change offset in section headers for divergent changes
- All meaningful operations work on divergent changes

#### Bookmark & Tag Management

- **Create** bookmarks and tags via context menu
- **Move** bookmarks with confirmation when moving backwards/sideways
- **Delete** bookmarks and tags
- Show local and remote bookmarks/tags separately
- Show the synced status for bookmarks/tags

#### Multi-Workspace Support

- Workspace labels shown in the graph for multi-workspace repos
- Handles "workspace is stale" errors with a button to update

#### Operation Management

- **Undo/Redo buttons** - Quick access to undo/redo in the operations log view
- **Browse operations** - View the full operations log

#### Workflow Support

- **Squash workflow** - Support for `jj new` as an alternative to edit mode (`jjx.changeEditAction`)
- **Edit workflow** - Traditional edit workflow fully supported
- **Commit action** - Separate configuration option for commit behavior (`jjx.commitAction`)

#### File Annotations

- Fetch the annotations of all selected lines at once for better performance when multi-cursor editing
- Cache annotations when selected lines don't change

### Usability Improvements

#### Graph View Enhancements

- **Default compact style** - Compact graph view is now the default
- **Default revset** - Matches `jj log` default revset
- **Increased limit** - Default graph view limit increased to 100 changes
- **Minimal change IDs** - Show minimal unambiguous change IDs, at least 4 characters
- **Empty commits** - Shown as `(empty)`
- **Working copy** - Highlighted with a larger `@` symbol
- **Bookmarks/tags** - Shown as pills, abbreviated if long
- **Beziér curves** - Smooth connections between adjacent columns

#### Context Menus

- **Abandon change** - With confirmation dialog
- **Describe change** - Opens full editor instead of one-line input
- **Copy change ID** - Quick copy to clipboard
- **Create bookmark/tag** - Create from context menu
- Better positioning to fit in viewport
- Closes on focus loss

#### Confirmation Dialogs

- Ask for confirmation when abandoning/discarding changes
- Ask for confirmation when moving bookmarks backwards/sideways

#### Editor Integration

- Full editor for `jj describe` instead of single-line input
- Removed timeout when entering long commit messages
- Snapshot working copy on explicit refresh

#### Configuration

Configuration prefix changed from `jjk` to `jjx`. New configuration options:

- `jjx.changeEditAction` - Action when clicking the edit button on a change (`edit` or `new`)
- `jjx.commitAction` - Action when pressing Ctrl+Enter in the source control input box (`commit` or `new`)
- `jjx.graphStyle` - Display style for commits in the graph view (`full` or `compact`, default: `compact`)
- `jjx.pollInterval` - Interval in milliseconds between repository polls (default: 30000, set to 0 to disable)
- `jjx.openDiffAction` - Action when clicking a file in the change view (`diff` or `file`)
- `jjx.elideImmutableCommits` - Elide chains of immutable commits in the graph view (default: `true`)

Removed: `jjk.ignoreWorkingCopy` (now handled automatically)

### Bug Fixes

- Fixed "Describe change" button for "Selected Commit"
- Fixed polling performance issue with throttling
- Fixed memory leak in `JJFileSystemProvider.dispose()`
- Fixed watching the real repo when in a jj workspace
- Fixed handling of `--ignore-working-copy` automatically
- Fixed handling of hidden change status for proper display
- Fixed handling of change_offset for non-divergent commits (prevents duplicate change IDs in graph)
- Fixed injection of `--config-file` before `--` in commands
- Removed obsolete jj version check

### Performance Improvements

- **JSON output** - All `jj log` invocations now use JSON parsing instead of brittle colored text parsing
- **Template builder** - Centralized JJ template string generation for consistent JSON output
- **Caching** - File annotations cached when selected lines don't change
- **Debouncing** - Repository polling debounced for better performance
- **Extension activation** - Only activates in jj repositories
- **Polling** - Configurable interval with throttling

### Architecture & Code Quality

- Split `repository.ts` into smaller, more maintainable files
- Centralized error handling
- Extracted hardcoded timeouts to central constants
- Removed winston logging framework in favor of native VS Code logging
- New lane assignment algorithm for better graph layout
- Added AGENTS.md for AI assistant context
- Set up Prettier for code formatting
- Devcontainer setup for development

### Other Changes

- **New logo** - Fresh branding for Jujutsu X
- **License** - Changed to AGPL-3.0 (original Jujutsu Kaizen code remains MIT)
- **CI/CD** - Added CI and publish workflows
- Extension registered as "Jujutsu" SCM provider
- Set `extensionKind: workspace` for remote development support

For the full list of changes, see the [commit history](https://github.com/Christoph-D/jjx/commits/main).
