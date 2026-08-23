import dns from "node:dns/promises";
import net from "node:net";

const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

/** Returns true if `ip` falls within a private, loopback, link-local, or otherwise non-public range. */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 0) return true; // "this" network
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true; // loopback
    if (normalized.startsWith("fe80:")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
    if (normalized.startsWith("::ffff:")) {
      // IPv4-mapped IPv6 address
      return isPrivateIp(normalized.replace("::ffff:", ""));
    }
    return false;
  }

  return true; // not a recognizable IP literal -- treat conservatively
}

async function assertPublicHostname(hostname: string): Promise<void> {
  if (hostname === "localhost") throw new Error("Refusing to fetch localhost");

  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map(r => r.address);
  } catch {
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }

  if (addresses.length === 0) throw new Error(`Hostname did not resolve to any address: ${hostname}`);
  for (const addr of addresses) {
    if (isPrivateIp(addr)) throw new Error(`Refusing to fetch private/internal address: ${hostname} -> ${addr}`);
  }
}

export interface SafeFetchResult {
  status: number;
  contentType: string | null;
  /** Selected response headers relevant to whether the page can be embedded in an iframe. */
  headers: Record<string, string>;
  body: string;
}

const CAPTURED_HEADERS = ["content-type", "x-frame-options", "content-security-policy"];

/**
 * Fetches a URL with SSRF protections: only http(s), only publicly-routable
 * resolved addresses, manual redirect following with re-validation on each hop,
 * a request timeout, and a response size cap.
 */
export async function safeFetchText(rawUrl: string, maxBytes = 100_000): Promise<SafeFetchResult> {
  let url = new URL(rawUrl);

  for (let redirects = 0; ; redirects++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Unsupported URL scheme: ${url.protocol}`);
    }

    await assertPublicHostname(url.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "iplace-submission-reviewer/1.0" },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect response (${response.status}) with no Location header`);
      if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
      url = new URL(location, url);
      continue;
    }

    const contentType = response.headers.get("content-type");
    const headers: Record<string, string> = {};
    for (const key of CAPTURED_HEADERS) {
      const value = response.headers.get(key);
      if (value) headers[key] = value;
    }

    const reader = response.body?.getReader();
    let body = "";
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      while (received < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        body += decoder.decode(value, { stream: true });
      }
      await reader.cancel().catch(() => {});
    }

    return { status: response.status, contentType, headers, body: body.slice(0, maxBytes) };
  }
}
