import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const collection = JSON.parse(
  readFileSync(new URL("./fixtures/regression.json", import.meta.url), "utf8"),
);
assert.equal(collection.schemaVersion, 1);
assert.equal(
  new Set(collection.cases.map((c) => c.id)).size,
  collection.cases.length,
);

function documentFor(row) {
  const scripts = (row.scripts ?? []).map((s) => ({
    ...s,
    textContent: s.text,
  }));
  const anchors = (row.links ?? []).map((href) => ({
    getAttribute: () => href,
    closest: () => null,
  }));
  const shadowRoot = {
    querySelectorAll: (selector) => (selector === "a[href]" ? anchors : []),
  };
  const container = {
    innerText: row.empty ? "No products found" : `${anchors.length} products`,
    querySelectorAll: (selector) =>
      row.retailer === "woolworths"
        ? selector === "*"
          ? [{ shadowRoot }]
          : []
        : selector === "a[href]"
          ? anchors
          : [],
  };
  return {
    title: row.blocked ? "Access Denied" : "Retailer product",
    body: { innerText: row.heading ?? "Product" },
    querySelector: (selector) => {
      if (selector === "main h1, h1")
        return row.heading ? { textContent: row.heading } : null;
      if (
        row.kind === "search" &&
        [
          "main",
          ".coles-targeting-search-content-container",
          '[data-testid="search-results-product-scrollable-content"]',
        ].includes(selector)
      )
        return container;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === "iframe[src]")
        return row.blocked
          ? [{ getAttribute: () => "/_Incapsula_Resource" }]
          : [];
      if (selector.startsWith("header")) return [];
      if (selector === "h1, h2, h3")
        return row.heading ? [{ textContent: row.heading }] : [];
      return selector.includes("script") ? scripts : [];
    },
  };
}

for (const reader of ["coles-worker", "shopping-list"]) {
  const context = vm.createContext({ URL, Date });
  vm.runInContext(
    readFileSync(
      new URL(`../../${reader}/content.js`, import.meta.url),
      "utf8",
    ),
    context,
  );
  for (const row of collection.cases) {
    test(`${reader}: saved ${row.id}`, () => {
      assert.ok(row.reason && row.provenance);
      const url =
        row.kind === "search"
          ? row.retailer === "coles"
            ? `https://www.coles.com.au/search/products?q=${encodeURIComponent(row.query)}`
            : `https://www.woolworths.com.au/shop/search/products?searchTerm=${encodeURIComponent(row.query)}`
          : row.url;
      const result = context.ColesReader.read(documentFor(row), url);
      if (row.expected.error) {
        assert.equal(result.ok, false);
        assert.equal(result.code, row.expected.error);
      } else {
        assert.equal(result.ok, true, JSON.stringify(result));
        if (row.kind === "search") {
          assert.equal(result.links.length, row.expected.count);
          assert.deepEqual(
            Array.from(
              result.links,
              (link) => context.ColesReader.retailerProductUrl(link).id,
            ).sort(),
            [...row.expected.codes].sort(),
          );
          assert.equal(result.emptyConfirmed, row.empty);
          assert.ok(
            result.links.every((link) =>
              new URL(link).hostname.endsWith(`${row.retailer}.com.au`),
            ),
          );
        } else {
          assert.equal(result.productId, row.expected.code);
          if (Object.hasOwn(row.expected, "price"))
            assert.equal(result.price, row.expected.price);
          if (row.expected.priceMissing) assert.equal(result.price, null);
          if (row.expected.promotion)
            assert.equal(result.promotion, row.expected.promotion);
          assert.ok(result.evidence);
        }
      }
    });
  }
}
