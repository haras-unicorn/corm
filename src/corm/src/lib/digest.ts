import type { CormConfig } from "../types/config";
import {
  CORM_DEFAULT_DIGEST_MAX_AGE_MS,
  CORM_DEFAULT_DIGEST_MIN_GAP_MS,
} from "./defaults";

export const isDigestEnabled = (config: CormConfig): boolean =>
  typeof config.digestCron === "string";

export const digestMaxAge = (config: CormConfig): number =>
  config.digestMaxAgeMs ?? CORM_DEFAULT_DIGEST_MAX_AGE_MS;

export const digestMinGap = (config: CormConfig): number =>
  config.digestMinGapMs ?? CORM_DEFAULT_DIGEST_MIN_GAP_MS;

export const isDigestDue = (
  last: number | undefined,
  now: number,
  config: CormConfig,
): boolean =>
  last === undefined || now - last >= digestMaxAge(config);

export const isDigestTooSoon = (
  last: number | undefined,
  now: number,
  config: CormConfig,
): boolean =>
  last !== undefined && now - last < digestMinGap(config);
