/**
 * Template field definitions for generating jj template strings.
 * This module provides a type-safe way to define template fields and generate
 * the corresponding jj template syntax for JSON output.
 */
import { type JJVersion, versionAtLeast, JJ_VERSION_WITH_OPERATION_ATTRIBUTES } from "./constants";

interface PrimitiveField {
  type: "string" | "raw" | "boolean" | "number";
  expr: string;
}

interface DictField {
  type: "dict";
  contents: TemplateFields;
}

interface ArrayField {
  type: "array";
  expr: string;
  loopVar: string;
  contents: TemplateFields;
}

interface StringArrayField {
  type: "string_array";
  expr: string;
  loopVar: string;
  value: string;
}

type TemplateField = PrimitiveField | DictField | ArrayField | StringArrayField;

export type TemplateFields = Record<string, TemplateField>;

function escapeTemplateString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function generatePrimitiveValue(field: PrimitiveField): string {
  const value = field.expr;
  if (field.type === "string") {
    return `stringify(${value}).escape_json()`;
  }
  if (field.type === "boolean") {
    return `if(${value}, "true", "false")`;
  }
  return value;
}

function generateFieldEntry(name: string, field: TemplateField): string {
  const escapedName = escapeTemplateString(name);

  switch (field.type) {
    case "string":
      return `"\\"${escapedName}\\": " ++ ${generatePrimitiveValue(field)}`;
    case "raw":
      return `"\\"${escapedName}\\": " ++ ${generatePrimitiveValue(field)}`;
    case "number":
      return `"\\"${escapedName}\\": " ++ ${generatePrimitiveValue(field)}`;
    case "boolean":
      return `"\\"${escapedName}\\": " ++ ${generatePrimitiveValue(field)}`;
    case "dict": {
      const inner = generateFields(field.contents);
      return `"\\"${escapedName}\\": {" ++ ${inner} ++ "}"`;
    }
    case "array": {
      const inner = generateFields(field.contents, field.loopVar);
      return `"\\"${escapedName}\\": [" ++ ${field.expr}.map(|${field.loopVar}| "{" ++ ${inner} ++ "}").join(",") ++ "]"`;
    }
    case "string_array":
      return `"\\"${escapedName}\\": [" ++ ${field.expr}.map(|${field.loopVar}| stringify(${field.value}).escape_json()).join(",") ++ "]"`;
  }
}

function applyPrefix(field: TemplateField, prefix: string): TemplateField {
  if (prefix && field.type !== "dict" && field.type !== "array" && field.type !== "string_array") {
    const value = field.expr;
    const prefixedValue = value.includes(".") || value.includes("(") ? value : `${prefix}.${value}`;
    return { ...field, expr: prefixedValue };
  }
  return field;
}

function generateFields(fields: TemplateFields, prefix?: string): string {
  const entries: string[] = [];
  const sortedKeys = Object.keys(fields).sort();

  for (let i = 0; i < sortedKeys.length; i++) {
    const name = sortedKeys[i];
    const field = applyPrefix(fields[name], prefix ?? "");
    entries.push(generateFieldEntry(name, field));
  }

  return entries.join(` ++ "," ++ `);
}

/**
 * Generates a complete jj template string that outputs JSON objects
 * @param fields - The fields to include in the JSON output (keys are field names)
 * @returns A jj template string
 */
export function generateTemplate(fields: TemplateFields): string {
  const fieldsStr = generateFields(fields);
  return `"{" ++ ${fieldsStr} ++ "}\\n"`;
}

const SHOW_ENTRY_FIELDS: TemplateFields = {
  change_id: { type: "string", expr: "change_id" },
  change_id_shortest: { type: "string", expr: "change_id.shortest()" },
  commit_id: { type: "string", expr: "commit_id" },
  divergent: { type: "boolean", expr: "self.divergent()" },
  change_offset: {
    type: "string",
    expr: 'if(self.change_offset(), self.change_offset(), "")',
  },
  author: {
    type: "dict",
    contents: {
      name: { type: "string", expr: "author.name()" },
      email: { type: "string", expr: "author.email()" },
    },
  },
  authored_date: {
    type: "string",
    expr: 'author.timestamp().utc().format("%FT%H:%M:%SZ")',
  },
  description: { type: "string", expr: "description" },
  empty: { type: "boolean", expr: "self.empty()" },
  conflict: { type: "boolean", expr: "self.conflict()" },
  diff_files: {
    type: "array",
    expr: "self.diff().files()",
    loopVar: "entry",
    contents: {
      status_char: { type: "string", expr: "entry.status_char()" },
      source_path: { type: "string", expr: "entry.source().path().display()" },
      target_path: { type: "string", expr: "entry.target().path().display()" },
      is_conflict: { type: "boolean", expr: "entry.target().conflict()" },
    },
  },
  conflicted_files: {
    type: "string_array",
    expr: "self.conflicted_files()",
    loopVar: "f",
    value: "f.path().display()",
  },
};

const STATUS_ENTRY_FIELDS: TemplateFields = {
  change_id: { type: "string", expr: "change_id" },
  change_id_shortest: { type: "string", expr: "change_id.shortest()" },
  commit_id: { type: "string", expr: "commit_id" },
  divergent: { type: "boolean", expr: "self.divergent()" },
  change_offset: {
    type: "string",
    expr: 'if(self.change_offset(), self.change_offset(), "")',
  },
  description: { type: "string", expr: "description" },
  empty: { type: "boolean", expr: "self.empty()" },
  conflict: { type: "boolean", expr: "self.conflict()" },
  local_bookmarks: {
    type: "string_array",
    expr: "self.local_bookmarks()",
    loopVar: "b",
    value: "b.name()",
  },
  parents: {
    type: "array",
    expr: "parents",
    loopVar: "p",
    contents: {
      change_id: { type: "string", expr: "p.change_id()" },
      change_id_shortest: { type: "string", expr: "p.change_id().shortest()" },
      commit_id: { type: "string", expr: "p.commit_id()" },
      divergent: { type: "boolean", expr: "p.divergent()" },
      change_offset: {
        type: "string",
        expr: 'if(p.change_offset(), p.change_offset(), "")',
      },
      description: { type: "string", expr: "p.description()" },
      empty: { type: "boolean", expr: "p.empty()" },
      conflict: { type: "boolean", expr: "p.conflict()" },
      local_bookmarks: {
        type: "string_array",
        expr: "p.local_bookmarks()",
        loopVar: "b",
        value: "b.name()",
      },
    },
  },
  diff_files: {
    type: "array",
    expr: "self.diff().files()",
    loopVar: "entry",
    contents: {
      status_char: { type: "string", expr: "entry.status_char()" },
      source_path: { type: "string", expr: "entry.source().path().display()" },
      target_path: { type: "string", expr: "entry.target().path().display()" },
      is_conflict: { type: "boolean", expr: "entry.target().conflict()" },
    },
  },
  conflicted_files: {
    type: "string_array",
    expr: "self.conflicted_files()",
    loopVar: "f",
    value: "f.path().display()",
  },
};

const LOG_ENTRY_FIELDS: TemplateFields = {
  author: {
    type: "dict",
    contents: {
      email: { type: "string", expr: "author.email()" },
      name: { type: "string", expr: "author.name()" },
      timestamp: {
        type: "string",
        expr: 'author.timestamp().local().format("%Y-%m-%d %H:%M:%S")',
      },
    },
  },
  local_bookmarks: {
    type: "array",
    expr: "self.local_bookmarks()",
    loopVar: "b",
    contents: {
      name: { type: "string", expr: "b.name()" },
      synced: { type: "boolean", expr: "b.synced()" },
      conflict: { type: "boolean", expr: "b.conflict()" },
    },
  },
  remote_bookmarks: {
    type: "array",
    expr: "self.remote_bookmarks()",
    loopVar: "b",
    contents: {
      name: { type: "string", expr: "b.name()" },
      remote: { type: "string", expr: "b.remote()" },
    },
  },
  change_id: { type: "string", expr: "change_id" },
  change_id_short: { type: "string", expr: "change_id.short(8)" },
  change_id_shortest: { type: "string", expr: "change_id.shortest()" },
  commit_id: { type: "string", expr: "commit_id" },
  commit_id_short: { type: "string", expr: "commit_id.short(8)" },
  committer: {
    type: "dict",
    contents: {
      email: { type: "string", expr: "committer.email()" },
      name: { type: "string", expr: "committer.name()" },
      timestamp: {
        type: "string",
        expr: 'committer.timestamp().local().format("%Y-%m-%d %H:%M:%S")',
      },
    },
  },
  conflict: { type: "boolean", expr: "self.conflict()" },
  current_working_copy: {
    type: "boolean",
    expr: "self.current_working_copy()",
  },
  description: { type: "string", expr: "description" },
  empty: { type: "boolean", expr: "self.empty()" },
  immutable: { type: "boolean", expr: "self.immutable()" },
  mine: { type: "boolean", expr: "self.mine()" },
  parents: {
    type: "array",
    expr: "parents",
    loopVar: "p",
    contents: {
      change_id: { type: "string", expr: "p.change_id()" },
      divergent: { type: "boolean", expr: "p.divergent()" },
      change_offset: {
        type: "string",
        expr: 'if(p.change_offset(), p.change_offset(), "")',
      },
    },
  },
  root: { type: "boolean", expr: "self.root()" },
  local_tags: {
    type: "array",
    expr: "self.local_tags()",
    loopVar: "t",
    contents: {
      name: { type: "string", expr: "t.name()" },
      synced: { type: "boolean", expr: "t.synced()" },
      conflict: { type: "boolean", expr: "t.conflict()" },
    },
  },
  remote_tags: {
    type: "array",
    expr: "self.remote_tags()",
    loopVar: "t",
    contents: {
      name: { type: "string", expr: "t.name()" },
      remote: { type: "string", expr: "t.remote()" },
    },
  },
  working_copies: {
    type: "string_array",
    expr: "self.working_copies()",
    loopVar: "wc",
    value: "wc.name()",
  },
  divergent: { type: "boolean", expr: "self.divergent()" },
  hidden: { type: "boolean", expr: "self.hidden()" },
  change_offset: {
    type: "string",
    expr: 'if(self.change_offset(), self.change_offset(), "")',
  },
};

const DIFF_FILES_FIELD: TemplateFields = {
  diff_files: {
    type: "array",
    expr: "self.diff().files()",
    loopVar: "entry",
    contents: {
      status_char: { type: "string", expr: "entry.status_char()" },
      source_path: { type: "string", expr: "entry.source().path().display()" },
      target_path: { type: "string", expr: "entry.target().path().display()" },
      is_conflict: { type: "boolean", expr: "entry.target().conflict()" },
    },
  },
  conflicted_files: {
    type: "string_array",
    expr: "self.conflicted_files()",
    loopVar: "f",
    value: "f.path().display()",
  },
};

/**
 * Builds the `jj log` JSON template. When `includeFiles` is true, the template
 * additionally includes per-file change data (`diff_files` and
 * `conflicted_files`), mirroring `SHOW_ENTRY_FIELDS`.
 */
export function buildLogTemplate(opts?: { includeFiles?: boolean }): string {
  const fields: TemplateFields = opts?.includeFiles ? { ...LOG_ENTRY_FIELDS, ...DIFF_FILES_FIELD } : LOG_ENTRY_FIELDS;
  return generateTemplate(fields);
}

/**
 * Builds the `jj operation log` JSON template.
 *
 * jj 0.41 deprecated `operation.tags()` in favor of `operation.attributes()`.
 * The JSON output key is `attributes` either way.
 */
export function buildOperationTemplate(version?: JJVersion): string {
  const attributesExpr =
    version && versionAtLeast(version, JJ_VERSION_WITH_OPERATION_ATTRIBUTES) ? "self.attributes()" : "self.tags()";
  const fields: TemplateFields = {
    id: { type: "string", expr: "self.id()" },
    description: { type: "string", expr: "self.description()" },
    attributes: { type: "string", expr: attributesExpr },
    start: { type: "string", expr: "self.time().start()" },
    user: { type: "string", expr: "self.user()" },
    snapshot: { type: "boolean", expr: "self.snapshot()" },
  };
  return generateTemplate(fields);
}

const DIFF_STATS_FIELDS: TemplateFields = {
  files_changed: {
    type: "number",
    expr: "self.diff().stat().files().len()",
  },
  total_added: {
    type: "number",
    expr: "self.diff().stat().total_added()",
  },
  total_removed: {
    type: "number",
    expr: "self.diff().stat().total_removed()",
  },
};

const CONFLICTED_FILES_FIELDS: TemplateFields = {
  conflicted_files: {
    type: "string_array",
    expr: "self.conflicted_files()",
    loopVar: "f",
    value: "f.path().display()",
  },
};

const WORKSPACE_LIST_FIELDS: TemplateFields = {
  name: { type: "string", expr: "self.name()" },
  // The root is optional and unreliable: `WorkspaceRef.root()` requires
  // jj 0.40.0, workspaces created before jj 0.38.0 did not record one, and
  // jj 0.44+ renders it empty when the recorded path is stale (directory
  // moved or deleted). Use `getWorkspaceRoot()` for a strict per-workspace
  // lookup.
  root: { type: "string", expr: "self.root()" },
};

const BOOKMARK_TRACKING_INFO_FIELDS: TemplateFields = {
  remote: { type: "string", expr: "remote" },
  synced: { type: "boolean", expr: "synced" },
  tracked: { type: "boolean", expr: "tracked" },
};

/**
 * Per-entry bookmark/tag status.
 */
const REMOTE_REF_STATUS_FIELDS: TemplateFields = {
  remote: { type: "string", expr: "remote" },
  tracked: { type: "boolean", expr: "tracked" },
  synced: { type: "boolean", expr: "synced" },
  present: { type: "boolean", expr: "present" },
};

export const SHOW_TEMPLATE = generateTemplate(SHOW_ENTRY_FIELDS);
export const STATUS_TEMPLATE = generateTemplate(STATUS_ENTRY_FIELDS);
export const LOG_TEMPLATE = buildLogTemplate();
export const DIFF_STATS_TEMPLATE = generateTemplate(DIFF_STATS_FIELDS);
export const CONFLICTED_FILES_TEMPLATE = generateTemplate(CONFLICTED_FILES_FIELDS);
export const BOOKMARK_TRACKING_INFO_TEMPLATE = generateTemplate(BOOKMARK_TRACKING_INFO_FIELDS);
export const REMOTE_REF_STATUS_TEMPLATE = generateTemplate(REMOTE_REF_STATUS_FIELDS);
export const WORKSPACE_LIST_TEMPLATE = generateTemplate(WORKSPACE_LIST_FIELDS);
