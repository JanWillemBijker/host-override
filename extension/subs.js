// Abonnementen: een regellijst (hosts-formaat, optioneel met "# group:"-koppen) op een https-URL.
// Wordt door de achtergrond opgehaald (handmatig, elk uur of elke dag). Alleen https, max 256 KB,
// max 2000 regels, strikte validatie per regel; de opgehaalde regels zijn alleen-lezen.
// Toestemming: alleen de origin van de lijst (optionele host-permissie, gevraagd bij abonneren).
import { parseHosts, subUrlProblem, subOrigin, SUB_MAX_BYTES, SUB_MAX_RULES } from "./model.js";

export class SubError extends Error {
  constructor(code, detail = "") { super(code); this.code = code; this.detail = detail; }
}

// Leest de lijst en geeft { rules, groups, skipped, bytes } of gooit een SubError met een code:
// url | https | credentials | host | permission | network | timeout | http-<status> | too-big | not-hosts | no-rules
export async function fetchSubList(url, { timeout = 20000, fetchFn = fetch, hasPermission } = {}) {
  const problem = subUrlProblem(url);
  if (problem) throw new SubError(problem);
  if (hasPermission && !(await hasPermission(subOrigin(url)))) throw new SubError("permission");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetchFn(url, { credentials: "omit", cache: "no-store", redirect: "follow", referrerPolicy: "no-referrer", signal: ctrl.signal,
      headers: { accept: "text/plain, */*;q=0.5" } });
  } catch (e) {
    clearTimeout(timer);
    throw new SubError(e?.name === "AbortError" ? "timeout" : "network", String(e?.message || e));
  }
  try {
    if (res.url && !res.url.startsWith("https://")) throw new SubError("https");
    if (!res.ok) throw new SubError(`http-${res.status}`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > SUB_MAX_BYTES) throw new SubError("too-big");
    // Stapsgewijs lezen met een harde grens (content-length kan ontbreken of liegen).
    const reader = res.body.getReader();
    const parts = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > SUB_MAX_BYTES) { try { await reader.cancel(); } catch { /* al dicht */ } throw new SubError("too-big"); }
      parts.push(value);
    }
    const buf = new Uint8Array(size);
    let off = 0;
    for (const p of parts) { buf.set(p, off); off += p.length; }
    const text = new TextDecoder("utf-8").decode(buf);
    if (/^\s*(<!doctype|<html|<\?xml|\{|\[)/i.test(text)) throw new SubError("not-hosts");
    const parsed = parseHosts(text, { maxRules: SUB_MAX_RULES });
    if (!parsed.rules.length) throw new SubError("no-rules");
    return { ...parsed, bytes: size };
  } finally { clearTimeout(timer); }
}
