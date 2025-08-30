import * as core from "@actions/core";
import { StateSchema, State } from "./types";

function truthy(s?: string): boolean {
  return (s || "").toLowerCase() === "true";
}

export function getStateTyped(): State {
  const raw = {
    preChecked: truthy(core.getState("preChecked")),
    destRoot: core.getState("destRoot") || undefined,
    runRoot: core.getState("runRoot") || undefined,
    scope: (core.getState("scope") || undefined) as any,
    dryRun: truthy(core.getState("dryRun")),
    verbose: truthy(core.getState("verbose")),
    trace: truthy(core.getState("trace")),
    cleanup: truthy(core.getState("cleanup")),
  };
  const parsed = StateSchema.safeParse(raw);
  return parsed.success ? parsed.data : (raw as State);
}
