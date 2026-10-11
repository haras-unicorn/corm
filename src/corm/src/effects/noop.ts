import type { CormAction } from "../types/action";
import type { CormState } from "../types/state";

// `noop` is emitted when an event is intentionally dropped: it is meaningless in
// the current state (a stray delta, a duplicate endpoint message, an event the
// brain does not handle). It carries the dropped event's kind so the dispatcher
// can log it. It changes no state and performs no host call, and it should
// disappear once every drop site is either handled or considered unreachable.
export interface CormNoopEffect {
  kind: "noop";
  dropped: string;
}

export type CormNoopEffectRule = {
  state: CormState;
  action: CormAction;
};
