// Confirmed by the user on 2026-11-01. Keep the pitch and its official result;
// omit only the erroneous exit speed from measured-contact statistics.
export function correctTrackmanMeasurements(row) {
  if (row.PitchUID === 'd688e1b0-bdf8-11f1-8598-61febcdafd6c'
      && row.Date === '2026-10-02' && row.BatterId === '1000274624'
      && row.BatterTeam === 'ASI_UNI') {
    return { ...row, ExitSpeed: '' };
  }
  if (row.PitchUID === '79e2edc0-afb2-11f0-806d-4576010de888'
      && row.Date === '2025-10-23' && row.BatterId === '1000274596'
      && row.BatterTeam === 'ASI_UNI') {
    return { ...row, ExitSpeed: '' };
  }
  return row;
}
