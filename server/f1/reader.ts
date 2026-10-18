// Sequential little-endian reader over one UDP packet. All F1 25 data is packed
// with no padding, so fields are read back to back in spec order.

const utf8 = new TextDecoder('utf-8');

export class Reader {
  offset: number;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  u8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  i8(): number {
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  u64(): bigint {
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  f32(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** Fixed-size, null-terminated UTF-8 string field. */
  str(size: number): string {
    const raw = this.bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    const end = raw.indexOf(0);
    return utf8.decode(end === -1 ? raw : raw.subarray(0, end));
  }

  skip(size: number): void {
    this.offset += size;
  }

  u8s(count: number): number[] {
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) out[i] = this.u8();
    return out;
  }

  u16s(count: number): number[] {
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) out[i] = this.u16();
    return out;
  }

  f32s(count: number): number[] {
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) out[i] = this.f32();
    return out;
  }
}

/** Sequential little-endian writer, the mirror of Reader. Used by the demo feed and tests. */
export class Writer {
  offset = 0;
  readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u8(v: number): void {
    this.view.setUint8(this.offset, v);
    this.offset += 1;
  }

  i8(v: number): void {
    this.view.setInt8(this.offset, v);
    this.offset += 1;
  }

  u16(v: number): void {
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
  }

  i16(v: number): void {
    this.view.setInt16(this.offset, v, true);
    this.offset += 2;
  }

  u32(v: number): void {
    this.view.setUint32(this.offset, v, true);
    this.offset += 4;
  }

  u64(v: bigint): void {
    this.view.setBigUint64(this.offset, v, true);
    this.offset += 8;
  }

  f32(v: number): void {
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
  }

  str(v: string, size: number): void {
    const encoded = new TextEncoder().encode(v).subarray(0, size - 1);
    this.bytes.set(encoded, this.offset);
    this.offset += size;
  }

  skip(size: number): void {
    this.offset += size;
  }
}
