# MicroSurveys Web SDK

In-app micro-surveys for the web — the browser counterpart to the
[MicroSurveys iOS SDK](https://github.com/MicroSurveysAI/microsurveys-ios). Drop it into your
React app, fire events, and targeted surveys present themselves; AI reads the responses back for
you in the [dashboard](https://microsurveys.ai).

This is a monorepo of the web/JS packages. One package per framework, all sharing a single
framework-agnostic runtime.

## Packages

| Package | What it is |
| --- | --- |
| [`@microsurveys/web-core`](./packages/web-core) | Framework-agnostic browser runtime — on-device trigger evaluation, deterministic sampling, config cache, offline ingest. No UI. |
| [`@microsurveys/react`](./packages/react) | React SDK — provider, hooks, auto-triggered overlay surveys, and inline `<MicroSurvey>`. |

Planned: `@microsurveys/js` (script-tag embed), `@microsurveys/vue`, `@microsurveys/svelte` — all
reusing `web-core` unchanged.

## Quick start (React)

```bash
npm install @microsurveys/react
```

```tsx
import { MicroSurveysProvider, useMicroSurveys } from "@microsurveys/react";

function App() {
  return (
    <MicroSurveysProvider apiKey="ms_live_…">
      <YourApp />
    </MicroSurveysProvider>
  );
}

function Checkout() {
  const { track } = useMicroSurveys();
  // Fire an event; an eligible survey presents itself after its configured delay.
  return <button onClick={() => track("checkout_completed", { plan: "pro" })}>Buy</button>;
}
```

Embed a specific survey inline (e.g. in a settings page):

```tsx
import { MicroSurvey } from "@microsurveys/react";

<MicroSurvey surveyId="svy_abc" onComplete={(r) => console.log(r)} />;
```

Your API key is the browser-embeddable project key from the dashboard (same key type the iOS SDK
ships). Surveys, triggers, targeting, and theme are configured in the dashboard and evaluated
**on-device** — no server round-trip to decide what to show.

## Development

```bash
pnpm install
pnpm build       # tsup → ESM + CJS + d.ts
pnpm test        # vitest (web-core runtime)
pnpm typecheck
```

> **This repository is a read-only mirror.** The source of truth lives in the private
> MicroSurveys monorepo under `sdk-web/`. Every change to that directory on `main` is mirrored
> here and published to npm automatically (patch bump by default; minor/major on demand) — the
> same model as [`microsurveys-ios`](https://github.com/MicroSurveysAI/microsurveys-ios). Open
> issues here; send code changes upstream.

## License

MIT
