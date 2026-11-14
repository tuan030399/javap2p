export type ConstantPoolEntry =
  | { tag: 1; value: string } // Utf8
  | { tag: 3; value: number } // Integer
  | { tag: 4; value: number } // Float
  | { tag: 5; value: bigint } // Long
  | { tag: 6; value: number } // Double
  | { tag: 7; nameIndex: number } // Class
  | { tag: 8; stringIndex: number } // String
  | { tag: 9; classIndex: number; nameAndTypeIndex: number } // Fieldref
  | { tag: 10; classIndex: number; nameAndTypeIndex: number } // Methodref
  | { tag: 11; classIndex: number; nameAndTypeIndex: number } // InterfaceMethodref
  | { tag: 12; nameIndex: number; descriptorIndex: number } // NameAndType
  | { tag: 15; referenceKind: number; referenceIndex: number } // MethodHandle
  | { tag: 16; descriptorIndex: number } // MethodType
  | { tag: 18; bootstrapMethodAttrIndex: number; nameAndTypeIndex: number } // InvokeDynamic
  | null;

export interface ParsedField {
  accessFlags: number;
  name: string;
  descriptor: string;
  constantValue?: number | string;
}

export interface ExceptionHandler {
  startPc: number;
  endPc: number;
  handlerPc: number;
  catchType: number;
}

export interface ParsedMethod {
  accessFlags: number;
  name: string;
  descriptor: string;
  maxStack: number;
  maxLocals: number;
  code: Uint8Array | null;
  exceptionTable: ExceptionHandler[];
}

export interface ParsedClassFile {
  minorVersion: number;
  majorVersion: number;
  constantPool: ConstantPoolEntry[];
  accessFlags: number;
  thisClass: string;
  superClass: string;
  interfaces: string[];
  fields: ParsedField[];
  methods: ParsedMethod[];
}

class BinaryReader {
  private view: DataView;
  public offset = 0;

  constructor(buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  u1(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u2(): number {
    const v = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return v;
  }

  u4(): number {
    const v = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return v;
  }

  i4(): number {
    const v = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return v;
  }

  f4(): number {
    const v = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return v;
  }

  f8(): number {
    const v = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return v;
  }

  i8(): bigint {
    const v = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return v;
  }

  bytes(len: number): Uint8Array {
    const slice = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
    this.offset += len;
    return slice;
  }

  skip(len: number) {
    this.offset += len;
  }

  utf8(len: number): string {
    const raw = this.bytes(len);
    return new TextDecoder('utf-8', { fatal: false }).decode(raw);
  }
}

export function getCpUtf8(cp: ConstantPoolEntry[], index: number): string {
  const entry = cp[index];
  if (entry && entry.tag === 1) return entry.value;
  return '';
}

export function getCpClassName(cp: ConstantPoolEntry[], index: number): string {
  if (index === 0) return '';
  const entry = cp[index];
  if (entry && entry.tag === 7) {
    return getCpUtf8(cp, entry.nameIndex);
  }
  return '';
}

export function parseClassFile(bytes: Uint8Array): ParsedClassFile {
  const r = new BinaryReader(bytes);
  const magic = r.u4();
  if (magic !== 0xcafebabe) {
    throw new Error(`Tệp .class không hợp lệ (magic 0x${magic.toString(16)})`);
  }

  const minorVersion = r.u2();
  const majorVersion = r.u2();
  const cpCount = r.u2();
  const constantPool: ConstantPoolEntry[] = new Array(cpCount).fill(null);

  for (let i = 1; i < cpCount; i++) {
    const tag = r.u1();
    switch (tag) {
      case 1: {
        const len = r.u2();
        constantPool[i] = { tag: 1, value: r.utf8(len) };
        break;
      }
      case 3:
        constantPool[i] = { tag: 3, value: r.i4() };
        break;
      case 4:
        constantPool[i] = { tag: 4, value: r.f4() };
        break;
      case 5:
        constantPool[i] = { tag: 5, value: r.i8() };
        i++; // Long occupies 2 slots
        break;
      case 6:
        constantPool[i] = { tag: 6, value: r.f8() };
        i++; // Double occupies 2 slots
        break;
      case 7:
        constantPool[i] = { tag: 7, nameIndex: r.u2() };
        break;
      case 8:
        constantPool[i] = { tag: 8, stringIndex: r.u2() };
        break;
      case 9:
      case 10:
      case 11:
        constantPool[i] = { tag, classIndex: r.u2(), nameAndTypeIndex: r.u2() };
        break;
      case 12:
        constantPool[i] = { tag: 12, nameIndex: r.u2(), descriptorIndex: r.u2() };
        break;
      case 15:
        constantPool[i] = { tag: 15, referenceKind: r.u1(), referenceIndex: r.u2() };
        break;
      case 16:
        constantPool[i] = { tag: 16, descriptorIndex: r.u2() };
        break;
      case 18:
        constantPool[i] = { tag: 18, bootstrapMethodAttrIndex: r.u2(), nameAndTypeIndex: r.u2() };
        break;
      default:
        throw new Error(`Tag ConstantPool không hỗ trợ: ${tag}`);
    }
  }

  const accessFlags = r.u2();
  const thisClass = getCpClassName(constantPool, r.u2());
  const superClass = getCpClassName(constantPool, r.u2());

  const ifaceCount = r.u2();
  const interfaces: string[] = [];
  for (let i = 0; i < ifaceCount; i++) {
    interfaces.push(getCpClassName(constantPool, r.u2()));
  }

  const fieldsCount = r.u2();
  const fields: ParsedField[] = [];
  for (let i = 0; i < fieldsCount; i++) {
    const fFlags = r.u2();
    const fName = getCpUtf8(constantPool, r.u2());
    const fDesc = getCpUtf8(constantPool, r.u2());
    const attrCount = r.u2();
    let constantValue: number | string | undefined;
    for (let a = 0; a < attrCount; a++) {
      const attrName = getCpUtf8(constantPool, r.u2());
      const attrLen = r.u4();
      if (attrName === 'ConstantValue' && attrLen === 2) {
        const cvIdx = r.u2();
        const cvEntry = constantPool[cvIdx];
        if (cvEntry && cvEntry.tag === 3) constantValue = cvEntry.value;
        else if (cvEntry && cvEntry.tag === 8) constantValue = getCpUtf8(constantPool, cvEntry.stringIndex);
      } else {
        r.skip(attrLen);
      }
    }
    fields.push({ accessFlags: fFlags, name: fName, descriptor: fDesc, constantValue });
  }

  const methodsCount = r.u2();
  const methods: ParsedMethod[] = [];
  for (let i = 0; i < methodsCount; i++) {
    const mFlags = r.u2();
    const mName = getCpUtf8(constantPool, r.u2());
    const mDesc = getCpUtf8(constantPool, r.u2());
    const attrCount = r.u2();
    let maxStack = 0;
    let maxLocals = 0;
    let code: Uint8Array | null = null;
    const exceptionTable: ExceptionHandler[] = [];

    for (let a = 0; a < attrCount; a++) {
      const attrName = getCpUtf8(constantPool, r.u2());
      const attrLen = r.u4();
      if (attrName === 'Code') {
        const endOffset = r.offset + attrLen;
        maxStack = r.u2();
        maxLocals = r.u2();
        const codeLen = r.u4();
        code = new Uint8Array(r.bytes(codeLen));
        const exLen = r.u2();
        for (let e = 0; e < exLen; e++) {
          exceptionTable.push({
            startPc: r.u2(),
            endPc: r.u2(),
            handlerPc: r.u2(),
            catchType: r.u2(),
          });
        }
        r.offset = endOffset;
      } else {
        r.skip(attrLen);
      }
    }

    methods.push({
      accessFlags: mFlags,
      name: mName,
      descriptor: mDesc,
      maxStack,
      maxLocals,
      code,
      exceptionTable,
    });
  }

  return {
    minorVersion,
    majorVersion,
    constantPool,
    accessFlags,
    thisClass,
    superClass,
    interfaces,
    fields,
    methods,
  };
}
