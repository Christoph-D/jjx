/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateTemplate,
  TemplateFields,
  LOG_ENTRY_FIELDS,
} from "../templateBuilder";

describe("TemplateBuilder Test Suite", () => {
  it("generateTemplate with string field", () => {
    const fields: TemplateFields = {
      email: { type: "string", expr: "author.email()" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"email\\": \\"" ++ author.email() ++ "\\"" ++ "}\\n"`,
    );
  });

  it("generateTemplate with multiple string fields (sorted alphabetically)", () => {
    const fields: TemplateFields = {
      zebra: { type: "string", expr: "a" },
      alpha: { type: "string", expr: "z" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"alpha\\": \\"" ++ z ++ "\\"" ++ "," ++ "\\"zebra\\": \\"" ++ a ++ "\\"" ++ "}\\n"`,
    );
  });

  it("generateTemplate with raw field", () => {
    const fields: TemplateFields = {
      description: { type: "raw", expr: "description.escape_json()" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"description\\": " ++ description.escape_json() ++ "}\\n"`,
    );
  });

  it("generateTemplate with boolean field", () => {
    const fields: TemplateFields = {
      conflict: { type: "boolean", expr: "self.conflict()" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"conflict\\": " ++ if(self.conflict(), "true", "false") ++ "}\\n"`,
    );
  });

  it("generateTemplate with number field", () => {
    const fields: TemplateFields = {
      count: { type: "number", expr: "files.len()" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"count\\": " ++ files.len() ++ "}\\n"`,
    );
  });

  it("generateTemplate with dict field", () => {
    const fields: TemplateFields = {
      author: {
        type: "dict",
        contents: {
          email: { type: "string", expr: "author.email()" },
          name: { type: "raw", expr: "author.name()" },
        },
      },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"author\\": {" ++ "\\"email\\": \\"" ++ author.email() ++ "\\"" ++ "," ++ "\\"name\\": " ++ author.name() ++ "}" ++ "}\\n"`,
    );
  });

  it("generateTemplate with array field", () => {
    const fields: TemplateFields = {
      files: {
        type: "array",
        expr: "self.diff().files()",
        loopVar: "x",
        contents: {
          path: { type: "string", expr: "x.path()" },
        },
      },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"files\\": [" ++ self.diff().files().map(|x| "{" ++ "\\"path\\": \\"" ++ x.path() ++ "\\"" ++ "}").join(",") ++ "]" ++ "}\\n"`,
    );
  });

  it("generateTemplate with array field using custom loopVar", () => {
    const fields: TemplateFields = {
      parents: {
        type: "array",
        expr: "parents",
        loopVar: "p",
        contents: {
          id: { type: "string", expr: "p.change_id()" },
        },
      },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"parents\\": [" ++ parents.map(|p| "{" ++ "\\"id\\": \\"" ++ p.change_id() ++ "\\"" ++ "}").join(",") ++ "]" ++ "}\\n"`,
    );
  });

  it("generateTemplate with string_array field", () => {
    const fields: TemplateFields = {
      tags: {
        type: "string_array",
        expr: "tags",
        loopVar: "t",
        value: "t.name()",
      },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"tags\\": [" ++ tags.map(|t| "\\"" ++ t.name() ++ "\\"").join(",") ++ "]" ++ "}\\n"`,
    );
  });

  it("generateTemplate escapes quotes in field names", () => {
    const fields: TemplateFields = {
      'field"with"quotes': { type: "string", expr: "x" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"field\\"with\\"quotes\\": \\"" ++ x ++ "\\"" ++ "}\\n"`,
    );
  });

  it("generateTemplate escapes backslashes in field names", () => {
    const fields: TemplateFields = {
      "field\\with\\backslash": { type: "string", expr: "x" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"field\\\\with\\\\backslash\\": \\"" ++ x ++ "\\"" ++ "}\\n"`,
    );
  });

  it("generateTemplate with complex nested structure", () => {
    const fields: TemplateFields = {
      change_id: { type: "string", expr: "change_id" },
      author: {
        type: "dict",
        contents: {
          email: { type: "string", expr: "author.email()" },
          name: { type: "string", expr: "author.name()" },
        },
      },
      empty: { type: "boolean", expr: "self.empty()" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"author\\": {" ++ "\\"email\\": \\"" ++ author.email() ++ "\\"" ++ "," ++ "\\"name\\": \\"" ++ author.name() ++ "\\"" ++ "}" ++ "," ++ "\\"change_id\\": \\"" ++ change_id ++ "\\"" ++ "," ++ "\\"empty\\": " ++ if(self.empty(), "true", "false") ++ "}\\n"`,
    );
  });

  it("generateTemplate with LOG_ENTRY_FIELDS produces valid output", () => {
    const result = generateTemplate(LOG_ENTRY_FIELDS);
    assert.ok(result.startsWith(`"{"`));
    assert.ok(result.endsWith(`"}\\n"`));
    assert.ok(result.includes(`change_id`));
    assert.ok(result.includes(`description`));
  });
});
