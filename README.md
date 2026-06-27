# 🐱 Cat Spotter

A tiny site for a community-cat care group, running entirely on Cloudflare's
free tier. Each cat has a name and a photo; when someone spots a cat they hit
**Spotted!**, and the home page shows how long ago each cat was last seen
(most recent first).

- **Compute:** Cloudflare Worker (TypeScript) — `src/index.ts`
- **Data:** D1 (serverless SQLite) — cat records
- **Images:** R2 (object storage) — cat photos, served at `/img/<key>`
- **Static:** `public/style.css`, served by Cloudflare's assets

> The original Go version is preserved under `legacy-go/` for reference. It is
> not deployed.

## Prerequisites

- A Cloudflare account (free).
- `npm install` (installs Wrangler locally).
- Logged in: `npx wrangler login`.

## One-time setup

### 1. Create the D1 database

```sh
npx wrangler d1 create cat-spotter
```

Copy the printed `database_id` into `wrangler.jsonc`, replacing
`PLACEHOLDER_RUN_D1_CREATE`.

### 2. Create the R2 bucket

```sh
npx wrangler r2 bucket create cat-spotter-images
```

> R2 must be enabled once in the Cloudflare dashboard (Storage & Databases →
> R2). It may ask for a card, but usage stays within the free tier.

### 3. Create the table

```sh
npx wrangler d1 execute cat-spotter --remote --file=schema.sql
```

### 4. (Optional) Migrate the original two cats

Upload their photos to R2 **with the correct content type**, then seed D1:

```sh
npx wrangler r2 object put cat-spotter-images/c97d9be7d208a5e9.jpg \
  --file=uploads/c97d9be7d208a5e9.jpg --content-type image/jpeg --remote
npx wrangler r2 object put cat-spotter-images/9bc49a97b9f62a75.jpg \
  --file=uploads/9bc49a97b9f62a75.jpg --content-type image/jpeg --remote

npx wrangler d1 execute cat-spotter --remote --file=seed.sql
```

### 5. Deploy

```sh
npx wrangler deploy
```

Wrangler prints your live URL (e.g. `https://cat-spotter.<subdomain>.workers.dev`).

## Local development

Wrangler emulates D1 and R2 locally, so you can run the whole thing offline:

```sh
npx wrangler d1 execute cat-spotter --local --file=schema.sql   # once
npx wrangler dev                                                # http://localhost:8787
```

Use `--local` on the `r2 object put` / `d1 execute` commands above to seed the
local store too.

## Routes

| Method | Path        | Purpose                          |
| ------ | ----------- | -------------------------------- |
| GET    | `/`         | List cats, most recently spotted |
| GET    | `/add`      | Form to add a cat                |
| POST   | `/add`      | Create a cat (name + photo)      |
| POST   | `/spot`     | Mark a cat as seen now           |
| GET    | `/img/<key>`| Serve a cat photo from R2        |

## Cost

Everything fits comfortably in the free tier: Workers 100k req/day, D1 5 GB +
5M row-reads/day, R2 10 GB storage with no egress fees.
