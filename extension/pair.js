// Koppelen met de helper via de 6-cijferige code: de helper bewijst EERST dat hij de code kent, pas daarna gaat
// het geheim (versleuteld) naar hem toe. Puur WebCrypto: werkt in de extensie en in Node (tests).
//
//   1. extensie -> helper : { step: "hello", nonce: nE }                       (16 willekeurige bytes, hex)
//   2. helper -> extensie : { helperNonce: nH, proof }                         proof = HMAC(kProof, "ho-pair-proof|nE|nH")
//   3. extensie controleert proof. Klopt het niet: afbreken, er gaat niets meer naar de helper.
//   4. extensie -> helper : { step: "finish", nonce, helperNonce, iv, data }   data = AES-256-GCM(kEnc, geheim), AAD bindt nE, nH en Origin
//
//   k0     = PBKDF2-SHA256(code, "ho-pair-v1|" + nE, PAIR_ITERATIONS)   (traag: een onderschept bewijs is niet binnen
//                                                                        de korte sessietijd offline te kraken)
//   kProof = HKDF-SHA256(k0, salt = nE,      info = "ho-pair-proof")
//   kEnc   = HKDF-SHA256(k0, salt = nE || nH, info = "ho-pair-enc")
// Dezelfde berekening staat in helper/proxy.js (Node crypto).

export const PAIR_ITERATIONS = 600000;
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
export const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const fromHex = (h) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));
const HEX32 = /^[0-9a-f]{32}$/;

async function keys(code, nE, nH) {
  const base = await subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveBits"]);
  const k0 = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode("ho-pair-v1|" + nE), iterations: PAIR_ITERATIONS }, base, 256);
  const hk = await subtle.importKey("raw", k0, "HKDF", false, ["deriveBits"]);
  const proofBits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: fromHex(nE), info: enc.encode("ho-pair-proof") }, hk, 256);
  const encBits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: fromHex(nE + nH), info: enc.encode("ho-pair-enc") }, hk, 256);
  return {
    proof: await subtle.importKey("raw", proofBits, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]),
    enc: await subtle.importKey("raw", encBits, "AES-GCM", false, ["encrypt"]),
  };
}

// post(body) -> { status, json }. origin: chrome-extension://<id> (zelfde waarde als de Origin-header).
// Uitkomst: { ok: true } of { ok: false, error: "format" | "no-pairing" | "proof" | "missing" | ..., sent: false }
// sent = of het (versleutelde) geheim de deur uit is gegaan.
export async function pairClient({ code, secret, origin, post }) {
  code = String(code || "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "format", sent: false };
  const nE = toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  let r;
  try { r = await post({ step: "hello", nonce: nE }); } catch { return { ok: false, error: "missing", sent: false }; }
  if (r.status !== 200) return { ok: false, error: r.json?.error || String(r.status), sent: false };
  const nH = r.json?.helperNonce, proof = r.json?.proof;
  if (!HEX32.test(nH || "") || !/^[0-9a-f]{64}$/.test(proof || "")) return { ok: false, error: "proof", sent: false };
  const k = await keys(code, nE, nH);
  const good = await subtle.verify("HMAC", k.proof, fromHex(proof), enc.encode(`ho-pair-proof|${nE}|${nH}`));
  if (!good) return { ok: false, error: "proof", sent: false }; // verkeerde code, of een ander programma op de poort
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`ho-pair-secret|${nE}|${nH}|${origin}`) }, k.enc, enc.encode(secret));
  try { r = await post({ step: "finish", nonce: nE, helperNonce: nH, iv: toHex(iv), data: toHex(data) }); }
  catch { return { ok: false, error: "missing", sent: true }; }
  return r.status === 200 ? { ok: true, sent: true } : { ok: false, error: r.json?.error || String(r.status), sent: true };
}
