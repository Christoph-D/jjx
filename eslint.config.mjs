// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Selectors matching `vscode.Uri.file(...)` and a directly imported `Uri.file(...)`.
const uriFileSelectors = [
  {
    selector: "CallExpression[callee.property.name='file'][callee.object.name='Uri']",
    message:
      "Uri.file() is restricted to the modules approved in eslint.config.mjs. Construct file URIs with toWorkspaceUri() from src/workspace-paths.ts so they use the workspace folder's path spelling.",
  },
  {
    selector: "CallExpression[callee.property.name='file'][callee.object.object.name='vscode']",
    message:
      "vscode.Uri.file() is restricted to the modules approved in eslint.config.mjs. Construct file URIs with toWorkspaceUri() from src/workspace-paths.ts so they use the workspace folder's path spelling.",
  },
];

// Selectors matching repository-root-anchored path arithmetic, i.e. path.join/path.relative whose
// first argument is a `<expr>.repositoryRoot` member or a `repositoryRoot`/`repoRoot` binding.
const repositoryRootPathSelectors = [
  {
    selector:
      "CallExpression[callee.object.name='path'][callee.property.name=/^(join|relative)$/] > MemberExpression:first-child[computed=false][property.name='repositoryRoot']",
    message:
      "Repository-root-anchored path.join/path.relative is restricted to the modules approved in eslint.config.mjs. Resolve the path spelling first (resolveRepositoryPath) and compute repo-relative paths with repositoryRelativePath()/joinRepositoryPath() from src/workspace-paths.ts.",
  },
  {
    selector:
      "CallExpression[callee.object.name='path'][callee.property.name=/^(join|relative)$/] > Identifier:first-child[name=/^(repositoryRoot|repoRoot)$/]",
    message:
      "Repository-root-anchored path.join/path.relative is restricted to the modules approved in eslint.config.mjs. Resolve the path spelling first (resolveRepositoryPath) and compute repo-relative paths with repositoryRelativePath()/joinRepositoryPath() from src/workspace-paths.ts.",
  },
];

export default tseslint.config(
  {
    ignores: ["dist/", "src/webview/graph/.generated/"],
  },
  eslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },

    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],
      "@typescript-eslint/prefer-promise-reject-errors": ["error", { allowThrowingUnknown: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "warn",
    },
  },
  // ---------------------------------------------------------------------
  // Path and URI construction guardrails.
  //
  // Paths come in two spellings (see src/workspace-paths.ts): the resolved (realpath) spelling
  // that jj reports (repository roots, file statuses) and the spelling VS Code keeps for the
  // workspace folders (symlinked roots such as /var -> /private/var on macOS, 8.3 short names
  // and drive-letter case on Windows). Constructing URIs or repo-relative paths with the wrong
  // spelling passes on Linux while breaking Windows/macOS, so review cannot catch it. These
  // rules keep URI construction and repository-root-anchored path arithmetic out of modules
  // that should not spell paths themselves: everything else must go through the helpers in
  // src/workspace-paths.ts (toWorkspaceUri, repositoryRelativePath, joinRepositoryPath) and the
  // unified resolver resolveRepositoryPath, which also covers paths that no longer exist on
  // disk (deleted files).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      // Approved for both URI construction and repository-root path arithmetic:
      // - src/workspace-paths.ts: the approved helpers themselves.
      // - src/source-control.ts: the SCM resource URI construction sites, which explicitly build
      //   URIs in the workspace spelling because VS Code derives the displayed paths from it,
      //   plus `.jj/repo` discovery and watcher filtering against the resolved root.
      // - src/unit-test/**: tests.
      "src/workspace-paths.ts",
      "src/source-control.ts",
      "src/unit-test/**",
      // Approved for repository-root path arithmetic only (URI construction stays restricted):
      // - src/repository.ts: turns absolute paths into the root-relative filesets handed to jj;
      //   incoming absolute paths are resolved through resolveRepositoryPath().
      // - src/parse-file-statuses.ts, src/parse-interdiff-summary.ts: join jj's repo-relative
      //   stdout paths onto the resolved root to produce RealPath file statuses.
      "src/repository.ts",
      "src/parse-file-statuses.ts",
      "src/parse-interdiff-summary.ts",
      // Approved for URI construction only (path arithmetic stays restricted):
      // - src/decoration-provider.ts: announces decoration changes with URIs in *both* spellings
      //   because VS Code may know the same file under either.
      "src/decoration-provider.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...uriFileSelectors, ...repositoryRootPathSelectors],
    },
  },
  {
    files: ["src/repository.ts", "src/parse-file-statuses.ts", "src/parse-interdiff-summary.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...uriFileSelectors],
    },
  },
  {
    files: ["src/decoration-provider.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...repositoryRootPathSelectors],
    },
  },
  {
    files: ["src/webview/{graph,split}/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },

    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "warn",
    },
  },
);
