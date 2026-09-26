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
    return extract({ url, scripts, blocked, location });
  }
  globalThis.ColesReader = Object.freeze({ productUrl, extract, read });
  if (typeof document !== "undefined") return read(document, location.href);
})();
