# Jujutsu X (jjx)

A VS Code extension for the [Jujutsu (jj)](https://github.com/jj-vcs/jj) version control system.

## Development

- **Build**: `npm run build`
- **Watch**: `npm run watch`
- **Type check**: `npm run check-types`
- **Lint**: `npm run lint`

## Testing

- Unit tests in `src/unit-test`: `npm run unit-test`
- VSCode tests in `src/test`: `npm run vscode-test`
- Run all tests: `npm run test`

### Integration Tests

To iterate on an integration test, change the test to `test.only()` and then run `npm run playwright-test:only-test`.

Do not add custom timeouts to Playwright expectations. The Playwright config already sets `expect.timeout` to 10
seconds.

## Architecture

| File                        | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `src/main.ts`               | Extension entry point, command registration   |
| `src/repository.ts`         | Core JJ command execution, repository state   |
| `src/templateBuilder.ts`    | JJ template string generation for JSON output |
| `src/graphWebview.ts`       | Interactive commit graph visualization        |
| `src/laneAssigner.ts`       | Algorithm for commit graph lane layout        |
| `src/fileSystemProvider.ts` | Virtual file system for `jj://` URIs          |

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

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- Format: `<type>: <description>`
- Types: `feat`, `fix`, `test`, `ci`, `docs`, `chore`
- Description: sentence case, imperative mood, no trailing period

Examples: `feat: Use HTML5 drag&drop API`, `test: Test rebase drag&drop`,
`fix: Run npm install in the create-release agent`
