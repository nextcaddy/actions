import * as core from "@actions/core";
import * as path from "node:path";
import * as fs from "node:fs";
import fsp from "node:fs/promises";
import fse from "fs-extra";

export async function ensureStoreWritable(store: string): Promise<void> {
  const probe = path.join(store, ".write_test");
  try {
    await fsp.mkdir(store, { recursive: true });
    await fsp.writeFile(probe, "ok", { flag: "w" });
    await fsp.rm(probe, { force: true });
  } catch {
    throw new Error(`Store not mounted or not writable: ${store}`);
  }
}

export async function listDir(p: string): Promise<void> {
  try {
    const s = await fsp.lstat(p);
    if (s.isDirectory()) {
      const entries = await fsp.readdir(p);
      core.info(`path: ${p}`);
      core.info(`entries: ${entries.length}`);
      core.info(
        entries
          .slice(0, 50)
          .map((e) => ` - ${e}`)
          .join("\n")
      );
    } else {
      core.info(`path: ${p} (file) size=${s.size}`);
    }
  } catch {
    core.info(`path: ${p} (missing)`);
  }
}

export async function copyDirWipe(
  src: string,
  dst: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    core.info(`(dry-run) would wipe '${dst}' and copy '${src}/.' -> '${dst}/'`);
    return;
  }
  await fse.ensureDir(dst);
  try {
    const items = await fsp.readdir(dst);
    await Promise.all(items.map((it) => fse.remove(path.join(dst, it))));
  } catch {}
  await fse.copy(src, dst, {
    overwrite: true,
    errorOnExist: false,
    dereference: true,
  });
}

export async function copyFile(
  src: string,
  dst: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    core.info(`(dry-run) would copy '${src}' -> '${dst}'`);
    return;
  }
  await fse.ensureDir(path.dirname(dst));
  await fse.copy(src, dst, {
    overwrite: true,
    errorOnExist: false,
    dereference: true,
  });
}

export async function hardlinkOrCopyFile(
  src: string,
  dst: string
): Promise<void> {
  await fse.ensureDir(path.dirname(dst));
  try {
    await fsp.link(src, dst);
  } catch (e: any) {
    core.warning(`Hardlink failed (${e?.code}); copying: ${src} -> ${dst}`);
    await fse.copy(src, dst, {
      overwrite: true,
      errorOnExist: false,
      dereference: true,
    });
  }
}
