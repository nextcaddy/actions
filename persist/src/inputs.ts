import * as core from "@actions/core";
import { InputsSchema, Inputs, Scopes, LinkModes } from "./types";

function toBool(x: string | boolean | undefined): boolean {
  if (typeof x === "boolean") return x;
  return String(x ?? "").toLowerCase() === "true";
}

export function getInputs(): Inputs {
  const raw = {
   mode: (core.getInput("mode", { required: true }) || "").toLowerCase(),
    files: core.getInput("files", { required: false }) || undefined,
    store: core.getInput("store") || "/store",
    scope: (core.getInput("scope") || Scopes.run).toLowerCase(),
    link: (core.getInput("link") || LinkModes.soft).toLowerCase(),
    verbose: toBool(core.getInput("verbose")),
    trace: toBool(core.getInput("trace")),
    dryRun: toBool(core.getInput("dry-run")),
  };
  const parsed = InputsSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid inputs:\n${msg}`);
  }
  return parsed.data;
}

export function parsePatterns(filesRaw: string): string[] {
  return filesRaw
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
}
