//
// storage.ts
//
// Browser primitives shared by the persistence layers, each guarded so the
// package can be imported during SSR (where `localStorage`/`crypto` may be
// absent) without throwing. All persistence in web-core goes through here so
// there is a single place that knows about the environment.
//

/** A safe `localStorage` handle, or `null` when unavailable (SSR, privacy modes). */
function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Accessing localStorage can throw in some sandboxed/blocked contexts.
    return null;
  }
}

export function getItem(key: string): string | null {
  return storage()?.getItem(key) ?? null;
}

export function setItem(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Quota exceeded / disabled storage — non-fatal, we simply don't persist.
  }
}

export function removeItem(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** A v4 UUID, using `crypto.randomUUID` when available with a safe fallback. */
export function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  // RFC-4122-ish fallback for older/embedded runtimes.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Current time in **seconds** since the Unix epoch — matches the iOS runtime's
 *  `Date.timeIntervalSince1970`, which all persisted timestamps use. */
export function nowSeconds(): number {
  return Date.now() / 1000;
}
