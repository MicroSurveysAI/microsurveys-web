//
// provider.tsx
//
// `<MicroSurveysProvider>` creates the client, starts it, exposes it via context,
// and mounts the overlay host that renders auto-triggered surveys. Port of the
// wiring in iOS `MicroSurveysSDK.init` + lifecycle.
//

"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient, type MicroSurveysClient } from "@microsurveysai/web-core";
import { OverlayHost } from "./overlayHost";
import { ensureStyles } from "./styles";

const ClientContext = createContext<MicroSurveysClient | null>(null);

export interface MicroSurveysProviderProps {
  /** Project API key (`ms_live_…` / `ms_test_…`). Browser-embeddable. */
  apiKey: string;
  /** Override the API base (staging/prod/self-hosted). Defaults to staging. */
  apiBaseURL?: string;
  /** Refresh config on tab foreground. Default true. */
  refreshOnForeground?: boolean;
  /** Start automatically on mount. Default true. */
  autoStart?: boolean;
  children?: React.ReactNode;
}

export function MicroSurveysProvider({ apiKey, apiBaseURL, refreshOnForeground, autoStart = true, children }: MicroSurveysProviderProps) {
  // Lazily create the client on the client only (localStorage/crypto are guarded,
  // but there's no reason to build one during SSR).
  const [client] = useState<MicroSurveysClient | null>(() =>
    typeof window === "undefined" ? null : createClient({ apiKey, apiBaseURL, refreshOnForeground }),
  );

  useEffect(() => {
    if (!client) return;
    ensureStyles();
    if (autoStart) client.start();
    return () => client.stop();
  }, [client, autoStart]);

  return (
    <ClientContext.Provider value={client}>
      {children}
      <OverlayHost client={client} />
    </ClientContext.Provider>
  );
}

/** The raw client (or null before mount). Prefer `useMicroSurveys` for events. */
export function useMicroSurveysClient(): MicroSurveysClient | null {
  return useContext(ClientContext);
}

/** Event + identity helpers bound to the provider's client. Safe no-ops if
 *  called outside a provider / before mount. */
export function useMicroSurveys() {
  const client = useContext(ClientContext);
  return useMemo(
    () => ({
      client,
      track: (name: string, properties?: Record<string, unknown>) => client?.track(name, properties),
      identify: (userId: string | null | undefined, properties?: Record<string, unknown>) => client?.identify(userId, properties),
      refresh: () => client?.refreshConfig(),
    }),
    [client],
  );
}

export { ClientContext };
