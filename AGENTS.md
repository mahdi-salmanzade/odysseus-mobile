# Expo SDK 56 — read before writing code

This app targets **Expo SDK 56** (React Native 0.85, React 19.2, Hermes v1, New
Architecture mandatory). Several APIs changed vs. older SDKs — do NOT write Expo
code from memory. Check the versioned docs at
https://docs.expo.dev/versions/v56.0.0/ first.

Things that bite here specifically:
- `expo/fetch` is the **default** global `fetch`; streaming uses
  `response.body.getReader()`. `src/lib/api.ts` imports `fetch` from `expo/fetch`
  explicitly for the chat stream.
- `expo-camera` uses `CameraView` + `useCameraPermissions` + `onBarcodeScanned`
  + `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}` (not the legacy `Camera`).
- `expo-router` no longer depends on React Navigation; auth-gating uses
  `Stack.Protected guard={…}`.
- Cleartext `http://` to a LAN IP needs `android.usesCleartextTraffic` and iOS
  ATS exceptions (`app.json`), and a **dev build** — it won't run in legacy Expo Go.
- Install packages with `npx expo install <pkg>` so versions match the SDK.

Use TypeScript and the `@/*` path alias (→ `src/*`).
