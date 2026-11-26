# 22 · Profile & Multi-Device Plan Review (Reviewer #20)

**Verdict: direction sound, not shippable as "real multi-device".** Much of the plan already exists in-tree (`avatarValue`, `PATCH /api/auth/profile`, `pairingBaseUrl`, vendored qrcode.js, `gen-cert.sh`); the gaps are below.

## P0 blockers

1. **Pairing-code brute force / privacy.** `/api/device/pair` is limited only per-IP (12/10min); `code_attempts` exists but is never incremented. Add per-code attempts + lockout. Worse, `/api/device/me` returns *all* children with avatars to a 365-day device token — data minimization violated (a child device sees siblings' photos). Return only the active child; shorten/rotate tokens; show last-seen and revoke in UI.
2. **`/api/setup` is public.** On a LAN, the first visitor becomes admin. Bind setup to localhost or require a one-time console token printed by `start.sh`. Rate limit ≠ authorization.
3. **No-demo migration is incomplete.** `start.sh` no longer seeds, but an existing demo DB keeps `parent@demo.com / Parent123!`. Add a startup guard: if `DEMO_MODE` is off and demo accounts exist → refuse to start or force password reset. `--demo` must use a separate data dir, never the production DB.
4. **HTTPS reality.** http://192.168.x.x is not a secure context: Huawei install degrades to a bookmark (no service worker/offline), and self-signed certs block `getUserMedia` until manually trusted. `pairingBaseUrl` trusts `Host` (QR poisoning) and `socket.encrypted` (wrong `http://` behind a TLS proxy); "first private IPv4" often picks docker0/VPN. Prefer explicit `PUBLIC_URL`, else `X-Forwarded-Proto`/`en0`, and label the QR URL unverified.

## P1

- **Avatar size spec mismatch:** 220 000 counts *base64 characters* (≈165 KB binary). Check decoded bytes and the boundary. Validate magic bytes or re-encode server-side; regex-only trust is brittle. Rate-limit profile PATCH.
- **Nickname:** trim/NFC, reject whitespace-only and control chars; "max 20" counts UTF-16 units, so emoji count double — use graphemes.
- **QR UX:** QR carries the URL only; the code must be typed. Include `?code=` for auto-fill, show countdown/regenerate/cancel, and a fallback for camera-less Macs. Keep `img`-only rendering (CSP already allows `data:`).
- **Child avatar privacy:** a minor's photo — cover it in `exportChildData`/`eraseHousehold`, and don't require camera consent to upload.

## Missing acceptance

Only 91 tests is a count, not coverage. Add: >limit avatar, MIME/`charset` params, avatar removal, cross-household 403, code expiry/reuse/lockout, QR host correctness, demo-DB startup refusal, revoke invalidating tokens, SSE reconnect after Huawei sleep. E2E must run on a real Huawei tablet + Mac Safari, including install and camera consent — Chrome emulation proves nothing.
