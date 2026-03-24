# Jujutsu X

![logo](images/logo-small.png)

> A Visual Studio Code extension for the [Jujutsu (jj) version control system](https://github.com/jj-vcs/jj). My
> personal development fork of [Jujutsu Kaizen](https://github.com/keanemind/jjk).

## 🚀 Features

The goal of this extension is to bring the great UX of Jujutsu into the VS Code UI.

Here's what you can do so far:

### 🔗 Graph view

- Compact graph view  
  ![compact graph](images/compact-view.png)
  - Alternative: [Extended graph view](images/full-view.png)
- High information density
  - Minimal change IDs
  - No unnecessary information
  - No author name if it's your own change
- Elided commits  
  ![elided commits](images/elided-commits.gif)
- Right-click on a change for a context menu, for example to abandon the change
- Select a change to see its affected files and diffs
- Create merge changes with shift-select
- Drag & drop changes onto other changes

### ✋ Drag & drop operations

- Rebase a change (with or without descendants) onto/after/before any other change
- Squash a change into any other change
- Duplicate a change onto/after/before any other change

### 📁 File management

- Track file statuses in the working copy
- Monitor file statuses across all parent changes
- View detailed file diffs for working copy and parent modifications
- Line-by-line blame annotations (optional)

### 💫 Change management

- Quickly commit with Ctrl+Enter
- Support both the
  [squash workflow](https://steveklabnik.github.io/jujutsu-tutorial/real-world-workflows/the-squash-workflow.html) and
  the [edit workflow](https://steveklabnik.github.io/jujutsu-tutorial/real-world-workflows/the-edit-workflow.html)
- Move changes between working copy and parents  
  ![squash](images/squash.png)
- Move specific lines from the working copy to its parent changes ![squash range](images/squash_range.webp)
- Discard changes

### ⚠️ Conflicts

- Show conflicts in the graph and change view  
  ![conflicts](images/conflicts.png)
- Resolve conflicts with the VS Code merge editor  
  ![merge editor](images/merge-editor.png)

### 🔀 Divergent changes

- Show divergent changes in the graph and change view
- Allow all meaningful operations on divergent changes

### 🏷️ Bookmark/Tag management

- Create, move, and delete bookmarks
- Set and delete tags
- Show conflicted bookmarks and tags with `??` suffix
- Show out-of-sync bookmarks and tags with `*` suffix

### 💼 Multi-Workspace support

- Show workspace labels in the graph view  
  ![workspaces](images/workspaces.png)
- Handle "workspace is stale" errors

### 🔄 Operation management

- Browse the operations log with quick undo/redo buttons  
  ![oplog](images/undo-redo.png)
- Undo any jj operation or restore repository to a previous state

## 📋 Prerequisites

- Ensure `jj` is installed and available in your system's `$PATH`, or configure a custom path using the `jjx.jjPath`
  setting
- Ensure `jj` is of a recent version (>=0.38.0)

## ⚙️ Configuration

The following settings can be configured in VS Code's settings:

| Setting                             | Default     | Description                                                                                                                                       |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jjx.enableAnnotations`             | `true`      | Enables in-line blame annotations                                                                                                                 |
| `jjx.commandTimeout`                | `null`      | Global timeout in milliseconds for all jj commands. If not set, per-command defaults will be used                                                 |
| `jjx.jjPath`                        | `""`        | Path to the jj executable. If not set, your PATH and common locations will be searched                                                            |
| `jjx.changeEditAction`              | `"edit"`    | Action when clicking the edit button on a change: `"edit"` (jj edit) or `"new"` (jj new)                                                          |
| `jjx.commitAction`                  | `"commit"`  | Action when pressing Ctrl+Enter in source control: `"commit"` (jj commit) or `"new"` (jj new)                                                     |
| `jjx.graphStyle`                    | `"compact"` | Display style for commits: `"full"` shows all details, `"compact"` shows single line                                                              |
| `jjx.pollInterval`                  | `30000`     | Interval in milliseconds between repository polls. Set to 0 to disable                                                                            |
| `jjx.fileClickAction`               | `"diff"`    | Action when clicking a file: `"diff"` (compare to parent), `"at-revision"` (open at clicked revision), or `"working-copy"` (open in working copy) |
| `jjx.elideImmutableCommits`         | `true`      | Hide chains of immutable commits between relevant commits in the graph view                                                                       |
| `jjx.numberOfImmutableParentsInLog` | `1`         | Number of immutable parent commits to show in the log                                                                                             |

## 🐛 Known issues

If you encounter any problems, please [report them on GitHub](https://github.com/Christoph-D/jjx/issues/)!

## 🔧 Troubleshooting

### Double modification annotations ("M, M") in file explorer

If you see annotations like "M, M" next to files, this is caused by VS Code's built-in Git extension running alongside
JJX. To disable Git, disable `git.enabled` in your VS Code settings.

### "Show elided commits" in the graph doesn't show all commits

This button only affects commits between regularly visible commits, not how many immutable parent commits are shown that
lead outside the visible set of commits. To increase the number of immutable parent commits in the log, adjust the
setting `jjx.numberOfImmutableParentsInLog`.

## 📝 License

This project is licensed under the [AGPL-3.0 License](LICENSE). Code from the original project
[Jujutsu Kaizen](https://github.com/keanemind/jjk) is licensed under the MIT License. See [LICENSE.md](LICENSE.md) for
details.
