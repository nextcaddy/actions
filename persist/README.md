# Persist Action (`slope/actions/persist`)

Save and restore selected **files/directories** from the workspace to a **persistent host store** (e.g. `/store`) using your project name as a namespace. Designed for Gitea Actions / self‑hosted `act_runner`, but works anywhere your runner can bind‑mount a host path.

> **Common use cases**
>
> - Generate protos once → reuse across matrix jobs.
> - Share compiled binaries across jobs (and then publish or build Docker images).
> - Keep per‑branch caches of generated assets without artifact uploads.

---

## ✨ Features

- Accepts **multiple files/globs** (e.g. `proto`, `artifacts/*`, `schemas/**/*.graphql`).
- **Two modes**: `save` (copy into store) and `restore` (symlink back into the workspace).
- Optional **scoping** by `branch` or `run` to prevent collisions.
- Rich **logging** controls:
  - `verbose`: sizes, counts, listings, and rsync stats.
  - `trace`: shell tracing (`set -x`).
  - `dry-run`: simulate actions without writing.
- Preserves directory structure under the store root:  
  `/<store>/<org__repo>/<scope>/<relative-path>`.

---

## ⚙️ Requirements

1. A **self‑hosted runner** with a persistent host directory mounted into job containers, e.g. `/store`.
2. `act_runner` config should whitelist and mount the store path:

```yaml
# act_runner config.yaml (on the runner host)
container:
  valid_volumes:
    - "/store/**"          # allow workflows to mount /store
  # Optional: mount globally (or do it per-job via job.container.volumes)
  options: -v /store:/store:rw

# (Optional) make workspace path stable inside containers, helpful for docs/debug
container:
  workdir_parent: workspace
```

If you don’t mount `/store` globally, add it per job:
```yaml
jobs:
  build:
    container:
      image: your/image:tag
      volumes:
        - /store:/store:rw
```

> The action will **fail fast** with `Store not mounted` if the path isn’t available.

---

## 📦 Installation & Usage

### From a central actions repo (recommended)

Push this action to `slope/actions` under `persist/action.yml`, tag it, then reference it:

```bash
git tag -a v1.0.0 -m "persist v1.0.0"
git tag -f v1
git push --tags
```

**Save**
```yaml
- name: Save generated artifacts
  uses: slope/actions/persist@v1
  with:
    mode: save
    files: |
      proto
      artifacts/*
    scope: branch      # optional: isolate by branch
    verbose: "true"    # logging (required input; "true" or "false")
    # trace: "true"
    # dry-run: "true"
```

**Restore**
```yaml
- name: Restore generated artifacts
  uses: slope/actions/persist@v1
  with:
    mode: restore
    files: |
      proto
      artifacts/*
    scope: branch
    verbose: "true"
```

### As a local action (inside your repo)

Place the action at `./.gitea/actions/persist/action.yml` (or `./.github/actions/persist/action.yml`) and call it:

```yaml
- uses: actions/checkout@v4   # required so the local action path exists
- name: Save
  uses: ./.gitea/actions/persist
  with:
    mode: save
    files: proto
    verbose: "true"
```

---

## 🧠 How it works

- **Namespace**: repository path `org/repo` is normalized to `org__repo`.
- **Destination root** (also exported as output `dest_root`):  
  ```
  <store>/<org__repo>/<scope?>
  ```
  where `scope` is empty, `<branch-name>`, or `run-<GITHUB_RUN_ID>`.
- **Save**: for each matched file/dir under the workspace, content is copied to  
  `<dest_root>/<relative-path>`.
- **Restore**: for each pattern, the action creates a **symlink** in the workspace pointing to the store target.
- For directories we use `rsync -a --delete` (if available) to keep the store exact; otherwise a `cp -a` fallback.

**Example layout** after saving:
```
/store/slope__platform/main/proto/...
/store/slope__platform/main/artifacts/slope-graphql-linux-amd64
/store/slope__platform/main/artifacts/slope-graphql-linux-arm64
...
```

---

## 🧾 Inputs

| Name     | Required | Default  | Description |
|----------|----------|----------|-------------|
| `mode`   | ✅       | —        | `save` or `restore`. |
| `files`  | ✅       | —        | Multiline list of workspace‑relative paths or globs. Comments (`# …`) and blank lines allowed. |
| `store`  | ❌       | `/store` | Absolute path mounted inside the job container. |
| `scope`  | ❌       | `"run"`     | `"global"`, `branch`, or `run`. |
| `verbose`| ✅       | `"false"`| Rich logs: sizes, counts, ls listings, rsync stats. |
| `trace`  | ❌       | `"false"`| Enable shell tracing (`set -x`). |
| `dry-run`| ❌       | `"false"`| Simulate saves/restores without changing files. |

## 🔁 Outputs

| Name         | Description |
|--------------|-------------|
| `dest_root`  | The resolved store root for this run (e.g. `/store/slope__platform/feature-X`). |

---

## 🐳 Docker build tip (COPY & symlinks)

Docker cannot `COPY` files that are **symlinks pointing outside** the build context. If you restored `artifacts/*` as symlinks to `/store/...`, **materialize** them first:

```yaml
- name: Materialize artifacts for Docker context
  run: |
    mkdir -p .artifacts
    if command -v rsync >/dev/null 2>&1; then
      rsync -aL artifacts/ .artifacts/   # -L follows symlinks
    else
      cp -aL artifacts/. .artifacts/
    fi
    rm -rf artifacts && mv .artifacts artifacts
```

---

## 🧩 Examples

**Proto once, build many (matrix)**

```yaml
jobs:
  setup:
    runs-on: rust-latest
    steps:
      - uses: actions/checkout@v4
      - run: make proto
      - uses: slope/actions/persist@v1
        with:
          mode: save
          files: proto
          scope: branch
          verbose: "true"

  build:
    needs: setup
    runs-on: rust-latest
    strategy:
      matrix:
        target: [x86_64-unknown-linux-musl, aarch64-unknown-linux-musl]
        bin: [slope-grpc-gateway, slope-grpc-inventory, slope-graphql]
    steps:
      - uses: actions/checkout@v4
      - uses: slope/actions/persist@v1
        with:
          mode: restore
          files: proto
          scope: branch
          verbose: "true"
      - run: |
          cargo zigbuild --release --bin "${{ matrix.bin }}" --target "${{ matrix.target }}"
          mkdir -p artifacts && cp "target/${{ matrix.target }}/release/${{ matrix.bin }}" \
            "artifacts/${{ matrix.bin }}-linux-${{ contains(matrix.target, 'aarch64') && 'arm64' || 'amd64' }}"
      - uses: slope/actions/persist@v1
        with:
          mode: save
          files: artifacts/*
          scope: branch
          verbose: "true"
```

---

## 🚨 Safety checks & limitations

- Patterns are **workspace‑relative**. Absolute paths and `..` are rejected.
- If `files` patterns match nothing in `save`, a warning is logged; in `restore`, missing entries are also warned.
- Ensure `/store` is mounted; otherwise the action exits with an error.
- On hosted runners where jobs run on different machines, this approach won’t persist across hosts—use artifacts instead.

---

## 🐞 Troubleshooting

- **`Store not mounted`** — Make sure the runner mounts `/store` (globally via `container.options` or per-job `container.volumes`) and that `valid_volumes` includes `/store/**`.
- **`failed to read 'action.yml'`** — If you use a **local** action path (e.g. `./.gitea/actions/persist`), run `actions/checkout` **before** the `uses:` step.
- **Docker COPY fails** — Materialize symlinks (see Docker tip above).
- **No files copied** — Turn on `verbose: "true"` to see counts and verify patterns.

---

## 📄 License

MIT
