import { renderTaskNotice } from "corm/lib/config";
import {
  CORM_DEFAULT_COMPACT_PRELUDE,
  CORM_DEFAULT_COMPACT_SUMMARY_LIMIT,
  CORM_DEFAULT_COMPACT_THRESHOLD,
  CORM_DEFAULT_COMPACTION_RECEIPTS,
  CORM_DEFAULT_HARD_THRESHOLD,
  CORM_DEFAULT_MESSAGE_TOKEN_LIMIT,
  CORM_DEFAULT_PROMPT_PRELUDE,
  CORM_DEFAULT_PROTECT_MESSAGES,
  CORM_DEFAULT_PROTECT_RATIO,
  CORM_DEFAULT_RECAP_END_NOTICE,
  CORM_DEFAULT_RECAP_MESSAGES,
  CORM_DEFAULT_RECAP_NOTICE,
  CORM_DEFAULT_REPLAY_MESSAGES,
  CORM_DEFAULT_REPLAY_RATIO,
  CORM_DEFAULT_REQUEST_MESSAGES,
  CORM_DEFAULT_TASK_NOTICE,
  CORM_DEFAULT_TRUNCATION_HINT,
  CORM_DEFAULT_TRUNCATION_MARKER,
} from "corm/lib/defaults";
import { detectFraming, frameInbound, runtimeMessage } from "corm/lib/framing";
import {
  type CormConfig,
  type CormTaskIdentity,
  cormWindowZod,
} from "corm/lib/opaque";
import { combinedRuntimePrompts } from "corm/lib/registry";
import {
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateTextTokens,
  estimateTokenChars,
  messageDigest,
  messageFingerprint,
  toolCallKey,
  truncateContent,
} from "corm/lib/tokens";
import type { CormLogger } from "corm/services/logger";

export interface CormWindow {
  input(): ChatMessage[];

  ingest(session: string, messages: ChatMessage[]): ChatMessage[];

  append(...messages: ChatMessage[]): void;

  tokens(inflight?: ChatMessage): number;

  anchor(promptTokens: number): void;

  overSoft(): boolean;

  overHard(): boolean;

  partition(): { evictable: ChatMessage[]; tail: ChatMessage[] };

  compact(summary: string): void;

  summary(): string | undefined;

  noteToolCall(name: string, args: unknown): number;

  dropDuplicateToolExchanges(name: string, args: unknown): number;

  snapshot(): unknown;

  restore(value: unknown): void;

  classify(message: ChatMessage): {
    kind: "current" | "compacted" | "new";
    depth?: number;
  };

  start(task: CormTaskIdentity): ChatMessage[];

  recap(task: CormTaskIdentity, messages: ChatMessage[]): ChatMessage[];

  sessionKey(messages: ChatMessage[]): string;
}

const noopLogger: CormLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export const createCormWindow = (
  config: CormConfig,
  logger: CormLogger = noopLogger,
) => new OmwCormWindow(config, logger) as CormWindow;

class OmwCormWindow {
  private _config: CormConfig;
  private _logger: CormLogger;
  private _summary?: string;
  private _messages: ChatMessage[];
  private _cursors: Record<string, { count: number; last: string }>;
  private _calls: Record<string, number>;
  private _digests: Record<string, number[]>;
  private _receipts: Record<string, number[]>[];
  private _anchor?: { epoch: number; tokens: number; at: number };
  private _epoch: number;

  constructor(config: CormConfig, logger: CormLogger) {
    this._config = config;
    this._logger = logger;
    this._summary = undefined;
    this._messages = [];
    this._cursors = {};
    this._calls = {};
    this._digests = {};
    this._receipts = [];
    this._anchor = undefined;
    this._epoch = 0;
  }

  public input(): ChatMessage[] {
    const leading: ChatMessage[] = [];

    let system = combinedRuntimePrompts(this._config).join("\n\n");
    if (this._config.prompt !== undefined && this._config.prompt !== "") {
      const prelude = this._config.promptPrelude ?? CORM_DEFAULT_PROMPT_PRELUDE;
      system += `\n\n\n${prelude}\n\n${this._config.prompt}`;
    }

    leading.push({ role: "system", content: system });

    if (this._summary !== undefined && this._summary !== "") {
      const prelude =
        this._config.compactPrelude ?? CORM_DEFAULT_COMPACT_PRELUDE;
      leading.push(runtimeMessage(`\n\n\n${prelude}\n\n${this._summary}`));
    }

    return [...leading, ...this._messages];
  }

  public ingest(session: string, messages: ChatMessage[]): ChatMessage[] {
    const cursor = this._cursors[session];

    const stillOurs =
      cursor !== undefined &&
      cursor.count > 0 &&
      cursor.count <= messages.length &&
      messageFingerprint(messages[cursor.count - 1]) === cursor.last;

    const fresh = stillOurs
      ? messages.slice(cursor.count)
      : messages.slice(this._protectedTailStart(messages));

    const unknown = fresh.filter(
      (message) => this.classify(message).kind === "new",
    );

    const ingested: ChatMessage[] = [];
    for (const message of unknown) {
      this._detect(message);
      ingested.push(...this._prepareInbound(message));
    }

    if (ingested.length > 0) {
      this._calls = {};
      this._push(ingested);
    }

    this._cursors[session] = {
      count: messages.length,
      last:
        messages.length > 0
          ? messageFingerprint(messages[messages.length - 1])
          : "",
    };

    return ingested;
  }

  public append(...messages: ChatMessage[]): void {
    this._push(messages.flatMap((message) => this._prepareAppend(message)));
  }

  public tokens(inflight?: ChatMessage): number {
    let tokens =
      this._anchor !== undefined && this._anchor.epoch === this._epoch
        ? this._anchor.tokens +
          estimateMessagesTokens(this._messages.slice(this._anchor.at))
        : estimateMessagesTokens(this._messages) +
          estimateTextTokens(this._summary);

    if (inflight !== undefined) {
      tokens += estimateMessageTokens(inflight);
    }

    return tokens;
  }

  public anchor(promptTokens: number): void {
    this._anchor = {
      epoch: this._epoch,
      tokens: promptTokens,
      at: this._messages.length,
    };
  }

  public overSoft(): boolean {
    return (
      this.tokens() >= this._compactThreshold() * this._config.contextLength
    );
  }

  public overHard(): boolean {
    return this.tokens() > this._hardThreshold() * this._config.contextLength;
  }

  public partition(): { evictable: ChatMessage[]; tail: ChatMessage[] } {
    const start = this._protectedTailStart(this._messages);
    return {
      evictable: this._messages.slice(0, start),
      tail: this._messages.slice(start),
    };
  }

  public compact(summary: string): void {
    const limit = estimateTokenChars(this._compactSummaryLimit());
    this._summary = summary.length > limit ? summary.slice(0, limit) : summary;

    const start = this._protectedTailStart(this._messages);
    const receipt = OmwCormWindow._buildIndex(this._messages, start);

    this._messages = this._messages.slice(start);
    this._rebuildIndex();

    this._receipts.push(receipt);
    const keep = this._compactionReceipts();
    if (this._receipts.length > keep) {
      this._receipts = this._receipts.slice(this._receipts.length - keep);
    }

    this._calls = {};
    this._epoch += 1;
  }

  public summary(): string | undefined {
    return this._summary;
  }

  public classify(message: ChatMessage): {
    kind: "current" | "compacted" | "new";
    depth?: number;
  } {
    const digest = messageDigest(this._inboundStored(message));
    const positions = this._digests[digest];

    if (positions !== undefined && positions.length > 0) {
      const latest = Math.max(...positions);
      return { kind: "current", depth: this._messages.length - 1 - latest };
    }

    for (const receipt of this._receipts) {
      if (receipt[digest] !== undefined) {
        return { kind: "compacted" };
      }
    }

    return { kind: "new" };
  }

  public start(task: CormTaskIdentity): ChatMessage[] {
    const notice = renderTaskNotice(
      this._config.taskNotice ?? CORM_DEFAULT_TASK_NOTICE,
      task,
    );

    return [runtimeMessage(notice)];
  }

  public sessionKey(messages: ChatMessage[]): string {
    if (messages.length === 0) {
      return "empty";
    }

    const digest = messageDigest(this._inboundStored(messages[0]));
    return (digest.split(":")[0] ?? "").padStart(8, "0");
  }

  public recap(task: CormTaskIdentity, messages: ChatMessage[]): ChatMessage[] {
    const recent = messages.slice(
      Math.max(0, messages.length - this._requestMessages()),
    );

    if (!this._resumed(recent)) {
      return [];
    }

    return [
      runtimeMessage(
        renderTaskNotice(
          this._config.recapNotice ?? CORM_DEFAULT_RECAP_NOTICE,
          task,
        ),
      ),
      ...this._recapReplay(recent),
      runtimeMessage(
        this._config.recapEndNotice ?? CORM_DEFAULT_RECAP_END_NOTICE,
      ),
    ];
  }

  public noteToolCall(name: string, args: unknown): number {
    const key = toolCallKey(name, args);
    const count = (this._calls[key] ?? 0) + 1;
    this._calls[key] = count;
    return count;
  }

  public dropDuplicateToolExchanges(name: string, args: unknown): number {
    const key = toolCallKey(name, args);

    const kept: ChatMessage[] = [];
    let removed = 0;
    let seen = false;
    let skipTool = false;

    for (const message of this._messages) {
      if (skipTool && message.role === "tool") {
        skipTool = false;
        continue;
      }
      skipTool = false;

      if (
        message.role === "assistant" &&
        message.toolCall !== undefined &&
        toolCallKey(message.toolCall.name, message.toolCall.arguments) === key
      ) {
        if (seen) {
          removed += 1;
          skipTool = true;
          continue;
        }
        seen = true;
      }

      kept.push(message);
    }

    this._messages = kept;

    if (removed > 0) {
      this._rebuildIndex();
      delete this._calls[key];
      this._epoch += 1;
    }

    return removed;
  }

  public snapshot(): unknown {
    return {
      summary: this._summary,
      messages: this._messages,
      sources: this._cursors,
      digests: this._digests,
      receipts: this._receipts,
      epoch: this._epoch,
    };
  }

  public restore(value: unknown): void {
    const parsed = cormWindowZod.safeParse(value);
    if (!parsed.success) {
      return;
    }

    this._summary = parsed.data.summary;
    this._messages = parsed.data.messages as ChatMessage[];
    this._cursors = parsed.data.sources;
    this._calls = {};
    this._digests = parsed.data.digests;
    this._receipts = parsed.data.receipts;
    this._anchor = undefined;
    this._epoch = parsed.data.epoch;

    if (this._messages.length > 0 && Object.keys(this._digests).length === 0) {
      this._rebuildIndex();
    }
  }

  private _inboundStored(message: ChatMessage): ChatMessage {
    return frameInbound(this._truncate(message));
  }

  private _prepareInbound(message: ChatMessage): ChatMessage[] {
    const role = message.role ?? "user";
    const truncated = this._truncate(message);
    const stored = frameInbound(truncated);

    if (truncated !== message && (role === "user" || role === "tool")) {
      return [stored, runtimeMessage(this._truncationHint())];
    }

    return [stored];
  }

  private _prepareAppend(message: ChatMessage): ChatMessage[] {
    const role = message.role ?? "user";
    const truncated = this._truncate(message);

    if (truncated !== message && role === "tool") {
      return [truncated, runtimeMessage(this._truncationHint())];
    }

    return [truncated];
  }

  private _detect(message: ChatMessage): void {
    const match = detectFraming(message.content);
    if (match === undefined) {
      return;
    }

    this._logger.warn(
      `SECURITY: message ${messageDigest(this._inboundStored(message))} emitted ${match}`,
    );
  }

  private _push(messages: ChatMessage[]): void {
    for (const message of messages) {
      this._addToIndex(message, this._messages.length);
      this._messages.push(message);
    }
  }

  private _addToIndex(message: ChatMessage, position: number): void {
    const digest = messageDigest(message);
    const positions = this._digests[digest];
    if (positions === undefined) {
      this._digests[digest] = [position];
    } else {
      positions.push(position);
    }
  }

  private _rebuildIndex(): void {
    this._digests = OmwCormWindow._buildIndex(
      this._messages,
      this._messages.length,
    );
  }

  private static _buildIndex(
    messages: ChatMessage[],
    end: number,
  ): Record<string, number[]> {
    const index: Record<string, number[]> = {};

    for (let position = 0; position < end; position++) {
      const digest = messageDigest(messages[position]);
      const positions = index[digest];
      if (positions === undefined) {
        index[digest] = [position];
      } else {
        positions.push(position);
      }
    }

    return index;
  }

  private _resumed(messages: ChatMessage[]): boolean {
    const scan = messages.slice(
      Math.max(0, messages.length - this._recapMessages()),
    );

    for (const message of scan) {
      if (this.classify(message).kind === "compacted") {
        return true;
      }
    }

    return false;
  }

  private _recapReplay(messages: ChatMessage[]): ChatMessage[] {
    const known = messages.filter(
      (message) => this.classify(message).kind !== "new",
    );

    let replay = known
      .slice(Math.max(0, known.length - this._replayMessages()))
      .map((message) => this._inboundStored(message));

    const budget = this._replayRatio() * this._config.contextLength;
    let total = estimateMessagesTokens(replay);

    while (replay.length > 1 && total > budget) {
      total -= estimateMessageTokens(replay[0]);
      replay = replay.slice(1);
    }

    return replay;
  }

  private _truncate(message: ChatMessage): ChatMessage {
    if (message.content === undefined) {
      return message;
    }

    const truncated = truncateContent(
      message.content,
      this._messageTokenLimit(),
      this._truncationMarker(),
    );

    if (truncated === message.content) {
      return message;
    }

    return { ...message, content: truncated };
  }

  private _protectedTailStart(messages: ChatMessage[]): number {
    const ratioLimit = this._protectRatio() * this._config.contextLength;
    const messageLimit = this._protectMessages();

    let size = 0;
    let start = messages.length;

    for (let index = messages.length - 1; index >= 0; index--) {
      const count = messages.length - index;
      const tokens = estimateMessageTokens(messages[index]);

      if (count > 1 && (count > messageLimit || size + tokens > ratioLimit)) {
        break;
      }

      size += tokens;
      start = index;
    }

    return start;
  }

  private _messageTokenLimit(): number {
    return this._config.messageTokenLimit ?? CORM_DEFAULT_MESSAGE_TOKEN_LIMIT;
  }

  private _truncationMarker(): string {
    return this._config.truncationMarker ?? CORM_DEFAULT_TRUNCATION_MARKER;
  }

  private _truncationHint(): string {
    return this._config.truncationHint ?? CORM_DEFAULT_TRUNCATION_HINT;
  }

  private _protectRatio(): number {
    return this._config.protectRatio ?? CORM_DEFAULT_PROTECT_RATIO;
  }

  private _protectMessages(): number {
    return this._config.protectMessages ?? CORM_DEFAULT_PROTECT_MESSAGES;
  }

  private _compactThreshold(): number {
    return this._config.compactThreshold ?? CORM_DEFAULT_COMPACT_THRESHOLD;
  }

  private _hardThreshold(): number {
    return this._config.hardThreshold ?? CORM_DEFAULT_HARD_THRESHOLD;
  }

  private _compactSummaryLimit(): number {
    return (
      this._config.compactSummaryLimit ?? CORM_DEFAULT_COMPACT_SUMMARY_LIMIT
    );
  }

  private _compactionReceipts(): number {
    return this._config.compactionReceipts ?? CORM_DEFAULT_COMPACTION_RECEIPTS;
  }

  private _recapMessages(): number {
    return this._config.recapMessages ?? CORM_DEFAULT_RECAP_MESSAGES;
  }

  private _replayMessages(): number {
    return this._config.replayMessages ?? CORM_DEFAULT_REPLAY_MESSAGES;
  }

  private _replayRatio(): number {
    return this._config.replayRatio ?? CORM_DEFAULT_REPLAY_RATIO;
  }

  private _requestMessages(): number {
    return this._config.requestMessages ?? CORM_DEFAULT_REQUEST_MESSAGES;
  }
}
