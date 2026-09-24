import { expect, test } from "vitest";

import { greet } from "./greet";

test("greets by name", () => {
  expect(greet("world")).toBe("hello, world");
});
