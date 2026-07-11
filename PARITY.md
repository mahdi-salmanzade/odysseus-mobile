# Feature-parity plan — odysseus-mobile vs. native competitors

Written 2026-07-11 after a full inventory of this app, the upstream Odysseus API,
and the competing native iOS client (`JoaoZaokk/odysseus-ios`). Goal: close the
remaining gaps and keep our differentiators (Android + iOS, MIT, revocable
scoped-token pairing instead of storing an admin session on the device).

## Where we already lead / match

Full chat (SSE streaming, image attachments/vision, agent + web + research
toggles, stop), on-device dictation (`expo-speech-recognition`), and working
screens for memory, notes, calendar (read + create), gallery, email (multi-account
read + send), documents, compare (dual-stream + voting), deep research (full
lifecycle), search, presets, skills, assistant persona, 5 admin tools, and push
notifications. iPhone + iPad.

## Gaps to close (this plan)

All routes below already exist on the Odysseus server and are reachable with our
`ody_` bearer token (verified against the upstream tree).

| # | Gap | Server route(s) already available | Kind |
|---|-----|-----------------------------------|------|
| 1 | **Themes** — 1 dark theme today; add 10+ palettes incl. light + picker | client-only | UI |
| 2 | **i18n + RTL** — ~30 languages, auto-detect; competitor brags 34 | client-only (`expo-localization`) | UI |
| 3 | **Reasoning + tool-use in chat** — `thinking:true` deltas and `tool_start`/`tool_output` are currently dropped | stream already carries it | chat |
| 4 | **Code syntax highlighting** — plain mono box today | client-only | chat |
| 5 | **TTS read-aloud** | `expo-speech`, or server `POST /api/tts/synthesize` | chat |
| 6 | **Memory search + pin** | `POST /api/memory/search`, `POST /api/memory/{id}/pin` | screen |
| 7 | **Task run/pause/resume/stop** | `POST /api/tasks/{id}/{run,pause,resume,stop}` | screen |
| 8 | **Gallery favorite toggle** | `POST /api/gallery/{id}/favorite` | screen |
| 9 | **Email AI summarize + reply** | `POST /api/email/summarize`, `/api/email/ai-reply` | screen |
| 10 | **Cookbook model browse/download/serve** (admin) | `/api/model/{cached,download,serve}`, `/api/cookbook/gpus` | screen |

## Chosen stack (Expo SDK 56, verified)

- TTS: **`expo-speech`** (native voices; local-first). Server `/api/tts` optional later.
- i18n: **`i18next` + `react-i18next` + `expo-localization`**; RTL via `I18nManager`
  using `Locale.textDirection`, reload on language switch.
- Themes: **context + tokens** preserving the current `Theme` shape (no unistyles rewrite).
- Highlighting: **`react-native-code-highlighter`** via the existing `SafeRenderer.code()` override, memoized for streaming.
- Attachments: already `expo-image-picker` + `expo/fetch` FormData.

## Order

Foundational first (theme context, i18n scaffold) since later screens consume them,
then chat quality (reasoning/tools, highlighting, TTS), then the independent
screen features (memory, tasks, gallery, email, cookbook). One focused commit per
item; `tsc` + `jest` green before each.

## Status (2026-07-11)

Shipped client-only: themes (12), i18n+RTL (7 langs), reasoning/tool-use in chat,
code syntax highlighting, TTS read-aloud, memory category filter.

Shipped with new owner-scoped companion-bridge endpoints (server + client):
task run/pause/resume/stop, gallery favorite toggle, email AI summarize + reply,
cookbook read-only model browse. Server endpoints re-resolve the real token owner
(never the `api` pseudo-user) with strict cross-owner 404s; 11 regression tests.

**Deliberately not exposed over the LAN companion:** cookbook model *download* and
*serve*. `serve` runs an operator-supplied shell command on the host (optionally
over SSH) — the exact surface the threat model keeps off the bridge. Browsing the
model inventory is safe; launching stays a desktop/admin-console action.

**Deferred (needs a server endpoint):** memory pin — the bridge has no owner-scoped
memory-pin route (only notes), so it needs a companion endpoint rather than the
un-scoped stock route.

## Deliberately NOT copying

The competitor stores an **admin session cookie** on the phone and ships a 550 MB
on-device PocketTTS pack. We keep the revocable scoped-token model and lean native
TTS. Native admin panel (model-endpoint CRUD, user management) is lower priority
and stays behind the existing admin gate.
