// ZIP reading and writing on web streams only, so the same code runs in Node 24 and in a
// Cloudflare Worker (workerd, nodejs_compat): no node:zlib, no node:fs.
//
// Reading (`openZip`) is random access over a `source` ({ size, read(offset, length) }), which in
// production is a ranged read of an R2 object: the End Of Central Directory is found in the
// archive's tail, the central directory is read in bounded slices, and each entry's data is read
// (and inflated) on demand. ZIP64 is supported for archives with more than 65535 entries or
// bigger than 4 GB, as Slack exports can be.
//
// Writing (`zipStream`) streams: every entry is followed by a data descriptor (general purpose
// flag bit 3), so sizes and CRCs need not be known in advance; names are UTF-8 (bit 11); ZIP64
// records appear only when sizes, offsets or the entry count need them (or when forced).

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_DESCRIPTOR = 0x08074b50;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
const EOCD_SIZE = 22;
const EOCD_SEARCH = EOCD_SIZE + MAX16; // 65557: the record plus the longest comment
const CD_SLICE = 1 << 20; // central directory read size
const DATA_SLICE = 1 << 20; // entry data read size
const INFLATE_FEED = 16 << 10; // compressed bytes handed to the inflater at once (bounds a bomb's burst)
const DEFAULT_MAX_BYTES = 64 << 20;

// ---------------------------------------------------------------------------------------------
// CRC-32 (IEEE 802.3), table based and incremental: crc32(b, crc32(a)) === crc32(a + b).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of `bytes`, continuing from `prev` (the CRC of everything before them). */
export function crc32(bytes, prev = 0) {
  let crc = (prev ^ MAX32) >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ MAX32) >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Sources

/** A source over bytes already in memory. */
export function bufferSource(bytes) {
  const data = toBytes(bytes);
  return {
    size: data.length,
    async read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > data.length) throw new RangeError(`Read ${offset}+${length} is outside the ${data.length} bytes`);
      return data.subarray(offset, offset + length);
    },
  };
}

/**
 * Several consecutive parts (an upload sent in chunks) presented as one source. Each part is
 * `{ size, read(offset, length) }` with offsets relative to that part; a read that spans parts is
 * stitched together.
 */
export function partsSource(parts) {
  const list = [...parts];
  const starts = [];
  let size = 0;
  for (const part of list) {
    if (!Number.isSafeInteger(part.size) || part.size < 0) throw new TypeError("Every part needs a size");
    starts.push(size);
    size += part.size;
  }
  const partAt = (offset) => {
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return {
    size,
    async read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > size) throw new RangeError(`Read ${offset}+${length} is outside the ${size} bytes`);
      if (length === 0) return new Uint8Array(0);
      const pieces = [];
      let i = partAt(offset);
      let at = offset;
      const end = offset + length;
      while (at < end) {
        while (list[i].size === 0 || starts[i] + list[i].size <= at) i++;
        const local = at - starts[i];
        const n = Math.min(end - at, list[i].size - local);
        const piece = toBytes(await list[i].read(local, n));
        if (piece.length !== n) throw new Error(`Part ${i} returned ${piece.length} bytes, ${n} were asked for`);
        pieces.push(piece);
        at += n;
      }
      return pieces.length === 1 ? pieces[0] : concat(pieces, length);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Reading

/**
 * Opens a ZIP archive over a random-access `source` ({ size, read(offset, length) → Promise<Uint8Array> }).
 * Returns its entries (central directory order) and readers for their contents.
 */
export async function openZip(source) {
  const size = source?.size;
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError("openZip needs a source with a size");
  const read = async (offset, length) => {
    if (offset < 0 || offset + length > size) throw new Error("The ZIP points outside the file: it is truncated or damaged");
    const bytes = toBytes(await source.read(offset, length));
    if (bytes.length !== length) throw new Error(`Short read: ${bytes.length} of ${length} bytes at ${offset}`);
    return bytes;
  };
  if (size < EOCD_SIZE) throw new Error("This is not a ZIP file: it is too small");

  // End Of Central Directory: the last record whose comment length ends the file (or fits).
  const tailLength = Math.min(size, EOCD_SEARCH);
  const tailStart = size - tailLength;
  const tail = await read(tailStart, tailLength);
  let at = -1;
  let loose = -1;
  for (let p = tail.length - EOCD_SIZE; p >= 0; p--) {
    if (u32(tail, p) !== SIG_EOCD) continue;
    const end = p + EOCD_SIZE + u16(tail, p + 20);
    if (end === tail.length) {
      at = p;
      break;
    }
    if (end < tail.length && loose < 0) loose = p;
  }
  if (at < 0) at = loose;
  if (at < 0) throw new Error("This is not a ZIP file: no end of central directory");
  const eocdOffset = tailStart + at;
  let count = u16(tail, at + 10);
  let cdSize = u32(tail, at + 12);
  let cdOffset = u32(tail, at + 16);
  if (u16(tail, at + 4) !== 0 || u16(tail, at + 6) !== 0) throw new Error("Split (multi-disk) ZIP archives are not supported");

  // ZIP64: a locator right before the EOCD points to the ZIP64 end record.
  if (eocdOffset >= 20) {
    const locator = eocdOffset - 20 >= tailStart ? tail.subarray(eocdOffset - 20 - tailStart, eocdOffset - tailStart) : await read(eocdOffset - 20, 20);
    if (u32(locator, 0) === SIG_ZIP64_LOCATOR) {
      const recordOffset = u64(locator, 8);
      const record = await read(recordOffset, 56);
      if (u32(record, 0) !== SIG_ZIP64_EOCD) throw new Error("The ZIP64 end of central directory is missing or damaged");
      count = u64(record, 32);
      cdSize = u64(record, 40);
      cdOffset = u64(record, 48);
    } else if (count === MAX16 || cdSize === MAX32 || cdOffset === MAX32) {
      throw new Error("The ZIP needs ZIP64 records but has none: it is damaged");
    }
  }
  if (cdOffset + cdSize > eocdOffset) throw new Error("The central directory runs past its end record: the ZIP is damaged");

  // Central directory, in bounded slices.
  const cdEnd = cdOffset + cdSize;
  let buf = new Uint8Array(0);
  let bufStart = cdOffset;
  let pos = cdOffset;
  const ensure = async (n) => {
    if (pos + n <= bufStart + buf.length) return;
    if (pos + n > cdEnd) throw new Error("The central directory is truncated");
    buf = await read(pos, Math.min(Math.max(n, CD_SLICE), cdEnd - pos));
    bufStart = pos;
  };
  const entries = [];
  while (pos < cdEnd) {
    await ensure(46);
    let o = pos - bufStart;
    if (u32(buf, o) !== SIG_CENTRAL) throw new Error(`Damaged central directory at entry ${entries.length + 1}`);
    const nameLength = u16(buf, o + 28);
    const extraLength = u16(buf, o + 30);
    const commentLength = u16(buf, o + 32);
    const total = 46 + nameLength + extraLength + commentLength;
    await ensure(total);
    o = pos - bufStart;
    const flags = u16(buf, o + 8);
    const rawName = buf.subarray(o + 46, o + 46 + nameLength);
    const extra = buf.subarray(o + 46 + nameLength, o + 46 + nameLength + extraLength);
    let compressedSize = u32(buf, o + 20);
    let entrySize = u32(buf, o + 24);
    let headerOffset = u32(buf, o + 42);
    let name = null;
    for (const [id, data] of extraFields(extra)) {
      if (id === 0x0001) {
        // ZIP64 extended information: only the fields saturated in the record, in this order.
        let q = 0;
        const next = () => {
          if (q + 8 > data.length) throw new Error("Damaged ZIP64 extra field");
          const v = u64(data, q);
          q += 8;
          return v;
        };
        if (entrySize === MAX32) entrySize = next();
        if (compressedSize === MAX32) compressedSize = next();
        if (headerOffset === MAX32) headerOffset = next();
      } else if (id === 0x7075 && !(flags & 0x800) && data.length > 5 && data[0] === 1 && u32(data, 1) === crc32(rawName)) {
        name = UTF8.decode(data.subarray(5)); // Info-ZIP Unicode Path
      }
    }
    if (name === null) name = flags & 0x800 ? UTF8.decode(rawName) : cp437(rawName);
    name = name.replace(/\\/g, "/");
    const dosTime = u16(buf, o + 12);
    const dosDate = u16(buf, o + 14);
    entries.push({
      name,
      method: u16(buf, o + 10),
      compressedSize,
      size: entrySize,
      crc32: u32(buf, o + 16),
      headerOffset,
      isDirectory: name.endsWith("/"),
      encrypted: (flags & 1) === 1,
      flags,
      modifiedAt: dosToMs(dosDate, dosTime),
    });
    pos += total;
  }
  if (count !== entries.length && count !== (entries.length & MAX16)) {
    throw new Error(`The ZIP says it has ${count} entries but its directory lists ${entries.length}`);
  }

  const offsets = new WeakMap();
  /** Where an entry's data starts: after its LOCAL header (whose lengths can differ from the central one). */
  const dataOffset = async (entry) => {
    if (offsets.has(entry)) return offsets.get(entry);
    if (entry.headerOffset + 30 > size) throw new Error(`${entry.name}: its header is outside the file`);
    const header = await read(entry.headerOffset, 30);
    if (u32(header, 0) !== SIG_LOCAL) throw new Error(`${entry.name}: damaged local header`);
    const offset = entry.headerOffset + 30 + u16(header, 26) + u16(header, 28);
    if (offset + entry.compressedSize > size) throw new Error(`${entry.name}: its data runs past the end of the file`);
    offsets.set(entry, offset);
    return offset;
  };

  const checkReadable = (entry) => {
    if (entry.encrypted) throw new Error(`${entry.name}: encrypted entries are not supported`);
    if (entry.method !== 0 && entry.method !== 8) throw new Error(`${entry.name}: compression method ${entry.method} is not supported (only stored and deflate)`);
    if (entry.method === 0 && entry.compressedSize !== entry.size) throw new Error(`${entry.name}: stored entry with mismatched sizes`);
  };

  /** The entry's contents as a stream; it errors if the data is longer or shorter than declared, or the CRC differs. */
  const streamEntry = (entry) => {
    checkReadable(entry);
    let offset = null;
    let remaining = entry.compressedSize;
    const feed = entry.method === 8 ? INFLATE_FEED : DATA_SLICE;
    const raw = new ReadableStream(
      {
        async pull(controller) {
          if (offset === null) offset = await dataOffset(entry);
          if (remaining > 0) {
            const n = Math.min(DATA_SLICE, remaining);
            const bytes = await read(offset, n);
            offset += n;
            remaining -= n;
            for (let i = 0; i < bytes.length; i += feed) controller.enqueue(bytes.subarray(i, i + feed));
          }
          if (remaining === 0) controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const inflated = entry.method === 8 ? raw.pipeThrough(new DecompressionStream("deflate-raw")) : raw;
    let total = 0;
    let crc = 0;
    return inflated.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          total += chunk.length;
          if (total > entry.size) throw new Error(`${entry.name}: inflates past its declared ${entry.size} bytes`);
          crc = crc32(chunk, crc);
          controller.enqueue(chunk);
        },
        flush() {
          if (total !== entry.size) throw new Error(`${entry.name}: ${total} bytes, ${entry.size} declared`);
          if (crc !== entry.crc32) throw new Error(`${entry.name}: CRC mismatch, the data is damaged`);
        },
      }),
    );
  };

  /** The entry's whole contents, verified; refuses entries declaring more than `maxBytes` (default 64 MB). */
  const readEntry = async (entry, { maxBytes = DEFAULT_MAX_BYTES } = {}) => {
    checkReadable(entry);
    if (entry.size > maxBytes) throw new Error(`${entry.name}: ${entry.size} bytes is more than the ${maxBytes} allowed`);
    const out = new Uint8Array(entry.size);
    let at = 0;
    const reader = streamEntry(entry).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out.set(value, at); // the stream already refused anything past entry.size
      at += value.length;
    }
    return out;
  };

  return { entries, readEntry, streamEntry, dataOffset };
}

// ---------------------------------------------------------------------------------------------
// Writing

/**
 * A ZIP archive as a stream. `entries` is an (async) iterable of
 * `{ name, data, date = new Date(), deflate = false }`, where `data` is a Uint8Array, a string, a
 * ReadableStream, an (async) iterable of chunks, or an (async) function returning one of those.
 * A name ending in "/" is a directory. `options.zip64` forces ZIP64 records everywhere.
 */
export function zipStream(entries, { zip64 = false } = {}) {
  const iterator = writeZip(entries, zip64);
  return new ReadableStream(
    {
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      async cancel(reason) {
        await iterator.return?.(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

/** The whole archive in memory (small archives, tests). */
export async function zipBytes(entries, options) {
  const chunks = [];
  let total = 0;
  const reader = zipStream(entries, options).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  return concat(chunks, total);
}

async function* writeZip(entries, forceZip64) {
  const central = [];
  let offset = 0;
  const names = new Set();
  for await (const entry of entries) {
    const name = String(entry?.name ?? "");
    if (!name) throw new Error("Every ZIP entry needs a name");
    if (names.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    names.add(name);
    const isDirectory = name.endsWith("/");
    const deflate = !isDirectory && !!entry.deflate;
    const method = deflate ? 8 : 0;
    const nameBytes = UTF8_ENCODER.encode(name);
    if (nameBytes.length > MAX16) throw new Error(`ZIP entry name too long: ${name.slice(0, 60)}…`);
    const { date: dosDate, time: dosTime } = toDos(entry.date ?? new Date());
    const headerOffset = offset;

    // Local header: sizes and CRC come later, in the data descriptor.
    const localExtra = forceZip64 ? zip64Extra([0, 0]) : new Uint8Array(0);
    const local = new Uint8Array(30 + nameBytes.length + localExtra.length);
    const lv = view(local);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, forceZip64 ? 45 : 20, true);
    lv.setUint16(6, 0x0808, true); // bit 3 (data descriptor) + bit 11 (UTF-8 name)
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    if (forceZip64) {
      lv.setUint32(18, MAX32, true);
      lv.setUint32(22, MAX32, true);
    }
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, localExtra.length, true);
    local.set(nameBytes, 30);
    local.set(localExtra, 30 + nameBytes.length);
    yield local;
    offset += local.length;

    // Data: CRC and size tallied on the way in, compressed size on the way out.
    let crc = 0;
    let size = 0;
    let compressedSize = 0;
    if (!isDirectory) {
      const tallied = (async function* () {
        for await (const chunk of chunksOf(entry.data)) {
          if (!chunk.length) continue;
          crc = crc32(chunk, crc);
          size += chunk.length;
          yield chunk;
        }
      })();
      if (deflate) {
        const reader = streamOf(tallied).pipeThrough(new CompressionStream("deflate-raw")).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = toBytes(value);
          compressedSize += chunk.length;
          yield chunk;
        }
      } else {
        for await (const chunk of tallied) {
          compressedSize += chunk.length;
          yield chunk;
        }
      }
    }
    offset += compressedSize;

    // Data descriptor, 64-bit sizes when this entry is ZIP64.
    const big = forceZip64 || size >= MAX32 || compressedSize >= MAX32;
    const descriptor = new Uint8Array(big ? 24 : 16);
    const dv = view(descriptor);
    dv.setUint32(0, SIG_DESCRIPTOR, true);
    dv.setUint32(4, crc, true);
    if (big) {
      dv.setBigUint64(8, BigInt(compressedSize), true);
      dv.setBigUint64(16, BigInt(size), true);
    } else {
      dv.setUint32(8, compressedSize, true);
      dv.setUint32(12, size, true);
    }
    yield descriptor;
    offset += descriptor.length;

    central.push({ nameBytes, method, dosTime, dosDate, crc, size, compressedSize, headerOffset, isDirectory });
  }

  // Central directory.
  const cdOffset = offset;
  for (const e of central) {
    const sizeBig = forceZip64 || e.size >= MAX32;
    const compBig = forceZip64 || e.compressedSize >= MAX32;
    const offsetBig = forceZip64 || e.headerOffset >= MAX32;
    const values = [];
    if (sizeBig) values.push(e.size);
    if (compBig) values.push(e.compressedSize);
    if (offsetBig) values.push(e.headerOffset);
    const extra = values.length ? zip64Extra(values) : new Uint8Array(0);
    const record = new Uint8Array(46 + e.nameBytes.length + extra.length);
    const v = view(record);
    v.setUint32(0, SIG_CENTRAL, true);
    v.setUint16(4, values.length ? 45 : 20, true); // made by: MS-DOS host, spec version
    v.setUint16(6, values.length ? 45 : 20, true);
    v.setUint16(8, 0x0808, true);
    v.setUint16(10, e.method, true);
    v.setUint16(12, e.dosTime, true);
    v.setUint16(14, e.dosDate, true);
    v.setUint32(16, e.crc, true);
    v.setUint32(20, compBig ? MAX32 : e.compressedSize, true);
    v.setUint32(24, sizeBig ? MAX32 : e.size, true);
    v.setUint16(28, e.nameBytes.length, true);
    v.setUint16(30, extra.length, true);
    v.setUint32(38, e.isDirectory ? 0x10 : 0, true);
    v.setUint32(42, offsetBig ? MAX32 : e.headerOffset, true);
    record.set(e.nameBytes, 46);
    record.set(extra, 46 + e.nameBytes.length);
    yield record;
    offset += record.length;
  }
  const cdSize = offset - cdOffset;
  const count = central.length;

  const countBig = forceZip64 || count >= MAX16;
  const cdSizeBig = forceZip64 || cdSize >= MAX32;
  const cdOffsetBig = forceZip64 || cdOffset >= MAX32;
  if (countBig || cdSizeBig || cdOffsetBig) {
    const record = new Uint8Array(56 + 20);
    const v = view(record);
    v.setUint32(0, SIG_ZIP64_EOCD, true);
    v.setBigUint64(4, 44n, true);
    v.setUint16(12, 45, true);
    v.setUint16(14, 45, true);
    v.setBigUint64(24, BigInt(count), true);
    v.setBigUint64(32, BigInt(count), true);
    v.setBigUint64(40, BigInt(cdSize), true);
    v.setBigUint64(48, BigInt(cdOffset), true);
    v.setUint32(56, SIG_ZIP64_LOCATOR, true);
    v.setBigUint64(64, BigInt(offset), true);
    v.setUint32(72, 1, true);
    yield record;
    offset += record.length;
  }
  const eocd = new Uint8Array(EOCD_SIZE);
  const v = view(eocd);
  v.setUint32(0, SIG_EOCD, true);
  v.setUint16(8, countBig ? MAX16 : count, true);
  v.setUint16(10, countBig ? MAX16 : count, true);
  v.setUint32(12, cdSizeBig ? MAX32 : cdSize, true);
  v.setUint32(16, cdOffsetBig ? MAX32 : cdOffset, true);
  yield eocd;
}

// ---------------------------------------------------------------------------------------------
// Helpers

const UTF8 = new TextDecoder("utf-8");
const UTF8_ENCODER = new TextEncoder();
// Code page 437, bytes 0x80–0xFF (names written without the UTF-8 flag).
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function cp437(bytes) {
  let out = "";
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return out;
}

function u16(b, o) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function u64(b, o) {
  const value = u32(b, o) + u32(b, o + 4) * 2 ** 32;
  if (!Number.isSafeInteger(value)) throw new Error("ZIP value too large");
  return value;
}
function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function* extraFields(extra) {
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = u16(extra, p);
    const length = u16(extra, p + 2);
    if (p + 4 + length > extra.length) return;
    yield [id, extra.subarray(p + 4, p + 4 + length)];
    p += 4 + length;
  }
}

function zip64Extra(values) {
  const extra = new Uint8Array(4 + values.length * 8);
  const v = view(extra);
  v.setUint16(0, 0x0001, true);
  v.setUint16(2, values.length * 8, true);
  values.forEach((value, i) => v.setBigUint64(4 + i * 8, BigInt(value), true));
  return extra;
}

/** DOS date and time fields (UTC, so the same input gives the same bytes on any machine). */
function toDos(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1980) return { date: (0 << 9) | (1 << 5) | 1, time: 0 };
  const year = Math.min(d.getUTCFullYear(), 2107);
  return {
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  };
}

function dosToMs(date, time) {
  if (!date) return null;
  return Date.UTC(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return UTF8_ENCODER.encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Expected bytes");
}

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Every chunk of an entry's data, as Uint8Arrays. */
async function* chunksOf(data) {
  if (typeof data === "function") data = await data();
  if (data == null) return;
  if (typeof data === "string" || data instanceof Uint8Array || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    yield toBytes(data);
    return;
  }
  if (typeof data.getReader === "function") {
    const reader = data.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        yield toBytes(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  if (typeof data[Symbol.asyncIterator] === "function" || typeof data[Symbol.iterator] === "function") {
    for await (const chunk of data) yield toBytes(chunk);
    return;
  }
  throw new TypeError("ZIP entry data must be bytes, a string, a stream or an iterable");
}

function streamOf(iterator) {
  return new ReadableStream(
    {
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      async cancel(reason) {
        await iterator.return?.(reason);
      },
    },
    { highWaterMark: 0 },
  );
}
