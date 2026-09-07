/**
 * URL article importer.
 *
 * Strategy:
 * 1. Fetch the page directly from the browser.
 * 2. Parse it with Mozilla Readability.
 * 3. If direct fetching or extraction fails, fetch through the configured
 *    Cloudflare Worker and run Mozilla Readability on the returned HTML.
 */
import { ARTICLE_PROXY_URL } from "../../../config.js";
import { createImportResult, IMPORT_TYPES } from "../import-types.js";
import { normalizeWhitespace } from "../import-utils.js";

const READABILITY_URL =
  "https://cdn.jsdelivr.net/npm/@mozilla/readability@0.6.0/+esm";

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

let readabilityPromise = null;

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    isPrivateIpv4(host)
  );
}

function validateUrl(value) {
  let parsed;

  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter a valid URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http:// and https:// URLs are supported.");
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error("Local and private-network URLs are not allowed.");
  }

  return parsed.href;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException("Import cancelled", "AbortError");
  }
}

async function fetchHtml(url, { signal, viaProxy, onProgress } = {}) {
  throwIfAborted(signal);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  const abortHandler = () => controller.abort("cancelled");
  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const requestUrl = viaProxy
      ? `${ARTICLE_PROXY_URL.replace(/\/+$/, "")}?url=${encodeURIComponent(url)}`
      : url;

    onProgress?.(
      viaProxy
        ? "Direct fetch failed · trying Cloudflare fallback…"
        : "Fetching webpage directly…"
    );

    const response = await fetch(requestUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5"
      },
      signal: controller.signal
    });

    throwIfAborted(signal);

    if (!response.ok) {
      throw new Error(
        `${viaProxy ? "Cloudflare fallback" : "Website"} returned HTTP ${response.status}.`
      );
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();

    if (contentType && !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
      throw new Error(`The URL returned ${contentType}, not an HTML page.`);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_HTML_BYTES) {
      throw new Error("The webpage is larger than the 5 MB import limit.");
    }

    const html = await response.text();

    if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
      throw new Error("The webpage is larger than the 5 MB import limit.");
    }

    if (!html.trim()) {
      throw new Error("The webpage returned an empty response.");
    }

    return {
      html,
      finalUrl: response.headers.get("x-source-url") || response.url || url
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException("Import cancelled", "AbortError");
    }
    if (error?.name === "AbortError") {
      throw new Error(`${viaProxy ? "Cloudflare fallback" : "Direct fetch"} timed out.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortHandler);
  }
}

async function getReadability() {
  if (globalThis.Readability) return globalThis.Readability;
  if (!readabilityPromise) {
    readabilityPromise = import(READABILITY_URL)
      .then(module => {
        const Readability = module.Readability || module.default?.Readability || module.default;
        if (!Readability) throw new Error("Mozilla Readability could not be loaded.");
        return Readability;
      })
      .catch(error => { readabilityPromise = null; throw error; });
  }
  return readabilityPromise;
}

function cleanArticleHtml(content, baseUrl) {
  const documentNode = new DOMParser().parseFromString(`<body>${content || ""}</body>`, "text/html");
  const body = documentNode.body;

  body.querySelectorAll("script,style,noscript,template,iframe,object,embed,form").forEach(node => node.remove());

  body.querySelectorAll("*").forEach(node => {
    [...node.attributes].forEach(attribute => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value || "";

      if (name.startsWith("on") || name === "srcdoc" || name === "style") {
        node.removeAttribute(attribute.name);
        return;
      }

      if (["href", "src", "poster"].includes(name) && value) {
        try {
          const resolved = new URL(value, baseUrl);
          if (!["http:", "https:", "mailto:", "tel:"].includes(resolved.protocol)) {
            node.removeAttribute(attribute.name);
          } else {
            node.setAttribute(attribute.name, resolved.href);
          }
        } catch {
          node.removeAttribute(attribute.name);
        }
      }
    });
  });

  return body.innerHTML.trim();
}

async function extractArticle(html, sourceUrl) {
  const Readability = await getReadability();
  const documentNode = new DOMParser().parseFromString(html, "text/html");

  if (!documentNode.head) {
    const head = documentNode.createElement("head");
    documentNode.documentElement.prepend(head);
  }

  const base = documentNode.createElement("base");
  base.href = sourceUrl;
  documentNode.head.prepend(base);

  const article = new Readability(documentNode, { charThreshold: 200, keepClasses: false }).parse();

  if (!article?.content) {
    throw new Error("Mozilla Readability could not identify the main article.");
  }

  const cleanHtml = cleanArticleHtml(article.content, sourceUrl);
  const text = normalizeWhitespace(
    new DOMParser().parseFromString(cleanHtml, "text/html").body.textContent || ""
  );

  if (text.length < 120) {
    throw new Error("The extracted article is too short to be a useful note source.");
  }

  return {
    title: normalizeWhitespace(article.title || "") || "Imported Web Article",
    html: cleanHtml,
    metadata: {
      sourceUrl,
      byline: article.byline || "",
      siteName: article.siteName || "",
      excerpt: article.excerpt || "",
      wordCount: text.split(/\s+/).filter(Boolean).length
    }
  };
}

export class URLImporter {
  canHandle(value) {
    return typeof value === "string" && /^https?:\/\//i.test(value.trim());
  }

  async import(url, options = {}) {
    const sourceUrl = validateUrl(url);
    const { signal, onProgress } = options;
    let directError;

    try {
      const fetched = await fetchHtml(sourceUrl, { signal, onProgress, viaProxy: false });
      const article = await extractArticle(fetched.html, fetched.finalUrl || sourceUrl);
      return createImportResult({
        type: IMPORT_TYPES.URL,
        title: article.title,
        html: article.html,
        metadata: { ...article.metadata, method: "direct" }
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      directError = error;
    }

    if (!ARTICLE_PROXY_URL) {
      throw new Error(
        `Direct URL import failed: ${directError?.message || "the website blocked the browser request"}. Cloudflare fallback is not configured yet.`
      );
    }

    try {
      const fetched = await fetchHtml(sourceUrl, { signal, onProgress, viaProxy: true });
      const article = await extractArticle(fetched.html, fetched.finalUrl || sourceUrl);
      return createImportResult({
        type: IMPORT_TYPES.URL,
        title: article.title,
        html: article.html,
        metadata: { ...article.metadata, method: "cloudflare" }
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error(
        `URL import failed. Direct fetch: ${directError?.message || "blocked or extraction failed"}. Cloudflare fallback: ${error?.message || "failed"}.`
      );
    }
  }
}
