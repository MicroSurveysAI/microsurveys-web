# @microsurveysai/web-core

Framework-agnostic browser runtime for [MicroSurveys](https://microsurveys.ai). Feed it events and
identity; it decides **on-device** when a survey is eligible and emits it for a UI layer (e.g.
[`@microsurveysai/react`](https://www.npmjs.com/package/@microsurveysai/react)) to render. No UI, no
framework dependencies.

A faithful port of the iOS SDK runtime — the same FNV-1a sampling on both platforms, so a given user
buckets identically across web and mobile.

```bash
npm install @microsurveysai/web-core
```

```ts
import { createClient } from "@microsurveysai/web-core";

const client = createClient({ apiKey: "ms_live_…" });
client.start();

client.onPresent(({ survey, shown, close }) => {
  // render `survey`, call shown() once it's on screen (sends the impression),
  // then close({ answers, completed, dismissed }) when it goes away
});

client.track("checkout_completed", { plan: "pro" });
```

Impressions and responses go through a persisted queue: anything sent while offline is retried
every few seconds (backing off to 30 s), when the tab comes back to the foreground, and when the
browser reports it's back online.

Most apps use a framework adapter (`@microsurveysai/react`) rather than this directly. See the
[repository README](https://github.com/MicroSurveysAI/microsurveys-web) for the full picture.

## License

MIT
