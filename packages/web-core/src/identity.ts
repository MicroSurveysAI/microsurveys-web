//
// identity.ts
//
// Maintains the current `Identity` snapshot the engine evaluates against, and
// mints/persists a stable anonymous id so cap + trigger state stay consistent
// across reloads before any user is identified. Port of iOS `IdentityStore`.
//

import { getItem, setItem, uuid } from "./storage";
import type { Identity, Json, JsonObject } from "./types";

const ANON_KEY = "com.microsurveys.anonymousId";
const PROPS_KEY = "com.microsurveys.userProperties";

export class IdentityStore {
  private identity: Identity;

  constructor() {
    let anon = getItem(ANON_KEY);
    if (!anon) {
      anon = "anon_" + uuid();
      setItem(ANON_KEY, anon);
    }
    let userProperties: JsonObject = {};
    const props = getItem(PROPS_KEY);
    if (props) {
      try {
        const parsed = JSON.parse(props) as JsonObject;
        if (parsed && typeof parsed === "object") userProperties = parsed;
      } catch {
        /* ignore */
      }
    }
    this.identity = { anonymousId: anon, userProperties };
  }

  /** Thread-safe not required (single-threaded JS); returns a shallow snapshot. */
  snapshot(): Identity {
    return { ...this.identity, userProperties: { ...this.identity.userProperties } };
  }

  /** Apply a host `identify(id, properties)` call. Merges properties. */
  setUser(id: string | null | undefined, properties?: Record<string, unknown>): void {
    if (id) this.identity.hostUserId = id;
    if (properties) {
      for (const key of Object.keys(properties)) {
        this.identity.userProperties[key] = toJson(properties[key]);
      }
      this.persistProperties();
    }
  }

  private persistProperties(): void {
    setItem(PROPS_KEY, JSON.stringify(this.identity.userProperties));
  }
}

/** Best-effort conversion of an arbitrary host value into a JSON value, for
 *  snapshotting user properties (port of iOS `JSONValue(any:)`). */
function toJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "object":
      if (Array.isArray(value)) return value.map(toJson);
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJson(v)]));
    default:
      return String(value);
  }
}
