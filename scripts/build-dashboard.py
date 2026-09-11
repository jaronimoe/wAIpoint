#!/usr/bin/env python3
"""Splice project data into the dashboard template.

Reads every projects/<project>/<wp>/tasks/<task>.json in a single pass and
writes the resulting JSON between the template's data markers.
"""
import datetime
import json
import os
import sys

MARKER_START = "/*WAIPOINT_DATA*/"
MARKER_END = "/*END_DATA*/"


def load(path):
    with open(path) as f:
        return json.load(f)


def collect(projects_dir):
    projects = []
    if not os.path.isdir(projects_dir):
        return projects
    for slug in sorted(os.listdir(projects_dir)):
        pdir = os.path.join(projects_dir, slug)
        pfile = os.path.join(pdir, "project.json")
        if not os.path.isfile(pfile):
            continue
        project = load(pfile)
        project["slug"] = slug
        workpackages = []
        for wp_slug in sorted(os.listdir(pdir)):
            wdir = os.path.join(pdir, wp_slug)
            wfile = os.path.join(wdir, "workpackage.json")
            if not os.path.isfile(wfile):
                continue
            wp = load(wfile)
            wp["slug"] = wp_slug
            tasks = []
            tdir = os.path.join(wdir, "tasks")
            if os.path.isdir(tdir):
                for tfile in sorted(os.listdir(tdir)):
                    if not tfile.endswith(".json"):
                        continue
                    task = load(os.path.join(tdir, tfile))
                    task["slug"] = tfile[: -len(".json")]
                    tasks.append(task)
            wp["tasks"] = tasks
            workpackages.append(wp)
        project["workpackages"] = workpackages
        projects.append(project)
    return projects


def main():
    projects_dir, template_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data = json.dumps(
        {"projects": collect(projects_dir), "generated": now},
        separators=(",", ":"),
    )

    with open(template_path) as f:
        template = f.read()
    i = template.index(MARKER_START) + len(MARKER_START)
    j = template.index(MARKER_END)

    with open(output_path, "w") as f:
        f.write(template[:i] + data + template[j:])

    print("Dashboard built: %s" % output_path)


if __name__ == "__main__":
    main()
