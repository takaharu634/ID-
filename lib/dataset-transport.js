/** Lossless column storage: preserve row order, every field, nulls and missing keys. */
export function packRows(rows) {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const missing = [];
  const values = rows.map((row, i) => columns.map((key, j) => {
    if (!Object.hasOwn(row, key)) { missing.push([i, j]); return null; }
    return row[key];
  }));
  return { columns, values, missing };
}

export function unpackRows(table) {
  if (!Array.isArray(table.columns) || !Array.isArray(table.values) || !Array.isArray(table.missing)) throw new Error('Invalid dataset table');
  const { columns, values } = table;
  const rows = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (!Array.isArray(values[i]) || values[i].length !== columns.length) throw new Error('Invalid dataset row');
    const row = {};
    for (let j = 0; j < columns.length; j++) {
      const key = columns[j];
      // Keep JSON's own-key semantics without allocating a pair array for every value.
      if (key === '__proto__') Object.defineProperty(row, key, { value: values[i][j], enumerable: true, configurable: true, writable: true });
      else row[key] = values[i][j];
    }
    rows[i] = row;
  }
  for (const [i, j] of table.missing) {
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || i >= rows.length || j < 0 || j >= columns.length) throw new Error('Invalid missing field');
    delete rows[i][columns[j]];
  }
  return rows;
}

export function packDataset(data) {
  return Array.isArray(data)
    ? { transportVersion: 1, kind: 'rows', table: packRows(data) }
    : { transportVersion: 1, kind: 'dataset', summary: { ...data, pitches: undefined }, table: packRows(data.pitches) };
}

export function unpackDataset(data) {
  if (data?.transportVersion !== 1 || !['rows', 'dataset'].includes(data.kind)) throw new Error('Unsupported dataset transport');
  const rows = unpackRows(data.table);
  return data.kind === 'rows' ? rows : { ...data.summary, pitches: rows };
}
