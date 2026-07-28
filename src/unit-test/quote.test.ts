/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { quoteJjName } from "../quote";

describe("quoteJjName", () => {
  it("wraps a simple name in double quotes", () => {
    assert.strictEqual(quoteJjName("v1.0.0"), '"v1.0.0"');
  });

  it("wraps a name starting with # so jj does not parse it as a symbol", () => {
    assert.strictEqual(quoteJjName("#123"), '"#123"');
  });

  it("preserves other special characters inside the quotes", () => {
    assert.strictEqual(quoteJjName("release/2.0-beta"), '"release/2.0-beta"');
  });

  it("escapes embedded double quotes", () => {
    assert.strictEqual(quoteJjName('a"b'), '"a\\"b"');
  });

  it("escapes embedded backslashes", () => {
    assert.strictEqual(quoteJjName("a\\b"), '"a\\\\b"');
  });

  it("escapes embedded backslashes before quotes", () => {
    assert.strictEqual(quoteJjName('a\\"c'), '"a\\\\\\"c"');
  });
});
