import type { CormAction } from "../types/action";
import type { CormState } from "../types/state";
import type {
  CormArmDigestTimerEffect,
  CormArmDigestTimerEffectRule,
  CormCommitDigestEffect,
  CormCommitDigestEffectRule,
  CormQueueDigestEffect,
  CormQueueDigestEffectRule,
  CormStartDigestEffect,
  CormStartDigestEffectRule,
} from "./digest";
import type {
  CormCancelGenerationEffect,
  CormCancelGenerationEffectRule,
  CormCircuitBreakEffect,
  CormCircuitBreakEffectRule,
  CormClearGenerationEffect,
  CormClearGenerationEffectRule,
  CormCommitCompactionEffect,
  CormCommitCompactionEffectRule,
  CormInvokeCormToolsEffect,
  CormInvokeCormToolsEffectRule,
  CormRetryTextToolCallEffect,
  CormRetryTextToolCallEffectRule,
  CormStartChatGenerationEffect,
  CormStartChatGenerationEffectRule,
  CormStartCompactionGenerationEffect,
  CormStartCompactionGenerationEffectRule,
} from "./generation";
import type { CormNoopEffect, CormNoopEffectRule } from "./noop";
import type {
  CormFoldChatDeltaEffect,
  CormFoldChatDeltaEffectRule,
  CormStreamEndpointDeltaEffect,
  CormStreamEndpointDeltaEffectRule,
} from "./stream";
import type {
  CormAppendInboundMessagesEffect,
  CormAppendInboundMessagesEffectRule,
  CormAppendRecapEffect,
  CormAppendRecapEffectRule,
  CormAppendRuntimeMessageEffect,
  CormAppendRuntimeMessageEffectRule,
  CormAppendToolResultEffect,
  CormAppendToolResultEffectRule,
  CormEnqueueInboundEffect,
  CormEnqueueInboundEffectRule,
  CormFlushNoticesEffect,
  CormFlushNoticesEffectRule,
  CormQueueNoticeEffect,
  CormQueueNoticeEffectRule,
  CormSetActiveRequestEffect,
  CormSetActiveRequestEffectRule,
} from "./window";

const cormApprovedSymbol: unique symbol = Symbol();

export type CormApprovedEffect = CormEffect &
  Record<typeof cormApprovedSymbol, true>;

export type CormEffect =
  | CormStartChatGenerationEffect
  | CormStartCompactionGenerationEffect
  | CormCommitCompactionEffect
  | CormCancelGenerationEffect
  | CormClearGenerationEffect
  | CormInvokeCormToolsEffect
  | CormRetryTextToolCallEffect
  | CormCircuitBreakEffect
  | CormSetActiveRequestEffect
  | CormAppendInboundMessagesEffect
  | CormEnqueueInboundEffect
  | CormAppendRuntimeMessageEffect
  | CormAppendRecapEffect
  | CormAppendToolResultEffect
  | CormFoldChatDeltaEffect
  | CormStreamEndpointDeltaEffect
  | CormArmDigestTimerEffect
  | CormStartDigestEffect
  | CormQueueDigestEffect
  | CormCommitDigestEffect
  | CormQueueNoticeEffect
  | CormFlushNoticesEffect
  | CormNoopEffect
  | never;

// The rule that governs each effect kind, looked up by the effect's `kind`.
type CormEffectRuleByKind = {
  "start-chat-generation": CormStartChatGenerationEffectRule;
  "start-compaction-generation": CormStartCompactionGenerationEffectRule;
  "commit-compaction": CormCommitCompactionEffectRule;
  "cancel-generation": CormCancelGenerationEffectRule;
  "clear-generation": CormClearGenerationEffectRule;
  "invoke-corm-tools": CormInvokeCormToolsEffectRule;
  "retry-text-tool-call": CormRetryTextToolCallEffectRule;
  "circuit-break": CormCircuitBreakEffectRule;
  "set-active-request": CormSetActiveRequestEffectRule;
  "append-inbound-messages": CormAppendInboundMessagesEffectRule;
  "enqueue-inbound": CormEnqueueInboundEffectRule;
  "append-runtime-message": CormAppendRuntimeMessageEffectRule;
  "append-recap": CormAppendRecapEffectRule;
  "append-tool-result": CormAppendToolResultEffectRule;
  "fold-chat-delta": CormFoldChatDeltaEffectRule;
  "stream-endpoint-delta": CormStreamEndpointDeltaEffectRule;
  "arm-digest-timer": CormArmDigestTimerEffectRule;
  "start-digest": CormStartDigestEffectRule;
  "queue-digest": CormQueueDigestEffectRule;
  "commit-digest": CormCommitDigestEffectRule;
  "queue-notice": CormQueueNoticeEffectRule;
  "flush-notices": CormFlushNoticesEffectRule;
  noop: CormNoopEffectRule;
};

type CormRuleFor<E extends CormEffect> = CormEffectRuleByKind[E["kind"]];

// The precondition of a rule: the state and action it accepts. The rule's
// `next` is deliberately excluded from the check.
type CormRulePrecondition<R> = R extends {
  state: infer RS;
  action: infer RA;
}
  ? { state: RS; action: RA }
  : never;

// The state a rule transitions into: its explicit `next` when it has one, or
// the unchanged state when the effect only reads or performs I/O.
type CormNextState<R, S extends CormState> = R extends {
  next: infer N extends CormState;
}
  ? N
  : S;

// A marker that can never be satisfied by a real effect, used so an illegal
// member of a sequence fails the parameter's assignability check.
interface CormIllegalEffect {
  readonly cormIllegalEffect: unique symbol;
}

// Approve each effect in order, threading the state type through each rule's
// `next` so a later effect is checked against the state its predecessors leave
// behind. A legal sequence maps to itself; an illegal one has an element that
// cannot be satisfied.
type CormCheckedEffects<
  S extends CormState,
  A extends CormAction,
  E extends readonly CormEffect[],
> = E extends readonly [
  infer Head extends CormEffect,
  ...infer Tail extends readonly CormEffect[],
]
  ? { state: S; action: A } extends CormRulePrecondition<CormRuleFor<Head>>
    ? readonly [
        Head,
        ...CormCheckedEffects<CormNextState<CormRuleFor<Head>, S>, A, Tail>,
      ]
    : readonly [CormIllegalEffect]
  : readonly [];

export const approveEffects = <
  S extends CormState,
  A extends CormAction,
  const E extends readonly [CormEffect, ...CormEffect[]],
>(
  _state: S,
  _action: A,
  ...effects: E & CormCheckedEffects<S, A, E>
): CormApprovedEffect[] => {
  return (effects as readonly CormEffect[]).map((effect) => {
    const approved = effect as CormApprovedEffect;
    approved[cormApprovedSymbol] = true;
    return approved;
  });
};
