# Building for TestFlight

Odysseus Mobile is an Expo SDK 56 app. The simplest path to TestFlight is **EAS
Build** (Expo's cloud builder handles iOS signing for you) + **EAS Submit**.

> **How testers use the app:** they still need an Odysseus server on their LAN and
> a pairing code — point them at
> [`MOBILE_SETUP.md`](https://github.com/pewdiepie-archdaemon/odysseus/blob/main/MOBILE_SETUP.md)
> on the server side.

## Prerequisites

- **Apple Developer Program** membership — **$99/year** (required even for internal TestFlight).
- An **Expo account** (free): `npx eas-cli@latest login`.
- Bundle identifier: **`tech.mindzone.odysseus`** (set in `app.json`). Create a
  matching App ID + an app record in [App Store Connect](https://appstoreconnect.apple.com).

## One-time setup

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest init            # links the project, writes extra.eas.projectId into app.json
```

Then fill the two placeholders in **`eas.json` → submit.production.ios**:
- `ascAppId` — your app's Apple ID number from App Store Connect (App → App Information → "Apple ID").
- `appleTeamId` — your 10-char Apple Developer Team ID.

(You can skip these and let `eas submit` prompt you interactively instead.)

## Build → TestFlight

```bash
# 1. Cloud build a signed .ipa (EAS creates/manages the signing certs the first time)
npx eas-cli@latest build --platform ios --profile production

# 2. Upload it to App Store Connect / TestFlight
npx eas-cli@latest submit --platform ios --profile production --latest
```

In App Store Connect → **TestFlight**:
- **Internal testers** (up to 100 on your team): available right after Apple finishes
  processing the build (~5–30 min). **No review.**
- **External testers** (public link, up to 10,000): the **first build needs Beta App
  Review** (lighter than full App Store review, usually ~a day). Fill in "What to
  Test" and the beta description.

`eas.json` uses `appVersionSource: "remote"` with `autoIncrement` on the production
profile, so the iOS build number bumps automatically each upload (TestFlight
requires unique build numbers). Bump the marketing version in `app.json`
(`expo.version`) for user-visible releases.

## Build profiles (`eas.json`)

| Profile | Use |
|---|---|
| `development` | dev client for `expo-dev-client` debugging |
| `preview` | internal-distribution `.ipa`/`.apk` for ad-hoc device installs |
| `production` | store build for TestFlight / App Store (auto-increments build number) |

## App Transport Security note

The app reaches your server over plain **HTTP on the LAN**, so `app.json` sets
`NSAllowsArbitraryLoads: true` (+ `NSAllowsLocalNetworking`). Internal TestFlight
doesn't care. For **external/App Store review**, be ready to justify it:

> "The app connects only to the user's own self-hosted Odysseus server on their
> local network. There are no remote/public endpoints; HTTPS isn't possible for an
> arbitrary LAN IP without the user provisioning certificates."

ATS exceptions are domain-scoped (not IP-range-scoped), so blanket arbitrary loads
is the practical option for a "connect to any LAN IP" app. If you later require a
fixed hostname (e.g. a Tailscale MagicDNS name or a `*.local` host), tighten this to
`NSExceptionDomains` for that host before App Store submission.

## Android (Play Store / internal)

```bash
npx eas-cli@latest build --platform android --profile production
npx eas-cli@latest submit --platform android --profile production --latest
```
(Needs a Google Play Console account — $25 one-time — and a service-account key.)
