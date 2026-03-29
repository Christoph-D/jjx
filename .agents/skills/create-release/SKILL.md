---
name: create-release
description:
  Create a new release by determining version bump from commits and updating changelog, package.json, and creating a tag
---

## What I do

Create a new release for the JJX extension following semantic versioning.

## Steps

1. **Find the most recent version tag:**

   ```
   jj tag list -T 'name ++ "\n"' --sort committer-date 'v*'
   ```

2. **Review commits since the last version:**

   ```
   jj log -r 'v1.0.0..@-' -T 'change_id.short() ++ " " ++ description'
   ```

   Where `$oldtag` is the tag from step 1. Be sure to use this exact command.

3. **Deep review specific commits:** For any commits that need a deeper review to understand the changes:

   ```
   jj show $change_id
   ```

4. **Determine the new version using semantic versioning:**
   - `fix:` commits → patch version bump (e.g., 1.0.0 → 1.0.1)
   - `feat:` commits → minor version bump (e.g., 1.0.0 → 1.1.0)
   - Breaking changes → major version bump (e.g., 1.0.0 → 2.0.0)
   - Read all commits and use judgment for the appropriate bump level

5. **Update CHANGELOG.md with the new release notes:**

   **CRITICAL: You MUST write the updated CHANGELOG.md to disk BEFORE asking the user for confirmation.** The user
   cannot review or edit the changelog if you haven't written it to the file. Do not just show the user your proposed
   changes—actually write them to CHANGELOG.md first.

6. **Get user confirmation:** After writing to CHANGELOG.md, tell the user that you wrote the new release notes to
   CHANGELOG.md. Ask them to review and edit CHANGELOG.md if needed. Do not continue until the user approves.

7. **Update package.json** with the new version in the `version` field.

8. **Run pnpm install** to update pnpm-lock.yaml:

   ```
   pnpm install
   ```

9. **Commit the version bump:**

   ```
   jj commit -m 'chore: Bump version to $tag'
   ```

10. **Move the main bookmark to the new change:**

    ```
    jj bookmark move main -t @-
    ```

11. **Create the new tag:**

    ```
    jj tag set -r main $tag
    ```

## When to use me

Use this skill when preparing a new release of the JJX extension. The skill handles the entire release process from
determining the version to creating the tag.
