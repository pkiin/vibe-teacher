import zlib from 'node:zlib';

/** 배포 묶음용 최소 zip 쓰기·읽기. 외부 도구 없이 Windows 탐색기가 풀 수 있는 형식(deflate, 4GB·65535개 미만)만 다룬다. */
export interface ZipEntry {
  /** 폴더 구분은 `/`. 앞에 `/`·`..` 가 없는 상대 경로만 받는다 */
  name: string;
  data: Buffer;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8 = 0x0800;

function dosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function safeName(name: string): string {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`zip 항목 이름이 올바르지 않습니다: ${name}`);
  }
  return name;
}

export function createZip(entries: ZipEntry[], at = new Date()): Buffer {
  if (entries.length >= 0xffff) throw new Error('zip 항목이 너무 많습니다');
  const stamp = dosTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = Buffer.from(safeName(entry.name), 'utf8');
    if (seen.has(entry.name)) throw new Error(`zip 항목이 겹칩니다: ${entry.name}`);
    seen.add(entry.name);
    const crc = zlib.crc32(entry.data);
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 });
    const stored = deflated.length >= entry.data.length;
    const body = stored ? entry.data : deflated;
    if (body.length > 0xfffffffe || entry.data.length > 0xfffffffe || offset > 0xfffffffe) throw new Error('4GB 이상 zip 은 만들지 않습니다');
    const method = stored ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** 이름 → 압축 해제 함수. 필요한 항목만 풀고, CRC 가 다르면 실패한다. zip64 는 지원하지 않는다. */
export function readZip(buf: Buffer): Map<string, () => Buffer> {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === END) { end = i; break; }
  }
  if (end < 0) throw new Error('zip 파일이 아닙니다');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error('zip64 형식은 지원하지 않습니다');
  const entries = new Map<string, () => Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== CENTRAL) throw new Error('zip 목차가 올바르지 않습니다');
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (size === 0xffffffff || local === 0xffffffff) throw new Error('zip64 형식은 지원하지 않습니다');
    entries.set(name, () => {
      if (buf.readUInt32LE(local) !== LOCAL) throw new Error(`zip 항목 머리가 올바르지 않습니다: ${name}`);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const body = buf.subarray(start, start + size);
      const data = method === 0 ? Buffer.from(body) : method === 8 ? zlib.inflateRawSync(body) : null;
      if (!data) throw new Error(`지원하지 않는 압축 방식입니다: ${name}`);
      if (zlib.crc32(data) !== crc) throw new Error(`zip 항목이 손상되었습니다: ${name}`);
      return data;
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
