/** Keep optional TrackMan measurements across every future CSV import. */
export const DEVELOPMENT_COLUMNS = [
  'EffectiveVelo', 'PopTime', 'ExchangeTime', 'TimeToBase', 'ThrowSpeed',
  'BasePositionX', 'BasePositionZ', 'CatcherThrowCatchConfidence',
  'CatcherThrowReleaseConfidence', 'CatcherThrowLocationConfidence',
  'PitchReleaseConfidence', 'PitchLocationConfidence', 'PitchMovementConfidence', 'HitLaunchConfidence',
];

export function developmentMeasurements(row) {
  const number = key => {
    const value = row[key];
    if (value == null || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    effectiveVelocity: number('EffectiveVelo'), popTime: number('PopTime'),
    exchangeTime: number('ExchangeTime'), timeToBase: number('TimeToBase'),
    throwSpeed: number('ThrowSpeed'), basePositionX: number('BasePositionX'),
    basePositionZ: number('BasePositionZ'),
    throwCatchConfidence: String(row.CatcherThrowCatchConfidence ?? ''),
    throwReleaseConfidence: String(row.CatcherThrowReleaseConfidence ?? ''),
    throwLocationConfidence: String(row.CatcherThrowLocationConfidence ?? ''),
    pitchReleaseConfidence: String(row.PitchReleaseConfidence ?? ''),
    pitchLocationConfidence: String(row.PitchLocationConfidence ?? ''),
    pitchMovementConfidence: String(row.PitchMovementConfidence ?? ''),
    hitLaunchConfidence: String(row.HitLaunchConfidence ?? ''),
  };
}
