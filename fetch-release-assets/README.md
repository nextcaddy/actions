# Fetch release assets by tag

**Composite action** to download **Gitea** release assets for a given **tag** into a local folder.  
Great for bootstrapping CI jobs with prebuilt binaries or SBOMs.

- Works with **self-hosted Gitea** (custom `api-base`) or gitea.com.
- Smart defaults: reads `owner`/`repo` from the workflow context, and `tag` from `GITHUB_REF_NAME` (if running on a tag).
- Optional **regex filter** to grab only the assets you want.
- Emits outputs with the **download count** and **JSON array of file paths** for downstream steps.

---

## ✅ What it does (flow)

1. Detects `owner`, `repo`, and `tag` (unless explicitly provided).
2. Calls `GET {api-base}/repos/{owner}/{repo}/releases/tags/{tag}` to find the release id.
3. Lists assets at `GET .../releases/{id}/assets`.
4. (Optional) Filters by regex (`pattern`).
5. Downloads each asset to `dest/` using **octet-stream** API.
6. Sets outputs:
   - `count`: number of files downloaded
   - `files_json`: JSON array of file paths (under `dest/`)
   - `dest`: the destination directory

> Note: File paths are **workspace-relative** unless you pass an absolute `dest` path.

---

## 🔐 Requirements

- A Gitea **personal access token** with at least read access to the repository.
- Network access from the runner to your Gitea instance.
- The action downloads a portable `jq` binary if not present.

---

## 🔌 Inputs

| Name           | Required | Default                                 | Description |
|----------------|----------|-----------------------------------------|-------------|
| `token`        | ✅       | —                                       | Gitea token with repo read access. |
| `tag`          | ❌       | `GITHUB_REF_NAME` (only when on tag)    | Release tag to fetch (e.g. `v1.2.3`). |
| `owner`        | ❌       | From `GITHUB_REPOSITORY`                | Repo owner/org. |
| `repo`         | ❌       | From `GITHUB_REPOSITORY`                | Repo name. |
| `api-base`     | ❌       | `https://gitea.slope.es/api/v1`         | Base API URL for your Gitea instance. |
| `dest`         | ❌       | `assets`                                | Destination directory for downloaded files. |
| `pattern`      | ❌       | —                                       | **Regex** to filter asset names (jq-compatible). |
| `fail-if-empty`| ❌       | `true`                                  | Fail the job if no assets match / are found. |

---

## 🧪 Outputs

| Name         | Description |
|--------------|-------------|
| `count`      | Number of assets downloaded. |
| `files_json` | **JSON array** of file paths (relative to the workspace unless `dest` is absolute). |
| `dest`       | The destination directory used. |

You can capture and reuse them like this:
```yaml
- id: fetch
  uses: your-org/fetch-release-assets-by-tag@v1
  with:
    token: ${{ secrets.GITEA_TOKEN }}
    tag: v1.2.3

- name: Print files
  run: |
    echo "Downloaded: ${{ steps.fetch.outputs.count }} files"
    echo '${{ steps.fetch.outputs.files_json }}' | jq .
```

---

## 🚀 Usage

### 1) Basic: current repo + tag from ref
```yaml
- uses: your-org/fetch-release-assets-by-tag@v1
  with:
    token: ${{ secrets.GITEA_TOKEN }}
    # tag omitted -> uses GITHUB_REF_NAME if triggered by a tag
```

### 2) Explicit repo + tag
```yaml
- uses: your-org/fetch-release-assets-by-tag@v1
  with:
    token: ${{ secrets.GITEA_TOKEN }}
    owner: slope
    repo: platform
    tag: v1.1.0
    api-base: https://gitea.slope.es/api/v1
```

### 3) Filter assets (regex)
Download only Linux amd64 binaries:
```yaml
- uses: your-org/fetch-release-assets-by-tag@v1
  with:
    token: ${{ secrets.GITEA_TOKEN }}
    tag: v1.1.0
    pattern: '^.*-linux-amd64(\.[A-Za-z0-9.]+)?$'
```

### 4) Don’t fail when empty (optional)
```yaml
- uses: your-org/fetch-release-assets-by-tag@v1
  with:
    token: ${{ secrets.GITEA_TOKEN }}
    tag: v1.1.0
    pattern: '^docs-.*\.pdf$'
    fail-if-empty: "false"   # continue even if nothing matched
```

### 5) Use outputs downstream (e.g., unpack all archives)
```yaml
- id: fetch
  uses: your-org/fetch-release-assets-by-tag@v1
  with:
    token: ${{ secrets.GITEA_TOKEN }}
    tag: v1.1.0

- name: Unpack
  run: |
    files='${{ steps.fetch.outputs.files_json }}'
    echo "$files" | jq -r '.[]' | while read -r p; do
      case "$p" in
        *.tar.gz|*.tgz) tar -xzf "$p" -C "${{ steps.fetch.outputs.dest }}" ;;
        *.zip) unzip -o "$p" -d "${{ steps.fetch.outputs.dest }}" ;;
        *) echo "skip: $p" ;;
      esac
    done
```

---

## 🐞 Troubleshooting

- **`Release not found for tag`**: ensure the tag exists and a release is published for it.
- **`No assets to download`**: either no assets are attached or your `pattern` filtered them out. Set `fail-if-empty: "false"` to continue.
- **`401/403`**: the token doesn’t have access to the repo or the API base is wrong.
- **Self‑signed TLS**: add your CA to the runner trust store if your Gitea uses a private CA.

---

## 🔐 Security

- Store tokens in **repository/organization secrets**.
- Avoid echoing token values. This action only sets the **Authorization** header for API calls.
- If downloading sensitive artifacts, validate checksums/signatures in a follow-up step.

---

## 🧱 Implementation notes

- Portable `jq` v1.6 is fetched if not present (`.bin/jq` in the workspace) to keep runners minimal.
- Asset name filtering uses `jq`’s regex engine: `select(.name | test($re))`.
- Downloads use the **Accept: application/octet-stream** asset endpoint to receive file content directly.
- Outputs are written via `$GITHUB_OUTPUT` for easy consumption by later steps.

---

## 📄 License

MIT
