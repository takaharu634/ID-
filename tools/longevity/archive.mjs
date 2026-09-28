// Dependency-free, streaming data archives. Node 22+, never a browser/Worker import.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, opendir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const FORMAT = 'id-touto-file-archive';
const MAX_CHUNK = 4 * 1024 * 1024;
const MAX_LINE = 16 * 1024;
const hash = data => createHash('sha256').update(data).digest('hex');
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const digest = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const fail = message => { throw new Error(message); };

export function safeRelative(p) {
  if (typeof p !== 'string' || !p || Buffer.byteLength(p) > 2048 || /[\\\x00-\x1f:*?"<>|]/.test(p)) fail('Unsafe archive path');
  for (const part of p.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(part)) fail('Unsafe archive path');
  }
  return p;
}

async function regular(file, max = Infinity) {
  const s = await lstat(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max) fail('Expected a bounded regular file');
  return s;
}

async function* walk(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const name = safeRelative(relative ? `${relative}/${entry.name}` : entry.name);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) fail('Links and special files are not archived');
    if (entry.isDirectory()) { yield { type: 'directory', path: name }; yield* walk(root, name); }
    else yield { type: 'file', path: name };
  }
}

async function* lines(file) {
  let pending = Buffer.alloc(0);
  for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) {
    pending = Buffer.concat([pending, chunk]);
    let end;
    while ((end = pending.indexOf(10)) >= 0) {
      if (end > MAX_LINE) fail('Archive index line is too large');
      const line = pending.subarray(0, end); pending = pending.subarray(end + 1);
      if (!line.length) fail('Empty archive index line');
      yield JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
    }
    if (pending.length > MAX_LINE) fail('Archive index line is too large');
  }
  if (pending.length) fail('Truncated archive index');
}

async function fileDigest(file) {
  await regular(file);
  const h = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { h.update(chunk); bytes += chunk.length; }
  return { sha256: h.digest('hex'), bytes };
}

async function canonicalDestination(value) {
  const absolute = path.resolve(value);
  try { return await realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(await canonicalDestination(parent), path.basename(absolute));
  }
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function newDestination(destination, operation) {
  const dest = path.resolve(destination), parent = path.dirname(dest);
  await mkdir(parent, { recursive: true });
  // Cooperating exporters/restorers cannot race or replace one another's output.
  const lock = await open(`${dest}.lock`, 'wx', 0o600);
  const temp = path.join(parent, `.id-touto-${randomUUID()}`);
  try {
    try { await lstat(dest); fail('Destination already exists; refusing to overwrite'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    await mkdir(temp, { mode: 0o700 });
    const result = await operation(temp);
    try { await lstat(dest); fail('Destination appeared during operation'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    await rename(temp, dest);
    return result;
  } finally {
    await rm(temp, { recursive: true, force: true });
    await lock.close(); await rm(`${dest}.lock`, { force: true });
  }
}

/** Exact file-byte backup of a frozen data export. Does not read a live database. */
export async function pack(source, destination, { chunkBytes = 1024 * 1024 } = {}) {
  if (!integer(chunkBytes, 1024) || chunkBytes > MAX_CHUNK) fail('Chunk size must be 1 KiB to 4 MiB');
  const sourceStat = await lstat(path.resolve(source));
  const root = await realpath(source), dest = await canonicalDestination(destination);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) fail('Source must be a real directory');
  if (inside(root, dest)) fail('Archive destination must be outside source');
  return newDestination(dest, async temp => {
    await mkdir(path.join(temp, 'objects'), { mode: 0o700 });
    const index = await open(path.join(temp, 'index.ndjson'), 'wx', 0o600);
    const ih = createHash('sha256');
    let indexBytes = 0, files = 0, directories = 0, contentBytes = 0, objectBytes = 0, objects = 0;
    const emit = async record => {
      const line = Buffer.from(JSON.stringify(record) + '\n');
      ih.update(line); indexBytes += line.length; await index.writeFile(line);
    };
    try {
      for await (const entry of walk(root)) {
        if (entry.type === 'directory') { directories++; await emit(entry); continue; }
        const filename = path.join(root, entry.path), before = await regular(filename);
        const input = await open(filename, 'r');
        const fh = createHash('sha256'); let offset = 0;
        await emit({ ...entry, bytes: before.size });
        try {
          const buffer = Buffer.allocUnsafe(chunkBytes);
          for (;;) {
            // Fill one block even if the OS returns a short read.
            let used = 0;
            while (used < chunkBytes) {
              const { bytesRead } = await input.read(buffer, used, chunkBytes - used, null);
              if (!bytesRead) break;
              used += bytesRead;
            }
            if (!used) break;
            const data = buffer.subarray(0, used), compressed = gzipSync(data);
            const sha256 = hash(data), compressedSha256 = hash(compressed);
            const object = `${compressedSha256}.gz`;
            try { await writeFile(path.join(temp, 'objects', object), compressed, { flag: 'wx', mode: 0o600 }); objectBytes += compressed.length; objects++; }
            catch (e) { if (e.code !== 'EEXIST') throw e; }
            await emit({ type: 'chunk', offset, bytes: used, compressedBytes: compressed.length, sha256, compressedSha256 });
            fh.update(data); offset += used;
          }
          const after = await input.stat();
          if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) fail('Source changed while exporting; create a frozen export first');
        } finally { await input.close(); }
        await emit({ type: 'end', bytes: offset, sha256: fh.digest('hex') });
        files++; contentBytes += offset;
      }
    } finally { await index.close(); }
    const manifest = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), chunkBytes,
      files, directories, contentBytes, objectBytes, objects, indexBytes, indexSha256: ih.digest('hex') };
    const text = JSON.stringify(manifest, null, 2) + '\n', manifestSha256 = hash(text);
    await writeFile(path.join(temp, 'manifest.json'), text, { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(temp, 'manifest.sha256'), manifestSha256 + '\n', { flag: 'wx', mode: 0o600 });
    // Never report a successful backup until a full read-back has passed.
    await verify(temp, { expectedManifestHash: manifestSha256 });
    return { ...manifest, manifestSha256 };
  });
}

/** Integrity is anchored by expectedManifestHash when supplied by a trusted source. */
export async function verify(archive, { expectedManifestHash = null, sink = null } = {}) {
  const root = path.resolve(archive);
  for (const dir of [root, path.join(root, 'objects')]) {
    const s = await lstat(dir); if (!s.isDirectory() || s.isSymbolicLink()) fail('Archive directories cannot be links');
  }
  const mf = path.join(root, 'manifest.json'); await regular(mf, MAX_LINE);
  const text = await readFile(mf), manifestSha256 = hash(text);
  if (expectedManifestHash !== null && (!digest(expectedManifestHash) || manifestSha256 !== expectedManifestHash)) fail('Manifest checksum mismatch');
  await regular(path.join(root, 'manifest.sha256'), 128);
  if ((await readFile(path.join(root, 'manifest.sha256'), 'utf8')).trim() !== manifestSha256) fail('Manifest checksum mismatch');
  const m = JSON.parse(text.toString('utf8'));
  if (m.format !== FORMAT || m.version !== 1 || !integer(m.chunkBytes, 1024) || m.chunkBytes > MAX_CHUNK || !digest(m.indexSha256)) fail('Unsupported archive format');
  for (const key of ['files', 'directories', 'contentBytes', 'objectBytes', 'objects', 'indexBytes']) if (!integer(m[key])) fail('Invalid archive counts');
  const index = path.join(root, 'index.ndjson'), checked = await fileDigest(index);
  if (checked.sha256 !== m.indexSha256 || checked.bytes !== m.indexBytes) fail('Index checksum mismatch');
  let current = null, files = 0, directories = 0, contentBytes = 0;
  // Paths are emitted in sorted depth-first order. This detects duplicates without an unbounded Set.
  let previousPath = '', previousType = '';
  for await (const item of lines(index)) {
    if (item.type === 'directory' || item.type === 'file') {
      if (current) fail('Missing file end record');
      safeRelative(item.path);
      // pack() uses component ordering, not locale-dependent collation.
      if (previousPath && comparePaths(previousPath, item.path) >= 0) fail('Duplicate or unsorted archive path');
      if (previousType === 'file' && item.path.startsWith(previousPath + '/')) fail('A file cannot be a parent directory');
      previousPath = item.path; previousType = item.type;
      if (item.type === 'directory') { directories++; await sink?.directory?.(item.path); }
      else {
        if (!integer(item.bytes)) fail('Invalid file size');
        current = { path: item.path, expected: item.bytes, bytes: 0, hash: createHash('sha256') };
        await sink?.start?.(item.path);
      }
    } else if (item.type === 'chunk') {
      if (!current || !integer(item.bytes, 1) || item.bytes > m.chunkBytes || item.offset !== current.bytes || !integer(item.compressedBytes, 1) || item.compressedBytes > m.chunkBytes + 65536 || !digest(item.sha256) || !digest(item.compressedSha256)) fail('Invalid chunk descriptor');
      const file = path.join(root, 'objects', `${item.compressedSha256}.gz`);
      const s = await regular(file, m.chunkBytes + 65536);
      if (s.size !== item.compressedBytes) fail('Compressed size mismatch');
      const compressed = await readFile(file);
      if (hash(compressed) !== item.compressedSha256) fail('Compressed checksum mismatch');
      const data = gunzipSync(compressed, { maxOutputLength: m.chunkBytes });
      if (data.length !== item.bytes || hash(data) !== item.sha256) fail('Chunk checksum mismatch');
      current.bytes += data.length;
      if (current.bytes > current.expected) fail('File exceeds declared size');
      current.hash.update(data); await sink?.chunk?.(data);
    } else if (item.type === 'end') {
      if (!current || item.bytes !== current.bytes || current.expected !== current.bytes || !digest(item.sha256) || current.hash.digest('hex') !== item.sha256) fail('File checksum mismatch');
      files++; contentBytes += current.bytes; current = null; await sink?.end?.();
    } else fail('Unknown archive record');
  }
  if (current || files !== m.files || directories !== m.directories || contentBytes !== m.contentBytes) fail('Incomplete archive');
  // Count actual stored objects rather than trusting capacity fields in metadata.
  let actualObjects = 0, actualObjectBytes = 0;
  const directory = await opendir(path.join(root, 'objects'));
  for await (const entry of directory) {
    if (!/^[a-f0-9]{64}\.gz$/.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) fail('Invalid archive object');
    const stat = await regular(path.join(root, 'objects', entry.name), m.chunkBytes + 65536);
    actualObjects++; actualObjectBytes += stat.size;
  }
  if (actualObjects !== m.objects || actualObjectBytes !== m.objectBytes) fail('Stored object inventory mismatch');
  return { ...m, manifestSha256, verified: true };
}

function comparePaths(a, b) {
  const x = a.split('/'), y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length - y.length;
}

/** Restores to a NEW directory. Never touches a live database, bucket or existing files. */
export async function restore(archive, destination, options = {}) {
  const checked = await verify(archive, options);
  const dest = await canonicalDestination(destination);
  if (inside(await realpath(archive), dest)) fail('Restore destination must be outside archive');
  return newDestination(dest, async temp => {
    let output = null;
    try {
      await verify(archive, { expectedManifestHash: checked.manifestSha256, sink: {
        directory: name => mkdir(path.join(temp, name), { recursive: true, mode: 0o700 }),
        start: async name => {
          const filename = path.join(temp, name);
          await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
          output = await open(filename, 'wx', 0o600);
        },
        chunk: data => output.writeFile(data),
        end: async () => { await output.close(); output = null; },
      } });
    } finally { if (output) await output.close(); }
    return { files: checked.files, contentBytes: checked.contentBytes, verified: true, manifestSha256: checked.manifestSha256 };
  });
}
