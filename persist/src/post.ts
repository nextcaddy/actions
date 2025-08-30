import * as core from "@actions/core";
import * as path from "node:path";
import fse from "fs-extra";
import { getStateTyped } from "./state";

function truthy(x: string | undefined) {
  return (x || "").toLowerCase() === "true";
}

function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0,
    v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

type Summary = {
  root: string;
  files: number;
  dirs: number;
  links: number;
  bytes: number;
  sample: string[];
};

async function summarizeDir(
  root: string,
  opts?: { maxEntries?: number; maxDepth?: number }
): Promise<Summary | null> {
  const exists = await fse.pathExists(root);
  if (!exists) return null;
  const maxEntries = opts?.maxEntries ?? 120;
  const maxDepth = opts?.maxDepth ?? 3;

  let files = 0,
    dirs = 0,
    links = 0,
    bytes = 0;
  const sample: string[] = [];
  const stack: Array<{ dir: string; depth: number; rel: string }> = [
    { dir: root, depth: 0, rel: "." },
  ];

  while (stack.length) {
    const { dir, depth, rel } = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = await fse.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      const relPath = path.join(rel, name);
      let st: fse.Stats;
      try {
        st = await fse.lstat(full);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        dirs++;
        if (sample.length < maxEntries) sample.push(`D  ${relPath}/`);
        if (depth < maxDepth)
          stack.push({ dir: full, depth: depth + 1, rel: relPath });
      } else if (st.isSymbolicLink()) {
        links++;
        if (sample.length < maxEntries)
          sample.push(`L  ${relPath} -> (symlink)`);
      } else {
        files++;
        bytes += st.size;
        if (sample.length < maxEntries)
          sample.push(`F  ${relPath}  (${formatBytes(st.size)})`);
      }
    }
  }
  return { root, files, dirs, links, bytes, sample };
}

async function reportDir(
  label: string,
  root: string,
  verbose: boolean,
  trace: boolean
) {
  if (!root) {
    core.info(`${label}: <empty path>`);
    return;
  }
  if (!(await fse.pathExists(root))) {
    core.info(`${label}: path does not exist -> ${root}`);
    return;
  }
  const summary = await summarizeDir(root, {
    maxEntries: trace ? 1000 : verbose ? 300 : 120,
    maxDepth: trace ? 10 : verbose ? 5 : 3,
  });
  if (!summary) {
    core.info(`${label}: <no data>`);
    return;
  }

  core.startGroup(`persist: sanity report for ${label} (${root})`);
  core.info(
    `entries: files=${summary.files}, dirs=${summary.dirs}, links=${
      summary.links
    }, total=${summary.files + summary.dirs + summary.links}`
  );
  core.info(`approx size: ${formatBytes(summary.bytes)}`);
  if (summary.sample.length === 0) {
    core.info("<empty>");
  } else {
    core.info(
      `sample (first ${summary.sample.length}${
        trace ? "" : ", increase with 'trace: true'"
      }):`
    );
    for (const line of summary.sample) core.info(line);
    if (!trace) core.info("(enable 'trace: true' for deeper/longer listing)");
  }
  core.endGroup();
}

async function removeDir(p: string, dryRun: boolean, label: string) {
  if (!p) return;
  if (!(await fse.pathExists(p))) {
    core.info(`${label} already removed or never created: ${p}`);
    return;
  }
  if (dryRun) {
    core.info(`(dry-run) would remove ${label}: ${p}`);
    return;
  }
  core.info(`Removing ${label}: ${p}`);
  await fse.remove(p);
}

async function post(): Promise<void> {
  try {
    const S = getStateTyped();

    // Inputs are also available during post; allow overriding
    const verbose = truthy(core.getInput("verbose")) || S.verbose;
    const trace = truthy(core.getInput("trace")) || S.trace;
    const mode = (
      core.getInput("mode", { required: false }) || ""
    ).toLowerCase();
    const cleanupRequested = S.cleanup || mode === "cleanup";

    if (cleanupRequested) {
      await reportDir(
        "run-scope directory (pre-cleanup)",
        S.runRoot || "",
        verbose,
        trace
      );
      core.startGroup("persist: cleanup (remove run-scope directory)");
      await removeDir(S.runRoot || "", S.dryRun, "run-scope directory");
      core.endGroup();
      return;
    }

    // Legacy branch: only if scope === 'run' AND gate is true
    if (S.scope === "run" && S.destRoot) {
      await reportDir(
        "run-scope directory (pre-cleanup)",
        S.destRoot,
        verbose,
        trace
      );
      core.startGroup("persist: post-cleanup (remove run scope)");
      await removeDir(S.destRoot, S.dryRun, "run-scope directory");
      core.endGroup();
    } else {
      core.info(
        `No cleanup requested; scope=${
          S.scope ?? "<none>"
        }; leaving files in place.`
      );
    }
  } catch (err: any) {
    core.warning(
      `Cleanup failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

post();
