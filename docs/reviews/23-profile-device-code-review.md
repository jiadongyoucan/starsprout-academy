# Review 23 — Profile Editing & Multi-Device Pairing

**Verdict: REVISE.** Core validation, pairing and revoke paths are sound and the suite is 91 tests. But setup can be taken over behind the documented reverse-proxy deployment, and the Docker/LAN pairing path is unusable.

## Blockers

1. **Setup takeover via proxy.** `src/routes/core.ts:66-70` trusts only `socket.remoteAddress`. Behind Caddy/Nginx/Cloudflare Tunnel — recommended in `docs/deploy-real.md:38` — every internet request arrives from 127.0.0.1, so the first anonymous caller of `/api/setup` becomes admin. `SETUP_TOKEN` exists but is absent from `.env.example`, compose and docs, and is untested. Require it whenever proxy headers are present and in production, compare with `timingSafeEqual`, and print a one-time token at boot.
2. **Docker production cannot initialize or pair.** The bridge source IP is not loopback, so `/api/setup` returns 403. `PUBLIC_URL` defaults to `http://localhost:8080`, which `src/core/network.ts:13` ignores, so the QR falls back to the container's `172.17.x` address and is unreachable from a phone. Compose/README must expose `SETUP_TOKEN` and a real `PUBLIC_URL`.
3. **Device token is not child-scoped.** `src/modules/device.ts:185-209` returns every sibling (name, class, pet) in `/api/device/inbox`; `deviceProfile` accepts `?childId=<sibling>` (line 428); `devicePlan` and the learning/snapshot endpoints accept any child in the household. A child tablet can read siblings' profiles, avatars and plans, contradicting "one active child". Add `devices.child_id` and enforce it on every `/api/device/*`.
4. **180-day token in the SSE query string** (`device.js:526`) is written to reverse-proxy logs and cannot rotate. Issue a short-lived stream ticket instead.

## Top fixes
- `code_attempts` never increments on wrong guesses (`device.ts:91-98`), so the per-code cap is dead code; only per-IP limiting works. Hash codes or add a global attempt budget.
- A child avatar is face data but needs no guardian consent or retention, unlike camera photos. Gate it or reuse consent, and omit avatars from device payloads.
- Profile and child nicknames skip the moderation `register` applies (`auth.ts:43`).
- 200 KB avatars are stored inline; 20 edits/10 min can bloat SQLite without a quota.
- `childModal.js:35` injects the avatar through unescaped `innerHTML` (low risk only because canvas re-encodes).

## Missing tests
None for: non-loopback or `SETUP_TOKEN` setup; demo-vs-real boot refusal; `pairingBaseUrl` public-Host rejection, `PUBLIC_URL`, HTTPS; sibling isolation; the 200 KB boundary, magic-byte mismatch, remote URLs; NFC/grapheme limits; per-code revoke; token expiry/SSE.

**Acceptance:** setup refuses non-loopback callers even with proxy headers unless a documented token is supplied; Docker setup and pairing URLs are reachable and documented; the device API returns 404 for siblings; the tests above are added with the existing 91 green.
