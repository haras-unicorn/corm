/// <reference path="./omw.d.ts" />

import { buildSystemPrompt } from "./identity";
import { collectTools, createResponder } from "./brain";

const MODEL = "morgan-fetch";

const toolSet = collectTools();
omw.host.log("info", `loaded ${toolSet.tools.length} tools`);
const respond = createResponder(toolSet);
const lifecycle = omw.host.subscribeLifecycle();
const endpoint = omw.host.subscribeEndpoint(MODEL);

omw.host.log("info", `morgan fetch online as "${MODEL}"`);

let running = true;
while (running) {
  let event: OmwEvent;
  try {
    event = omw.host.recv();
  } catch (error) {
    omw.host.log("debug", `recv: ${String(error)}`);
    continue;
  }

  switch (event.kind) {
    case "endpoint-message": {
      const { session, messages } = event.payload;
      const reply = respond([
        { role: "system", content: buildSystemPrompt() },
        ...messages,
      ]);
      omw.host.streamEndpoint(session, { content: reply });
      omw.host.streamEndpoint(session, { finish_reason: "stop" });
      break;
    }

    case "error":
      omw.host.log("error", event.payload);
      break;

    case "reload":
    case "shutdown":
      running = false;
      break;

    default:
      break;
  }
}

omw.host.unsubscribeEndpoint(endpoint);
omw.host.unsubscribeLifecycle(lifecycle);
omw.host.log("info", "morgan fetch offline");
