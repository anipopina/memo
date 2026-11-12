"""Restore the exact bundled skill snapshots without replacing existing files."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile

root = Path(__file__).resolve().parent.parent
target_root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / '.agents' / 'skills'
records = json.loads((root / 'tools/skills-sources.json').read_text())['skills']
for record in records:
    archive = root / record['archive']
    if hashlib.sha256(archive.read_bytes()).hexdigest() != record['version']['sha256']:
        raise SystemExit(f"Archive hash mismatch: {record['name']}")
    target = target_root / record['name']
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        for member in members:
            if not member.isfile() or Path(member.name).is_absolute() or '..' in Path(member.name).parts:
                raise SystemExit('Unexpected archive entry')
            destination = target / member.name
            if destination.exists() and destination.read_bytes() != source.extractfile(member).read():
                raise SystemExit(f'Existing file differs; refusing overwrite: {destination}')
        for member in members:
            destination = target / member.name
            if destination.exists():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(source.extractfile(member).read())
    print(f"Verified/restored: {record['name']}")
