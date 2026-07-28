/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { abbreviateName, escapeInvisibleChars } from "../webview/graph/utils";

describe("escapeInvisibleChars", () => {
  it("leaves ordinary visible text unchanged", () => {
    assert.strictEqual(escapeInvisibleChars("main"), "main");
  });

  it("does not escape spaces, quotes, or punctuation", () => {
    assert.strictEqual(escapeInvisibleChars('a b"c#d@e'), 'a b"c#d@e');
  });

  it("does not escape backslashes", () => {
    assert.strictEqual(escapeInvisibleChars("a\\b"), "a\\b");
  });

  it("does not escape non-ASCII characters", () => {
    assert.strictEqual(escapeInvisibleChars("café-测试"), "café-测试");
  });

  it("escapes newlines as \\n", () => {
    assert.strictEqual(escapeInvisibleChars("a\nb"), "a\\nb");
  });

  it("escapes tabs as \\t", () => {
    assert.strictEqual(escapeInvisibleChars("a\tb"), "a\\tb");
  });

  it("escapes carriage returns as \\r", () => {
    assert.strictEqual(escapeInvisibleChars("a\rb"), "a\\rb");
  });

  it("escapes NUL as \\0", () => {
    assert.strictEqual(escapeInvisibleChars("a\0b"), "a\\0b");
  });

  it("escapes other control characters as \\xHH (lowercase)", () => {
    assert.strictEqual(escapeInvisibleChars("a\x07b"), "a\\x07b");
    assert.strictEqual(escapeInvisibleChars("a\x1bb"), "a\\x1bb");
    assert.strictEqual(escapeInvisibleChars("a\x1fb"), "a\\x1fb");
  });

  it("escapes DEL (0x7f) as \\x7f", () => {
    assert.strictEqual(escapeInvisibleChars("a\x7fb"), "a\\x7fb");
  });

  it("escapes multiple invisible characters at once", () => {
    assert.strictEqual(escapeInvisibleChars("a\nb\tc"), "a\\nb\\tc");
  });
});

describe("abbreviateName escapes invisible characters", () => {
  it("escapes a short name without truncating", () => {
    assert.strictEqual(abbreviateName("a\nb"), "a\\nb");
  });

  it("escapes the visible parts of a truncated name", () => {
    const longName = "a\n" + "x".repeat(30);
    const result = abbreviateName(longName);
    assert.ok(result.startsWith("a\\n"));
    assert.ok(result.includes("..."));
  });

  it("leaves ordinary names unchanged when short enough", () => {
    assert.strictEqual(abbreviateName("main"), "main");
  });
});
