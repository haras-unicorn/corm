import type { CormConfig } from "../types/config";
import {
  CORM_DEFAULT_COMPACT_SUMMARY_LIMIT,
  CORM_DEFAULT_COMPACT_THRESHOLD,
  CORM_DEFAULT_DIGEST_LOOKBACK_MS,
  CORM_DEFAULT_DIGEST_MAX_AGE_MS,
  CORM_DEFAULT_DIGEST_MIN_GAP_MS,
  CORM_DEFAULT_HARD_THRESHOLD,
  CORM_DEFAULT_MESSAGE_TOKEN_LIMIT,
  CORM_DEFAULT_PROTECT_RATIO,
  CORM_DEFAULT_REPLAY_MESSAGES,
  CORM_DEFAULT_REPLAY_RATIO,
  CORM_DEFAULT_REQUEST_MESSAGES,
} from "./defaults";
import { oneLine } from "./static";

export const validateConfig = (config: CormConfig): void => {
  const contextLength = config.contextLength;
  const protectRatio = config.protectRatio ?? CORM_DEFAULT_PROTECT_RATIO;
  const compactThreshold =
    config.compactThreshold ?? CORM_DEFAULT_COMPACT_THRESHOLD;
  const hardThreshold = config.hardThreshold ?? CORM_DEFAULT_HARD_THRESHOLD;
  const replayRatio = config.replayRatio ?? CORM_DEFAULT_REPLAY_RATIO;
  const requestMessages =
    config.requestMessages ?? CORM_DEFAULT_REQUEST_MESSAGES;
  const replayMessages = config.replayMessages ?? CORM_DEFAULT_REPLAY_MESSAGES;
  const messageTokenLimit =
    config.messageTokenLimit ?? CORM_DEFAULT_MESSAGE_TOKEN_LIMIT;
  const compactSummaryLimit =
    config.compactSummaryLimit ?? CORM_DEFAULT_COMPACT_SUMMARY_LIMIT;

  if (!(protectRatio >= 0.125 && protectRatio <= 0.5)) {
    throw new Error(
      `protectRatio must be within [0.125, 0.5]; got ${protectRatio}`,
    );
  }

  if (
    !(
      protectRatio < compactThreshold &&
      compactThreshold <= hardThreshold &&
      hardThreshold < 1
    )
  ) {
    throw new Error(
      oneLine(`
        require protectRatio < compactThreshold <= hardThreshold < 1;
        got ${protectRatio}, ${compactThreshold}, ${hardThreshold}
      `),
    );
  }

  if (!(replayRatio > 0 && replayRatio < hardThreshold - compactThreshold)) {
    throw new Error(
      oneLine(`
        replayRatio must be within (0, hardThreshold - compactThreshold)
        (${hardThreshold - compactThreshold}); got ${replayRatio}
      `),
    );
  }

  if (!(requestMessages >= 1 && replayMessages >= 1)) {
    throw new Error(
      oneLine(`
        requestMessages and replayMessages must be at least 1; got
        ${requestMessages}, ${replayMessages}
      `),
    );
  }

  if (!(messageTokenLimit <= protectRatio * contextLength)) {
    throw new Error(
      oneLine(`
        messageTokenLimit must not exceed protectRatio * contextLength
        (${protectRatio * contextLength}); got ${messageTokenLimit}
      `),
    );
  }

  if (!(compactSummaryLimit <= protectRatio * contextLength)) {
    throw new Error(
      oneLine(`
        compactSummaryLimit must not exceed protectRatio * contextLength
        (${protectRatio * contextLength}); got ${compactSummaryLimit}
      `),
    );
  }

  if (typeof config.digestCron === "string") {
    if (config.digestCron.trim() === "") {
      throw new Error("digestCron must not be empty");
    }

    if (
      (config.digestFeeds?.length ?? 0) === 0 &&
      config.digestPrompt === undefined
    ) {
      throw new Error(
        "digestCron requires digestFeeds or a custom digestPrompt",
      );
    }
  }

  const digestLookbackMs =
    config.digestLookbackMs ?? CORM_DEFAULT_DIGEST_LOOKBACK_MS;
  const digestMaxAgeMs =
    config.digestMaxAgeMs ?? CORM_DEFAULT_DIGEST_MAX_AGE_MS;
  const digestMinGapMs =
    config.digestMinGapMs ?? CORM_DEFAULT_DIGEST_MIN_GAP_MS;

  if (!(digestLookbackMs > 0)) {
    throw new Error(
      `digestLookbackMs must be positive; got ${digestLookbackMs}`,
    );
  }

  if (!(digestMaxAgeMs > 0)) {
    throw new Error(`digestMaxAgeMs must be positive; got ${digestMaxAgeMs}`);
  }

  if (!(digestMinGapMs >= 0)) {
    throw new Error(
      `digestMinGapMs must not be negative; got ${digestMinGapMs}`,
    );
  }
};
