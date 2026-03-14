# Jujutsu Kaizen (jjk)

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

## Architecture

| File | Purpose |
|------|---------|
| `src/main.ts` | Extension entry point, command registration |
| `src/repository.ts` | Core JJ command execution, repository state |
| `src/templateBuilder.ts` | JJ template string generation for JSON output |
| `src/graphWebview.ts` | Interactive commit graph visualization |
| `src/laneAssigner.ts` | Algorithm for commit graph lane layout |
| `src/fileSystemProvider.ts` | Virtual file system for `jj://` URIs |

## JJ Templating Reference

This extension uses JJ's templating language to parse command output. See the official docs:
https://docs.jj-vcs.dev/latest/templates/

Key types used: `Commit`, `ChangeId`, `CommitId`, `Signature`, `Timestamp`.

## Code Conventions

- TypeScript strict mode, ES2022 target
- ES modules with bundler resolution
- No comments unless requested
- Follow existing patterns in neighboring files
