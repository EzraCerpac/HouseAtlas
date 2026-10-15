# Explicit full Document server selection

Persistent `serve` can explicitly select the full native geodata profile through
two additional options. The normal server configuration, authentication mode,
configured homes, command policy and existing AI account options keep their
existing meanings.

```text
houseatlas-backend serve --server-config /absolute/private/server.json \
  --full-geodata-source-policy /absolute/private/reviewed-sources.json \
  --full-geodata-source-policy-sha256 <lowercase-sha256-of-exact-policy-file>
```

Select only a target data directory already prepared by the separately reviewed
offline copy conversion and full-profile qualification. Its native state receipt,
database identities, access state, media closure and full schema must satisfy the
full-profile reopen checks. Changing this startup selection does not convert a
database, issue a receipt, adopt a legacy dataset or qualify a target. Keep the
source directory and its configuration unchanged. Do not select its database as
the converted target.

The two options must appear together, once each, on `serve`. They are rejected
for initialization, backup, receipt compatibility, origin rebind and disposable
startup. With neither option, the existing normal persistent startup is used.
A failed full-profile selection is an error; startup never retries through the
normal profile.

The selected policy file uses the existing
`houseatlas.reviewed-document-source-policy.v1` format described in
[reviewed source policy](reviewed-source-policy.md). Supply its exact whole-file
SHA-256 separately through the command line. This pin is distinct from the
reviewed source manifest digest inside the policy. It records custody, and does
not establish the trustworthiness of the policy or issue access or source grants.
The operator must already trust and approve the selected private file.

The file must be an absolute canonical path to a regular, single-link file owned
by the effective server user with mode `0600`. Startup opens it without following
symlinks, captures at most 4 MiB, checks its inode and metadata during capture,
and verifies its exact byte digest. JSON decoding rejects duplicate keys and
unknown manifest fields. The manifest must select an exact workspace/home pair
in the actual selected server configuration; existing bounded source-policy
validation then checks its document approvals and provenance. Keep real policy
files, private paths, source manifests and household records outside Git.

Both direct TLS and the trusted Unix gateway use the selected full-profile
`Core.store`. The Host enables Document routes only after checking that the
full store retains the same native access and media owners. Native routes,
Stock and Documents share that store connection. Gateway identity, socket
authority, account preparation and the lifetime of the exclusive server lease
continue through their existing startup paths.

This selection performs no source fetch, account provisioning, origin rebind,
automatic schema migration or conversion. Code integration and synthetic checks
do not authorize a service change, a release or selection of private data.
