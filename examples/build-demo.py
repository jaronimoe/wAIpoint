#!/usr/bin/env python3
"""Build the public demo board from examples/projects.

Works on a copy, so the committed data stays as is. Every timestamp moves
forward by whole days until the newest lands within the last day, which keeps
the board from aging. Repo and commit links point at demo-repo.html, because
example_owner's repos do not exist.

Usage: examples/build-demo.py [output_dir]   (default: _site)
"""
import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STAMPS = ("created", "updated", "edited")
FORMAT = "%Y-%m-%dT%H:%M:%SZ"
LINK_PAGE = "demo-repo.html"
# The template builds repo links on a hardcoded GitHub base. Fail the build
# rather than ship dead links if that markup changes.
REPO_HREF = 'href="https://github.com/${escAttr(r)}"'


def parse(s):
    return datetime.datetime.strptime(s, FORMAT).replace(tzinfo=datetime.timezone.utc)


def load_all(root):
    docs = {}
    for dirpath, _, names in os.walk(root):
        for name in names:
            if name.endswith(".json"):
                path = os.path.join(dirpath, name)
                with open(path) as f:
                    docs[path] = json.load(f)
    return docs


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "_site"
    index = os.path.join(out_dir, "index.html")
    now = datetime.datetime.now(datetime.timezone.utc)

    with tempfile.TemporaryDirectory() as tmp:
        projects = os.path.join(tmp, "projects")
        shutil.copytree(os.path.join(HERE, "projects"), projects)

        docs = load_all(projects)
        newest = max(parse(d[k]) for d in docs.values() for k in STAMPS if k in d)
        shift = datetime.timedelta(days=(now - newest).days)

        for path, doc in docs.items():
            for k in STAMPS:
                if k in doc:
                    doc[k] = (parse(doc[k]) + shift).strftime(FORMAT)
            # The dashboard shows the last path segment as the short SHA.
            if "commits" in doc:
                doc["commits"] = ["%s#commit/%s" % (LINK_PAGE, c.rstrip("/").split("/")[-1])
                                  for c in doc["commits"]]
            with open(path, "w") as f:
                json.dump(doc, f, indent=2)

        os.makedirs(out_dir, exist_ok=True)
        subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "build-dashboard.py"),
                        projects, os.path.join(ROOT, "docs", "index.html"), index], check=True)

    with open(index) as f:
        html = f.read()
    if html.count(REPO_HREF) != 1:
        sys.exit("build-demo: repo link markup in docs/index.html changed; update REPO_HREF")
    with open(index, "w") as f:
        f.write(html.replace(REPO_HREF, 'href="%s#repo/${escAttr(r)}"' % LINK_PAGE))
    shutil.copy(os.path.join(HERE, LINK_PAGE), out_dir)

    print("Demo built: %s (timestamps shifted %d days)" % (out_dir, shift.days))


if __name__ == "__main__":
    main()
