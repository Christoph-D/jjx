/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateTemplate,
  TemplateFields,
  LOG_TEMPLATE,
  buildLogTemplate,
  buildOperationTemplate,
} from "../template-builder";

describe("TemplateBuilder Test Suite", () => {
  it("generateTemplate with string field", () => {
    const fields: TemplateFields = {
      email: { type: "string", expr: "author.email()" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(result, `"{" ++ "\\"email\\": " ++ stringify(author.email()).escape_json() ++ "}\\n"`);
  });

  it("generateTemplate with multiple string fields (sorted alphabetically)", () => {
    const fields: TemplateFields = {
      zebra: { type: "string", expr: "a" },
      alpha: { type: "string", expr: "z" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(
      result,
      `"{" ++ "\\"alpha\\": " ++ stringify(z).escape_json() ++ "," ++ "\\"zebra\\": " ++ stringify(a).escape_json() ++ "}\\n"`,
    );
  });

  it("generateTemplate with raw field", () => {
    const fields: TemplateFields = {
      description: { type: "raw", expr: "description.escape_json()" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(result, `"{" ++ "\\"description\\": " ++ description.escape_json() ++ "}\\n"`);
  });

  it("generateTemplate with boolean field", () => {
    const fields: TemplateFields = {
      conflict: { type: "boolean", expr: "self.conflict()" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(result, `"{" ++ "\\"conflict\\": " ++ if(self.conflict(), "true", "false") ++ "}\\n"`);
  });

  it("generateTemplate with number field", () => {
    const fields: TemplateFields = {
      count: { type: "number", expr: "files.len()" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(result, `"{" ++ "\\"count\\": " ++ files.len() ++ "}\\n"`);
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
      `"{" ++ "\\"author\\": {" ++ "\\"email\\": " ++ stringify(author.email()).escape_json() ++ "," ++ "\\"name\\": " ++ author.name() ++ "}" ++ "}\\n"`,
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
      `"{" ++ "\\"files\\": [" ++ self.diff().files().map(|x| "{" ++ "\\"path\\": " ++ stringify(x.path()).escape_json() ++ "}").join(",") ++ "]" ++ "}\\n"`,
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
      `"{" ++ "\\"parents\\": [" ++ parents.map(|p| "{" ++ "\\"id\\": " ++ stringify(p.change_id()).escape_json() ++ "}").join(",") ++ "]" ++ "}\\n"`,
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
      `"{" ++ "\\"tags\\": [" ++ tags.map(|t| stringify(t.name()).escape_json()).join(",") ++ "]" ++ "}\\n"`,
    );
  });

  it("generateTemplate escapes quotes in field names", () => {
    const fields: TemplateFields = {
      'field"with"quotes': { type: "string", expr: "x" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(result, `"{" ++ "\\"field\\"with\\"quotes\\": " ++ stringify(x).escape_json() ++ "}\\n"`);
  });

  it("generateTemplate escapes backslashes in field names", () => {
    const fields: TemplateFields = {
      "field\\with\\backslash": { type: "string", expr: "x" },
    };
    const result = generateTemplate(fields);
    assert.strictEqual(result, `"{" ++ "\\"field\\\\with\\\\backslash\\": " ++ stringify(x).escape_json() ++ "}\\n"`);
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
      `"{" ++ "\\"author\\": {" ++ "\\"email\\": " ++ stringify(author.email()).escape_json() ++ "," ++ "\\"name\\": " ++ stringify(author.name()).escape_json() ++ "}" ++ "," ++ "\\"change_id\\": " ++ stringify(change_id).escape_json() ++ "," ++ "\\"empty\\": " ++ if(self.empty(), "true", "false") ++ "}\\n"`,
    );
  });

  it("LOG_TEMPLATE produces valid output", () => {
    assert.ok(LOG_TEMPLATE.startsWith(`"{"`));
    assert.ok(LOG_TEMPLATE.endsWith(`"}\\n"`));
    assert.ok(LOG_TEMPLATE.includes(`change_id`));
    assert.ok(LOG_TEMPLATE.includes(`description`));
  });

  it("buildLogTemplate() (no args) excludes diff_files and conflicted_files", () => {
    const result = buildLogTemplate();
    assert.ok(!result.includes("diff_files"));
    assert.ok(!result.includes("conflicted_files"));
    assert.ok(result.includes("change_id"));
  });

  it("buildLogTemplate() matches LOG_TEMPLATE const", () => {
    assert.strictEqual(buildLogTemplate(), LOG_TEMPLATE);
  });

  it("buildLogTemplate({ includeFiles: true }) includes diff_files fragment", () => {
    const result = buildLogTemplate({ includeFiles: true });
    assert.ok(result.includes("diff_files"));
    assert.ok(result.includes("entry.status_char()"));
    assert.ok(result.includes("entry.source().path().display()"));
    assert.ok(result.includes("entry.target().path().display()"));
    assert.ok(result.includes("entry.target().conflict()"));
  });

  it("buildLogTemplate({ includeFiles: true }) includes conflicted_files fragment", () => {
    const result = buildLogTemplate({ includeFiles: true });
    assert.ok(result.includes("conflicted_files"));
    assert.ok(result.includes("self.conflicted_files()"));
    assert.ok(result.includes("f.path().display()"));
  });

  it("buildOperationTemplate() (no version) defaults to deprecated self.tags()", () => {
    const result = buildOperationTemplate();
    assert.ok(result.includes("self.tags()"), "expected deprecated tags() expression");
    assert.ok(!result.includes("self.attributes()"), "must not emit attributes() when version is unknown");
    // JSON key is `attributes` regardless of the underlying expression.
    assert.ok(result.includes('\\"attributes\\"'), "JSON key is 'attributes'");
  });

  it("buildOperationTemplate(undefined) defaults to deprecated self.tags()", () => {
    const result = buildOperationTemplate(undefined);
    assert.ok(result.includes("self.tags()"));
    assert.ok(!result.includes("self.attributes()"));
    assert.ok(result.includes('\\"attributes\\"'), "JSON key is 'attributes'");
  });

  it("buildOperationTemplate(< 0.41) uses deprecated self.tags()", () => {
    const result = buildOperationTemplate({ major: 0, minor: 38, patch: 0 });
    assert.ok(result.includes("self.tags()"));
    assert.ok(!result.includes("self.attributes()"));
    assert.ok(result.includes('\\"attributes\\"'), "JSON key is 'attributes'");
  });

  it("buildOperationTemplate(0.40.x) uses deprecated self.tags()", () => {
    const result = buildOperationTemplate({ major: 0, minor: 40, patch: 5 });
    assert.ok(result.includes("self.tags()"));
    assert.ok(!result.includes("self.attributes()"));
    assert.ok(result.includes('\\"attributes\\"'), "JSON key is 'attributes'");
  });

  it("buildOperationTemplate(>= 0.41) uses self.attributes() with the attributes JSON key", () => {
    const result = buildOperationTemplate({ major: 0, minor: 41, patch: 0 });
    assert.ok(result.includes("self.attributes()"), "expected attributes() on 0.41");
    assert.ok(!result.includes("self.tags()"), "must not emit deprecated tags() on >= 0.41");
    assert.ok(result.includes('\\"attributes\\"'), "JSON key is 'attributes'");
  });

  it("buildOperationTemplate(0.42.0) uses self.attributes()", () => {
    const result = buildOperationTemplate({ major: 0, minor: 42, patch: 0 });
    assert.ok(result.includes("self.attributes()"));
    assert.ok(!result.includes("self.tags()"));
    assert.ok(result.includes('\\"attributes\\"'), "JSON key is 'attributes'");
  });

  it("buildOperationTemplate(1.0.0) uses self.attributes()", () => {
    const result = buildOperationTemplate({ major: 1, minor: 0, patch: 0 });
    assert.ok(result.includes("self.attributes()"));
    assert.ok(!result.includes("self.tags()"));
    assert.ok(result.includes('\\"attributes\\"'), "JSON key is 'attributes'");
  });
});
