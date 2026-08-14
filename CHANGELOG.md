# Changelog

## Build 12 — 2026-08-14

### Remote access over HTTPS

- Added an **Use HTTPS** option to pairing, so a server behind a TLS reverse
  proxy (`tailscale serve`, Caddy, nginx) can be paired and used. Pasting a full
  `https://…` address into the host field turns it on automatically, and the
  scheme is carried through every request, including SSE streaming and uploads.
  This is what makes the app usable over Tailscale/WireGuard: iOS App Transport
  Security exempts only local addresses, and its exception list is keyed by
  domain — a CGNAT range like `100.64.0.0/10` can't be expressed — so cleartext
  to a tailnet IP never left the device. ([#2](https://github.com/mahdi-salmanzade/odysseus-mobile/issues/2))
- Kept the cleartext contract unchanged: `http://` pairings are still restricted
  to LAN/loopback/link-local/CGNAT/`.local`/single-label hosts. An https pairing
  may name any host, and a scanned code pointing outside the local network now
  asks for confirmation before the token is sent.
- Skipped the LAN subnet sweep for https pairings — the host is a name, not a
  DHCP lease, so rediscovery could only have pointed it at the wrong machine.
- Switched the host fields to the URL keyboard; the numeric one couldn't type a
  hostname at all, which the mDNS/MagicDNS advice depended on.
- Added a pairing hint: on Tailscale, use the machine name rather than the
  `100.x.y.z` literal when staying on cleartext.
- Documented in the README which companion-bridge branches provide which
  `/api/companion/*` endpoints, and which two the app calls that aren't
  published yet.

## Build 11 — 2026-07-11

Build 11 is a major feature update.

### New

- Added 12 color themes, including light modes, selectable in **Settings → Appearance**.
- Added seven interface languages: English, Spanish, French, German, Portuguese, Arabic, and Persian.
- Added automatic device-language detection and right-to-left layout for Arabic and Persian.
- Added collapsible assistant thinking, agent tool-call chips, and syntax-highlighted code blocks to chat.
- Added on-device, offline read-aloud for assistant replies.
- Updated voice dictation to follow the selected language.

### Tasks, Gallery, Email, and Admin

- Added controls to run, pause, resume, and stop scheduled tasks.
- Added gallery image favorites.
- Added AI email summaries and AI-drafted replies.
- Added cached-model browsing under **Admin → Cookbook**.

All companion features remain owner-scoped and communicate only with the paired Odysseus server over the user's network.

### What to test

- Switch between themes and languages, including Arabic or Persian for right-to-left layout.
- Send a chat message, expand the thinking block, and use **Read aloud**.
- Favorite a gallery image.
- Run or pause a scheduled task.
- Summarize an email and generate an AI reply.
