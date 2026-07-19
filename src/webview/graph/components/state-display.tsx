import { type HTMLAttributes, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "preact";
import type { ComponentChildren } from "preact";
import styles from "./state-display.module.css";

interface StateDisplayProps extends Omit<HTMLAttributes<HTMLDivElement>, "class"> {
  icon: string;
  message: string;
  children?: ComponentChildren;
}

export function StateDisplay({ icon, message, children, ...rest }: StateDisplayProps) {
  return (
    <div class={styles.stateDisplay} {...rest}>
      <div class={styles.icon}>
        <i class={`codicon codicon-${icon}`}></i>
      </div>
      <div class={styles.message} data-role="message">
        {message}
      </div>
      {children}
    </div>
  );
}

export function StateDescription({ children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div class={styles.description} {...rest}>
      {children}
    </div>
  );
}

export function StateActionButton({ children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button class={styles.action} {...rest}>
      {children}
    </button>
  );
}

export function StateActionLink({ children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a class={styles.action} style={{ textDecoration: "none" }} {...rest}>
      {children}
    </a>
  );
}
