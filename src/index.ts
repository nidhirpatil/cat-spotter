// Cat Spotter — a Cloudflare Worker for a community-cat care group.
// Cats live in D1 (SQLite); their photos live in R2. Anyone can mark a cat
// "seen", and the home page shows when each cat was last spotted.

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
}

interface Cat {
  id: string;
  name: string;
  image_key: string | null;
  last_seen: number | null; // unix milliseconds
}

// Accepted image content types -> file extension used for the R2 key.
const ALLOWED_IMAGE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

const IMG_PREFIX = "/img/";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    try {
      if (method === "GET" && pathname === "/") return await renderIndex(env);
      if (method === "GET" && pathname === "/add") return htmlResponse(addPage());
      if (method === "POST" && pathname === "/add") return await handleAdd(request, env);
      if (method === "POST" && pathname === "/spot") return await handleSpot(request, env);
      if (method === "GET" && pathname.startsWith(IMG_PREFIX)) {
        return await serveImage(decodeURIComponent(pathname.slice(IMG_PREFIX.length)), env, ctx, request);
      }
    } catch (err) {
      console.error("handler error:", err);
      return new Response("internal error", { status: 500 });
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// --- handlers -------------------------------------------------------------

async function renderIndex(env: Env): Promise<Response> {
  // Most recently spotted first; never-seen cats sort last, then by name.
  const { results } = await env.DB.prepare(
    `SELECT id, name, image_key, last_seen FROM cats
     ORDER BY last_seen IS NULL, last_seen DESC, name COLLATE NOCASE`,
  ).all<Cat>();
  return htmlResponse(indexPage(results ?? []));
}

async function handleAdd(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return new Response("a cat needs a name", { status: 400 });

  let imageKey: string | null = null;
  const file = form.get("picture");
  // form.get returns File | string | null; a real upload is a non-empty File.
  if (file && typeof file !== "string" && file.size > 0) {
    const ext = ALLOWED_IMAGE[file.type];
    if (!ext) return new Response("picture must be a jpg, png, gif, or webp", { status: 400 });
    imageKey = crypto.randomUUID() + ext;
    await env.IMAGES.put(imageKey, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
  }

  await env.DB.prepare(
    "INSERT INTO cats (id, name, image_key, last_seen) VALUES (?, ?, ?, NULL)",
  )
    .bind(crypto.randomUUID(), name, imageKey)
    .run();

  return redirect("/");
}

async function handleSpot(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (!id) return new Response("missing cat id", { status: 400 });

  await env.DB.prepare("UPDATE cats SET last_seen = ? WHERE id = ?")
    .bind(Date.now(), id)
    .run();

  return redirect("/");
}

async function serveImage(
  key: string,
  env: Env,
  ctx: ExecutionContext,
  request: Request,
): Promise<Response> {
  if (!key) return new Response("not found", { status: 404 });

  // Serve from the edge cache when possible. This is a no-op on workers.dev
  // subdomains, but kicks in automatically on a custom domain.
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const obj = await env.IMAGES.get(key);
  if (!obj) return new Response("not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  // Immutable: keys are content-addressed, so browsers can cache forever.
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  const resp = new Response(obj.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

// --- helpers --------------------------------------------------------------

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function humanizeAgo(ms: number | null): string {
  if (ms == null) return "never spotted yet";
  const diff = Date.now() - ms;
  const min = 60_000,
    hour = 60 * min,
    day = 24 * hour;
  if (diff < min) return "just now";
  if (diff < hour) return plural(Math.floor(diff / min), "minute") + " ago";
  if (diff < day) return plural(Math.floor(diff / hour), "hour") + " ago";
  return plural(Math.floor(diff / day), "day") + " ago";
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

// --- templates ------------------------------------------------------------

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cat Spotter 🐱</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <a href="/" class="logo">🐱 Cat Spotter</a>
    <a href="/add" class="btn btn-add">+ Add a cat</a>
  </header>
  <main>${content}</main>
  <footer>Looking after our community cats 💛</footer>
</body>
</html>`;
}

function indexPage(cats: Cat[]): string {
  const cards = cats
    .map(
      (c) => `
  <li class="cat-card">
    <div class="cat-photo">
      ${
        c.image_key
          ? `<img src="/img/${encodeURIComponent(c.image_key)}" alt="${escapeHTML(c.name)}">`
          : `<span class="no-photo">🐾</span>`
      }
    </div>
    <div class="cat-body">
      <h2>${escapeHTML(c.name)}</h2>
      <p class="seen ${c.last_seen == null ? "never" : ""}">${humanizeAgo(c.last_seen)}</p>
      <form method="post" action="/spot">
        <input type="hidden" name="id" value="${escapeHTML(c.id)}">
        <button type="submit" class="btn btn-spot">👀 Spotted!</button>
      </form>
    </div>
  </li>`,
    )
    .join("");

  const content = cats.length
    ? `<h1>Recently spotted</h1>\n<ul class="cat-grid">${cards}\n</ul>`
    : `<h1>Recently spotted</h1>\n<p class="empty">No cats yet. <a href="/add">Add the first one</a> 🐈</p>`;

  return layout(content);
}

function addPage(): string {
  return layout(`
<h1>Add a cat</h1>
<form method="post" action="/add" enctype="multipart/form-data" class="add-form">
  <label>
    Name
    <input type="text" name="name" required placeholder="e.g. Marmalade">
  </label>
  <label>
    Picture <span class="hint">(optional — jpg, png, gif, webp)</span>
    <input type="file" name="picture" accept="image/*">
  </label>
  <div class="actions">
    <button type="submit" class="btn btn-add">Add cat</button>
    <a href="/" class="btn btn-cancel">Cancel</a>
  </div>
</form>
<script>
// Shrink the photo in the browser before uploading, so large phone pictures
// don't have to travel full-size. Falls back to a normal submit if anything
// fails or JavaScript is unavailable.
(() => {
  const MAX = 800, QUALITY = 0.75;
  const form = document.querySelector(".add-form");
  const fileInput = form.querySelector('input[name="picture"]');

  form.addEventListener("submit", async (e) => {
    const file = fileInput.files[0];
    if (!file || !file.type.startsWith("image/")) return; // no photo -> normal submit
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Uploading…";
    try {
      const blob = await shrink(file);
      const data = new FormData(form);
      data.set("picture", blob, "photo.jpg");
      const res = await fetch("/add", { method: "POST", body: data });
      if (res.redirected) location.assign(res.url);
      else if (res.ok) location.assign("/");
      else throw new Error(await res.text());
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Add cat";
      alert("Upload failed: " + (err && err.message ? err.message : err));
    }
  });

  async function shrink(file) {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const scale = Math.min(1, MAX / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode image"))), "image/jpeg", QUALITY),
    );
  }
})();
</script>`);
}
