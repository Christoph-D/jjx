/**
 * Template field definitions for generating jj template strings.
 * This module provides a type-safe way to define template fields and generate
 * the corresponding jj template syntax for JSON output.
 */

export interface PrimitiveField {
  type: "string" | "raw" | "boolean" | "number";
  expr: string;
}

export interface DictField {
  type: "dict";
  contents: TemplateFields;
}

export interface ArrayField {
  type: "array";
  expr: string;
  loopVar: string;
  contents: TemplateFields;
}

export interface StringArrayField {
  type: "string_array";
  expr: string;
  loopVar: string;
  value: string;
}

export type TemplateField = PrimitiveField | DictField | ArrayField | StringArrayField;

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
      return `"\\"${escapedName}\\": [" ++ ${field.expr}.map(|${field.loopVar}| "\\"" ++ ${field.value} ++ "\\"").join(",") ++ "]"`;
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
    expr: 'author.timestamp().local().format("%F %H:%M:%S")',
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
  diff: {
    type: "dict",
    contents: {
      files: {
        type: "array",
        expr: "self.diff().stat().files()",
        loopVar: "f",
        contents: {
          path: { type: "string", expr: "f.path().display()" },
          status_char: { type: "string", expr: "f.status_char()" },
        },
      },
      total_added: {
        type: "number",
        expr: "self.diff().stat().total_added()",
      },
      total_removed: {
        type: "number",
        expr: "self.diff().stat().total_removed()",
      },
    },
  },
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

const OPERATION_ENTRY_FIELDS: TemplateFields = {
  id: { type: "string", expr: "self.id()" },
  description: { type: "string", expr: "self.description()" },
  tags: { type: "string", expr: "self.tags()" },
  start: { type: "string", expr: "self.time().start()" },
  user: { type: "string", expr: "self.user()" },
  snapshot: { type: "boolean", expr: "self.snapshot()" },
};

export const SHOW_TEMPLATE = generateTemplate(SHOW_ENTRY_FIELDS);
export const STATUS_TEMPLATE = generateTemplate(STATUS_ENTRY_FIELDS);
export const LOG_TEMPLATE = generateTemplate(LOG_ENTRY_FIELDS);
export const OPERATION_TEMPLATE = generateTemplate(OPERATION_ENTRY_FIELDS);
