import { type CormLogger, createCormLogger } from "corm/lib/log";
import type { CormAnyToolingHandle } from "corm/lib/omw";
import type { CormHandles } from "./handles";

export const cormToolPrefix = "corm__";

interface CormToolEntry {
  tooling: string;
  handle: CormAnyToolingHandle;
  tool: Tool;
}

export interface CormToolCall {
  uuid: string;
  exposed: string;
  name: string;
  args: unknown;
}

export interface CormToolSettlement {
  call: CormToolCall;
  result?: ToolResult;
  error?: string;
}

export interface CormTooling {
  definitions(): ChatTool[];

  own(name: string): boolean;

  invoke(name: string, args: unknown): CormToolCall;

  pending(): CormToolCall[];

  settle(event: OmwEvent): CormToolSettlement | undefined;
}

export const createCormTooling = (handles: CormHandles) =>
  new OmwCormTooling(handles) as CormTooling;

class OmwCormTooling {
  private _logger: CormLogger;
  private _registry: Map<string, CormToolEntry>;
  private _pending: Map<string, CormToolCall>;

  constructor(handles: CormHandles) {
    this._logger = createCormLogger(handles.host());
    this._registry = new Map();
    this._pending = new Map();

    for (const tooling of handles.toolings()) {
      for (const tool of tooling.handle.listTools()) {
        const exposed = `${cormToolPrefix}${tool.name}`;
        if (this._registry.has(exposed)) {
          this._logger.warn(
            `corm tool ${exposed} from ${tooling.name} shadows another tooling's tool`,
          );
        }
        this._registry.set(exposed, {
          tooling: tooling.name,
          handle: tooling.handle,
          tool,
        });
      }
    }

    this._logger.debug(
      `registered ${this._registry.size} corm tool(s) across ${handles.toolings().length} tooling(s)`,
    );
  }

  public definitions(): ChatTool[] {
    return [...this._registry.entries()].map(([exposed, entry]) => ({
      name: exposed,
      description: entry.tool.description,
      inputSchema: entry.tool.inputSchema,
      outputSchema: entry.tool.outputSchema,
    }));
  }

  public own(name: string): boolean {
    return this._registry.has(name);
  }

  public invoke(name: string, args: unknown): CormToolCall {
    const entry = this._registry.get(name);
    if (entry === undefined) {
      throw new Error(`unknown corm tool ${name}`);
    }

    this._logger.trace(`invoking corm tool ${name} via ${entry.tooling}`);

    const uuid = entry.handle.callTool(entry.tool.name, args);
    const call = { uuid, exposed: name, name: entry.tool.name, args };
    this._pending.set(uuid, call);

    this._logger.debug(`corm tool ${name} queued as ${uuid}`);

    return call;
  }

  public pending(): CormToolCall[] {
    return [...this._pending.values()];
  }

  public settle(event: OmwEvent): CormToolSettlement | undefined {
    if (event.kind !== "tool-result" && event.kind !== "error") {
      return undefined;
    }

    const call = this._pending.get(event.id);
    if (call === undefined) {
      return undefined;
    }

    this._pending.delete(event.id);

    if (event.kind === "tool-result") {
      this._logger.trace(`corm tool ${call.exposed} settled as ${call.uuid}`);
      return { call, result: event.payload };
    }

    this._logger.warn(
      `corm tool ${call.exposed} failed as ${call.uuid}: ${event.payload}`,
    );
    return { call, error: event.payload };
  }
}
