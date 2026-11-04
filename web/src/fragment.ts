/** Decode the case Markdown from a `#load=<base64>` URL fragment. Returns null when absent or undecodable. */
export function decodeLoadFragment(hash: string): string | null {
  // Parsed by hand: URLSearchParams would turn "+" into a space and corrupt standard base64.
  const m = hash.match(/^#load=(.*)$/s);
  if (!m) return null;
  try {
    let b64 = decodeURIComponent(m[1]).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    b64 = b64.replace(/=+$/, "");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

export const hasLoadFragment = (hash: string) => hash.startsWith("#load=");
