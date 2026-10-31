import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/seo.ts", import.meta.url), "utf8");
const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { publicOrigin, publicMetadata, publicPages, privatePrefixes, privateMetadata } = await import(`data:text/javascript;base64,${Buffer.from(script).toString("base64")}`);
function configured(value, action) {
  const previous = process.env.MYSHOPPINGLIST_PUBLIC_ORIGIN;
  if (value === undefined) delete process.env.MYSHOPPINGLIST_PUBLIC_ORIGIN; else process.env.MYSHOPPINGLIST_PUBLIC_ORIGIN = value;
  try { action(); } finally { if (previous === undefined) delete process.env.MYSHOPPINGLIST_PUBLIC_ORIGIN; else process.env.MYSHOPPINGLIST_PUBLIC_ORIGIN = previous; }
}
test("missing or unsafe public origins never create a canonical URL", () => {
  for (const value of [undefined, "javascript:alert(1)", "http://public.example", "https://user:password@example.test", "https://example.test/private", "https://example.test/?token=private", "https://example.test/#private"])
    configured(value, () => { assert.equal(publicOrigin(), null); assert.equal(publicMetadata("Title", "Description", "/features").alternates, undefined); });
});
test("configured canonical URLs are exact and private routes stay outside the sitemap inventory", () => {
  configured("https://shopping.example.test/", () => { assert.equal(publicOrigin(), "https://shopping.example.test");
    assert.equal(publicMetadata("Title", "Description", "/features").alternates.canonical, "https://shopping.example.test/features"); });
  assert.ok(publicPages.every(path => !privatePrefixes.some(prefix => path.startsWith(prefix))));
  assert.deepEqual(privateMetadata.robots, { index: false, follow: false }); assert.equal(privateMetadata.alternates.canonical, null);
});
