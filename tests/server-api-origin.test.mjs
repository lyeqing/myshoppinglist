import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;
const source = await readFile(new URL("../src/lib/server-api-origin.ts", import.meta.url), "utf8");
assert.match(source, /import "server-only"/);
const originUrl = moduleUrl(source.replace('import "server-only";', ""));
const { serverApiOrigin } = await import(originUrl);
const routeSource = await readFile(new URL("../src/app/api/[...path]/route.ts", import.meta.url), "utf8");
const gateway = await import(moduleUrl(routeSource.replace("@/lib/server-api-origin", originUrl)));
const adminSource = await readFile(new URL("../src/lib/admin-session.ts", import.meta.url), "utf8");
const admin = await import(moduleUrl(adminSource.replace('import "server-only";', "")
  .replace('import { cookies } from "next/headers";', 'const cookies = async () => ({ get: () => ({ value: "a".repeat(64) }) });')
  .replace("./server-api-origin", originUrl)));

async function configured(internal, fallback, action) {
  const keys = ["MYSHOPPINGLIST_INTERNAL_API_URL", "MYSHOPPINGLIST_API_URL"];
  const previous = keys.map(key => process.env[key]);
  [internal, fallback].forEach((value, index) => {
    if (value === undefined) delete process.env[keys[index]]; else process.env[keys[index]] = value;
  });
  try { await action(); } finally {
    previous.forEach((value, index) => {
      if (value === undefined) delete process.env[keys[index]]; else process.env[keys[index]] = value;
    });
  }
}

test("server origins prefer internal transport, including Docker, and retain the legacy fallback", async () => {
  for (const [internal, fallback, expected] of [
    ["http://127.0.0.1:5392", "https://public.example", "http://127.0.0.1:5392/"],
    ["http://api:8080", "https://public.example", "http://api:8080/"],
    [undefined, "https://public.example", "https://public.example/"],
    ["  ", "https://public.example", "https://public.example/"],
    [undefined, undefined, "http://localhost:5392/"],
  ]) await configured(internal, fallback, () => assert.equal(serverApiOrigin().href, expected));
});

test("invalid internal origins fail closed instead of selecting the public API", async () => {
  for (const internal of ["not a URL", "ftp://api", "http://user:secret@api", "http://api/private", "http://api/?key=secret", "http://api/#private"])
    await configured(internal, "https://public.example", () => assert.throws(serverApiOrigin));
});

test("gateway and SSR administrator checks select the same internal or fallback API", async t => {
  for (const internal of ["http://api:8080", undefined]) await configured(internal, "https://public.example", async () => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url: String(url), options }); return Response.json({}); });
    const request = new Request("http://website.test/api/auth/me");
    request.cookies = { get: () => undefined };
    const response = await gateway.GET(request, { params: Promise.resolve({ path: ["auth", "me"] }) });
    assert.equal(response.status, 200);
    assert.equal(await admin.hasAdministratorSession(), true);
    const base = internal || "https://public.example";
    assert.deepEqual(calls.map(call => call.url), [base + "/api/auth/me", base + "/api/admin/session"]);
    assert.equal(calls[0].options.cache, "no-store");
    assert.deepEqual(calls[1].options.headers, { Cookie: `myshoppinglist_session=${"a".repeat(64)}` });
    assert.equal(calls[1].options.redirect, "error");
    t.mock.restoreAll();
  });
});

test("a failed internal write is attempted once and never retried through the public API", async t => {
  await configured("http://api:8080", "https://public.example", async () => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async url => { calls.push(String(url)); throw new Error("connection failed"); });
    const request = new Request("http://website.test/api/auth/login", { method: "POST", headers: {
      "Content-Type": "application/json", "X-MyShoppingList-Request": "1", Origin: "http://website.test",
    }, body: JSON.stringify({ email: "fixture@example.test", password: "fixture" }) });
    request.cookies = { get: () => undefined };
    const response = await gateway.POST(request, { params: Promise.resolve({ path: ["auth", "login"] }) });
    assert.equal(response.status, 502);
    assert.deepEqual(calls, ["http://api:8080/api/auth/login"]);
    assert.ok(!(await response.text()).includes("api:8080"));
  });
});

test("invalid configuration returns a safe failure without making a network request", async t => {
  await configured("http://private-api/incorrect", "https://public.example", async () => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected request"); });
    const response = await gateway.GET(new Request("http://website.test/api/auth/me"), { params: Promise.resolve({ path: ["auth", "me"] }) });
    assert.equal(response.status, 503);
    assert.equal(await admin.hasAdministratorSession(), false);
    assert.equal(calls, 0);
    assert.ok(!(await response.text()).includes("private-api"));
  });
});
