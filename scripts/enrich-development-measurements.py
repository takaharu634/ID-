"""Add optional measurements by PitchUID. Never rebuild or replace existing statistics.

Run again after merging regenerated datasets from another development task.
Only measurement fields owned by this feature are written; existing fields/rows stay intact.
"""
import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NUMBERS = {
    'EffectiveVelo': 'effectiveVelocity', 'PopTime': 'popTime',
    'ExchangeTime': 'exchangeTime', 'TimeToBase': 'timeToBase',
    'ThrowSpeed': 'throwSpeed', 'BasePositionX': 'basePositionX',
    'BasePositionZ': 'basePositionZ',
}
TEXT = {
    'CatcherThrowCatchConfidence': 'throwCatchConfidence',
    'CatcherThrowReleaseConfidence': 'throwReleaseConfidence',
    'CatcherThrowLocationConfidence': 'throwLocationConfidence',
    'PitchReleaseConfidence': 'pitchReleaseConfidence',
    'PitchLocationConfidence': 'pitchLocationConfidence',
    'PitchMovementConfidence': 'pitchMovementConfidence',
    'HitLaunchConfidence': 'hitLaunchConfidence',
}

def numeric(value):
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None

def main():
    lookup = {}
    for source in sorted((ROOT / 'data').rglob('*.csv')):
        with source.open(encoding='utf-8-sig', newline='') as f:
            for row in csv.DictReader(f):
                uid = row.get('PitchUID', '').strip()
                if not uid:
                    continue
                values = {field: numeric(row.get(key)) for key, field in NUMBERS.items()}
                values.update({field: row.get(key, '') for key, field in TEXT.items()})
                old = lookup.get(uid, {})
                # A reduced backup must not erase a measurement from a richer source.
                lookup[uid] = {key: value if value not in (None, '') else old.get(key, value) for key, value in values.items()}
    for target in sorted((ROOT / 'public/data').glob('*.json')):
        if not (target.name.startswith('season-') or target.name == 'initial-data.json'):
            continue
        dataset = json.loads(target.read_text())
        matched = 0
        for pitch in dataset.get('pitches', []):
            if pitch.get('id') in lookup:
                # Runtime-imported values already present take precedence over backups.
                for key, value in lookup[pitch['id']].items():
                    if pitch.get(key) in (None, ''):
                        pitch[key] = value
                matched += 1
        target.write_text(json.dumps(dataset, ensure_ascii=False, separators=(',', ':')))
        if target.name.startswith('season-'):
            season = target.stem.removeprefix('season-')
            columns = ['id', *NUMBERS.values(), *TEXT.values()]
            supplement = {'version': 1, 'season': season, 'columns': columns,
                          'rows': [[pitch.get(key) for key in columns] for pitch in dataset.get('pitches', []) if pitch.get('id') in lookup]}
            (target.parent / f'development-{season}.json').write_text(json.dumps(supplement, ensure_ascii=False, separators=(',', ':')))
        print(f'{target.name}: {matched}/{len(dataset.get("pitches", []))} PitchUID matched')

if __name__ == '__main__':
    main()
