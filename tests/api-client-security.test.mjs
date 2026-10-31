import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/api-client.ts", import.meta.url), "utf8");
const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/import \{ reportDiagnostic \} from "\.\/diagnostics";/, "const reportDiagnostic = () => {}; ");
const { api, ApiError } = await import(`data:text/javascript;base64,${Buffer.from(script).toString("base64")}`);

test("server failures show a bounded investigation reference without internal error details", async t => {
  const reference = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
  t.mock.method(globalThis, "fetch", async () => Response.json({ title: "private internal exception", traceId: reference }, { status: 500 }));
  await assert.rejects(api("/auth/me"), error => {
    assert.ok(error instanceof ApiError); assert.equal(error.referenceId, reference);
    assert.match(error.message, /temporarily unavailable/); assert.ok(error.message.includes(reference));
    assert.ok(!error.message.includes("private internal exception")); return true;
  });
});

test("malformed reference text cannot be reflected into the customer error", async t => {
  for (const traceId of ["<script>bad</script>", "x".repeat(81), "private\nheader", {}, null]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ traceId }, { status: 503 }));
    await assert.rejects(api("/auth/me"), error => { assert.equal(error.referenceId, null); assert.equal(error.message, "The service is temporarily unavailable. Please try again."); return true; });
    t.mock.restoreAll();
  }
});

test("null upstream problem documents retain the useful HTTP error", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(null, { status: 500 }));
  await assert.rejects(api("/auth/me"), error => { assert.equal(error.status, 500); assert.match(error.message, /temporarily unavailable/); return true; });
});
