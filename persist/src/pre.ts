import * as core from "@actions/core";
import * as path from "node:path";
import fs from "node:fs";
import { getInputs } from "./inputs";
import { ensureStoreWritable } from "./fs-ops";

async function pre(): Promise<void> {
  try {
    const I = getInputs();

    if (!path.isAbsolute(I.store)) {
      throw new Error(`Store must be an absolute path; got "${I.store}"`);
    }
    if (!fs.existsSync(I.store)) {
      throw new Error(
        `Store not mounted: ${I.store}. Hint: mount with container.options: -v /data/act_runner/store:/store:rw,z`
      );
    }

    await ensureStoreWritable(I.store);
    core.info(`Store OK: ${I.store}`);

    // Persist flags for post
    core.saveState("preChecked", "true");
    core.saveState("verbose", String(I.verbose));
    core.saveState("trace", String(I.trace));
    core.saveState("dryRun", String(I.dryRun));
  } catch (err: any) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

pre();
