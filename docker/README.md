# Buildx per-arch push + OCI manifest

Build and push **per-architecture Docker images** with Buildx and (optionally) create a **multi-arch OCI manifest** — all in one composite action.

- Minimal interface: `image` is just the **bare name** (e.g., `slope-graphql`).
- Visibility routing: publish to `private/<image>`, `library/<image>`, or **both**.
- Flexible tagging: always `:<sha>`; plus whatever you pass via `tag:` (no automatic git-ref tagging).
- Logging controls: `verbose`, `trace`.
- Sensible defaults: `arches: amd64 arm64`, `dockerfile: Dockerfile`, `manifest: true`.

---

## ✅ What it does

1. **Builds per-arch images** (default: `amd64` and `arm64`) and pushes them (unless `push: "false"`):
   - If `visibility: private` or `both`: builds under `private/<image>`
   - If `visibility: public`: builds under `library/<image>`
   - Tags: `<registry>/<repo>/<image>:<sha>-<arch>`

2. **Creates a multi-arch manifest** (unless `manifest: "false"`):
   - For each target visibility (`private`, `public`, or `both`):
     - Tags: `:<sha>` and any **additional tags** from the `tag` input.
   - Sources are the per-arch tags built in step 1.

> The action **does not** infer tags from `GITHUB_REF`. If you want `latest`, `v0.0.1`, etc., pass them explicitly via `tag:`.

---

## 🚧 Requirements

- Buildx must be available:
  ```yaml
  - uses: docker/setup-buildx-action@v3
  ```
- You must be logged in to your registry **before** calling this action:
  ```yaml
  - uses: docker/login-action@v3
    with:
      registry: ${{ env.REGISTRY_DOMAIN }}
      username: ${{ secrets.REGISTRY_USER }}
      password: ${{ secrets.REGISTRY_PASSWORD }}
  ```
- If your build context contains symlinks to a host store (e.g., `/store`), **materialize** them before `docker build`:
  ```bash
  rsync -aL artifacts/ .artifacts/ && rm -rf artifacts && mv .artifacts artifacts
  ```

---

## 🔌 Inputs

| Name        | Required | Default           | Description |
|-------------|----------|-------------------|-------------|
| `registry`  | ✅       | —                 | Registry domain, e.g. `harbor.slope.es`. |
| `image`     | ✅       | —                 | **Bare image name**, e.g. `slope-graphql`. |
| `visibility`| ❌       | `private`         | `private` \| `public` \| `both`. Controls where manifests are tagged. Per-arch builds go to `private` unless `public` is selected. |
| `dockerfile`| ❌       | `Dockerfile`      | Path to Dockerfile. |
| `context`   | ❌       | `.`               | Build context. |
| `arches`    | ❌       | `amd64 arm64`     | Space-separated architectures to build. |
| `build_args`| ❌       | `""`              | Multiline `KEY=VALUE`. `{arch}` placeholder expands to current arch. |
| `options`   | ❌       | `""`              | Extra raw options appended to `docker buildx build` (e.g. `--pull --no-cache`). |
| `push`      | ❌       | `true`            | Push per-arch images. If `false`, manifest is skipped. |
| `manifest`  | ❌       | `true`            | Create multi-arch OCI manifest from the per-arch images. |
| `tag`       | ❌       | `latest`          | Space/newline-separated tags to apply to the manifest(s), in addition to `:<sha>`. Set empty (`""`) for only `:<sha>`. |
| `verbose`   | ❌       | `false`           | Emit grouped, detailed logs. |
| `trace`     | ❌       | `false`           | Enable shell tracing (`set -x`). |

### 🧪 Outputs

| Name         | Description |
|--------------|-------------|
| `built_tags` | Newline-separated list of the per-arch tags that were built and (optionally) pushed. |

---

## 🧭 Tagging behavior

- Always tags the manifest(s) with `:<sha>`.
- Additionally tags **each** visibility target with any values provided in `tag:`:  
  e.g. `latest`, `stable`, `v0.0.1`.
- **No automatic** tag from `GITHUB_REF` — you control all extra tags.

**Examples** (with `registry = harbor.slope.es`, `image = slope-graphql`):

Per-arch (for `amd64`, `arm64`):
```
harbor.slope.es/private/slope-graphql:<sha>-amd64
harbor.slope.es/private/slope-graphql:<sha>-arm64
```

Manifests when `visibility: both`, `tag: "latest v0.0.1"`:
```
harbor.slope.es/private/slope-graphql:<sha>
harbor.slope.es/private/slope-graphql:latest
harbor.slope.es/private/slope-graphql:v0.0.1

harbor.slope.es/library/slope-graphql:<sha>
harbor.slope.es/library/slope-graphql:latest
harbor.slope.es/library/slope-graphql:v0.0.1
```

---

## 🚀 Usage

### Basic (private only, default tags)
```yaml
- uses: docker/setup-buildx-action@v3
- uses: docker/login-action@v3
  with:
    registry: ${{ env.REGISTRY_DOMAIN }}
    username: ${{ secrets.REGISTRY_USER }}
    password: ${{ secrets.REGISTRY_PASSWORD }}

- name: Build per-arch & publish manifest
  uses: slope/actions/buildx-arch-push@v1
  with:
    registry: ${{ env.REGISTRY_DOMAIN }}
    image: slope-graphql
    build_args: |
      BIN_PATH=artifacts/slope-graphql-linux-{arch}
    tag: latest
    verbose: "true"
```

### Public & private (both), multiple tags
```yaml
- uses: slope/actions/buildx-arch-push@v1
  with:
    registry: ${{ env.REGISTRY_DOMAIN }}
    image: slope-graphql
    visibility: both
    arches: "amd64 arm64"
    build_args: |
      BIN_PATH=artifacts/slope-graphql-linux-{arch}
    tag: |
      latest
      v0.0.1
```

### Only SHA (no extra tags)
```yaml
- uses: slope/actions/buildx-arch-push@v1
  with:
    registry: ${{ env.REGISTRY_DOMAIN }}
    image: slope-graphql
    tag: ""              # only :<sha> will be applied
```

### Extra buildx options
```yaml
- uses: slope/actions/buildx-arch-push@v1
  with:
    registry: ${{ env.REGISTRY_DOMAIN }}
    image: slope-graphql
    options: --pull --no-cache
```

---

## 🧱 Implementation details

- Per-arch images are **built once** under:
  - `private/<image>` if `visibility` is `private` or `both`
  - `library/<image>` if `visibility` is `public`
- Action constructs `docker buildx build` commands as arrays for safe quoting.
- Manifest creation uses `docker buildx imagetools create` with all requested tags and per-arch sources.
- `built_tags` output can be reused if you want to perform additional inspection or signing.

---

## 🔐 Security tips

- Keep registry credentials in repository or organization **secrets**.
- Avoid leaking secrets in build args or logs; prefer `--build-arg` values that do not echo sensitive data.
- Use `trace: "false"` by default; enable only when debugging.

---

## 🏷️ Versioning

Tag releases in `slope/actions` and reference them like `slope/actions/buildx-arch-push@v1` (floating major) or `@v1.0.0` (pinned).

---

## 📄 License

MIT
