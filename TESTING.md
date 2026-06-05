# Testing

A layered pyramid. Everything here runs on a plain Node machine (and in CI) —
**no simulator, no device, no running Odysseus server** — so the loop is fast and
deterministic. Only a thin top slice genuinely needs a phone.

## Layers

| Layer | What | Where | Needs |
|------|------|-------|-------|
| **1. Unit / logic** | Pure functions — host validation, pairing parse, keychain round-trip | `__tests__/pairing-test.ts` | Node |
| **2. Component** | React Native render + interaction (RTL) | `__tests__/screen-header-test.tsx` | Node |
| **3. Wire contract** | Exact bytes on the wire + response shapes we accept, incl. the SSE stream parser | `__tests__/api-test.ts` | Node |
| **4. E2E** | Real UI flows on a built app | `.maestro/` | Simulator/Emulator |
| 5. Manual *(not automatable)* | QR camera scan, real-LAN pairing, push | — | Physical phone |

Layer 3 is the highest-leverage guard for this project: if the Odysseus server
changes a route or payload, these tests fail loudly instead of the app breaking
silently in the field.

## Run

```sh
npm test              # run all suites once
npm run test:watch    # watch mode
npm run test:ci       # CI mode + coverage
npm run typecheck     # tsc --noEmit
npm run lint
```

Conventions: tests live in the top-level `__tests__/` directory and are named
`*-test.ts` / `*-test.tsx`. The `@/` import alias resolves to `src/` (jest
`moduleNameMapper`, mirroring `tsconfig` paths).

### Gotchas (SDK 56 / React 19)

- `@testing-library/react-native` v14's `render` is **async** — `await render(...)`,
  or the queries come back `undefined`. (It uses the new `test-renderer`, not
  `react-test-renderer`.)
- `expo-secure-store` and `expo/fetch` are mocked per-suite; `jest.mock(...)` is
  hoisted above imports by `babel-jest`.

## Tests never ship in the production build

Three independent guarantees, the last one verified:

1. **Not routes.** `expo-router` only scans `src/app/`. Tests live in `__tests__/`,
   so they're never turned into screens.
2. **Not bundled.** Metro bundles only what's reachable from `expo-router/entry`.
   Nothing in `src/` imports `__tests__/`, and `jest` / RTL are `devDependencies`
   (never in the JS bundle).
3. **Verified.** Exporting a production bundle (`expo export -p ios`) and grepping
   its Hermes string table finds app strings but **zero** test-only strings or
   test libraries. Re-run to re-confirm:

   ```sh
   npx expo export -p ios --output-dir /tmp/x
   strings /tmp/x/_expo/static/js/ios/*.hbc | grep -c 'testing-library'   # -> 0
   ```

## Layer 4 — E2E (Maestro)

Flows in `.maestro/` drive the **real built app** and assert on the actual UI.
They're deliberately **server-free** so they run anywhere — they cover the cold
start and the pairing screen up to (but not through) a successful connection,
which is the part that needs a live Odysseus server (→ Layer 5, manual).

| Flow | What it proves |
|------|----------------|
| `launch.yml` | App boots; the unpaired gate shows "Set up Odysseus"; the CTA opens both pairing modes |
| `manual-validation.yml` | A public host is rejected client-side with the invalid-code error, no network call — the on-device twin of the `isLanHost` unit tests |
| `unreachable-server.yml` | A valid-but-unrouted LAN host is actually pinged, then surfaces the network error |

Selectors: the pairing inputs/button carry stable `testID`s (`pair-host`,
`pair-port`, `pair-token`, `pair-connect`) so flows don't depend on copy.

### Run locally

Needs the [Maestro CLI](https://maestro.mobile.dev) and a built app on a running
simulator/emulator (Maestro can't drive Expo Go reliably — use a dev/preview build):

```sh
curl -Ls "https://get.maestro.mobile.dev" | bash   # one-time
npx expo run:ios          # or run:android — installs a build on the simulator
maestro test .maestro/    # runs every flow
```

### Run in CI (cloud)

`.eas/workflows/e2e-ios.yml` and `e2e-android.yml` build the app with the
`e2e-test` profile and run the flows on an EAS-hosted simulator/emulator on each
PR. These need EAS (an Expo account) and the `e2e-test` build profile in
`eas.json`. `eas.json` is gitignored in this repo (it holds Apple/ASC ids), so
add the profile locally:

```jsonc
// eas.json → "build"
"e2e-test": {
  "withoutCredentials": true,
  "ios": { "simulator": true },
  "android": { "buildType": "apk" }
}
```

Trigger manually with `npx eas-cli workflow:run .eas/workflows/e2e-ios.yml`.

> E2E is the layer that needs real infra (a build + a simulator), so it does not
> run in the plain Node `mobile-ci` workflow — keep that one fast.

## CI

`.github/workflows/mobile-ci.yml` runs typecheck → lint → test (with coverage) on
every push/PR to `main`, on Node 20.19.4 (SDK 56's minimum). E2E (Layer 4) runs
separately via the EAS workflows above.
