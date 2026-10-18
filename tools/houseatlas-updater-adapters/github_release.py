"""Source-only GitHub Acquisition; an owner must inject a bounded HTTPS port.

No transport, credentials, runtime entrypoint, installation or dynamic loading.
Consumes the updater's pinned ReleaseBundleV1 rather than a second manifest parser.
"""

import re
import time
from collections.abc import Mapping
from typing import ContextManager, Protocol
from urllib.parse import urlsplit

from houseatlas_updater.model import Acquired, Policy, Producer, Selection, UpdateError
from houseatlas_updater.release_bundle import ReleaseBundleV1, validate_schema
from houseatlas_updater.validation import (
    digest, json_object, public_selection, require, selection as validate_selection, sha256,
)


REPOSITORY = "EzraCerpac/HouseAtlas"
WORKFLOW = ".github/workflows/release-bundle.yml"
SOURCE_REF = "refs/heads/main"
API = f"https://api.github.com/repos/{REPOSITORY}"
ASSET_ORIGIN = "https://release-assets.githubusercontent.com"
METADATA_LIMIT = 512 * 1024
HEADER_LIMIT = 16 * 1024
CHUNK = 64 * 1024
TIMEOUT = 60
MAX_REQUESTS = 32


class Response(Protocol):
    status: int
    # Lowercase, unique header names; raw header allocation is bounded by the port.
    headers: Mapping[str, str]

    def read(self, size: int, *, deadline: float) -> bytes:
        """Read at most size bytes; enforce the absolute monotonic deadline."""
        ...


class Http(Protocol):
    def open(self, url: str, *, headers: Mapping[str, str], deadline: float,
             max_header_bytes: int) -> ContextManager[Response]:
        """GET only; TLS hostname/certificate verification, no automatic redirects.

        Enforce deadline during DNS/connect/TLS/headers/body, and the raw header
        bound before allocation. Send exactly supplied headers. No ambient auth,
        cookies, proxy credentials, decompression, retries or background reads.
        Context exit closes the response even when validation fails.
        """
        ...


def positive_id(value):
    return type(value) is int and 0 < value <= 2**53 - 1


class _Reads:
    """One acquisition's shared deadline and request budget, including redirects."""

    def __init__(self, http):
        self.http = http
        self.deadline = time.monotonic() + TIMEOUT
        self.requests = 0

    def remaining(self):
        require(time.monotonic() < self.deadline, "acquisition-failed")

    def body(self, url, limit, *, asset=False):
        require(type(limit) is int and 0 < limit <= 64 * 1024 * 1024,
                "acquisition-failed")
        # Initial URLs are constructed below, never taken from API/caller URL fields.
        require(url.startswith(API + "/") or url == API, "acquisition-failed")
        for redirect in range(3):
            self.remaining()
            self.requests += 1
            require(self.requests <= MAX_REQUESTS, "acquisition-failed")
            headers = {"accept": "application/octet-stream" if asset else "application/vnd.github+json",
                       "accept-encoding": "identity", "user-agent": "HouseAtlas-source-acquisition/1"}
            if url.startswith(API):
                headers["x-github-api-version"] = "2022-11-28"
            with self.http.open(url, headers=headers, deadline=self.deadline,
                                max_header_bytes=HEADER_LIMIT) as response:
                self.remaining()
                require(type(response.status) is int and isinstance(response.headers, Mapping),
                        "acquisition-failed")
                require(len(response.headers) <= 100 and all(
                    type(k) is str and type(v) is str and k == k.lower()
                    for k, v in response.headers.items()), "acquisition-failed")
                require(sum(len(k) + len(v) + 4 for k, v in response.headers.items()) <= HEADER_LIMIT,
                        "acquisition-failed")
                if response.status in (301, 302, 303, 307, 308):
                    require(asset and redirect < 2, "acquisition-failed")
                    location = response.headers.get("location", "")
                    require(0 < len(location) <= 8192 and location.isascii() and
                            not any(ord(c) <= 32 or ord(c) == 127 for c in location) and
                            "\\" not in location, "acquisition-failed")
                    target = urlsplit(location)
                    require(target.scheme == "https" and target.netloc ==
                            "release-assets.githubusercontent.com" and target.path.startswith("/") and
                            not target.fragment, "acquisition-failed")
                    # A fresh header set is built each time. No Authorization,
                    # Cookie, Referer, API headers or ambient credentials cross origins.
                    url = location
                    continue
                require(response.status == 200 and response.headers.get(
                    "content-encoding", "identity") == "identity", "acquisition-failed")
                content_type = response.headers.get("content-type", "").split(";", 1)[0].strip()
                require(content_type == ("application/octet-stream" if asset else "application/json"),
                        "acquisition-failed")
                length = response.headers.get("content-length")
                if length is not None:
                    require(re.fullmatch(r"[0-9]{1,10}", length) is not None and
                            int(length) <= limit, "acquisition-failed")
                data = bytearray()
                while True:
                    self.remaining()
                    size = min(CHUNK, limit - len(data) + 1)
                    chunk = response.read(size, deadline=self.deadline)
                    self.remaining()
                    require(type(chunk) is bytes and len(chunk) <= size and
                            len(data) + len(chunk) <= limit, "acquisition-failed")
                    if not chunk:
                        break
                    data.extend(chunk)
                require(length is None or len(data) == int(length), "acquisition-failed")
                return bytes(data)
        raise UpdateError("acquisition-failed")

    def metadata(self, path):
        return json_object(self.body(API + path, METADATA_LIMIT), METADATA_LIMIT)


def _release(value, selected):
    require(type(value["id"]) is int and value["id"] == selected.release_id and
            value["draft"] is False and value["prerelease"] is ("-" in selected.version) and
            type(value["published_at"]) is str and bool(value["published_at"]) and
            value["tag_name"] == "v" + selected.version, "release-identity-mismatch")
    rows = value["assets"]
    require(type(rows) is list and len(rows) == 3, "release-identity-mismatch")
    assets = {}
    ids = set()
    for row in rows:
        require(type(row) is dict and type(row["name"]) is str and
                row["name"] not in assets and positive_id(row["id"]) and row["id"] not in ids and
                type(row["size"]) is int and row["size"] > 0 and row["state"] == "uploaded" and
                type(row["digest"]) is str and row["digest"].startswith("sha256:") and
                digest(row["digest"][7:]), "release-identity-mismatch")
        assets[row["name"]] = (row["id"], row["size"], row["digest"][7:])
        ids.add(row["id"])
    require(set(assets) == {selected.asset_name, "manifest.json", "SHA256SUMS"} and
            assets[selected.asset_name][0] == selected.asset_id and
            assets[selected.asset_name][2] == selected.archive_sha256 and
            assets["manifest.json"][2] == selected.manifest_sha256, "release-identity-mismatch")
    return assets


def _tag(reads, selected):
    tag = "v" + selected.version
    ref = reads.metadata(f"/git/ref/tags/{tag}")
    require(ref["ref"] == "refs/tags/" + tag, "release-identity-mismatch")
    obj = ref["object"]
    for _ in range(4):
        require(digest(obj["sha"], 40), "release-identity-mismatch")
        if obj["type"] == "commit":
            require(obj["sha"] == selected.commit, "release-identity-mismatch")
            return
        require(obj["type"] == "tag", "release-identity-mismatch")
        annotated = reads.metadata(f"/git/tags/{obj['sha']}")
        require(annotated["sha"] == obj["sha"], "release-identity-mismatch")
        obj = annotated["object"]
    raise UpdateError("release-identity-mismatch")


def _run(value, build, selected, repository_id, workflow_id):
    require(positive_id(value["id"]) and str(value["id"]) == build["runId"] and
            type(value["run_attempt"]) is int and value["run_attempt"] == build["runAttempt"] and
            type(value["workflow_id"]) is int and value["workflow_id"] == workflow_id and
            value["path"] == WORKFLOW and value["event"] == "workflow_dispatch" and
            value["head_branch"] == "main" and value["head_sha"] == selected.commit and
            value["status"] == "completed" and value["conclusion"] == "success",
            "producer-untrusted")
    for key in ("repository", "head_repository"):
        repo = value[key]
        require(repo["full_name"] == REPOSITORY and type(repo["id"]) is int and
                repo["id"] == repository_id and repo["private"] is False, "producer-untrusted")


class GitHubReleaseAcquisition:
    def __init__(self, http: Http, verifier: ReleaseBundleV1):
        # Native/storage mappings and exact schema bytes are reviewed owner inputs.
        require(type(verifier) is ReleaseBundleV1 and not verifier.synthetic_only,
                "producer-untrusted")
        self.http = http
        self.verifier = verifier

    def acquire(self, selected: Selection, policy: Policy) -> Acquired:
        try:
            return self._acquire(selected, policy)
        except UpdateError:
            raise
        except Exception:
            # Never expose signed locations, response bodies or transport exceptions.
            raise UpdateError("acquisition-failed") from None

    def _acquire(self, selected, policy):
        validate_selection(public_selection(selected))
        require((policy.repository, policy.workflow, policy.source_ref) ==
                (REPOSITORY, WORKFLOW, SOURCE_REF) and
                policy.bundle_contract == "houseatlas.release-bundle.v1", "producer-untrusted")
        require(type(policy.max_archive_bytes) is int and 0 < policy.max_archive_bytes <= 64 * 1024 * 1024 and
                type(policy.max_manifest_bytes) is int and 0 < policy.max_manifest_bytes <= 512 * 1024,
                "acquisition-failed")
        require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?",
                             selected.version) is not None and selected.asset_name ==
                f"houseatlas-{selected.version}-x86_64-apple-darwin.tar.gz", "release-identity-mismatch")
        reads = _Reads(self.http)
        repo = reads.metadata("")
        require(repo["full_name"] == REPOSITORY and positive_id(repo["id"]) and
                repo["private"] is False and repo["visibility"] == "public" and repo["fork"] is False,
                "producer-untrusted")
        assets = _release(reads.metadata(f"/releases/{selected.release_id}"), selected)
        limits = {selected.asset_name: policy.max_archive_bytes,
                  "manifest.json": min(policy.max_manifest_bytes, 262144), "SHA256SUMS": 1024}
        require(all(size <= limits[name] for name, (_, size, _) in assets.items()), "acquisition-failed")

        def asset(name):
            asset_id, size, expected = assets[name]
            data = reads.body(API + f"/releases/assets/{asset_id}", size, asset=True)
            require(len(data) == size and sha256(data) == expected, "digest-mismatch")
            return data

        manifest = asset("manifest.json")
        value = json_object(manifest, limits["manifest.json"])
        validate_schema(value, self.verifier.schema)
        build = value["build"]
        require(build["kind"] == "github-actions" and value["version"] == selected.version and
                value["source"]["repository"] == REPOSITORY and
                value["source"]["commit"] == build["workflowCommit"] == selected.commit and
                value["source"]["tree"] == selected.tree, "producer-untrusted")
        _tag(reads, selected)
        commit = reads.metadata(f"/git/commits/{selected.commit}")
        require(commit["sha"] == selected.commit and commit["tree"]["sha"] == selected.tree,
                "release-identity-mismatch")
        workflow = reads.metadata("/actions/workflows/release-bundle.yml")
        require(positive_id(workflow["id"]) and workflow["path"] == WORKFLOW and
                workflow["state"] == "active", "producer-untrusted")
        path = f"/actions/runs/{build['runId']}"
        run = reads.metadata(path)
        _run(run, build, selected, repo["id"], workflow["id"])
        attempt_path = path + f"/attempts/{build['runAttempt']}"
        attempt = reads.metadata(attempt_path)
        _run(attempt, build, selected, repo["id"], workflow["id"])
        jobs = reads.metadata(attempt_path + "/jobs?per_page=100")
        require(type(jobs["total_count"]) is int and type(jobs["jobs"]) is list and
                0 < jobs["total_count"] == len(jobs["jobs"]) <= 100, "producer-untrusted")
        builders = [job for job in jobs["jobs"] if job["name"] == "build"]
        require(len(builders) == 1, "producer-untrusted")
        job = builders[0]
        require(type(job["run_id"]) is int and job["run_id"] == run["id"] and
                type(job["run_attempt"]) is int and job["run_attempt"] == build["runAttempt"] and
                job["head_sha"] == selected.commit and job["status"] == "completed" and
                job["conclusion"] == "success", "producer-untrusted")
        archive = asset(selected.asset_name)
        sums = asset("SHA256SUMS")
        require(sums == (f"{selected.archive_sha256}  {selected.asset_name}\n"
                         f"{selected.manifest_sha256}  manifest.json\n").encode(), "digest-mismatch")
        acquired = Acquired(selected, manifest, archive,
                            Producer(REPOSITORY, workflow["path"], SOURCE_REF, run["head_sha"],
                                     commit["tree"]["sha"], run["id"], attempt["run_attempt"]))
        # Existing pinned parser checks canonical bytes, native/storage compatibility,
        # component closure and packaging identities. Unknown mappings fail closed.
        self.verifier.verify(acquired, policy)
        require(_release(reads.metadata(f"/releases/{selected.release_id}"), selected) == assets,
                "release-identity-mismatch")
        _tag(reads, selected)
        reads.remaining()
        return acquired
