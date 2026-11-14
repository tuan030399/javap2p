import JSZip from 'jszip';
import { JarAssetImage, JarInspectResult, JarManifestInfo } from '../types/j2me';

export function parseManifestText(text: string): Record<string, string> {
  const cleanText = text.replace(/^\uFEFF/, '');
  const unfolded = cleanText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const props: Record<string, string> = {};
  for (const line of unfolded.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      props[key] = val;
    }
  }
  return props;
}

function getPropCaseInsensitive(props: Record<string, string>, targetKey: string): string {
  if (props[targetKey] !== undefined) return props[targetKey];
  const lower = targetKey.toLowerCase();
  for (const [k, v] of Object.entries(props)) {
    if (k.toLowerCase() === lower) return v;
  }
  return '';
}

export function extractManifestInfo(props: Record<string, string>, fallbackName: string): JarManifestInfo {
  const midlet1 = getPropCaseInsensitive(props, 'MIDlet-1');
  const parts = midlet1.split(',').map((s) => s.trim());
  const midletName =
    getPropCaseInsensitive(props, 'MIDlet-Name') ||
    parts[0] ||
    fallbackName.replace(/\.(jar|jad)$/i, '');
  const midletIconPath = parts[1] || getPropCaseInsensitive(props, 'MIDlet-Icon') || null;
  const midletClass = parts[2] || '';

  return {
    midletName,
    midletVendor: getPropCaseInsensitive(props, 'MIDlet-Vendor') || 'Không rõ nhà phát triển',
    midletVersion: getPropCaseInsensitive(props, 'MIDlet-Version') || '1.0',
    midletClass,
    midletIconPath: midletIconPath ? midletIconPath.replace(/^\/+/, '') : null,
    profile: getPropCaseInsensitive(props, 'MicroEdition-Profile') || 'MIDP-2.0',
    configuration: getPropCaseInsensitive(props, 'MicroEdition-Configuration') || 'CLDC-1.1',
    rawProperties: props,
  };
}

function uint8ToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function inspectJarBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  extraProps?: Record<string, string>
): Promise<JarInspectResult> {
  const zip = await JSZip.loadAsync(buffer);
  let manifestProps: Record<string, string> = {};

  const manifestPath = Object.keys(zip.files).find(
    (p) => !zip.files[p].dir && /(^|\/)meta-inf\/manifest\.mf$/i.test(p.replace(/\\/g, '/'))
  );
  const manifestEntry = manifestPath ? zip.file(manifestPath) : null;
  if (manifestEntry) {
    const text = await manifestEntry.async('text');
    manifestProps = parseManifestText(text);
  }
  if (extraProps) {
    manifestProps = { ...manifestProps, ...extraProps };
  }

  const manifest = extractManifestInfo(manifestProps, fileName);
  const classFiles: string[] = [];
  const imageAssets: JarAssetImage[] = [];
  const audioAssets: string[] = [];
  let totalFiles = 0;
  let iconDataUrl: string | null = null;

  const entries = Object.entries(zip.files);
  for (const [path, file] of entries) {
    if (file.dir) continue;
    totalFiles++;
    if (path.endsWith('.class')) {
      classFiles.push(path);
    } else if (/\.(png|gif|jpg|jpeg)$/i.test(path)) {
      const bytes = await file.async('uint8array');
      const lower = path.toLowerCase();
      const mime = lower.endsWith('.gif')
        ? 'image/gif'
        : lower.endsWith('.png')
          ? 'image/png'
          : 'image/jpeg';
      const dataUrl = uint8ToDataUrl(bytes, mime);
      if (imageAssets.length < 36) {
        imageAssets.push({ path, dataUrl });
      }
      const normPath = path.replace(/^\/+/, '').toLowerCase();
      const targetIcon = manifest.midletIconPath?.toLowerCase();
      if (targetIcon && normPath === targetIcon) {
        iconDataUrl = dataUrl;
      } else if (!iconDataUrl && /icon/i.test(normPath)) {
        iconDataUrl = dataUrl;
      }
    } else if (/\.(mid|midi|wav|amr|mp3|ogg)$/i.test(path)) {
      audioAssets.push(path);
    }
  }

  if (!iconDataUrl && imageAssets.length > 0) {
    iconDataUrl = imageAssets[0].dataUrl;
  }

  return {
    manifest,
    iconDataUrl,
    classFiles,
    imageAssets,
    audioAssets,
    totalFiles,
    totalSizeBytes: buffer.byteLength,
  };
}

// ============================================================================
// Programmatic JVM .class Assembler for Sample Playable MIDP 2.0 .JAR
// ============================================================================

class ByteWriter {
  private buf: number[] = [];

  u1(v: number) { this.buf.push(v & 0xff); }
  u2(v: number) { this.buf.push((v >> 8) & 0xff, v & 0xff); }
  u4(v: number) {
    this.buf.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  i4(v: number) { this.u4(v | 0); }
  bytes(arr: number[] | Uint8Array) {
    for (let i = 0; i < arr.length; i++) this.buf.push(arr[i] & 0xff);
  }
  strUtf8(s: string) {
    const enc = new TextEncoder().encode(s);
    this.u2(enc.length);
    this.bytes(enc);
  }
  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buf);
  }
  get length(): number {
    return this.buf.length;
  }
}

class MiniClassBuilder {
  private cp: { tag: number; write: (w: ByteWriter) => void }[] = [null!];
  private utf8Map = new Map<string, number>();
  private classMap = new Map<string, number>();
  private strMap = new Map<string, number>();
  private ntMap = new Map<string, number>();
  private fieldRefMap = new Map<string, number>();
  private methodRefMap = new Map<string, number>();
  private intMap = new Map<number, number>();

  private fields: { flags: number; nameIdx: number; descIdx: number }[] = [];
  private methods: { flags: number; nameIdx: number; descIdx: number; maxStack: number; maxLocals: number; code: Uint8Array }[] = [];

  private thisClass: string;
  private superClass: string;

  constructor(thisClass: string, superClass: string) {
    this.thisClass = thisClass;
    this.superClass = superClass;
    this.addClass(thisClass);
    this.addClass(superClass);
    this.addUtf8('Code');
  }

  addUtf8(s: string): number {
    const existing = this.utf8Map.get(s);
    if (existing) return existing;
    const idx = this.cp.length;
    this.cp.push({
      tag: 1,
      write: (w) => {
        w.u1(1);
        w.strUtf8(s);
      },
    });
    this.utf8Map.set(s, idx);
    return idx;
  }

  addInt(v: number): number {
    const existing = this.intMap.get(v);
    if (existing) return existing;
    const idx = this.cp.length;
    this.cp.push({
      tag: 3,
      write: (w) => {
        w.u1(3);
        w.i4(v);
      },
    });
    this.intMap.set(v, idx);
    return idx;
  }

  addClass(name: string): number {
    const existing = this.classMap.get(name);
    if (existing) return existing;
    const nIdx = this.addUtf8(name);
    const idx = this.cp.length;
    this.cp.push({
      tag: 7,
      write: (w) => {
        w.u1(7);
        w.u2(nIdx);
      },
    });
    this.classMap.set(name, idx);
    return idx;
  }

  addString(s: string): number {
    const existing = this.strMap.get(s);
    if (existing) return existing;
    const uIdx = this.addUtf8(s);
    const idx = this.cp.length;
    this.cp.push({
      tag: 8,
      write: (w) => {
        w.u1(8);
        w.u2(uIdx);
      },
    });
    this.strMap.set(s, idx);
    return idx;
  }

  addNameAndType(name: string, desc: string): number {
    const key = `${name}:${desc}`;
    const existing = this.ntMap.get(key);
    if (existing) return existing;
    const nIdx = this.addUtf8(name);
    const dIdx = this.addUtf8(desc);
    const idx = this.cp.length;
    this.cp.push({
      tag: 12,
      write: (w) => {
        w.u1(12);
        w.u2(nIdx);
        w.u2(dIdx);
      },
    });
    this.ntMap.set(key, idx);
    return idx;
  }

  addFieldRef(cls: string, name: string, desc: string): number {
    const key = `${cls}.${name}:${desc}`;
    const existing = this.fieldRefMap.get(key);
    if (existing) return existing;
    const cIdx = this.addClass(cls);
    const ntIdx = this.addNameAndType(name, desc);
    const idx = this.cp.length;
    this.cp.push({
      tag: 9,
      write: (w) => {
        w.u1(9);
        w.u2(cIdx);
        w.u2(ntIdx);
      },
    });
    this.fieldRefMap.set(key, idx);
    return idx;
  }

  addMethodRef(cls: string, name: string, desc: string): number {
    const key = `${cls}.${name}:${desc}`;
    const existing = this.methodRefMap.get(key);
    if (existing) return existing;
    const cIdx = this.addClass(cls);
    const ntIdx = this.addNameAndType(name, desc);
    const idx = this.cp.length;
    this.cp.push({
      tag: 10,
      write: (w) => {
        w.u1(10);
        w.u2(cIdx);
        w.u2(ntIdx);
      },
    });
    this.methodRefMap.set(key, idx);
    return idx;
  }

  addField(name: string, desc: string, flags = 0x0002) {
    this.fields.push({
      flags,
      nameIdx: this.addUtf8(name),
      descIdx: this.addUtf8(desc),
    });
  }

  addMethod(name: string, desc: string, maxStack: number, maxLocals: number, code: Uint8Array, flags = 0x0001) {
    this.methods.push({
      flags,
      nameIdx: this.addUtf8(name),
      descIdx: this.addUtf8(desc),
      maxStack,
      maxLocals,
      code,
    });
  }

  build(): Uint8Array {
    const w = new ByteWriter();
    w.u4(0xcafebabe);
    w.u2(0); // minor
    w.u2(48); // major (Java 1.4 / J2ME)

    w.u2(this.cp.length);
    for (let i = 1; i < this.cp.length; i++) {
      this.cp[i].write(w);
    }

    w.u2(0x0021); // ACC_PUBLIC | ACC_SUPER
    w.u2(this.addClass(this.thisClass));
    w.u2(this.addClass(this.superClass));
    w.u2(0); // interfaces

    w.u2(this.fields.length);
    for (const f of this.fields) {
      w.u2(f.flags);
      w.u2(f.nameIdx);
      w.u2(f.descIdx);
      w.u2(0); // attributes
    }

    const codeAttrNameIdx = this.addUtf8('Code');
    w.u2(this.methods.length);
    for (const m of this.methods) {
      w.u2(m.flags);
      w.u2(m.nameIdx);
      w.u2(m.descIdx);
      w.u2(1); // 1 attribute (Code)
      w.u2(codeAttrNameIdx);
      w.u4(12 + m.code.length);
      w.u2(m.maxStack);
      w.u2(m.maxLocals);
      w.u4(m.code.length);
      w.bytes(m.code);
      w.u2(0); // exception_table_length
      w.u2(0); // code attributes_count
    }

    w.u2(0); // class attributes
    return w.toUint8Array();
  }
}

class CodeEmitter {
  private bytes: number[] = [];
  private patches: { pos: number; label: string; base: number }[] = [];
  private labels = new Map<string, number>();

  op(opcode: number) { this.bytes.push(opcode & 0xff); }
  u1(v: number) { this.bytes.push(v & 0xff); }
  u2(v: number) { this.bytes.push((v >> 8) & 0xff, v & 0xff); }
  i1(v: number) { this.bytes.push(v & 0xff); }
  i2(v: number) { this.bytes.push((v >> 8) & 0xff, v & 0xff); }

  label(name: string) {
    this.labels.set(name, this.bytes.length);
  }

  branch(opcode: number, targetLabel: string) {
    const base = this.bytes.length;
    this.op(opcode);
    const pos = this.bytes.length;
    this.u2(0);
    this.patches.push({ pos, label: targetLabel, base });
  }

  pushConst(v: number, b: MiniClassBuilder) {
    if (v >= -1 && v <= 5) {
      this.op(0x03 + v);
    } else if (v >= -128 && v <= 127) {
      this.op(0x10);
      this.i1(v);
    } else if (v >= -32768 && v <= 32767) {
      this.op(0x11);
      this.i2(v);
    } else {
      const idx = b.addInt(v);
      this.op(0x13);
      this.u2(idx);
    }
  }

  ldcStr(s: string, b: MiniClassBuilder) {
    const idx = b.addString(s);
    if (idx < 256) {
      this.op(0x12);
      this.u1(idx);
    } else {
      this.op(0x13);
      this.u2(idx);
    }
  }

  toUint8Array(): Uint8Array {
    for (const p of this.patches) {
      const target = this.labels.get(p.label) ?? 0;
      const diff = target - p.base;
      this.bytes[p.pos] = (diff >> 8) & 0xff;
      this.bytes[p.pos + 1] = diff & 0xff;
    }
    return new Uint8Array(this.bytes);
  }
}

export async function createSamplePlayableJar(): Promise<{ buffer: ArrayBuffer; fileName: string }> {
  // 1. SampleMidlet extends MIDlet
  const midlet = new MiniClassBuilder('SampleMidlet', 'javax/microedition/midlet/MIDlet');
  const mInitSuper = midlet.addMethodRef('javax/microedition/midlet/MIDlet', '<init>', '()V');
  const mGetDisp = midlet.addMethodRef(
    'javax/microedition/lcdui/Display',
    'getDisplay',
    '(Ljavax/microedition/midlet/MIDlet;)Ljavax/microedition/lcdui/Display;'
  );
  const cCanvas = midlet.addClass('SampleCanvas');
  const mCanvasInit = midlet.addMethodRef('SampleCanvas', '<init>', '()V');
  const mSetCurr = midlet.addMethodRef(
    'javax/microedition/lcdui/Display',
    'setCurrent',
    '(Ljavax/microedition/lcdui/Displayable;)V'
  );

  {
    const c = new CodeEmitter();
    c.op(0x2a); // aload_0
    c.op(0xb7); c.u2(mInitSuper);
    c.op(0xb1); // return
    midlet.addMethod('<init>', '()V', 2, 1, c.toUint8Array());
  }
  {
    const c = new CodeEmitter();
    c.op(0x2a); // aload_0
    c.op(0xb8); c.u2(mGetDisp);
    c.op(0xbb); c.u2(cCanvas); // new SampleCanvas
    c.op(0x59); // dup
    c.op(0xb7); c.u2(mCanvasInit);
    c.op(0xb6); c.u2(mSetCurr);
    c.op(0xb1);
    midlet.addMethod('startApp', '()V', 4, 1, c.toUint8Array());
  }
  {
    const c = new CodeEmitter();
    c.op(0xb1);
    midlet.addMethod('pauseApp', '()V', 1, 1, c.toUint8Array());
  }
  {
    const c = new CodeEmitter();
    c.op(0xb1);
    midlet.addMethod('destroyApp', '(Z)V', 1, 2, c.toUint8Array());
  }

  // 2. SampleCanvas extends Canvas (Interactive Star Catcher Mini-Game)
  const canvas = new MiniClassBuilder('SampleCanvas', 'javax/microedition/lcdui/Canvas');
  canvas.addField('px', 'I');
  canvas.addField('py', 'I');
  canvas.addField('tx', 'I');
  canvas.addField('ty', 'I');
  canvas.addField('score', 'I');

  const fPx = canvas.addFieldRef('SampleCanvas', 'px', 'I');
  const fPy = canvas.addFieldRef('SampleCanvas', 'py', 'I');
  const fTx = canvas.addFieldRef('SampleCanvas', 'tx', 'I');
  const fTy = canvas.addFieldRef('SampleCanvas', 'ty', 'I');
  const fScore = canvas.addFieldRef('SampleCanvas', 'score', 'I');

  const mCanvSuper = canvas.addMethodRef('javax/microedition/lcdui/Canvas', '<init>', '()V');
  const mGetW = canvas.addMethodRef('SampleCanvas', 'getWidth', '()I');
  const mGetH = canvas.addMethodRef('SampleCanvas', 'getHeight', '()I');
  const mRepaint = canvas.addMethodRef('SampleCanvas', 'repaint', '()V');
  const mGetAction = canvas.addMethodRef('SampleCanvas', 'getGameAction', '(I)I');
  const mSetColor = canvas.addMethodRef('javax/microedition/lcdui/Graphics', 'setColor', '(I)V');
  const mFillRect = canvas.addMethodRef('javax/microedition/lcdui/Graphics', 'fillRect', '(IIII)V');
  const mDrawRect = canvas.addMethodRef('javax/microedition/lcdui/Graphics', 'drawRect', '(IIII)V');
  const mDrawStr = canvas.addMethodRef('javax/microedition/lcdui/Graphics', 'drawString', '(Ljava/lang/String;III)V');
  const mIntToStr = canvas.addMethodRef('java/lang/Integer', 'toString', '(I)Ljava/lang/String;');

  // <init>()
  {
    const c = new CodeEmitter();
    c.op(0x2a); c.op(0xb7); c.u2(mCanvSuper);
    c.op(0x2a); c.pushConst(104, canvas); c.op(0xb5); c.u2(fPx);
    c.op(0x2a); c.pushConst(220, canvas); c.op(0xb5); c.u2(fPy);
    c.op(0x2a); c.pushConst(108, canvas); c.op(0xb5); c.u2(fTx);
    c.op(0x2a); c.pushConst(90, canvas); c.op(0xb5); c.u2(fTy);
    c.op(0x2a); c.pushConst(0, canvas); c.op(0xb5); c.u2(fScore);
    c.op(0xb1);
    canvas.addMethod('<init>', '()V', 4, 1, c.toUint8Array());
  }

  // paint(Graphics g)
  {
    const c = new CodeEmitter();
    // Background #0D1522
    c.op(0x2b); c.pushConst(0x0d1522, canvas); c.op(0xb6); c.u2(mSetColor);
    c.op(0x2b); c.op(0x03); c.op(0x03);
    c.op(0x2a); c.op(0xb6); c.u2(mGetW);
    c.op(0x2a); c.op(0xb6); c.u2(mGetH);
    c.op(0xb6); c.u2(mFillRect);

    // Header bar #1B2738
    c.op(0x2b); c.pushConst(0x1b2738, canvas); c.op(0xb6); c.u2(mSetColor);
    c.op(0x2b); c.op(0x03); c.op(0x03);
    c.op(0x2a); c.op(0xb6); c.u2(mGetW);
    c.pushConst(34, canvas);
    c.op(0xb6); c.u2(mFillRect);

    // Title
    c.op(0x2b); c.pushConst(0x38bdf8, canvas); c.op(0xb6); c.u2(mSetColor);
    c.op(0x2b); c.ldcStr('JAVA MIDLET DEMO', canvas);
    c.pushConst(12, canvas); c.pushConst(10, canvas); c.pushConst(20, canvas);
    c.op(0xb6); c.u2(mDrawStr);

    // Score label & value
    c.op(0x2b); c.pushConst(0xf8fafc, canvas); c.op(0xb6); c.u2(mSetColor);
    c.op(0x2b); c.ldcStr('DIEM:', canvas);
    c.pushConst(12, canvas); c.pushConst(46, canvas); c.pushConst(20, canvas);
    c.op(0xb6); c.u2(mDrawStr);

    c.op(0x2b); c.pushConst(0xf59e0b, canvas); c.op(0xb6); c.u2(mSetColor);
    c.op(0x2b);
    c.op(0x2a); c.op(0xb4); c.u2(fScore);
    c.op(0xb8); c.u2(mIntToStr);
    c.pushConst(68, canvas); c.pushConst(46, canvas); c.pushConst(20, canvas);
    c.op(0xb6); c.u2(mDrawStr);

    // Target Gold Box (tx, ty, 24, 24)
    c.op(0x2b); c.pushConst(0xf59e0b, canvas); c.op(0xb6); c.u2(mSetColor);
    c.op(0x2b);
    c.op(0x2a); c.op(0xb4); c.u2(fTx);
    c.op(0x2a); c.op(0xb4); c.u2(fTy);
    c.pushConst(24, canvas); c.pushConst(24, canvas);
    c.op(0xb6); c.u2(mFillRect);

    c.op(0x2b); c.pushConst(0xfef3c7, canvas); c.op(0xb6); c.u2(mSetColor);
    c.op(0x2b);
    c.op(0x2a); c.op(0xb4); c.u2(fTx);
    c.op(0x2a); c.op(0xb4); c.u2(fTy);
    c.pushConst(24, canvas); c.pushConst(24, canvas);
    c.op(0xb6); c.u2(mDrawRect);

    // Player Emerald Ship (px, py, 32, 20)
    c.op(0x2b); c.pushConst(0x10b981, canvas); c.op(0xb6); c.u2(mSetColor);
    c.op(0x2b);
    c.op(0x2a); c.op(0xb4); c.u2(fPx);
    c.op(0x2a); c.op(0xb4); c.u2(fPy);
    c.pushConst(32, canvas); c.pushConst(20, canvas);
    c.op(0xb6); c.u2(mFillRect);

    // Footer instruction
    c.op(0x2b); c.pushConst(0x94a3b8, canvas); c.op(0xb6); c.u2(mSetColor);
    c.op(0x2b); c.ldcStr('D-PAD / OK: CHOI', canvas);
    c.pushConst(12, canvas);
    c.op(0x2a); c.op(0xb6); c.u2(mGetH);
    c.pushConst(26, canvas);
    c.op(0x64); // isub
    c.pushConst(20, canvas);
    c.op(0xb6); c.u2(mDrawStr);

    c.op(0xb1);
    canvas.addMethod('paint', '(Ljavax/microedition/lcdui/Graphics;)V', 6, 2, c.toUint8Array());
  }

  // keyPressed(int keyCode)
  {
    const c = new CodeEmitter();
    // int act = getGameAction(keyCode); store in local 2
    c.op(0x2a); c.op(0x1b); c.op(0xb6); c.u2(mGetAction);
    c.op(0x3d); // istore_2

    // if act == 1 (UP) -> py -= 14
    c.op(0x1c); c.pushConst(1, canvas); c.branch(0xa0, 'check_down');
    c.op(0x2a); c.op(0x2a); c.op(0xb4); c.u2(fPy); c.pushConst(14, canvas); c.op(0x64); c.op(0xb5); c.u2(fPy);

    c.label('check_down');
    c.op(0x1c); c.pushConst(6, canvas); c.branch(0xa0, 'check_left');
    c.op(0x2a); c.op(0x2a); c.op(0xb4); c.u2(fPy); c.pushConst(14, canvas); c.op(0x60); c.op(0xb5); c.u2(fPy);

    c.label('check_left');
    c.op(0x1c); c.pushConst(2, canvas); c.branch(0xa0, 'check_right');
    c.op(0x2a); c.op(0x2a); c.op(0xb4); c.u2(fPx); c.pushConst(14, canvas); c.op(0x64); c.op(0xb5); c.u2(fPx);

    c.label('check_right');
    c.op(0x1c); c.pushConst(5, canvas); c.branch(0xa0, 'check_fire');
    c.op(0x2a); c.op(0x2a); c.op(0xb4); c.u2(fPx); c.pushConst(14, canvas); c.op(0x60); c.op(0xb5); c.u2(fPx);

    c.label('check_fire');
    // Check collision or fire key (act == 8) -> add 10 score & relocate target
    c.op(0x1c); c.pushConst(8, canvas); c.branch(0xa0, 'check_hit');
    c.branch(0xa7, 'do_score');

    c.label('check_hit');
    // |px - tx| < 26 && |py - ty| < 24 -> score!
    c.op(0x2a); c.op(0xb4); c.u2(fPx);
    c.op(0x2a); c.op(0xb4); c.u2(fTx);
    c.op(0x64);
    c.pushConst(28, canvas);
    c.branch(0xa2, 'done'); // >= 28 -> done
    c.op(0x2a); c.op(0xb4); c.u2(fPx);
    c.op(0x2a); c.op(0xb4); c.u2(fTx);
    c.op(0x64);
    c.pushConst(-28, canvas);
    c.branch(0xa4, 'done'); // <= -28 -> done
    c.op(0x2a); c.op(0xb4); c.u2(fPy);
    c.op(0x2a); c.op(0xb4); c.u2(fTy);
    c.op(0x64);
    c.pushConst(24, canvas);
    c.branch(0xa2, 'done');
    c.op(0x2a); c.op(0xb4); c.u2(fPy);
    c.op(0x2a); c.op(0xb4); c.u2(fTy);
    c.op(0x64);
    c.pushConst(-24, canvas);
    c.branch(0xa4, 'done');

    c.label('do_score');
    c.op(0x2a); c.op(0x2a); c.op(0xb4); c.u2(fScore); c.pushConst(10, canvas); c.op(0x60); c.op(0xb5); c.u2(fScore);
    // Move tx = (tx + 53) % 180 + 20
    c.op(0x2a); c.op(0x2a); c.op(0xb4); c.u2(fTx); c.pushConst(53, canvas); c.op(0x60);
    c.pushConst(180, canvas); c.op(0x70); c.pushConst(20, canvas); c.op(0x60);
    c.op(0xb5); c.u2(fTx);
    // Move ty = (ty + 47) % 160 + 60
    c.op(0x2a); c.op(0x2a); c.op(0xb4); c.u2(fTy); c.pushConst(47, canvas); c.op(0x60);
    c.pushConst(160, canvas); c.op(0x70); c.pushConst(60, canvas); c.op(0x60);
    c.op(0xb5); c.u2(fTy);

    c.label('done');
    c.op(0x2a); c.op(0xb6); c.u2(mRepaint);
    c.op(0xb1);
    canvas.addMethod('keyPressed', '(I)V', 6, 3, c.toUint8Array());
  }

  const zip = new JSZip();
  zip.file(
    'META-INF/MANIFEST.MF',
    [
      'Manifest-Version: 1.0',
      'MIDlet-Name: StarCatcher MIDlet',
      'MIDlet-Version: 1.0.0',
      'MIDlet-Vendor: JavaDeck Demo',
      'MIDlet-1: StarCatcher MIDlet, , SampleMidlet',
      'MicroEdition-Profile: MIDP-2.0',
      'MicroEdition-Configuration: CLDC-1.1',
      '',
    ].join('\r\n')
  );
  zip.file('SampleMidlet.class', midlet.build());
  zip.file('SampleCanvas.class', canvas.build());

  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return { buffer: buf, fileName: 'StarCatcher_Demo.jar' };
}
