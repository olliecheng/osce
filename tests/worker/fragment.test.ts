import { describe, expect, it } from "vitest";
import { decodeLoadFragment } from "../../web/src/fragment";

const enc = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe("decodeLoadFragment", () => {
  it("round-trips ASCII and UTF-8", () => {
    for (const s of ["---\ntitle: x\n---\n## A\nhi\n", "café 🫀\n## ü\n"]) {
      expect(decodeLoadFragment(`#load=${enc(s)}`)).toBe(s);
    }
  });
  it("accepts base64url and missing padding", () => {
    const s = "???>>>~~~ ÿÿ";
    const u = enc(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeLoadFragment(`#load=${u}`)).toBe(s);
  });
  it("accepts percent-encoded padding", () => {
    expect(decodeLoadFragment(`#load=${encodeURIComponent(enc("ab"))}`)).toBe("ab");
  });
  it("returns null for garbage, wrong prefix and empty", () => {
    expect(decodeLoadFragment("#load=!!!")).toBeNull();
    expect(decodeLoadFragment("#other=YWI=")).toBeNull();
    expect(decodeLoadFragment("#load=")).toBeNull();
    expect(decodeLoadFragment("#load=/w==")).toBeNull(); // invalid UTF-8 (0xFF)
  });
});
