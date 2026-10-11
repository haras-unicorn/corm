import { validateConfig } from "corm/lib/config";
import { expect, test } from "vitest";
import { baseConfig } from "../common";

test("accepts a default config", () => {
  expect(() => validateConfig(baseConfig())).not.toThrow();
});

test("rejects a protectRatio outside [0.125, 0.5]", () => {
  expect(() => validateConfig(baseConfig({ protectRatio: 0.1 }))).toThrow(
    /protectRatio/,
  );
  expect(() => validateConfig(baseConfig({ protectRatio: 0.6 }))).toThrow(
    /protectRatio/,
  );
});

test("requires protectRatio < compactThreshold <= hardThreshold < 1", () => {
  expect(() =>
    validateConfig(baseConfig({ protectRatio: 0.5, compactThreshold: 0.4 })),
  ).toThrow();
  expect(() =>
    validateConfig(baseConfig({ compactThreshold: 0.9, hardThreshold: 0.8 })),
  ).toThrow();
  expect(() => validateConfig(baseConfig({ hardThreshold: 1 }))).toThrow();
});

test("requires replayRatio within (0, hardThreshold - compactThreshold)", () => {
  expect(() => validateConfig(baseConfig({ replayRatio: 0 }))).toThrow(
    /replayRatio/,
  );
  expect(() =>
    validateConfig(
      baseConfig({
        compactThreshold: 0.8,
        hardThreshold: 0.9,
        replayRatio: 0.5,
      }),
    ),
  ).toThrow(/replayRatio/);
});

test("requires at least one request and replay message", () => {
  expect(() => validateConfig(baseConfig({ requestMessages: 0 }))).toThrow();
  expect(() => validateConfig(baseConfig({ replayMessages: 0 }))).toThrow();
});

test("bounds messageTokenLimit and compactSummaryLimit by the protected region", () => {
  const contextLength = 1000;
  const protectRatio = 0.125;

  expect(() =>
    validateConfig(
      baseConfig({
        contextLength,
        protectRatio,
        messageTokenLimit: 200,
      }),
    ),
  ).toThrow();
  expect(() =>
    validateConfig(
      baseConfig({
        contextLength,
        protectRatio,
        compactSummaryLimit: 200,
      }),
    ),
  ).toThrow();
  expect(() =>
    validateConfig(
      baseConfig({
        contextLength,
        protectRatio,
        messageTokenLimit: 100,
        compactSummaryLimit: 100,
      }),
    ),
  ).not.toThrow();
});
