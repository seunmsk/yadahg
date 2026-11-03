// Yadah-G website API (Cloudflare Pages Functions)
// Bindings (set in the Cloudflare dashboard):
//   DB     KV namespace  - stores quote requests, claims, renewals, reviews, call backs and rates
//   FILES  R2 bucket     - optional, stores claim photos and documents
// Variables / secrets:
//   ADMIN_PASSWORD   - staff desk password (required for /#admin)
//   RESEND_API_KEY   - optional, emails each new request to NOTIFY_EMAIL
//   NOTIFY_EMAIL     - optional, e.g. info@yadahg.com (comma-separate several)
//   FROM_EMAIL       - optional, a sender on a domain verified in Resend

const KINDS = { quote: "Q", claim: "C", renewal: "R", review: "V", callback: "B" };
const STAGES = ["Received", "Documents review", "With insurer", "Offer made", "Settled", "Declined"];
const STATUSES = {
  quote: ["New", "Contacted", "Quoted", "Won", "Lost"],
  review: ["New", "Scheduled", "Done"],
  callback: ["New", "Called", "No answer"],
  renewal: ["New", "Reminded", "Renewed", "Lost"],
  claim: STAGES,
};
const FIELDS = ["name", "phone", "email", "company", "product", "details", "contactVia", "policy", "incidentDate",
  "claimType", "description", "expiry", "insurer", "sector", "staff", "time"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const digits = (s) => String(s || "").replace(/\D/g, "").slice(-10);

function makeRef(kind) {
  const t = new Date(), p = (n) => String(n).padStart(2, "0");
  const rnd = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  return `YG-${KINDS[kind]}-${String(t.getUTCFullYear()).slice(2)}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}-${rnd}`;
}

function authed(request, env) {
  const h = request.headers.get("authorization") || "";
  const pw = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!env.ADMIN_PASSWORD || !pw || pw.length !== env.ADMIN_PASSWORD.length) return false;
  let diff = 0;
  for (let i = 0; i < pw.length; i++) diff |= pw.charCodeAt(i) ^ env.ADMIN_PASSWORD.charCodeAt(i);
  return diff === 0;
}

async function notify(env, item) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return;
  const label = { quote: "Quote request", claim: "New claim", renewal: "Renewal reminder", review: "Risk review", callback: "Call back" }[item.kind];
  const lines = Object.entries(item)
    .filter(([k, v]) => v && !["kind", "history", "files"].includes(k))
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#56675D">${k}</td><td>${String(v).replace(/</g, "&lt;")}</td></tr>`)
    .join("");
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.FROM_EMAIL || "Yadah-G Website <onboarding@resend.dev>",
        to: env.NOTIFY_EMAIL.split(",").map((s) => s.trim()),
        subject: `${label}: ${item.name || ""} (${item.ref})`,
        html: `<h2 style="font-family:sans-serif">${label}</h2><table style="font-family:sans-serif;font-size:14px">${lines}</table>`,
      }),
    });
  } catch {}
}

async function listItems(env) {
  const keys = [];
  let cursor;
  do {
    const r = await env.DB.list({ prefix: "item:", cursor });
    keys.push(...r.keys.map((k) => k.name));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && keys.length < 2000);
  const items = (await Promise.all(keys.map((k) => env.DB.get(k, "json")))).filter(Boolean);
  return items.sort((a, b) => b.created.localeCompare(a.created));
}

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const path = (params.path || []).join("/");
  const m = request.method;

  if (path === "health") return json({ ok: !!env.DB, files: !!env.FILES, email: !!(env.RESEND_API_KEY && env.NOTIFY_EMAIL) });
  if (!env.DB) return json({ error: "Storage isn't connected yet." }, 503);

  if (path === "config" && m === "GET") return json({ rates: (await env.DB.get("config:rates", "json")) || null });

  if (path === "submit" && m === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
    if (!KINDS[body.kind]) return json({ error: "Unknown form." }, 400);
    if (body.website) return json({ ref: "YG-OK" }); // honeypot
    if (!body.name || digits(body.phone).length < 10) return json({ error: "Please add your name and a valid phone number." }, 400);
    const ip = request.headers.get("cf-connecting-ip") || "x";
    const rk = `rate:${ip}:${new Date().toISOString().slice(0, 13)}`;
    const n = +(await env.DB.get(rk)) || 0;
    if (n > 20) return json({ error: "Too many requests. Please WhatsApp or call us instead." }, 429);
    await env.DB.put(rk, String(n + 1), { expirationTtl: 3700 });

    const item = { kind: body.kind, ref: makeRef(body.kind), created: new Date().toISOString(), status: body.kind === "claim" ? "Received" : "New" };
    for (const f of FIELDS) if (body[f]) item[f] = String(body[f]).slice(0, 3000);
    if (item.kind === "claim") item.history = [{ s: "Received", at: item.created }];
    await env.DB.put(`item:${item.ref}`, JSON.stringify(item));
    await notify(env, item);
    return json({ ref: item.ref });
  }

  if (path === "upload" && m === "POST") {
    if (!env.FILES) return json({ error: "File storage isn't connected." }, 503);
    const ref = url.searchParams.get("ref") || "";
    const item = await env.DB.get(`item:${ref}`, "json");
    if (!item || item.kind !== "claim") return json({ error: "Claim not found." }, 404);
    if (Date.now() - Date.parse(item.created) > 3600e3) return json({ error: "Upload window closed. Send files on WhatsApp." }, 403);
    if ((item.files || []).length >= 4) return json({ error: "File limit reached." }, 400);
    const size = +request.headers.get("content-length") || 0;
    if (size > 8e6) return json({ error: "File too large (8MB max)." }, 413);
    const type = request.headers.get("content-type") || "application/octet-stream";
    if (!/^(image\/|application\/pdf)/.test(type)) return json({ error: "Images and PDFs only." }, 415);
    const name = (url.searchParams.get("name") || "file").replace(/[^\w.\-]/g, "_").slice(-80);
    const key = `claims/${ref}/${Date.now()}-${name}`;
    await env.FILES.put(key, request.body, { httpMetadata: { contentType: type } });
    item.files = [...(item.files || []), key];
    await env.DB.put(`item:${ref}`, JSON.stringify(item));
    return json({ ok: true });
  }

  if (path === "track" && m === "GET") {
    const ref = (url.searchParams.get("ref") || "").trim().toUpperCase();
    const item = await env.DB.get(`item:${ref}`, "json");
    if (!item || item.kind !== "claim" || digits(item.phone) !== digits(url.searchParams.get("phone")))
      return json({ error: "No claim matches that reference and phone number. Check both and try again." }, 404);
    const { ref: r, claimType, created, status, history } = item;
    return json({ claim: { ref: r, claimType, created, status, history } });
  }

  // ---- staff desk ----
  if (path.startsWith("admin/")) {
    if (!authed(request, env)) return json({ error: "Wrong password." }, 401);
    const sub = path.slice(6);

    if (sub === "items" && m === "GET") return json({ items: await listItems(env) });

    if (sub === "update" && m === "POST") {
      const { ref, status, note } = await request.json();
      const item = await env.DB.get(`item:${ref}`, "json");
      if (!item) return json({ error: "Not found." }, 404);
      if (!STATUSES[item.kind].includes(status)) return json({ error: "Unknown status." }, 400);
      if (item.kind === "claim" && (status !== item.status || note))
        (item.history = item.history || []).push({ s: status, at: new Date().toISOString(), note: String(note || "").slice(0, 500) });
      item.status = status;
      item.updated = new Date().toISOString();
      await env.DB.put(`item:${ref}`, JSON.stringify(item));
      return json({ ok: true });
    }

    if (sub === "config" && m === "PUT") {
      const { rates } = await request.json();
      const clean = {};
      for (const [k, v] of Object.entries(rates || {})) if (/^\w+$/.test(k) && Number.isFinite(+v)) clean[k] = +v;
      await env.DB.put("config:rates", JSON.stringify(clean));
      return json({ ok: true });
    }

    if (sub === "file" && m === "GET") {
      if (!env.FILES) return json({ error: "File storage isn't connected." }, 503);
      const obj = await env.FILES.get(url.searchParams.get("key") || "");
      if (!obj) return json({ error: "Not found." }, 404);
      return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "application/octet-stream" } });
    }
  }

  return json({ error: "Not found." }, 404);
}
