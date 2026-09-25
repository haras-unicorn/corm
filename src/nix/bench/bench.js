const providerName = omw.host.memoryGet("bench-provider");
if (providerName === undefined) {
  throw new Error("bench-provider missing from memory");
}
const provider = omw.provider.get(providerName);
const model = provider.listModels()[0];

provider.chat(
  model,
  [
    {
      role: "system",
      content: "You are a helpful assistant. Answer the user's request.",
    },
    { role: "user", content: "Please say hi!" },
  ],
  [],
);

const prompt = omw.host.memoryGet("bench-prompt");
if (prompt === undefined) {
  throw new Error("bench-prompt missing from memory");
}

const tokens = omw.host.memoryGet("bench-tokens");
if (tokens === undefined) {
  throw new Error("bench-tokens missing from memory");
}
omw.host.log("info", `prompt tokens: ${tokens}`);

const start = omw.host.timeNow();

const stream = provider.chatStream(
  model,
  [
    {
      role: "system",
      content: "You are a helpful assistant. Answer the user's request.",
    },
    {
      role: "user",
      content:
        `>>> CONTENT START\n\n\n${prompt}\n\n\n>>> CONTENT END\n\n\n` +
        "Please write a long summary of the provided content.",
    },
  ],
  [],
);

let firstDelta = null;
let usage = null;
let reasoning = "";
let content = "";

while (true) {
  const event = omw.host.recv();
  if (event.id !== stream) {
    continue;
  }
  if (event.kind === "chat-delta") {
    if (
      firstDelta === null &&
      (event.payload.reasoning || event.payload.content)
    ) {
      firstDelta = omw.host.timeNow();
      omw.host.log(
        "info",
        `first delta at ${firstDelta - start}: ${JSON.stringify(event)}`,
      );
    }
    if (event.payload.reasoning) {
      reasoning += event.payload.reasoning;
    }
    if (event.payload.content) {
      content += event.payload.content;
    }
    if (event.payload.usage) {
      usage = event.payload.usage;
    }
  } else if (event.kind === "chat-end") {
    break;
  } else if (event.kind === "error") {
    throw new Error(`${JSON.stringify(event.payload)}`);
  }
}

const end = omw.host.timeNow();

if (firstDelta === null) {
  throw new Error("stream produced no deltas");
}
if (
  usage === null ||
  usage.promptTokens === undefined ||
  usage.completionTokens === undefined
) {
  throw new Error("stream reported no usage");
}

const prefillMs = firstDelta - start;
const generationMs = end - firstDelta;
const totalMs = end - start;
const totalTokens =
  usage.totalTokens ?? usage.promptTokens + usage.completionTokens;

const report = {
  model,
  prompt,
  reasoning,
  content,
  promptTokens: usage.promptTokens,
  completionTokens: usage.completionTokens,
  totalTokens,
  prefillMs,
  generationMs,
  totalMs,
  prefillTps: usage.promptTokens / (prefillMs / 1000),
  generationTps: usage.completionTokens / (generationMs / 1000),
  totalTps: totalTokens / (totalMs / 1000),
};

omw.host.log("info", `{{CORM BENCH RESULT: ${JSON.stringify(report)}}}`);

omw.host.recv();
