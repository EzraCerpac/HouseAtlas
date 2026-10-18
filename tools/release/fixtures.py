"""Generated software-shaped bytes only; never a runnable native release."""
from pathlib import Path

SHELL = "a" * 64


def metadata():
    return {
        "version": "0.1.0-fixture.1",
        "source": {"repository": "EzraCerpac/HouseAtlas", "commit": "1" * 40, "tree": "2" * 40},
        "build": {"kind": "synthetic-fixture", "workflow": ".github/workflows/release-bundle.yml",
                  "workflowCommit": "1" * 40, "ref": "refs/heads/main", "runId": "1", "runAttempt": 1,
                  "runner": "macos-15-intel", "runnerImage": "synthetic", "rust": "1.99.0",
                  "node": "26.10.0", "npm": "11.19.1", "nativeProfileSha256": "3" * 64,
                  "xcodeBuild": "synthetic"},
        "platform": {"os": "macos", "architecture": "x86_64", "target": "x86_64-apple-darwin",
                     "minimumOs": "15.0", "abi": "apple-darwin", "dynamicLibraries": [], "sdkVersion": "15.0"},
        "compatibility": {"status": "unqualified", "backendFrontend": "same-source",
                          "storagePolicy": "preserve-no-migration", "requiredStorageContractSha256": None,
                          "resultingStorageContractSha256": None, "codeRollbackCompatible": False},
    }


def payload(root: Path):
    files = {
        "bin/houseatlas": b"SYNTHETIC NONEXECUTABLE BACKEND\n",
        "frontend/index.html": b'<html><div id="root"></div></html>\n',
        "frontend/assets/application.js": b'console.log("synthetic application");\n',
        "frontend/saved/index.html": f'<html><head><meta name="houseatlas-saved-shell-build" content="{SHELL}"></head></html>\n'.encode(),
        "frontend/saved/service-worker.js": f'const BUILD="{SHELL}", TABLE=[];\n'.encode(),
        "licenses/synthetic-LICENSE.txt": b"Synthetic fixture only; no third-party software.\n",
    }
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return root
