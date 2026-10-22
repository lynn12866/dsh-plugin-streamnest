import { BusinessError } from '../../../../shared/src/messages.js';
import { createReadStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const WECHAT_PREFIX_BYTES = 131_072;
const uint64 = (value: bigint) => BigInt.asUintN(64, value);

/** The platform uses unsigned 64-bit arithmetic and big-endian keystream words. */
export function wechatKeyStream(key: string, length: number): Buffer {
  if (!/^\d{1,20}$/.test(key) || BigInt(key) > 0xffffffffffffffffn)
    throw new BusinessError('WECHAT_KEY_INVALID');
  if (!Number.isInteger(length) || length < 0 || length > WECHAT_PREFIX_BYTES)
    throw new BusinessError('WECHAT_RANGE_INVALID');
  const seed = Array<bigint>(256).fill(0n);
  const memory = Array<bigint>(256).fill(0n);
  seed[0] = BigInt(key);
  let a = 0n,
    b = 0n,
    c = 0n;
  const mix = (values: bigint[]) => {
    const shifts = [9n, 9n, 23n, 15n, 14n, 20n, 17n, 14n];
    for (let i = 0; i < 8; i++) {
      const next = (i + 5) % 8,
        source = (i + 7) % 8;
      values[i] = uint64(values[i]! - values[(i + 4) % 8]!);
      const shift = i % 2 ? values[source]! << shifts[i]! : values[source]! >> shifts[i]!;
      values[next] = uint64(values[next]! ^ shift);
      values[source] = uint64(values[source]! + values[i]!);
    }
  };
  const values = Array<bigint>(8).fill(0x9e3779b97f4a7c13n);
  for (let i = 0; i < 4; i++) mix(values);
  for (const source of [seed, memory]) {
    for (let i = 0; i < 256; i += 8) {
      for (let j = 0; j < 8; j++) values[j] = uint64(values[j]! + source[i + j]!);
      mix(values);
      for (let j = 0; j < 8; j++) memory[i + j] = values[j]!;
    }
  }
  const generate = () => {
    c = uint64(c + 1n);
    b = uint64(b + c);
    for (let i = 0; i < 256; i++) {
      a = uint64(
        [() => ~(a ^ (a << 21n)), () => a ^ (a >> 5n), () => a ^ (a << 12n), () => a ^ (a >> 33n)][
          i % 4
        ]!(),
      );
      a = uint64(a + memory[(i + 128) % 256]!);
      const x = memory[i]!;
      const y = uint64(memory[Number((x >> 3n) & 255n)]! + a + b);
      memory[i] = y;
      b = uint64(memory[Number((y >> 11n) & 255n)]! + x);
      seed[i] = b;
    }
  };
  generate();
  let count = 255;
  const result = Buffer.alloc(length);
  for (let i = 0; i < length; i += 8) {
    const word = Buffer.allocUnsafe(8);
    word.writeBigUInt64BE(seed[count]!);
    word.copy(result, i, 0, Math.min(8, length - i));
    if (count === 0) {
      generate();
      count = 255;
    } else count--;
  }
  return result;
}

export function decodeWechatPrefix(bytes: Buffer, key: string): Buffer {
  const length = Math.min(bytes.length, WECHAT_PREFIX_BYTES);
  const mask = wechatKeyStream(key, length);
  const output = Buffer.from(bytes);
  for (let i = 0; i < length; i++) output[i] = output[i]! ^ mask[i]!;
  return output;
}

function isMP4(bytes: Buffer): boolean {
  return bytes.subarray(4, 8).toString('ascii') === 'ftyp';
}

/** Keep the encrypted download intact for resume; publish only a validated decoded copy. */
export async function decodeWechatFile(
  input: string,
  output: string,
  key: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const file = await open(input, 'r');
  const header = Buffer.alloc(16);
  let length: number;
  try {
    length = (await file.read(header, 0, header.length, 0)).bytesRead;
  } finally {
    await file.close();
  }
  const raw = header.subarray(0, length);
  const encrypted = !isMP4(raw);
  if (encrypted && (!key || !isMP4(decodeWechatPrefix(raw, key))))
    throw new BusinessError('WECHAT_INTEGRITY_FAILED');
  const mask = encrypted ? wechatKeyStream(key, WECHAT_PREFIX_BYTES) : undefined;
  let offset = 0;
  const decoder = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (mask && offset < mask.length) {
        const count = Math.min(chunk.length, mask.length - offset);
        for (let i = 0; i < count; i++) chunk[i] = chunk[i]! ^ mask[offset + i]!;
      }
      offset += chunk.length;
      callback(null, chunk);
    },
  });
  const destination = await open(output, 'wx', 0o600);
  try {
    await pipeline(createReadStream(input), decoder, destination.createWriteStream(), { signal });
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  } finally {
    await destination.close();
  }
}
