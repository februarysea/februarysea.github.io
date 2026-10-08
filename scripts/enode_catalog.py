#!/usr/bin/env python3
"""Export only metric definitions and exercise-name mappings, never the app database."""
import argparse
import json
from pathlib import Path

from enode_export import load_catalog


def portable_catalog(database):
    metrics, _, exercises = load_catalog(database)
    # Generic translations can contain unrelated app/account content. Exercise
    # labels are already resolved by load_catalog; no translation table is needed.
    return {"schemaVersion": 1, "metrics": metrics, "translations": {},
            "exercises": {key: name for key, name in exercises.items() if isinstance(name, str) and name.strip()}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = portable_catalog(args.database)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"metrics": len(result["metrics"]), "exercises": len(result["exercises"])}))
