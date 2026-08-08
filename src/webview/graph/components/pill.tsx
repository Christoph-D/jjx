import { type HTMLAttributes } from "preact";
import { cx } from "../utils";
import styles from "./pill.module.css";

interface LocalPillProps extends HTMLAttributes<HTMLSpanElement> {
  conflict: boolean;
  synced: boolean;
}

export function BookmarkPill({ conflict, synced, ...rest }: LocalPillProps) {
  return (
    <span
      class={cx(styles.pill, styles.bookmarkPill, conflict ? styles.conflicted : !synced && styles.unsynced)}
      {...rest}
    />
  );
}

export function TagPill({ conflict, synced, ...rest }: LocalPillProps) {
  return (
    <span
      class={cx(styles.pill, styles.tagPill, conflict ? styles.conflicted : !synced && styles.unsynced)}
      {...rest}
    />
  );
}

export function RemoteBookmarkPill({ ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span class={cx(styles.pill, styles.bookmarkPill, styles.remotePill)} {...rest} />;
}

export function RemoteTagPill({ ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span class={cx(styles.pill, styles.tagPill, styles.remotePill)} {...rest} />;
}

export function WorkspacePill({ ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span class={cx(styles.pill, styles.workspacePill)} {...rest} />;
}

interface BookmarkPushIconProps extends HTMLAttributes<HTMLSpanElement> {
  pushing?: boolean;
}

export function BookmarkPushIcon({ pushing, ...rest }: BookmarkPushIconProps) {
  return (
    <i
      class={cx(
        "codicon",
        pushing ? "codicon-sync" : "codicon-cloud-upload",
        pushing && "codicon-modifier-spin",
        styles.bookmarkPushIcon,
        pushing && styles.bookmarkPushingIcon,
      )}
      data-role="push-icon"
      {...rest}
    />
  );
}
