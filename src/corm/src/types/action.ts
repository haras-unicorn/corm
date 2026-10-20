import type { CormOmwEvent } from "./omw";

// Actions are exactly the events omw delivers; there are no synthetic actions.
export type CormAction = CormOmwEvent;
