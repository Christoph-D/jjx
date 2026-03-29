# Change Log

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
