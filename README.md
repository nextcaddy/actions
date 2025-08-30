# Slope Actions

Reusable **Gitea/GitHub Actions** maintained by the Slope team.  
Each action lives in its own folder and is versioned via Git tags (e.g., `v1.0.0`, floating `v1`).

- Works with **self‑hosted** `act_runner` and standard GitHub runners.
- Pure **composite** actions (no custom runners required).
- Focus on **speed** and **repeatability** across monorepos and matrix builds.

---

## 📦 Available Actions

| Action | Path | Type | What it does | Best for |
|---|---|---|---|---|
| **persist** | `persist/` | Composite | Save/restore files or directories to a **host store** (e.g., `/store`) by project. Uses symlinks on restore; supports globs; rich logging. | Reusing generated protos/assets across jobs; avoiding artifact uploads. |
| **docker** | `docker/` | Composite | Build & push **per‑arch** images (default `amd64 arm64`) and create a **multi‑arch OCI manifest**. Visibility routing (`private`, `public`, `both`). Flexible tags via input. | Multi‑arch Docker publishing pipelines. |

---

## 🚀 Quick Start

### `persist` — save & restore generated files

> Requires a host path mounted into job containers (default: `/store`).

```yaml
# Save
- uses: slope/actions/persist@v1
  with:
    mode: save
    files: |
      proto
      artifacts/*
    scope: branch           # optional isolation: '', branch, run
    verbose: "true"

# Restore
- uses: slope/actions/persist@v1
  with:
    mode: restore
    files: |
      proto
      artifacts/*
    scope: branch
```

**Inputs (high level):**
- `mode` (save | restore), `files` (globs allowed), `store` (default `/store`), `scope` (`''|branch|run`), `verbose`, `trace`, `dry-run`.

**Tip (Docker COPY):** If restored files are **symlinks** into `/store`, materialize before building:
```bash
rsync -aL artifacts/ .artifacts/ && rm -rf artifacts && mv .artifacts artifacts
```

---

### `docker` — per‑arch build + OCI manifest

```yaml
- uses: docker/setup-buildx-action@v3
- uses: docker/login-action@v3
  with:
    registry: ${{ env.REGISTRY_DOMAIN }}
    username: ${{ secrets.REGISTRY_USER }}
    password: ${{ secrets.REGISTRY_PASSWORD }}

- name: Build per-arch & publish manifest
  uses: slope/actions/docker@v1
  with:
    registry: ${{ env.REGISTRY_DOMAIN }}
    image: slope-graphql                 # bare name
    visibility: both                     # private | public | both (default private)
    arches: "amd64 arm64"                # default
    dockerfile: Dockerfile               # default
    context: .                           # default
    build_args: |
      BIN_PATH=artifacts/slope-graphql-linux-{arch}
    tag: |
      latest
      v0.0.1
    verbose: "true"
```

**Key behaviors:**
- Per‑arch images go to `private/<image>` (or `library/<image>` if visibility is `public`).
- Manifest gets `:<sha>` and any tags provided via `tag:` (e.g., `latest`, `stable`, `v0.0.1`).
- No automatic Git ref tagging; you decide tags via input.

**Inputs (high level):**
- Required: `registry`, `image`.
- Optional: `visibility` (`private|public|both`), `dockerfile`, `context`, `arches`, `build_args` (supports `{arch}`), `options`, `push`, `manifest`, `tag`, `verbose`, `trace`.

---

## 🧰 Runner Setup (self‑hosted `act_runner`)

Some workflows (notably **persist**) need a host path mounted in job containers.

**Runner `config.yaml`:**
```yaml
container:
  valid_volumes:
    - "/store/**"
  options: -v /store:/store:rw
  # Optional: make in-container workspace stable:
  workdir_parent: workspace
```

Or mount per job:
```yaml
jobs:
  build:
    container:
      image: your/image:tag
      volumes:
        - /store:/store:rw
```

---

## 🏷️ Versioning

- Tag each release: `v1.0.0`, `v1.1.0`, …
- Maintain a floating major: `v1` → latest `v1.x`
- Consumers reference as: `slope/actions/<action>@v1` or pin exact versions.

---

## 🤝 Contributing

1. Add a new folder `<action-name>/` with an `action.yml` (composite preferred).
2. Include a brief description and inputs/outputs in the YAML.
3. Update this README’s **Available Actions** table.
4. Test via a sample workflow.
5. Open PR; upon merge, tag a release and bump `v1` if needed.

**Bash guidance:** use `set -euo pipefail`; provide `trace`/`verbose` flags; avoid external deps (or add fallbacks).

---

## 📄 License

MIT
