import { describe, it, expect, beforeEach } from "bun:test";
import { resolveServerLimits } from "../src/server/config/limits";
import { handleDeploy, handleDeployStatus } from "../src/server/routes/handlers";
import { validateRequest } from "../src/server/services/validation";
import {
  addOutput,
  finishDeploy,
  resetDeployState,
  shouldRejectNewDeploy,
  startDeploy,
} from "../src/server/services/deployState";

describe("resolveServerLimits deployCooldownSec", () => {
  it("defaults to 30 seconds", () => {
    expect(resolveServerLimits({}).deployCooldownMs).toBe(30_000);
  });

  it("allows 0 to disable cooldown", () => {
    expect(
      resolveServerLimits({ deployCooldownSec: 0 }).deployCooldownMs
    ).toBe(0);
  });

  it("accepts a custom positive value", () => {
    expect(
      resolveServerLimits({ deployCooldownSec: 45 }).deployCooldownMs
    ).toBe(45_000);
  });

  it("rejects negative values", () => {
    expect(() =>
      resolveServerLimits({ deployCooldownSec: -1 })
    ).toThrow(/deployCooldownSec/);
  });

  it("rejects non-integers", () => {
    expect(() =>
      resolveServerLimits({ deployCooldownSec: 1.5 })
    ).toThrow(/deployCooldownSec/);
  });
});

describe("shouldRejectNewDeploy", () => {
  const env = "cooldown-unit";

  beforeEach(() => {
    resetDeployState(env);
  });

  it("rejects while a deploy is running", () => {
    startDeploy(env);
    const result = shouldRejectNewDeploy(env, 30_000);
    expect(result.reject).toBe(true);
    expect(result.reason).toContain("already in progress");
  });

  it("rejects within the cooldown window after finish", () => {
    finishDeploy(startDeploy(env), { success: true, exitCode: 0 });
    const result = shouldRejectNewDeploy(env, 5_000);
    expect(result.reject).toBe(true);
    expect(result.reason).toContain("cooldown");
  });

  it("allows a new deploy when cooldown is 0", () => {
    finishDeploy(startDeploy(env), { success: true, exitCode: 0 });
    expect(shouldRejectNewDeploy(env, 0)).toEqual({ reject: false });
  });

  it("allows a new deploy after the cooldown elapses", async () => {
    finishDeploy(startDeploy(env), { success: true, exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(shouldRejectNewDeploy(env, 10)).toEqual({ reject: false });
  });
});

describe("deployment identity", () => {
  const env = "identity-test";
  const config = {
    port: 0, configDir: process.cwd(), token: "test-token",
    limits: { deployCooldownSec: 0 },
    environments: { [env]: { deployCommand: "", uploadPath: "." } },
  };

  function deploy(stream: boolean, headers: Record<string, string> = {}) {
    return handleDeploy(new Request("http://localhost/deploy", {
      method: "POST", headers: { authorization: config.token, ...headers },
      body: JSON.stringify({ env, stream }),
    }), config);
  }

  function status(headers: Record<string, string> = {}) {
    return handleDeployStatus(new Request(`http://localhost/deploy/status?env=${env}`, {
      headers: { authorization: config.token, ...headers },
    }), config);
  }

  beforeEach(() => {
    resetDeployState(env);
    config.environments[env]!.deployCommand = "";
  });

  it("resumes a failed stream after a successful JSON deploy and expires it on the next stream", async () => {
    config.environments[env]!.deployCommand = "echo preparing && exit 7";
    const first = await deploy(true);
    const deploymentId = first.headers.get("x-deployment-id");
    const events = await first.text();
    const eventId = events.match(/^id: (\d+)$/m)?.[1];
    expect(deploymentId).toBeTruthy();
    expect(eventId).toBeTruthy();
    expect(events).toContain("event: error");
    const cursor = { "last-event-id": eventId! };
    const identity = { "x-deployment-id": deploymentId! };

    config.environments[env]!.deployCommand = "";
    expect((await deploy(false)).status).toBe(200);
    expect((await (await status()).json()).lastResult.success).toBe(true);
    expect((await (await status(identity)).json()).lastResult.exitCode).toBe(7);
    for (const headers of [cursor, { ...cursor, ...identity }]) {
      const resumed = await deploy(true, headers);
      expect(resumed.headers.get("x-deployment-id")).toBe(deploymentId);
      expect(await resumed.text()).toContain('"exitCode":7');
    }

    expect(await (await deploy(true)).text()).toContain("event: done");
    expect((await deploy(true, cursor)).status).toBe(410);
    expect((await deploy(true, { ...identity, "last-event-id": "0" })).status).toBe(410);
    expect((await status(identity)).status).toBe(410);
  });

  it("delivers the terminal event to a subscriber that reconnects before any output", async () => {
    const run = startDeploy(env, true);
    const identity = { "x-deployment-id": run.deploymentId };
    const first = await deploy(true, identity);
    await first.body!.cancel();
    const resumed = await deploy(true, { ...identity, "last-event-id": "0" });
    expect(resumed.status).toBe(200);
    expect((await (await status(identity)).json()).running).toBe(true);
    addOutput(run, "output", { type: "stdout", data: "resumed output" });
    finishDeploy(run, { success: true, exitCode: 0 });
    addOutput(run, "done", { success: true, exitCode: 0 });
    const events = await resumed.text();
    expect(events).toContain("resumed output");
    expect(events).toContain("event: done");
  });

  it("keeps the command and stderr out of stored JSON deploy results", async () => {
    config.environments[env]!.deployCommand = "echo test-diagnostic >&2 && exit 7";
    const failed = await deploy(false);
    expect(failed.status).toBe(500);
    expect((await failed.json()).stderr).toContain("test-diagnostic");
    const result = (await (await status()).json()).lastResult;
    expect(result).toMatchObject({ success: false, exitCode: 7 });
    expect(result).not.toHaveProperty("message");
    expect(JSON.stringify(result)).not.toContain("test-diagnostic");
  });

  it("requires a non-empty, configured environment name", () => {
    for (const invalid of [null, "", " ", [], {}, 1, "toString"]) {
      expect(validateRequest(invalid, config.token, config).valid).toBe(false);
    }
    expect(validateRequest(env, config.token, config).valid).toBe(true);
  });

  it("shares the running lock across both modes with cooldown disabled", async () => {
    for (const streaming of [false, true]) {
      const active = startDeploy(env, streaming);
      expect((await deploy(!streaming)).status).toBe(409);
      finishDeploy(active, { success: true, exitCode: 0 });
    }
  });
});
