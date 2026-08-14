import type { SplitCheckState } from "../../../split/hunk-model";

interface Props {
  state: SplitCheckState;
  title?: string;
  onChange: (checked: boolean) => void;
}

/** Native checkbox driven to tri-state (`indeterminate` is a DOM property, so Preact sets it directly). */
export function TriStateCheckbox({ state, title, onChange }: Props) {
  return (
    <input
      type="checkbox"
      class="splitCheckbox"
      checked={state === true}
      indeterminate={state === "indeterminate"}
      title={title}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
    />
  );
}
