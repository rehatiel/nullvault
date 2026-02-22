# 🔒 NullVault

A self-hosted honeypot link tracker. Create a secret-looking URL, share it with a target, and get notified the instant it's opened — with geolocation, device fingerprinting, a private control panel, and optional webhook alerts.

Built for scam baiting, OSINT, and catching unauthorized access to sensitive material.

> **Built entirely with [Claude](https://claude.ai) (Anthropic).** Every line of code, config, and documentation in this project was written through an iterative AI-assisted development session — no manual coding. The architecture decisions, feature design, and implementation were all driven through conversation with Claude Sonnet.


---

## Features

- **Deceptive templates** — the public page looks like a generic secret share, a banking portal, or a crypto wallet depending on the template
- **Burn-on-reveal toggle** — optionally destroy the secret after the first read, or leave it persistent for continued monitoring
- **Full access logging** — every visit captures IP, city/state/country, ISP, browser, OS, referrer, and timestamp
- **Private control panel** — stat cards, activity chart, world map, US state heat map, device breakdown, IP lookup, raw log table with CSV export
- **Webhook alerts** — configure a Discord webhook or any HTTP endpoint from the control panel; test pings included
- **Zero external requests at runtime** — fonts, Chart.js, and map SVGs are all self-hosted; no CDN calls, no third-party analytics
- **Strict CSP** — `script-src 'self'`, `style-src 'self'`, `default-src 'none'`; zero inline styles or scripts
- **Docker-first** — single `docker compose up -d` to deploy; SQLite persisted in a named volume

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/rehatiel/nullvault.git
cd nullvault
cp .env.example .env
```

Open `.env` and set at minimum:

```env
BASE_URL=https://your-domain.com
CREATION_SECRET=your-long-random-secret
```

Generate a strong secret:

```bash
openssl rand -hex 32
```

### 2. Deploy

```bash
docker compose up -d
```

The app listens on port `3000`. Put Nginx, Caddy, or a Cloudflare Tunnel in front.

### 3. Create your first honeypot link

```bash
curl -s -X POST https://your-domain.com/create \
  -H "Content-Type: application/json" \
  -H "X-Creation-Secret: your-long-random-secret" \
  -d '{
    "content":      "The password is: hunter2",
    "template":     "banking",
    "expiryDays":   30,
    "burnOnReveal": false
  }' | jq
```

Response:

```json
{
  "publicUrl":  "https://your-domain.com/s/ABC123...",
  "controlUrl": "https://your-domain.com/s/ABC123.../control",
  "expiresAt":  1234567890
}
```

- Share `publicUrl` with your target
- Bookmark `controlUrl` — it's your private dashboard

---

## Usage

### Web UI

Visit `https://your-domain.com` to use the creation form. Options:

| Field | Description |
|---|---|
| **Content** | The secret text the visitor sees on reveal (up to 4 096 chars) |
| **Template** | Visual decoy skin shown to the visitor |
| **Expiry** | Days until the link stops working (`0` = never) |
| **Burn after reading** | Destroy the secret after the first successful reveal |

### Templates

| Value | Looks like |
|---|---|
| `default` | Generic NullVault secure-secret page |
| `banking` | "SecureDoc Portal" — corporate document delivery |
| `crypto` | "WalletVault" — crypto wallet seed-phrase viewer |

### Control Panel

Every link has a private dashboard at `/s/<public_token>/control`:

| Tab | Contents |
|---|---|
| **Overview** | Stat cards, recent activity timeline, world map, US state heat map |
| **Timeline** | Full chronological log with event type, IP, location |
| **Devices** | Browser and OS breakdown from User-Agent strings |
| **IP Addresses** | Deduplicated IPs with location, ISP, and IPInfo lookup link |
| **Raw Logs** | Full table with CSV export |
| **Settings** | Webhook URL — set, update, clear, or test-ping any time |

### Maps

- **World map** — countries with accesses are highlighted; hover for name + count
- **US state heat map** — appears automatically when US traffic is detected; states coloured on a 4-level scale (amber → red) relative to the most-active state

### Webhook Alerts

Configure from the **Settings** tab after link creation. Format is auto-detected:

- **Discord** — rich embed with event type, IP, location, user agent, referrer
- **Generic HTTP** — JSON POST with `event`, `publicUrl`, `ip`, `location`, `userAgent`, `referer`, `timestamp`

A **Send Test Ping** button fires a real request with `test: true` to verify delivery.

---

## API

All endpoints return JSON. Link creation requires an `X-Creation-Secret` header.

### `POST /create`

**Headers:**
```
X-Creation-Secret: <CREATION_SECRET>
Content-Type: application/json
```

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `content` | string | ✅ | Up to 4 096 chars |
| `template` | string | | `default`, `banking`, or `crypto` |
| `expiryDays` | number | | `0` = never; defaults to `DEFAULT_EXPIRY_DAYS` |
| `burnOnReveal` | boolean | | `false` = persistent; `true` = one-time |

**Response `201`:**
```json
{
  "publicUrl":  "https://your-domain.com/s/<token>",
  "controlUrl": "https://your-domain.com/s/<token>/control",
  "expiresAt":  1234567890
}
```

### `GET /s/:token` — public honeypot page

### `POST /s/:token/reveal` — reveal secret (called by public page)

### `GET /s/:token/control` — private control panel (HTML)

### `POST /s/:token/webhook` — update webhook URL

```json
{ "webhookUrl": "https://discord.com/api/webhooks/..." }
```

Send `{ "webhookUrl": null }` to clear.

### `POST /s/:token/webhook/test` — fire a test ping

### `GET /health` — returns `{ "status": "ok" }`

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | — | **Required.** Full public URL, no trailing slash |
| `CREATION_SECRET` | — | **Required.** `X-Creation-Secret` header value for `/create` |
| `PORT` | `3000` | Listen port |
| `TRUST_PROXY` | `1` | Express trust-proxy depth |
| `DEFAULT_EXPIRY_DAYS` | `30` | Default link lifetime in days |
| `RETENTION_DAYS` | `30` | Access log retention in days |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | `20` | Max requests per window per IP |
| `DB_PATH` | `/app/data/honeypot.db` | SQLite path inside container |

---

## Reverse Proxy

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

### Caddy

```
your-domain.com {
    reverse_proxy localhost:3000
}
```

### Cloudflare Tunnel

Set `TRUST_PROXY=1`. NullVault reads the real IP from `CF-Connecting-IP` automatically.

---

## Updating

```bash
git pull
docker compose up -d --build
```

The database schema is migrated automatically on startup — no manual steps needed.

---

## Security Notes

- The `controlUrl` is the only access control for the dashboard — treat it like a password
- `CREATION_SECRET` protects link creation; use a long random value
- Geolocation uses the bundled `geoip-lite` offline database — no outbound IP lookups
- Helmet.js enforces strict CSP: no inline scripts, no inline styles, no external resources
- SQLite WAL mode is enabled for safe concurrent reads during traffic spikes

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (Alpine) |
| Web framework | Express 4 |
| Database | SQLite via `better-sqlite3` |
| Templates | Nunjucks |
| Geolocation | `geoip-lite` (fully offline) |
| Security headers | Helmet.js |
| Maps | Natural Earth + US Atlas TopoJSON (pre-rendered SVG) |
| Charts | Chart.js 4 (self-hosted) |
| Fonts | IBM Plex Sans/Mono (self-hosted WOFF2) |

---

## ⚠️ Important Disclaimer

This software is provided for **educational and research purposes only**.

By using this project, you agree that:

- You are responsible for complying with all applicable local, state, and international laws  
- You will not use this software for harassment, doxxing, retaliation, or unauthorized surveillance  
- You understand that IP-based geolocation is approximate and unreliable  
- You will not attempt to identify, track, or harm individuals using this software  
- The authors and contributors assume no liability for misuse  

---

## What This Project **Is**

- A passive honeypot designed to observe scam-related access patterns  
- A self-hosted tool — no centralized service, no external tracking  
- A single-purpose application with minimal data collection  
- An open-source project suitable for demonstrations, learning, and analysis  

---

## What This Project **Is NOT**

- ❌ A hacking tool  
- ❌ A doxxing or retaliation platform  
- ❌ A credential harvester  
- ❌ A tracking or fingerprinting system  
- ❌ A way to bypass VPNs, proxies, or anonymity tools  
- ❌ A law enforcement or attribution solution  

---

## Core Features

- Generate shareable links that appear to be a simple secret-sharing page  
- Each link has a private control panel accessible via a derived URL  
- No global admin panel or user accounts  
- Passive logging of basic request metadata  
- Clean, minimal UI for viewing access logs  
- Optional link expiration  
- Ability to delete links and associated logs  
- Rate limiting to reduce abuse  

---

## Data Collected

This project intentionally limits data collection.

**Logged metadata includes:**

- IP address  
- Timestamp  
- User-Agent string  
- HTTP referrer (if present)  
- Requested path  
- Standard HTTP headers  
- Approximate geolocation (country / region only)  

**The application does not:**

- Execute client-side exploits  
- Use invasive fingerprinting techniques  
- Track users across sessions  
- Attempt to deanonymize visitors  
- Collect credentials or secrets  

---

## License

MIT
