# @microsurveysai/react

React SDK for [MicroSurveys](https://microsurveys.ai). Wrap your app in a provider, fire events, and
targeted in-app surveys present themselves — or embed a specific survey inline.

```bash
npm install @microsurveysai/react
```

## Auto-triggered surveys

```tsx
import { MicroSurveysProvider, useMicroSurveys } from "@microsurveysai/react";

export default function App({ children }) {
  return <MicroSurveysProvider apiKey="ms_live_…">{children}</MicroSurveysProvider>;
}

function Checkout() {
  const { track, identify } = useMicroSurveys();
  identify("user_123", { plan: "pro" });
  return <button onClick={() => track("checkout_completed")}>Buy</button>;
}
```

Eligibility (triggers, audience, sampling, frequency caps) is configured in the dashboard and
evaluated **on-device**. An eligible survey presents as a bottom sheet or centered dialog per its
configuration.

## Inline surveys

```tsx
import { MicroSurvey } from "@microsurveysai/react";

<MicroSurvey surveyId="svy_abc" onComplete={(result) => console.log(result)} />;
```

## Props

`MicroSurveysProvider`:

| Prop | Default | Description |
| --- | --- | --- |
| `apiKey` | — | Browser-embeddable project key (`ms_live_…` / `ms_test_…`). |
| `apiBaseURL` | staging | Override for prod / self-hosted. |
| `autoStart` | `true` | Start on mount (fetch config, flush ingest). |
| `refreshOnForeground` | `true` | Refresh config when the tab regains focus. |

Next.js App Router: the package ships with `"use client"`, so you can render `<MicroSurveysProvider>`
from a Server Component without extra wrapping.

## License

MIT
