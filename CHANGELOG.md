# Change Log

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
- `jjx.numberOfImmutableParentsInLog` - New setting to control the number of immutable parent commits to show in the log
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
