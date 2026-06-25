import { describe, expect, it } from "vitest";
import { resolveTargetAuth } from "../../src/auth";
import type { TargetAuth } from "../../src/auth/types";

describe("resolveTargetAuth", () => {
  it("returns OpenClaw auth for the openclaw target", () => {
    const auth: TargetAuth = { target: "openclaw", token: "token" };
    expect(
      resolveTargetAuth("openclaw", {
        readers: {
          openclaw: () => auth,
          hermes: () => null,
        },
      }),
    ).toBe(auth);
  });

  it("returns Hermes auth for the hermes target", () => {
    const auth: TargetAuth = { target: "hermes", token: "token" };
    expect(
      resolveTargetAuth("hermes", {
        readers: {
          openclaw: () => null,
          hermes: () => auth,
        },
      }),
    ).toBe(auth);
  });
});
