import { frame } from "corm/lib/framing";
import {
  assistantMessage,
  systemMessage,
  userMessage,
} from "corm/lib/messages";
import {
  appendInboundMessages,
  appendReplayMessages,
  appendRuntimeMessage,
  appendSummaryDelta,
  appendToolResult,
  commitCompaction,
  dropLastExchange,
  enqueueInbound,
  foldAssistantDelta,
  hardLimit,
  isCompacted,
  liveAssistant,
  needsRecap,
  overHard,
  overSoft,
  ownsTool,
  projectIngest,
  protectedTailCount,
  recapReplay,
  recount,
  setActiveRequest,
  softLimit,
  summaryMessage,
  truncationHintMessage,
  windowInput,
  windowSize,
} from "corm/lib/window";
import type { CormInboxMessage } from "corm/types/inbox";
import { defaultTurn } from "corm/types/turn";
import type { CormWindow } from "corm/types/window";
import { expect, test } from "vitest";
import { baseConfig, endpointMessage } from "../common";

const config = baseConfig();

const windowOf = (): CormWindow => ({
  system: systemMessage("system", config),
  summary: "",
  active: [],
  tools: [],
  clientTools: [],
  session: "",
  params: undefined,
  tokens: 0,
  chars: 0,
});

const client = (content: string): ChatMessage => ({ role: "user", content });

test("appendInboundMessages frames a user as client and a system as persona", () => {
  const window = windowOf();

  appendInboundMessages(
    window,
    [
      { role: "user", content: "hi" },
      { role: "system", content: "sys" },
    ],
    [],
    config,
  );

  expect(window.active.map((message) => message.role)).toEqual([
    "user",
    "user",
  ]);
  expect(window.active[0].message.content).toBe(frame("client", "hi"));
  expect(window.active[1].message.content).toBe(frame("persona", "sys"));
});

test("appendInboundMessages skips messages already present", () => {
  const window = windowOf();

  appendInboundMessages(window, [client("a")], [], config);
  appendInboundMessages(window, [client("a"), client("b")], [], config);

  expect(window.active).toHaveLength(2);
});

test("appendInboundMessages skips a message compaction already evicted", () => {
  const window = windowOf();
  const receipts = [[userMessage("client", "gone", config).digest]];

  appendInboundMessages(
    window,
    [client("gone"), client("kept")],
    receipts,
    config,
  );

  expect(window.active).toHaveLength(1);
  expect(window.active[0].message.content).toBe(frame("client", "kept"));
});

test("appendInboundMessages truncates an oversized body and appends the hint", () => {
  const truncated = baseConfig({ messageTokenLimit: 1, charsPerToken: 1 });
  const window = windowOf();

  appendInboundMessages(window, [client("abcdefghij")], [], truncated);

  expect(window.active.map((message) => message.role)).toEqual([
    "user",
    "user",
  ]);
  expect(window.active[0].message.content).toContain("<truncated>");
  expect(window.active[1].message.content).toContain(
    truncationHintMessage(truncated).message.content,
  );
});

test("windowInput leads with the system message", () => {
  const window = windowOf();
  appendInboundMessages(window, [client("hi")], [], config);

  expect(windowInput(window, config)[0]).toEqual(window.system.message);
  expect(windowInput(window, config)).toHaveLength(2);
});

test("windowInput injects the summary as a runtime message before the window", () => {
  const window = windowOf();
  window.summary = "old";
  appendInboundMessages(window, [client("hi")], [], config);

  const input = windowInput(window, config);
  expect(input).toHaveLength(3);
  expect(input[1]).toEqual(summaryMessage("old", config).message);
});

test("summaryMessage renders the compact prelude", () => {
  expect(summaryMessage("body", config).message.content).toContain(
    "The following is a compacted summary",
  );
  expect(summaryMessage("body", config).message.content).toContain("body");
});

test("foldAssistantDelta accumulates content into the live message", () => {
  const window = windowOf();

  foldAssistantDelta(window, { content: "he" }, config);
  foldAssistantDelta(window, { content: "llo" }, config);

  expect(liveAssistant(window)?.content).toBe("hello");
  expect(window.active).toHaveLength(1);
});

test("appendToolResult appends a tool message", () => {
  const window = windowOf();

  appendToolResult(
    window,
    {
      name: "echo",
      arguments: {},
      content: [{ type: "text", text: "hi" }],
    },
    config,
  );

  expect(window.active.at(-1)?.role).toBe("tool");
  expect(window.active.at(-1)?.content).toBe("hi");
});

test("appendRuntimeMessage frames a runtime message and recounts", () => {
  const window = windowOf();

  appendRuntimeMessage(window, "note", config);

  expect(window.active).toHaveLength(1);
  expect(window.active[0]).toMatchObject({ tag: "runtime" });
  expect(window.active[0].message.content).toBe(frame("runtime", "note"));
  expect(window.tokens).toBe(window.active[0].tokens);
});

test("enqueueInbound parks the event in the inbox", () => {
  const inbox: CormInboxMessage[] = [];
  const event = endpointMessage("s");

  enqueueInbound(inbox, event);

  expect(inbox).toHaveLength(1);
  expect(inbox[0].event).toEqual(event);
});

test("projectIngest does not mutate the original window", () => {
  const window = windowOf();

  const projected = projectIngest(window, [client("hi")], [], config);

  expect(window.active).toHaveLength(0);
  expect(projected.active).toHaveLength(1);
});

test("dropLastExchange removes the trailing tool messages and the assistant", () => {
  const window = windowOf();
  appendInboundMessages(window, [client("q")], [], config);
  window.active.push(assistantMessage("call", undefined, undefined, config));
  appendToolResult(
    window,
    { name: "t", arguments: {}, content: [{ type: "text", text: "r" }] },
    config,
  );

  expect(dropLastExchange(window)).toBe(true);
  expect(window.active).toHaveLength(1);
  expect(window.active[0].role).toBe("user");
});

test("commitCompaction folds the evicted set and keeps the protected tail", () => {
  const window = windowOf();
  appendInboundMessages(window, ["a", "b", "c", "d"].map(client), [], config);
  const receipts: string[][] = [];

  commitCompaction(window, "summary", receipts, config);

  expect(window.summary).toBe("summary");
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toHaveLength(3);
  expect(window.active).toHaveLength(1);
  expect(window.anchor).toBeUndefined();
});

test("commitCompaction caps the retained receipts", () => {
  const capped = baseConfig({ compactionReceipts: 1 });
  const window = windowOf();
  const receipts: string[][] = [];

  for (let index = 0; index < 3; index++) {
    appendInboundMessages(window, [client("a"), client("b")], [], capped);
    commitCompaction(window, "s", receipts, capped);
  }

  expect(receipts).toHaveLength(1);
});

test("isCompacted finds a digest in any receipt", () => {
  expect(isCompacted("d", [["a"], ["d"]])).toBe(true);
  expect(isCompacted("d", [["a"], ["b"]])).toBe(false);
});

test("setActiveRequest records the session, params and client tools", () => {
  const window = windowOf();

  setActiveRequest(window, "s1", { temperature: 1 }, [{ name: "client__x" }]);

  expect(window.session).toBe("s1");
  expect(window.params).toEqual({ temperature: 1 });
  expect(window.clientTools).toHaveLength(1);
});

test("ownsTool matches corm tool names only", () => {
  const window = windowOf();
  window.tools = [{ name: "corm__filesystem__echo" }];

  expect(ownsTool(window, "corm__filesystem__echo")).toBe(true);
  expect(ownsTool(window, "client__thing")).toBe(false);
});

test("appendSummaryDelta caps the summary at compactSummaryLimit", () => {
  const turn = defaultTurn();

  appendSummaryDelta(
    turn,
    { content: "hello" },
    {
      ...config,
      compactSummaryLimit: 1,
    },
  );

  expect(turn.summary).toBe("hell");
});

test("recount sums the active tokens", () => {
  const window = windowOf();
  appendInboundMessages(window, [client("hi")], [], config);

  recount(window, config);

  expect(window.tokens).toBe(window.active[0].tokens);
});

test("windowSize prefers the provider anchor when it is larger", () => {
  const window = windowOf();
  window.tokens = 10;
  window.anchor = 20;

  expect(windowSize(window)).toBe(20);
  window.anchor = 5;
  expect(windowSize(window)).toBe(10);
});

test("overSoft and overHard compare against their thresholds", () => {
  const tight = baseConfig({
    contextLength: 100,
    compactThreshold: 0.5,
    hardThreshold: 0.9,
  });
  const window = windowOf();

  expect(softLimit(tight)).toBe(50);
  expect(hardLimit(tight)).toBe(90);

  window.anchor = 60;
  expect(overSoft(window, tight)).toBe(true);
  expect(overHard(window, tight)).toBe(false);

  window.anchor = 90;
  expect(overHard(window, tight)).toBe(true);
});

test("protectedTailCount keeps at least one message", () => {
  const window = windowOf();
  window.active = [0, 1, 2, 3].map((n) =>
    userMessage("client", String(n), config),
  );

  expect(protectedTailCount(window, config)).toBe(1);
});

test("needsRecap only scans the examined request tail", () => {
  const receipts = [[userMessage("client", "gone", config).digest]];

  expect(needsRecap([client("gone")], receipts, config)).toBe(true);
  expect(needsRecap([client("fresh")], receipts, config)).toBe(false);

  const bounded = baseConfig({ requestMessages: 1, recapMessages: 8 });
  expect(needsRecap([client("gone"), client("fresh")], receipts, bounded)).toBe(
    false,
  );
});

test("recapReplay replays the newest evicted messages", () => {
  const receipts = [
    [
      userMessage("client", "a", config).digest,
      userMessage("client", "b", config).digest,
    ],
  ];

  const replay = recapReplay(
    [client("a"), client("b"), client("c")],
    receipts,
    config,
  );

  expect(replay).toEqual([client("a"), client("b")]);
});

test("recapReplay drops the oldest messages until the replay fits", () => {
  const tight = baseConfig({ contextLength: 100, replayRatio: 0.01 });
  const receipts = [
    [
      userMessage("client", "a", tight).digest,
      userMessage("client", "b", tight).digest,
    ],
  ];

  const replay = recapReplay([client("a"), client("b")], receipts, tight);

  expect(replay).toEqual([client("b")]);
});

test("appendReplayMessages appends framed replayed messages", () => {
  const window = windowOf();

  appendReplayMessages(window, [client("a"), client("b")], config);

  expect(window.active).toHaveLength(2);
  expect(window.active[0].message.content).toBe(frame("client", "a"));
});
