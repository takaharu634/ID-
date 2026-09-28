/** Iterable extrema avoid the engine's function-argument limit as seasons grow. */
export function maxValue(values, initial = -Infinity) {
  let result = initial;
  for (const value of values) result = Math.max(result, value);
  return result;
}
export function minValue(values, initial = Infinity) {
  let result = initial;
  for (const value of values) result = Math.min(result, value);
  return result;
}
