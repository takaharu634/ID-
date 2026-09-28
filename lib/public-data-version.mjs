import manifest from '../data/bundled/manifest.json' with { type: 'json' };

/** Both files are part of a publication; never identify them by the season alone. */
export function bundledDatasetVersion(season) {
  const summary = manifest.files.find(file => file.name === `season-${season}.json`);
  const spin = manifest.files.find(file => file.name === `spin-${season}.json`);
  return summary && spin ? `bundled:${summary.sha256}:${spin.sha256}` : null;
}
