import {
  CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  CORM_DEFAULT_COMPACT_PRELUDE,
  CORM_DEFAULT_PROMPT_PRELUDE,
  CORM_DEFAULT_RECAP_END_NOTICE,
  CORM_DEFAULT_TRUNCATION_HINT,
} from "corm/lib/defaults";
import { frame } from "corm/lib/framing";
import type { CormConfig } from "corm/lib/opaque";
import { combinedRuntimePrompts } from "corm/lib/registry";
import { estimateMessageTokens, estimateTextTokens } from "corm/lib/tokens";
import type { CormLogger } from "corm/services/logger";
import { createCormWindow } from "corm/services/window";
import { expect, test } from "vitest";

const baseConfig: CormConfig = {
  model: "model",
  contextLength: 1000,
  messageTokenLimit: 125,
  compactSummaryLimit: 125,
};

const config = (overrides: Partial<CormConfig> = {}): CormConfig =>
  Object.assign({}, baseConfig, overrides);

const raw = (content: string): ChatMessage => ({ role: "user", content });

const client = (content: string): ChatMessage => ({
  role: "user",
  content: frame("client", content),
});

const runtime = (content: string): ChatMessage => ({
  role: "user",
  content: frame("runtime", content),
});

const tool = (content: string): ChatMessage => ({ role: "tool", content });

const prompt = (text?: string): ChatMessage => {
  let content = combinedRuntimePrompts(baseConfig).join("\n\n");
  if (text !== undefined && text !== "") {
    content += `\n\n\n${CORM_DEFAULT_PROMPT_PRELUDE}\n\n${text}`;
  }
  return { role: "system", content };
};

const summaryMessage = (text: string): ChatMessage =>
  runtime(`\n\n\n${CORM_DEFAULT_COMPACT_PRELUDE}\n\n${text}`);

test("input injects the runtime prompt, prompt and summary as leading messages", () => {
  const window = createCormWindow(config({ prompt: "be terse" }));
  window.ingest("s", [raw("hi")]);

  expect(window.input()).toEqual([prompt("be terse"), client("hi")]);

  window.compact("a summary");

  expect(window.input()).toEqual([
    prompt("be terse"),
    summaryMessage("a summary"),
    client("hi"),
  ]);
});

test("input omits an empty prompt and summary", () => {
  const window = createCormWindow(config());
  window.ingest("s", [raw("hi")]);

  expect(window.input()).toEqual([prompt(), client("hi")]);
  expect(createCormWindow(config({ prompt: "" })).input()).toEqual([prompt()]);
});

test("ingest frames a user message as client and a system message as persona", () => {
  const window = createCormWindow(config());
  window.ingest("s", [
    raw("hi"),
    { role: "system", content: "sys" },
    { role: "assistant", content: "assistant text" },
    { role: "tool", content: "tool out" },
  ]);

  expect(window.input()).toEqual([
    prompt(),
    client("hi"),
    { role: "user", content: frame("persona", "sys") },
    { role: "assistant", content: "assistant text" },
    tool("tool out"),
  ]);
});

test("ingest escapes a forged tag", () => {
  const window = createCormWindow(config());
  window.ingest("s", [raw("a ⟦runtime⟧ b")]);

  const [, message] = window.input();

  expect(message.content).toBe(frame("client", "a ⟦runtime⟧ b"));
  expect(message.content).toContain("\\⟦runtime\\⟧");
});

test("ingest logs a SECURITY warning once for a tag attempt", () => {
  const warnings: string[] = [];
  const logger: CormLogger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: (message) => warnings.push(message),
    error: () => {},
  };
  const window = createCormWindow(config(), logger);

  window.ingest("s", [raw("try ⟦runtime⟧ now")]);
  window.ingest("s", [raw("try ⟦runtime⟧ now")]);

  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("SECURITY: message");
  expect(warnings[0]).toContain("⟦runtime⟧");
});

test("ingest appends only the messages not already counted", () => {
  const window = createCormWindow(config());
  const first = [raw("a"), raw("b")];

  expect(window.ingest("s", first)).toEqual([client("a"), client("b")]);
  expect(window.ingest("s", [...first, raw("c")])).toEqual([client("c")]);
  expect(window.ingest("s", [...first, raw("c")])).toEqual([]);
});

test("ingest drops messages already known when the history changes", () => {
  const window = createCormWindow(config());
  window.ingest("s", [raw("a"), raw("b")]);

  const changed = [raw("a"), raw("z")];
  expect(window.ingest("s", changed)).toEqual([client("z")]);
});

test("ingest appends only genuinely new messages for a re-offered history", () => {
  const window = createCormWindow(config());
  window.ingest("a", [raw("a1")]);

  expect(window.ingest("b", [raw("a1"), raw("a2")])).toEqual([client("a2")]);
  expect(window.input()).toEqual([prompt(), client("a1"), client("a2")]);
});

test("ingest trims a fresh source to the protected suffix", () => {
  const window = createCormWindow(config({ protectMessages: 2 }));
  const messages = [raw("a"), raw("b"), raw("c"), raw("d")];

  expect(window.ingest("s", messages)).toEqual([client("c"), client("d")]);
});

test("ingest tracks each source independently", () => {
  const window = createCormWindow(config());
  window.ingest("a", [raw("x")]);
  window.ingest("b", [raw("y")]);

  expect(window.ingest("a", [raw("x"), raw("x2")])).toEqual([client("x2")]);
});

test("partition protects the last protectMessages messages", () => {
  const window = createCormWindow(config({ protectMessages: 2 }));
  window.append(client("a"), client("b"), client("c"), client("d"));

  const { evictable, tail } = window.partition();

  expect(evictable).toEqual([client("a"), client("b")]);
  expect(tail).toEqual([client("c"), client("d")]);
});

test("partition protects a size-bounded suffix", () => {
  const window = createCormWindow(config({ protectMessages: 32 }));
  const big = "x".repeat(36);
  window.append(...Array.from({ length: 12 }, () => client(big)));

  const { evictable, tail } = window.partition();

  expect(tail).toHaveLength(7);
  expect(evictable).toHaveLength(5);
});

test("partition always protects at least one message", () => {
  const window = createCormWindow(config({ protectMessages: 0 }));
  window.append(client("a"), client("b"));

  const { evictable, tail } = window.partition();

  expect(evictable).toEqual([client("a")]);
  expect(tail).toEqual([client("b")]);
});

test("ingest truncates an oversized message with the marker", () => {
  const window = createCormWindow(config());
  const long = "a".repeat(600) + "b".repeat(600);
  window.ingest("s", [{ role: "user", content: long }]);

  const [, message, hint] = window.input();

  expect(message.content).toContain("<truncated>");
  expect(
    (message.content as string).startsWith(`⟦client⟧\n\n${"a".repeat(245)}`),
  ).toBe(true);
  expect((message.content as string).endsWith("b".repeat(244))).toBe(true);
  expect(hint).toEqual(runtime(CORM_DEFAULT_TRUNCATION_HINT));
});

test("append truncates a tool message and injects the hint", () => {
  const window = createCormWindow(config());
  window.append(
    { role: "assistant", toolCall: { id: "1", name: "t", arguments: {} } },
    tool("x".repeat(1000)),
  );

  const messages = window.input();

  expect(messages).toHaveLength(4);
  expect(messages[2].content).toContain("<truncated>");
  expect(messages[3]).toEqual(runtime(CORM_DEFAULT_TRUNCATION_HINT));
});

test("append truncates an assistant message without a hint", () => {
  const window = createCormWindow(config());
  window.append({ role: "assistant", content: "y".repeat(1000) });

  const messages = window.input();

  expect(messages).toHaveLength(2);
  expect(messages[1].content).toContain("<truncated>");
});

test("truncation keeps every message within messageTokenLimit", () => {
  const window = createCormWindow(config());
  window.ingest("s", [raw("z".repeat(10_000))]);
  window.append(tool("q".repeat(10_000)));

  const [, user, userHint, toolMessage, toolHint] = window.input();

  expect(estimateTextTokens(user.content)).toBe(128);
  expect(estimateTextTokens(toolMessage.content)).toBe(125);
  expect(userHint).toEqual(runtime(CORM_DEFAULT_TRUNCATION_HINT));
  expect(toolHint).toEqual(runtime(CORM_DEFAULT_TRUNCATION_HINT));
});

test("truncation honours the configured marker", () => {
  const window = createCormWindow(config({ truncationMarker: "..." }));
  window.ingest("s", [{ role: "user", content: "a".repeat(1000) }]);

  const [, message] = window.input();

  expect(message.content).toContain("...");
  expect(message.content).not.toContain("<truncated>");
});

test("short messages are not truncated and get no hint", () => {
  const window = createCormWindow(config());
  window.ingest("s", [raw("hi")]);
  window.append(tool("ok"));

  expect(window.input()).toEqual([prompt(), client("hi"), tool("ok")]);
});

test("summary returns the current rolling summary", () => {
  const window = createCormWindow(config());

  expect(window.summary()).toBeUndefined();

  window.compact("a summary");

  expect(window.summary()).toBe("a summary");
});

test("compact replaces the evictable set with the summary", () => {
  const window = createCormWindow(config({ protectMessages: 2 }));
  window.append(client("a"), client("b"), client("c"), client("d"));
  window.compact("summary text");

  expect(window.input()).toEqual([
    prompt(),
    summaryMessage("summary text"),
    client("c"),
    client("d"),
  ]);
});

test("compact caps the summary at compactSummaryLimit", () => {
  const window = createCormWindow(config({ protectMessages: 1 }));
  window.append(client("a"), client("b"));
  window.compact("s".repeat(600));

  const [, summary] = window.input();
  expect(summary).toEqual(summaryMessage("s".repeat(500)));
});

test("tokens estimates and anchor overrides the covered portion", () => {
  const window = createCormWindow(config());
  window.append(client("a"));
  expect(window.tokens()).toBeGreaterThan(0);

  window.anchor(500);
  expect(window.tokens()).toBe(500);

  window.append(client("b"));
  expect(window.tokens()).toBe(500 + estimateMessageTokens(client("b")));

  expect(window.tokens(client("c"))).toBe(
    500 +
      estimateMessageTokens(client("b")) +
      estimateMessageTokens(client("c")),
  );
});

test("compact invalidates the anchor", () => {
  const window = createCormWindow(config({ protectMessages: 1 }));
  window.append(client("a"), client("b"));
  window.anchor(500);
  window.compact("s");

  expect(window.tokens()).toBe(
    estimateMessageTokens(client("b")) + estimateTextTokens("s"),
  );
});

test("overSoft and overHard compare against the thresholds", () => {
  const window = createCormWindow(config());

  expect(window.overSoft()).toBe(false);
  expect(window.overHard()).toBe(false);

  window.anchor(800);
  expect(window.overSoft()).toBe(true);
  expect(window.overHard()).toBe(false);

  window.anchor(951);
  expect(window.overHard()).toBe(true);
});

test("noteToolCall counts repeats and ingest clears the count", () => {
  const window = createCormWindow(config());

  expect(window.noteToolCall("t", { a: 1 })).toBe(1);
  expect(window.noteToolCall("t", { a: 1 })).toBe(2);
  expect(window.noteToolCall("t", { a: 2 })).toBe(1);

  window.ingest("s", [raw("hi")]);
  expect(window.noteToolCall("t", { a: 1 })).toBe(1);
});

test("dropDuplicateToolExchanges drops repeats and resets the count", () => {
  const window = createCormWindow(config());
  const exchange = (id: string, result: string): ChatMessage[] => [
    { role: "assistant", toolCall: { id, name: "t", arguments: { a: 1 } } },
    tool(result),
  ];
  window.append(
    ...exchange("1", "r1"),
    ...exchange("2", "r2"),
    ...exchange("3", "r3"),
  );

  expect(window.dropDuplicateToolExchanges("t", { a: 1 })).toBe(2);
  expect(window.input()).toEqual([
    prompt(),
    {
      role: "assistant",
      toolCall: { id: "1", name: "t", arguments: { a: 1 } },
    },
    tool("r1"),
  ]);
  expect(window.noteToolCall("t", { a: 1 })).toBe(1);
});

test("dropDuplicateToolExchanges is a no-op without repeats", () => {
  const window = createCormWindow(config());
  window.append(
    { role: "assistant", toolCall: { id: "1", name: "t", arguments: {} } },
    tool("r"),
  );

  expect(window.dropDuplicateToolExchanges("t", {})).toBe(0);
  expect(window.input()).toHaveLength(3);
});

test("snapshot and restore round-trip the window", () => {
  const original = createCormWindow(config({ prompt: "p" }));
  original.ingest("s1", [raw("a"), raw("b")]);
  original.compact("a summary");

  const restored = createCormWindow(config({ prompt: "p" }));
  restored.restore(original.snapshot());

  expect(restored.input()).toEqual(original.input());
});

test("restore ignores an unknown shape", () => {
  const window = createCormWindow(config());
  window.append(client("keep"));

  window.restore("nonsense");
  window.restore({ messages: "nope" });
  window.restore(null);

  expect(window.input()).toEqual([prompt(), client("keep")]);
});

test("restore of an empty snapshot clears the window", () => {
  const window = createCormWindow(config());
  window.append(client("gone"));
  window.restore({});

  expect(window.input()).toEqual([prompt()]);
});

test("classify reports current depth, compacted and new messages", () => {
  const window = createCormWindow(config({ protectMessages: 1 }));
  window.append(client("a"), client("b"), client("c"));

  expect(window.classify(raw("c"))).toEqual({ kind: "current", depth: 0 });
  expect(window.classify(raw("b"))).toEqual({ kind: "current", depth: 1 });
  expect(window.classify(raw("z"))).toEqual({ kind: "new" });

  window.compact("summary");

  expect(window.classify(raw("a"))).toEqual({ kind: "compacted" });
  expect(window.classify(raw("c"))).toEqual({ kind: "current", depth: 0 });
});

test("compaction receipts are bounded by compactionReceipts", () => {
  const window = createCormWindow(
    config({ protectMessages: 1, compactionReceipts: 1 }),
  );

  window.append(client("a1"), client("a2"));
  window.compact("s1");
  window.append(client("b1"));
  window.compact("s2");

  expect(window.classify(raw("a1"))).toEqual({ kind: "new" });
  expect(window.classify(raw("a2"))).toEqual({ kind: "compacted" });
});

test("dropDuplicateToolExchanges keeps the digest index in sync", () => {
  const window = createCormWindow(config());
  const call: ChatMessage = {
    role: "assistant",
    toolCall: { id: "1", name: "t", arguments: {} },
  };
  window.append(call, tool("r"), call, tool("r"));

  window.dropDuplicateToolExchanges("t", {});

  expect(window.classify(call)).toEqual({ kind: "current", depth: 1 });
});

test("snapshot preserves the digest index and receipts", () => {
  const original = createCormWindow(config({ protectMessages: 1 }));
  original.append(client("a"), client("b"));
  original.compact("summary");

  const restored = createCormWindow(config({ protectMessages: 1 }));
  restored.restore(original.snapshot());

  expect(restored.classify(raw("a"))).toEqual({ kind: "compacted" });
  expect(restored.classify(raw("b"))).toEqual({ kind: "current", depth: 0 });
});

test("restore rebuilds the digest index from messages", () => {
  const window = createCormWindow(config());
  window.restore({
    messages: [client("a"), client("b")],
    sources: {},
    epoch: 0,
  });

  expect(window.classify(raw("a"))).toEqual({ kind: "current", depth: 1 });
});

const task = { name: "chat", id: "1" };

test("start renders the task notice as a runtime message", () => {
  const window = createCormWindow(config());

  expect(window.start({ name: "chat", id: "7" })).toEqual([
    runtime("You are starting task chat (7)."),
  ]);
});

test("start renders the task identity's description", () => {
  const window = createCormWindow(config());

  expect(
    window.start({ name: "chat", id: "2", description: "Session abc" }),
  ).toEqual([runtime("You are starting task chat (2) Session abc.")]);
});

test("input leads with the combined runtime prompts", () => {
  const window = createCormWindow(config());

  expect(window.input()[0]).toEqual(prompt());
});

test("input uses the configured runtime system prompt", () => {
  const window = createCormWindow(
    config({ runtimeSystemPrompt: "combined prompt" }),
  );

  expect(window.input()[0]).toEqual({
    role: "system",
    content: `combined prompt\n\n${CORM_DEFAULT_CHAT_SYSTEM_PROMPT}`,
  });
});

test("recap fires when the source's recent messages were compacted and replays them", () => {
  const window = createCormWindow(config({ protectMessages: 1 }));
  window.ingest("a", [raw("a1")]);
  window.append(client("keep"));
  window.compact("summary");

  const block = window.recap(task, [raw("a1"), raw("a2")]);

  expect(block[0]).toEqual(
    runtime(
      "You started task chat (1) again. The following is a replay of its most recent messages so you can continue where you left off.",
    ),
  );
  expect(block[1]).toEqual(client("a1"));
  expect(block.at(-1)).toEqual(runtime(CORM_DEFAULT_RECAP_END_NOTICE));
});

test("recap does not fire for a deep-but-present source", () => {
  const window = createCormWindow(config());
  window.ingest("a", [raw("a1")]);
  window.append(client("b1"), client("b2"), client("b3"));

  expect(window.recap(task, [raw("a1"), raw("a2")])).toEqual([]);
});

test("a recap makes the replayed content shallow so an immediate re-offer does not recap", () => {
  const window = createCormWindow(config({ protectMessages: 1 }));
  window.ingest("a", [raw("a1")]);
  window.append(client("keep"));
  window.compact("summary");

  const block = window.recap(task, [raw("a1"), raw("a2")]);
  expect(block.length).toBeGreaterThan(0);

  window.append(...block);

  expect(window.recap(task, [raw("a1"), raw("a2")])).toEqual([]);
});

test("recap fires again once the replayed copy is compacted away", () => {
  const window = createCormWindow(config({ protectMessages: 1 }));
  window.ingest("a", [raw("a1")]);
  window.append(client("keep"));
  window.compact("summary");

  window.append(...window.recap(task, [raw("a1"), raw("a2")]));

  window.append(client("keep2"));
  window.compact("summary2");

  expect(window.recap(task, [raw("a1"), raw("a2")]).length).toBeGreaterThan(0);
});

test("recap does not fire for a brand-new task", () => {
  const window = createCormWindow(config());

  expect(window.recap(task, [raw("a1")])).toEqual([]);
});

test("recap does not fire for a source whose messages are still present", () => {
  const window = createCormWindow(config());
  window.ingest("a", [raw("a1")]);
  window.append(client("b1"));

  expect(window.recap(task, [raw("a1"), raw("a2")])).toEqual([]);
});

test("appending a recap block indexes the replayed copies", () => {
  const window = createCormWindow(config({ protectMessages: 1 }));
  window.ingest("a", [raw("a1")]);
  window.append(client("keep"));
  window.compact("summary");

  window.append(...window.recap(task, [raw("a1"), raw("a2")]));

  expect(window.classify(raw("a1"))).toEqual({ kind: "current", depth: 1 });
});

test("recap does not fire for an active client re-offering its full history", () => {
  const window = createCormWindow(config());
  const history = Array.from({ length: 20 }, (_, index) => raw(`m${index}`));
  window.ingest("s", history);

  expect(window.recap(task, [...history, raw("next")])).toEqual([]);
});

test("requestMessages bounds the request slice recap considers", () => {
  const window = createCormWindow(
    config({ requestMessages: 2, protectMessages: 1 }),
  );
  window.ingest("s", [raw("old")]);
  window.append(client("keep"));
  window.compact("summary");

  expect(window.recap(task, [raw("old"), raw("a2"), raw("a3")])).toEqual([]);
});
