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
   jj tag list -T name --sort committer-date 'v*'
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

5. **Get user confirmation:** Present the proposed tag value and the proposed changes to CHANGELOG.md to the user. Ask
   them to review and confirm before proceeding. Do not continue until the user approves.

6. **Update CHANGELOG.md** with the new release notes summarizing the changes.

7. **Update package.json** with the new version in the `version` field.

8. **Run npm install** to update package-lock.json:

   ```
   npm install
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
