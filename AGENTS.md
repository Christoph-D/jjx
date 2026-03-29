# Jujutsu X (jjx)

A VS Code extension for the [Jujutsu (jj)](https://github.com/jj-vcs/jj) version control system.

## Development

- **Build**: `pnpm run build`
- **Watch**: `pnpm run watch`
- **Type check**: `pnpm run check-types`
- **Lint**: `pnpm run lint`

## Testing

- Unit tests in `src/unit-test`: `pnpm run unit-test`
- Integration tests in `src/tests-integration`: `pnpm run playwright-test`
- Run all tests: `pnpm run test`

### Integration Tests

To iterate on an integration test, change the test to `test.only()` and then run `pnpm run playwright-test:only-test`.

Do not add custom timeouts to Playwright expectations. The Playwright config already sets `expect.timeout` to 20
seconds.

## Architecture

| File                          | Purpose                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `src/main.ts`                 | Extension entry point, command registration                  |
| `src/repository.ts`           | Core JJ command execution, repository state                  |
| `src/sourceControl.ts`        | VS Code source control integration                           |
| `src/templateBuilder.ts`      | JJ template string generation for JSON output                |
| `src/graphWebview.ts`         | Commit graph webview host                                    |
| `src/webview/graph/`          | Commit graph UI (Preact)                                     |
| `src/laneAssigner.ts`         | Algorithm for commit graph lane layout                       |
| `src/elidedEdges.ts`          | Collapsed edge rendering for graph                           |
| `src/fileSystemProvider.ts`   | Virtual file system for `jj://` URIs                         |
| `src/ipc/`                    | IPC server/client for extension subprocess communication     |
| `src/jjEditor.ts`             | External editor integration (`jj edit`, squash, merge, diff) |
| `src/decorationProvider.ts`   | In-editor line decorations (change IDs, etc.)                |
| `src/operationLogTreeView.ts` | Tree view for JJ operation log                               |

## JJ Templating Reference

This extension uses JJ's templating language to parse command output. See the official docs:
https://docs.jj-vcs.dev/latest/templates/

Key types used: `Commit`, `ChangeId`, `CommitId`, `Signature`, `Timestamp`.

## Version Control

If `jj status` works, then this is a jj repository. In this case you must use `jj` commands instead of `git`. Do not try
to use `git`:

- **Commit**: `jj commit -m $message`
- **Status**: `jj status`
- **Diff**: `jj show --git`
- **Recent changes**: `jj log --limit 5 -r '..@' -T 'change_id.short() ++ " " ++ description.first_line()'`

Git commands appear to work because jj repositories are often colocated with git repositories. If any jj command works,
then you must use only jj commands and never git commands.

## Code Conventions

- TypeScript strict mode, ES2022 target
- ES modules with bundler resolution
- No comments unless requested
- Existing comments should remain in place unless they become incorrect
- Follow existing patterns in neighboring files

### UI Text Capitalization

Use Title Case for UI elements (capitalizing all words except articles, coordinating conjunctions, and prepositions with
4 or fewer letters):

- **Command titles**: "Open File", "Fetch from Remote", "Move Changes to Parent"
- **Menu items**: "Edit This Change", "Rebase onto This Change"
- **Placeholders**: "Select a Repository", "Select Parent to Squash Into"
- **Labels**: "Working Copy Is Stale"

Use sentence case for full sentences (questions, statements, descriptions in message boxes and confirmations):

- "Are you sure you want to discard changes in this change?"
- "Are you sure you want to abandon this change?"
- "Moving bookmark backwards or sideways, are you sure?"
- "The working copy state is outdated and needs to be refreshed."

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- Format: `<type>: <description>`
- Types: `feat`, `fix`, `test`, `ci`, `docs`, `chore`
- Description: sentence case, imperative mood, no trailing period

Examples: `feat: Use HTML5 drag&drop API`, `test: Test rebase drag&drop`,
`fix: Run pnpm install in the create-release agent`
