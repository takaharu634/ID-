/** Independent source-to-output checks, run before an autumn snapshot is written.
 * Preserve the existing metric pool: measured in-play contact, excluding bunts. */
export function validateAutumnBatting(dataset, sourceRows) {
  const fail = (message) => { throw new Error(`打者・打球の検証に失敗しました: ${message}`); };
  const numeric = (value) => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const rounded = (value) => value === null ? null : Math.round(value * 10) / 10;
  const equal = (actual, expected, label) => {
    if (expected === null ? actual !== null : !Number.isFinite(actual) || Math.abs(actual - expected) > 0.00001) fail(label);
  };
  const sources = new Map(sourceRows.map((row) => [row.PitchUID, row]));
  const batters = new Map(dataset.batters.map((row) => [row.id, row]));
  const players = new Map(dataset.players.map((row) => [row.id, row]));
  const groups = new Map();
  for (const pitch of dataset.pitches) {
    const raw = sources.get(pitch.id);
    if (!raw) fail(`元CSVにない投球 ${pitch.id}`);
    const batter = batters.get(pitch.batterId), player = players.get(pitch.batterId);
    if (!batter || !player?.batting || !player.roles.includes('打者')) fail(`打者一覧・選手詳細に存在しない打者 ${pitch.batterId}`);
    for (const [field, sourceField] of [['exitVelocity', 'ExitSpeed'], ['launchAngle', 'Angle'], ['direction', 'Direction'], ['distance', 'Distance']]) {
      equal(pitch[field], rounded(numeric(raw[sourceField])), `${pitch.id}: ${field}`);
    }
    equal(pitch.sprayAngle, rounded(numeric(raw.Bearing) ?? numeric(raw.Direction)), `${pitch.id}: sprayAngle`);
    if (pitch.hitType !== (raw.TaggedHitType ?? '').trim()) fail(`${pitch.id}: hitType`);
    const contacts = groups.get(pitch.batterId) ?? [];
    groups.set(pitch.batterId, contacts);
    if (raw.PitchCall === 'InPlay' && raw.TaggedHitType !== 'Bunt' && numeric(raw.ExitSpeed) > 0 && numeric(raw.Angle) !== null) contacts.push(raw);
  }
  if (groups.size !== batters.size || batters.size !== dataset.metadata.batters) fail('打者数');
  let battedBalls = 0;
  for (const [id, contacts] of groups) {
    const batter = batters.get(id);
    battedBalls += contacts.length;
    const velocities = contacts.map((row) => numeric(row.ExitSpeed));
    const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const expected = {
      bbe: contacts.length,
      avgExitVelocity: rounded(mean(velocities)),
      maxExitVelocity: velocities.length ? rounded(Math.max(...velocities)) : null,
      avgLaunchAngle: rounded(mean(contacts.map((row) => numeric(row.Angle)))),
    };
    for (const row of [batter, players.get(id).batting]) {
      for (const [key, value] of Object.entries(expected)) equal(row[key], value, `${id}: ${key}`);
      for (const key of ['pa', 'ab', 'hits', 'doubles', 'triples', 'homeRuns', 'walks', 'strikeouts']) {
        if (!Number.isFinite(row[key]) || row[key] < 0) fail(`${id}: ${key}`);
      }
      if (contacts.length) {
        for (const key of ['ev90', 'hardHitRate', 'barrelRate', 'sweetSpotRate', 'xba', 'xslg', 'xwoba']) {
          if (!Number.isFinite(row[key])) fail(`${id}: ${key}`);
        }
      }
    }
  }
  if (dataset.metadata.battedBalls !== battedBalls) fail('有効打球数');
  return { batters: batters.size, battedBalls, battingValidationVersion: 1 };
}
