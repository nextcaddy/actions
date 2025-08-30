import * as core from "@actions/core";
import * as path from "node:path";
import fsp from "node:fs/promises";
import fg from "fast-glob";
import {
  copyDirWipe,
  copyFile,
  hardlinkOrCopyFile,
  ensureStoreWritable,
  listDir,
} from "./fs-ops";
import { getInputs, parsePatterns } from "./inputs";
import { LinkModes, Modes, Scopes, type Inputs } from "./types";

function repoSafe(repo: string): string {
  return repo.replace(/\//g, "__");
}

function assertWorkspaceRel(rel: string, argName = "pattern"): void {
  if (path.isAbsolute(rel) || rel.includes("..")) {
    throw new Error(`Invalid ${argName} (absolute or contains '..'): ${rel}`);
  }
}

function destRootFrom(
  scope: Inputs["scope"] | "run",
  store: string,
  repo: string,
  refName: string,
  runId: string
): string {
  const safe = repoSafe(repo);
  let scopePart = "";
  if (scope === Scopes.branch) scopePart = `/${refName}`;
  else if (scope === Scopes.run) scopePart = `/run-${runId}`;
  else if (scope !== Scopes.global)
    throw new Error(
      `Unknown scope '${scope}' (use 'global', 'branch', or 'run')`
    );
  return path.join(store, safe + scopePart);
}

async function materializeDirHard(src: string, dst: string): Promise<void> {
  const files = await fg(["**/*"], {
    cwd: src,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: true,
  });
  const dirs = await fg(["**/"], {
    cwd: src,
    onlyDirectories: true,
    dot: true,
  });
  await Promise.all(
    dirs.map((d) => fsp.mkdir(path.join(dst, d), { recursive: true }))
  );
  for (const rel of files) {
    await hardlinkOrCopyFile(path.join(src, rel), path.join(dst, rel));
  }
}

async function run(): Promise<void> {
  try {
    const I = getInputs(); // must support mode: "save" | "restore" | "cleanup"

    if (I.trace) core.debug("Trace enabled");

    const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || "";
    const GITHUB_REF_NAME = process.env.GITHUB_REF_NAME || "";
    const GITHUB_RUN_ID = process.env.GITHUB_RUN_ID || "";
    const WORKSPACE = process.env.GITHUB_WORKSPACE || process.cwd();

    if (!GITHUB_REPOSITORY) throw new Error("GITHUB_REPOSITORY is not set");

    // Normal destination (respects chosen scope)
    const DEST_ROOT = destRootFrom(
      I.scope,
      I.store,
      GITHUB_REPOSITORY,
      GITHUB_REF_NAME,
      GITHUB_RUN_ID
    );

    // Run-scope root (used for cleanup regardless of scope)
    const RUN_ROOT = destRootFrom(
      Scopes.run,
      I.store,
      GITHUB_REPOSITORY,
      GITHUB_REF_NAME,
      GITHUB_RUN_ID
    );

    // Outputs & state for post.ts
    core.setOutput("dest_root", I.mode === Modes.cleanup ? RUN_ROOT : DEST_ROOT);
    core.saveState("destRoot", DEST_ROOT);
    core.saveState("runRoot", RUN_ROOT);
    core.saveState("scope", I.scope);
    core.saveState("dryRun", String(I.dryRun));
    if (I.mode === Modes.cleanup) core.saveState("cleanup", "true");

    // Short-circuit: cleanup work happens in post.ts
    if (I.mode === Modes.cleanup) {
      core.info(
        "cleanup mode: nothing to do in main (deletion happens in post)."
      );
      return;
    }

    if (I.files.trim() === "") {
      core.info("No files specified, nothing to do.");
      return;
    }

    await ensureStoreWritable(I.store);

    const patterns = parsePatterns(I.files);
    if (patterns.length === 0) throw new Error("No files specified");

    if (I.verbose) {
      core.startGroup("persist: context");
      core.info(
        `mode=${I.mode} repo=${repoSafe(GITHUB_REPOSITORY)} scope=${
          I.scope
        } link=${I.link}`
      );
      core.info(`store=${I.store}`);
      core.info(`dest_root=${DEST_ROOT}`);
      core.info(`run_root=${RUN_ROOT}`);
      core.info(`workspace=${WORKSPACE}`);
      core.endGroup();
    }

    const globOptsSave = {
      cwd: WORKSPACE,
      dot: true,
      onlyFiles: false,
      followSymbolicLinks: true,
      unique: true,
      markDirectories: true as const,
      braceExpansion: true,
    };

    if (I.mode === Modes.save) {
      if (I.verbose) core.startGroup("persist: resolve & copy (save)");

      for (const pat of patterns) {
        assertWorkspaceRel(pat, "pattern");
        const matches = await fg(pat, globOptsSave);
        if (!matches || matches.length === 0) {
          core.warning(`No matches for pattern: ${pat}`);
          continue;
        }
        for (const rel of matches) {
          const src = path.resolve(WORKSPACE, rel);
          const dst = path.resolve(DEST_ROOT, rel);
          if (!dst.startsWith(path.resolve(DEST_ROOT))) {
            throw new Error(`Refusing to write outside dest root: ${dst}`);
          }
          const st = await fsp.lstat(src);
          if (st.isDirectory()) {
            core.info(`save dir: ${rel} -> ${path.relative(I.store, dst)}/`);
            await copyDirWipe(src, dst, I.dryRun);
          } else {
            core.info(`save file: ${rel} -> ${path.relative(I.store, dst)}`);
            await copyFile(src, dst, I.dryRun);
          }
          if (I.verbose) await listDir(dst);
        }
      }

      if (I.verbose) core.endGroup();
      return;
    }

    // restore
    if (I.link === LinkModes.soft || I.link === LinkModes.symlink) {
      if (I.verbose)
        core.startGroup("persist: restore (soft links / symlinks)");

      for (const pat of patterns) {
        assertWorkspaceRel(pat, "pattern");
        const storeMatches = await fg(pat, {
          cwd: DEST_ROOT,
          dot: true,
          onlyFiles: false,
          markDirectories: true,
          followSymbolicLinks: true,
        });
        if (storeMatches.length === 0) {
          core.warning(`Nothing saved for ${pat}`);
          continue;
        }
        for (const rel of storeMatches) {
          const src = path.resolve(DEST_ROOT, rel);
          const dst = path.resolve(WORKSPACE, rel);
          await fsp.mkdir(path.dirname(dst), { recursive: true });
          if (I.dryRun) {
            core.info(`(dry-run) would symlink '${rel}' -> '${src}'`);
          } else {
            try {
              await fsp.rm(dst, { recursive: true, force: true });
            } catch {}
            try {
              await fsp.symlink(src, dst);
            } catch {
              // For directories on Windows, use 'junction' fallback
              const st = await fsp.lstat(src);
              await fsp.symlink(
                src,
                dst,
                st.isDirectory() ? "junction" : "file"
              );
            }
            core.info(`link: ${rel} -> ${src}`);
            if (I.verbose) await listDir(dst);
          }
        }
      }

      if (I.verbose) core.endGroup();
      return;
    }

    if (I.link === LinkModes.hard) {
      if (I.verbose)
        core.startGroup(
          "persist: restore (hard links; copy fallback if cross-device)"
        );

      for (const pat of patterns) {
        assertWorkspaceRel(pat, "pattern");
        const storeMatches = await fg(pat, {
          cwd: DEST_ROOT,
          dot: true,
          onlyFiles: false,
          markDirectories: true,
          followSymbolicLinks: true,
        });
        if (storeMatches.length === 0) {
          core.warning(`Nothing saved for ${pat}`);
          continue;
        }
        for (const rel of storeMatches) {
          const src = path.resolve(DEST_ROOT, rel);
          const dst = path.resolve(WORKSPACE, rel);
          if (I.dryRun) {
            core.info(`(dry-run) would hardlink/copy '${src}' -> '${dst}'`);
            continue;
          }
          try {
            await fsp.rm(dst, { recursive: true, force: true });
          } catch {}
          const st = await fsp.lstat(src);
          if (st.isDirectory()) {
            await materializeDirHard(src, dst);
          } else {
            await hardlinkOrCopyFile(src, dst);
          }
          if (I.verbose) await listDir(dst);
        }
      }

      if (I.verbose) core.endGroup();
      return;
    }

    throw new Error(`Unknown link mode: ${I.link} (use 'soft' or 'hard')`);
  } catch (err: any) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
