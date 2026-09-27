/* Shared pure parser and an isolated-world DOM reader. No page scripts are executed. */
(() => {
  const MAX_DATA = 2000000;
  const text = (value) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  const fail = (code, message) => ({ ok: false, code, message });
  function productUrl(value) {
    if (typeof value !== "string" || value.length > 8192 || value.includes("\\")) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.port || url.username || url.password ||
          !["www.coles.com.au", "coles.com.au"].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/product\/(?:[a-z0-9.-]+-)?(\d{1,15})\/?$/i);
      return match ? { id: match[1], url: url.origin + url.pathname } : null;
    } catch { return null; }
  }
  function money(value) {
    if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(text(value))) return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 && amount < 100000000 ? amount : null;
  }
  function products(root, depth = 0) {
    if (!root || depth > 32) return [];
    if (Array.isArray(root)) return root.flatMap(item => products(item, depth + 1));
    if (typeof root !== "object") return [];
    const own = [root["@type"]].flat().includes("Product") ? [root] : [];
    return own.concat(products(root["@graph"], depth + 1));
  }
  function parseJson(value) { try { return JSON.parse(value); } catch { return null; } }
  function extract(snapshot, expectedId) {
    const page = productUrl(snapshot.url);
    if (!page || (expectedId && page.id !== expectedId))
      return fail("product_identity_conflict", "The tab does not match the requested Coles product.");
    if (snapshot.blocked) return fail("retailer_access_restricted", "Coles displayed an access restriction. Inspect the product tab; no automatic bypass is attempted.");
    const scripts = snapshot.scripts || [];
    if (scripts.length > 100 || scripts.reduce((sum, script) => sum + script.text.length, 0) > MAX_DATA)
      return fail("page_too_large", "Product data exceeds the reader's size limit.");
    const state = scripts.find(script => script.id === "__NEXT_DATA__");
    const props = parseJson(state?.text)?.props?.pageProps;
    if (props?.isRestricted === true) return fail("retailer_access_restricted", "Coles restricted access to this product.");
    const next = props?.product;
    if (next?.id != null && text(next.id) !== page.id)
      return fail("product_identity_conflict", "Embedded product data belongs to another product.");
    const main = next && text(next.id) === page.id ? next : null;
    const matches = scripts.filter(script => script.type === "application/ld+json")
      .flatMap(script => products(parseJson(script.text))).filter(product => {
        const sku = text(product.sku);
        const url = product.url || product["@id"];
        const code = url ? productUrl(url)?.id : null;
        return (sku === page.id || code === page.id) && (!sku || sku === page.id) && (!url || code === page.id);
      });
    if (matches.length > 1) return fail("ambiguous_product", "Multiple main-product records were found.");
    const ld = matches[0];
    if (!main && !ld) return fail("product_not_identified", "Waiting for verifiable product data. A page title alone is not sufficient.");
    const name = text(ld?.name) || [text(main?.brand), text(main?.name), text(main?.size)].filter(Boolean).join(" ");
    if (!name || name.length > 500) return fail("invalid_product_name", "The product name is missing or invalid.");
    const offers = [ld?.offers].flat().filter(offer => offer && typeof offer === "object" &&
      (!offer.url || productUrl(offer.url)?.id === page.id));
    const offer = offers[0];
    const pricing = main?.pricing;
    const ldPrice = money(offer?.price);
    const nextPrice = money(pricing?.now);
    let issue = null;
    if (offers.length > 1) issue = "ambiguous_price";
    else if ((offer?.price != null && ldPrice === null) || (pricing?.now != null && nextPrice === null)) issue = "invalid_price";
    else if (offer?.priceCurrency && offer.priceCurrency !== "AUD") issue = "invalid_currency";
    else if (ldPrice !== null && nextPrice !== null && ldPrice !== nextPrice) issue = "price_conflict";
    else if (ldPrice === null && nextPrice === null) issue = "price_unavailable";
    else if (nextPrice === null && offer?.priceCurrency !== "AUD") issue = "missing_currency";
    const price = issue ? null : nextPrice ?? ldPrice;
    const was = money(pricing?.was);
    const stock = /\/InStock$/.test(text(offer?.availability)) ? true :
      /\/OutOfStock$/.test(text(offer?.availability)) ? false : typeof main?.availability === "boolean" ? main.availability : null;
    return {
      ok: true, productId: page.id, url: page.url, name,
      brand: (text(ld?.brand?.name || ld?.brand) || text(main?.brand)).slice(0, 200) || null,
      pack: text(main?.size).slice(0, 100) || null,
      price, currency: price === null ? null : "AUD", priceIssue: issue,
      normalPrice: price !== null && was > price ? was : null,
      unitPrice: issue ? null : money(pricing?.unit?.price),
      unit: issue ? null : [text(pricing?.unit?.ofMeasureQuantity), text(pricing?.unit?.ofMeasureUnits)].filter(Boolean).join(" ") || null,
      promotion: text(pricing?.offerDescription || pricing?.priceDescription).slice(0, 500) || null,
      // Never substitute multiBuyPromotion.reward or a variant's price for the shelf price.
      inStock: stock, priceScope: "unverified_browser_context",
      location: snapshot.location || null, checkedAt: new Date().toISOString(),
      source: main ? "coles_embedded_product" : "coles_json_ld"
    };
  }
  function read(document, url) {
    const title = document.title || "";
    const body = (document.body?.innerText || "").slice(0, 100000);
    const blocked = /access denied|request unsuccessful|verify you are human|robot or human|just a moment/i.test(title + "\n" + body) ||
      Array.from(document.querySelectorAll("iframe[src]")).some(frame => {
        try { const src = new URL(frame.getAttribute("src"), url); return src.hostname === new URL(url).hostname && src.pathname === "/_Incapsula_Resource"; }
        catch { return false; }
      });
    const pageUrl = new URL(url);
    if (pageUrl.origin === "https://www.coles.com.au" && pageUrl.pathname === "/search/products") {
      if (blocked) return fail("retailer_access_restricted", "Coles restricted access to search.");
      const heading = document.querySelector('main h1, h1');
      const query = (pageUrl.searchParams.get("q") || "").trim().toLowerCase();
      if (heading && query && !(heading.textContent || "").toLowerCase().includes(query))
        return fail("product_not_identified", "Waiting for the requested search results.");
      const results = document.querySelector('.coles-targeting-search-content-container');
      const count = body.match(/\b\d+\s*[-–]\s*\d+\s+of\s+(\d+)\s+results\b/i);
      // A bounded, visibly identified result page is a fallback when Coles changes its container class.
      const container = results || (heading && count ? document.querySelector('main') : null);
      const candidates = container ? Array.from(container.querySelectorAll('a[href]'))
        .filter(a => !a.closest?.('aside, nav, header, footer, [aria-label*="recommend" i]'))
        .map(a => { try { return productUrl(new URL(a.getAttribute("href"), url).href)?.url; } catch { return null; } })
        .filter(Boolean) : [];
      const unique = new Map(candidates.map(link => [productUrl(link).id, link]));
      const links = [...unique.values()];
      const emptyMessage = /no results for|no results found|no products found|we couldn't find any|we couldn’t find any/i;
      // Only the current search heading/result region can establish an empty search.
      // Coles can show suggested products beneath a "No results" heading.
      // Keep those candidates for product matching rather than declaring the search empty.
      const emptyConfirmed = links.length === 0 && (emptyMessage.test(heading?.textContent || "")
        || emptyMessage.test(results?.innerText || ""));
      if (!links.length && !emptyConfirmed) return fail("product_not_identified", "Waiting for Coles search results.");
      if (!results && count && links.length > Number(count[1]))
        return fail("product_not_identified", "Search results could not be separated from recommendations.");
      return { ok: true, kind: "search", url: pageUrl.href, links: emptyConfirmed ? [] : [...new Set(links)].slice(0, 5), emptyConfirmed };
    }
    const nodes = Array.from(document.querySelectorAll('script#__NEXT_DATA__, script[type="application/ld+json"]'));
    let size = 0;
    const scripts = [];
    for (const node of nodes.slice(0, 101)) {
      const value = node.textContent || "";
      size += value.length;
      if (size > MAX_DATA) return fail("page_too_large", "Product data exceeds the reader's size limit.");
      scripts.push({ id: node.id, type: node.type, text: value });
    }
    // Retain only delivery mode/postcode, never an address, account name, or whole header.
    const labels = Array.from(document.querySelectorAll('header button, header [role="button"]'))
      .map(node => node.innerText || node.getAttribute("aria-label") || "");
    const locationLabel = labels.find(label => /delivery|deliver to|collect/i.test(label) && /\b\d{4}\b/.test(label));
    const location = locationLabel ? { postcode: locationLabel.match(/\b\d{4}\b/)[0],
      mode: /collect/i.test(locationLabel) ? "collection" : "delivery", verified: false } : null;
    const result = extract({ url, scripts, blocked, location });
    if (result.ok) {
      const state = parseJson(scripts.find(script => script.id === "__NEXT_DATA__")?.text);
      // Send only main-product data, never the application's account/session state.
      const main = state?.props?.pageProps?.product;
      const jsonLd = scripts.filter(script => script.type === "application/ld+json")
        .flatMap(script => products(parseJson(script.text)))
        .filter(product => text(product.sku) === result.productId || productUrl(product.url || product["@id"])?.id === result.productId)
        .map(product => JSON.stringify(product));
      result.evidence = { nextProductJson: main ? JSON.stringify(main) : null, jsonLd };
    }
    return result;
  }
  globalThis.ColesReader = Object.freeze({ productUrl, extract, read });
  if (typeof document !== "undefined") return read(document, location.href);
})();
