import JSZip from 'jszip';
import { J2MEKey, JarInspectResult, SoftkeyLabels, VmRuntimeState } from '../types/j2me';
import {
  ConstantPoolEntry,
  ParsedClassFile,
  ParsedMethod,
  getCpClassName,
  getCpUtf8,
  parseClassFile,
} from './classParser';
import {
  J2MEImageData,
  createBlankImage,
  createImageFromBytes,
  createRgbImage,
  drawTransformedRegion,
} from './imageDecode';

type JvmValue = number | bigint | string | null | JvmObject | JvmArray;

interface JvmStreamData {
  data: Uint8Array;
  pos: number;
  mark: number;
}

interface JvmOutStreamData {
  bytes: number[];
}

interface JvmObjectInternal {
  commands?: JvmObject[];
  cmdListener?: JvmObject;
  title?: string;
  items?: string[];
  vec?: JvmValue[];
  map?: Map<string, { key: JvmValue; value: JvmValue }>;
  runnable?: JvmObject;
  str?: string;
  stream?: JvmStreamData;
  outStream?: JvmOutStreamData;
  recordStoreName?: string;
  timerCancelled?: boolean;
  hashId?: number;
}

interface JvmObject {
  __type: 'object';
  className: string;
  fields: Record<string, JvmValue>;
  internal?: JvmObjectInternal;
  nativeData?: unknown;
}

interface JvmArray {
  __type: 'array';
  elementType: string;
  items: JvmValue[];
}

interface VmFrame {
  cls: ParsedClassFile;
  method: ParsedMethod;
  pc: number;
  locals: JvmValue[];
  stack: JvmValue[];
}

interface VmThread {
  id: number;
  frames: VmFrame[];
  sleepUntil: number;
  repeatIntervalMs?: number;
  timerTaskObj?: JvmObject;
  finished: boolean;
}

interface CanvasGraphicState {
  color: string;
  rgb: number;
  tx: number;
  ty: number;
  fontSize: number;
  fontBold: boolean;
  clipX: number;
  clipY: number;
  clipW: number;
  clipH: number;
  strokeStyle: number;
  ctx: CanvasRenderingContext2D;
}

const ANCHOR_HCENTER = 1;
const ANCHOR_VCENTER = 2;
const ANCHOR_LEFT = 4;
const ANCHOR_RIGHT = 8;
const ANCHOR_TOP = 16;
const ANCHOR_BOTTOM = 32;
const ANCHOR_BASELINE = 64;

function isObject(v: JvmValue | undefined): v is JvmObject {
  return typeof v === 'object' && v !== null && '__type' in v && v.__type === 'object';
}

function isArray(v: JvmValue | undefined): v is JvmArray {
  return typeof v === 'object' && v !== null && '__type' in v && v.__type === 'array';
}

function parseDescriptorParamTypes(descriptor: string): string[] {
  const params: string[] = [];
  let i = 1;
  while (i < descriptor.length && descriptor[i] !== ')') {
    const start = i;
    const ch = descriptor[i];
    if (ch === 'L') {
      i = descriptor.indexOf(';', i) + 1;
    } else if (ch === '[') {
      while (descriptor[i] === '[') i++;
      if (descriptor[i] === 'L') i = descriptor.indexOf(';', i) + 1;
      else i++;
    } else {
      i++;
    }
    params.push(descriptor.slice(start, i));
  }
  return params;
}

function buildMethodLocals(
  descriptor: string,
  receiver: JvmValue | null,
  isStatic: boolean,
  args: JvmValue[]
): JvmValue[] {
  const locals: JvmValue[] = [];
  if (!isStatic) locals.push(receiver);
  const paramTypes = parseDescriptorParamTypes(descriptor);
  for (let i = 0; i < args.length; i++) {
    locals.push(args[i]);
    const t = paramTypes[i];
    if (t === 'J' || t === 'D') {
      locals.push(0); // 64-bit types occupy 2 local slots in JVM spec
    }
  }
  return locals;
}

function rgbToCss(rgb: number): string {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return `rgb(${r},${g},${b})`;
}

function createMultiArray(dims: number[], typeDesc: string): JvmArray {
  const len = Math.max(0, dims[0] | 0);
  if (dims.length <= 1) {
    const def: JvmValue = typeDesc.startsWith('L') || typeDesc.startsWith('[') ? null : 0;
    return { __type: 'array', elementType: typeDesc, items: new Array(len).fill(def) };
  }
  const items: JvmValue[] = new Array(len);
  const rest = dims.slice(1);
  for (let i = 0; i < len; i++) {
    items[i] = createMultiArray(rest, typeDesc.slice(1));
  }
  return { __type: 'array', elementType: typeDesc, items };
}

function decodeJavaModifiedUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }
}

export class J2MEVirtualMachine {
  private zip: JSZip | null = null;
  private classes = new Map<string, ParsedClassFile>();
  private staticFields = new Map<string, Record<string, JvmValue>>();
  private initializedClasses = new Set<string>();
  private imageCache = new Map<string, J2MEImageData>();
  private rawResources = new Map<string, Uint8Array>();

  private midletObj: JvmObject | null = null;
  private currentDisplayable: JvmObject | null = null;
  private threads: VmThread[] = [];
  private nextThreadId = 1;
  private nextHashId = 1000;
  private needsRepaint = true;

  private width = 240;
  private height = 320;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;

  private state: VmRuntimeState = {
    status: 'idle',
    currentScreen: 'Chưa khởi chạy',
    instructionsExecuted: 0,
    logs: [],
  };

  private manifestProps: Record<string, string> = {};
  private onStateChange?: (state: VmRuntimeState) => void;
  private heldKeyFlags = 0;

  constructor(width: number, height: number, onStateChange?: (state: VmRuntimeState) => void) {
    this.width = width;
    this.height = height;
    this.onStateChange = onStateChange;
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = width;
    this.offscreenCanvas.height = height;
    const ctx = this.offscreenCanvas.getContext('2d');
    if (!ctx) throw new Error('Không thể khởi tạo Canvas 2D cho J2ME VM.');
    this.offscreenCtx = ctx;
    this.seedBuiltinStatics();
  }

  private seedBuiltinStatics() {
    this.staticFields.set('java/lang/System', {
      out: this.createObject('java/io/PrintStream'),
      err: this.createObject('java/io/PrintStream'),
    });
    this.staticFields.set('javax/microedition/lcdui/Canvas', {
      UP: 1, LEFT: 2, RIGHT: 5, DOWN: 6, FIRE: 8,
      GAME_A: 9, GAME_B: 10, GAME_C: 11, GAME_D: 12,
      KEY_NUM0: 48, KEY_NUM1: 49, KEY_NUM2: 50, KEY_NUM3: 51, KEY_NUM4: 52,
      KEY_NUM5: 53, KEY_NUM6: 54, KEY_NUM7: 55, KEY_NUM8: 56, KEY_NUM9: 57,
      KEY_STAR: 42, KEY_POUND: 35,
    });
    this.staticFields.set('javax/microedition/lcdui/Graphics', {
      HCENTER: 1, VCENTER: 2, LEFT: 4, RIGHT: 8, TOP: 16, BOTTOM: 32, BASELINE: 64,
      SOLID: 0, DOTTED: 1,
    });
    this.staticFields.set('javax/microedition/lcdui/Font', {
      FACE_SYSTEM: 0, FACE_MONOSPACE: 32, FACE_PROPORTIONAL: 64,
      STYLE_PLAIN: 0, STYLE_BOLD: 1, STYLE_ITALIC: 2, STYLE_UNDERLINED: 4,
      SIZE_MEDIUM: 0, SIZE_SMALL: 8, SIZE_LARGE: 16,
      FONT_STATIC_TEXT: 0, FONT_INPUT_TEXT: 1,
    });
    this.staticFields.set('javax/microedition/lcdui/Command', {
      SCREEN: 1, BACK: 2, CANCEL: 3, OK: 4, HELP: 5, STOP: 6, EXIT: 7, ITEM: 8,
    });
    this.staticFields.set('javax/microedition/lcdui/game/Sprite', {
      TRANS_NONE: 0, TRANS_MIRROR_ROT180: 1, TRANS_MIRROR: 2, TRANS_ROT180: 3,
      TRANS_MIRROR_ROT270: 4, TRANS_ROT90: 5, TRANS_ROT270: 6, TRANS_MIRROR_ROT90: 7,
    });
    this.staticFields.set('javax/microedition/lcdui/TextField', {
      ANY: 0, EMAILADDR: 1, NUMERIC: 2, PHONENUMBER: 3, URL: 4, DECIMAL: 5,
      PASSWORD: 0x10000, UNEDITABLE: 0x20000,
    });
    this.staticFields.set('javax/microedition/lcdui/Choice', {
      EXCLUSIVE: 1, MULTIPLE: 2, IMPLICIT: 3, POPUP: 4,
    });
    this.staticFields.set('java/lang/Integer', {
      MAX_VALUE: 2147483647, MIN_VALUE: -2147483648,
    });
    this.staticFields.set('java/lang/Long', {
      MAX_VALUE: 9223372036854775807n, MIN_VALUE: -9223372036854775808n,
    });
    this.staticFields.set('java/lang/Short', {
      MAX_VALUE: 32767, MIN_VALUE: -32768,
    });
    this.staticFields.set('java/lang/Byte', {
      MAX_VALUE: 127, MIN_VALUE: -128,
    });
    this.staticFields.set('com/nokia/mid/ui/FullCanvas', {
      KEY_SOFTKEY1: -6, KEY_SOFTKEY2: -7, KEY_SOFTKEY3: -5,
      KEY_UP_ARROW: -1, KEY_DOWN_ARROW: -2, KEY_LEFT_ARROW: -3, KEY_RIGHT_ARROW: -4,
      KEY_SEND: -10, KEY_END: -11,
    });
  }

  public setDimensions(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.offscreenCanvas.width = width;
    this.offscreenCanvas.height = height;
    this.needsRepaint = true;
  }

  public getState(): VmRuntimeState {
    return { ...this.state };
  }

  private emitState() {
    if (this.onStateChange) {
      this.onStateChange({ ...this.state, logs: [...this.state.logs] });
    }
  }

  private log(msg: string) {
    this.state.logs.push(msg);
    if (this.state.logs.length > 50) {
      this.state.logs.shift();
    }
  }

  public async loadJar(buffer: ArrayBuffer, inspect: JarInspectResult): Promise<void> {
    this.zip = await JSZip.loadAsync(buffer);
    this.classes.clear();
    this.staticFields.clear();
    this.seedBuiltinStatics();
    this.initializedClasses.clear();
    this.imageCache.clear();
    this.rawResources.clear();
    this.threads = [];
    this.midletObj = null;
    this.currentDisplayable = null;
    this.manifestProps = inspect.manifest.rawProperties;

    this.state = {
      status: 'running',
      currentScreen: inspect.manifest.midletName || 'MIDlet',
      instructionsExecuted: 0,
      logs: [`Nạp tệp .JAR: ${inspect.manifest.midletName} (${inspect.classFiles.length} lớp)`],
    };

    const entries = Object.entries(this.zip.files);
    for (const [path, file] of entries) {
      if (file.dir) continue;
      const bytes = await file.async('uint8array');
      const normalized = path.startsWith('/') ? path : `/${path}`;
      this.rawResources.set(normalized, bytes);
      this.rawResources.set(normalized.toLowerCase(), bytes);

      if (path.endsWith('.class')) {
        try {
          const parsed = parseClassFile(bytes);
          this.classes.set(parsed.thisClass, parsed);
        } catch (err) {
          this.log(`Bỏ qua lớp lỗi ${path}: ${(err as Error).message}`);
        }
      } else if (/\.(png|gif|jpg|jpeg)$/i.test(path)) {
        const imgData = createImageFromBytes(bytes, () => {
          this.needsRepaint = true;
        });
        this.imageCache.set(normalized, imgData);
      }
    }

    // Small settle tick so preloaded icon/splash images decode before startApp
    await new Promise((r) => setTimeout(r, 40));

    let mainClassDot = inspect.manifest.midletClass.trim();
    if (!mainClassDot) {
      // Auto-detect any class extending javax/microedition/midlet/MIDlet
      for (const parsed of this.classes.values()) {
        if (this.isSubclass(parsed.thisClass, 'javax/microedition/midlet/MIDlet')) {
          mainClassDot = parsed.thisClass.replace(/\//g, '.');
          this.log(`Tự động phát hiện lớp MIDlet: ${mainClassDot}`);
          break;
        }
      }
    }

    if (!mainClassDot) {
      const mainClassProp = Object.entries(inspect.manifest.rawProperties).find(
        ([k]) => k.toLowerCase() === 'main-class'
      )?.[1];
      const hasDesktopMain = Array.from(this.classes.values()).some((c) =>
        c.methods.some((m) => m.name === 'main' && m.descriptor === '([Ljava/lang/String;)V')
      );
      if (mainClassProp || hasDesktopMain) {
        this.failVm(
          'Tệp .JAR này là ứng dụng Java PC (Java SE dùng hàm main), không phải game Java điện thoại (J2ME MIDlet).'
        );
        return;
      }
      this.failVm('Không tìm thấy thuộc tính MIDlet-1 trong MANIFEST.MF hoặc lớp MIDlet hợp lệ.');
      return;
    }

    const mainClassInternal = mainClassDot.replace(/\./g, '/');
    const cls = this.classes.get(mainClassInternal);
    if (!cls) {
      this.failVm(`Không tìm thấy lớp chính "${mainClassDot}" trong tệp .JAR.`);
      return;
    }

    try {
      this.ensureClassInit(cls.thisClass);
      const midlet = this.createObject(cls.thisClass);
      this.midletObj = midlet;
      this.runMethodSync(cls.thisClass, '<init>', '()V', [midlet], 120000);
      this.runMethodSync(cls.thisClass, 'startApp', '()V', [midlet], 250000);
      this.needsRepaint = true;
      this.log(`Khởi chạy startApp() trên ${mainClassDot}`);
      this.emitState();
    } catch (err) {
      this.handleVmException(err);
    }
  }

  private failVm(reason: string, missingApi?: string) {
    this.state.status = 'error';
    this.state.errorReason = reason;
    this.state.missingApi = missingApi;
    this.log(`Lỗi VM: ${reason}${missingApi ? ` (${missingApi})` : ''}`);
    this.emitState();
  }

  private handleVmException(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const missingMatch = msg.match(/API_UNSUPPORTED:(.+)/);
    if (missingMatch) {
      this.failVm(
        `Game gọi phương thức hoặc thư viện chưa có trong trình giả lập JS.`,
        missingMatch[1]
      );
    } else {
      this.failVm(msg);
    }
  }

  public pause() {
    if (this.state.status === 'running') {
      this.state.status = 'paused';
      if (this.midletObj) {
        try {
          this.runMethodSync(this.midletObj.className, 'pauseApp', '()V', [this.midletObj], 30000);
        } catch {
          // ignore
        }
      }
      this.emitState();
    }
  }

  public resume() {
    if (this.state.status === 'paused') {
      this.state.status = 'running';
      if (this.midletObj) {
        try {
          this.runMethodSync(this.midletObj.className, 'startApp', '()V', [this.midletObj], 60000);
        } catch {
          // ignore
        }
      }
      this.needsRepaint = true;
      this.emitState();
    }
  }

  public onKeyDown(keyCode: number) {
    this.updateGameKeyFlag(keyCode, true);
    if (this.state.status !== 'running' || !this.currentDisplayable) return;
    const disp = this.currentDisplayable;

    if (
      (disp.className === 'javax/microedition/lcdui/Alert' ||
        disp.className === 'javax/microedition/lcdui/Form' ||
        disp.className === 'javax/microedition/lcdui/TextBox' ||
        disp.className === 'javax/microedition/lcdui/List') &&
      !this.findMethod(disp.className, 'keyPressed', '(I)V')
    ) {
      if (keyCode === J2MEKey.SOFT_LEFT || keyCode === J2MEKey.FIRE) {
        this.triggerCommandOnDisplayable(disp, 0);
      } else if (keyCode === J2MEKey.SOFT_RIGHT) {
        this.triggerCommandOnDisplayable(disp, 1);
      }
      return;
    }

    try {
      const m = this.findMethod(disp.className, 'keyPressed', '(I)V');
      if (m) {
        this.runMethodSync(m.cls.thisClass, 'keyPressed', '(I)V', [disp, keyCode], 80000);
        this.needsRepaint = true;
      }
    } catch (err) {
      this.handleVmException(err);
    }
  }

  public onKeyUp(keyCode: number) {
    this.updateGameKeyFlag(keyCode, false);
    if (this.state.status !== 'running' || !this.currentDisplayable) return;
    const disp = this.currentDisplayable;
    try {
      const m = this.findMethod(disp.className, 'keyReleased', '(I)V');
      if (m) {
        this.runMethodSync(m.cls.thisClass, 'keyReleased', '(I)V', [disp, keyCode], 50000);
      }
    } catch {
      // ignore
    }
  }

  private updateGameKeyFlag(keyCode: number, down: boolean) {
    let bit = 0;
    if (keyCode === J2MEKey.UP || keyCode === J2MEKey.KEY_2) bit = 1 << 1;
    else if (keyCode === J2MEKey.LEFT || keyCode === J2MEKey.KEY_4) bit = 1 << 2;
    else if (keyCode === J2MEKey.RIGHT || keyCode === J2MEKey.KEY_6) bit = 1 << 5;
    else if (keyCode === J2MEKey.DOWN || keyCode === J2MEKey.KEY_8) bit = 1 << 6;
    else if (keyCode === J2MEKey.FIRE || keyCode === J2MEKey.KEY_5) bit = 1 << 8;
    if (bit) {
      if (down) this.heldKeyFlags |= bit;
      else this.heldKeyFlags &= ~bit;
    }
  }

  private triggerCommandOnDisplayable(disp: JvmObject, cmdIndex: number) {
    const cmds = disp.internal?.commands || [];
    const listener = disp.internal?.cmdListener || null;
    if (listener && cmds[cmdIndex]) {
      try {
        this.runMethodSync(
          listener.className,
          'commandAction',
          '(Ljavax/microedition/lcdui/Command;Ljavax/microedition/lcdui/Displayable;)V',
          [listener, cmds[cmdIndex], disp],
          60000
        );
      } catch (err) {
        this.handleVmException(err);
      }
    }
  }

  public getSoftkeys(): SoftkeyLabels {
    if (this.state.status === 'error') {
      return { left: 'Chi tiết', center: 'Thử lại', right: 'Thoát' };
    }
    const cmds = this.currentDisplayable?.internal?.commands;
    if (cmds && cmds.length > 0) {
      return {
        left: cmds[0]?.internal?.title || 'Chọn',
        center: 'OK',
        right: cmds[1]?.internal?.title || 'Quay lại',
      };
    }
    return { left: 'Menu', center: 'Chọn', right: 'Quay lại' };
  }

  public tick(ctx: CanvasRenderingContext2D) {
    if (this.state.status === 'error') {
      this.renderErrorScreen(ctx);
      return;
    }

    if (this.state.status === 'running') {
      const now = performance.now();
      for (const t of this.threads) {
        if (t.finished || t.sleepUntil > now) continue;
        try {
          this.stepThread(t, 40000);
          if (t.finished && t.repeatIntervalMs && t.timerTaskObj && !t.timerTaskObj.internal?.timerCancelled) {
            const found = this.findMethod(t.timerTaskObj.className, 'run', '()V');
            if (found && found.method.code) {
              t.finished = false;
              t.sleepUntil = now + t.repeatIntervalMs;
              t.frames = [
                {
                  cls: found.cls,
                  method: found.method,
                  pc: 0,
                  locals: [t.timerTaskObj],
                  stack: [],
                },
              ];
            }
          }
        } catch (err) {
          t.finished = true;
          this.handleVmException(err);
          break;
        }
      }
      this.threads = this.threads.filter((t) => !t.finished);
    }

    if (this.needsRepaint && this.currentDisplayable && this.state.status === 'running') {
      this.needsRepaint = false;
      const disp = this.currentDisplayable;
      const gObj = this.createGraphicsObject(this.offscreenCtx);
      try {
        const paintMethod = this.findMethod(disp.className, 'paint', '(Ljavax/microedition/lcdui/Graphics;)V');
        if (paintMethod) {
          this.offscreenCtx.save();
          this.runMethodSync(
            paintMethod.cls.thisClass,
            'paint',
            '(Ljavax/microedition/lcdui/Graphics;)V',
            [disp, gObj],
            120000
          );
          this.offscreenCtx.restore();
        } else {
          this.renderNativeDisplayable(disp, this.offscreenCtx);
        }
      } catch (err) {
        try {
          this.offscreenCtx.restore();
        } catch {
          // ignore
        }
        this.handleVmException(err);
      }
    }

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.offscreenCanvas, 0, 0);

    if (this.state.status === 'paused') {
      ctx.fillStyle = 'rgba(10, 12, 16, 0.72)';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = '#F59E0B';
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TẠM DỪNG', this.width / 2, this.height / 2);
      ctx.textAlign = 'left';
    }
  }

  private renderNativeDisplayable(disp: JvmObject, ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#12151C';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 13px "Plus Jakarta Sans", sans-serif';
    const title = String(disp.internal?.title || this.state.currentScreen || 'MIDlet');
    ctx.fillText(title, 12, 24);
    ctx.fillStyle = '#334155';
    ctx.fillRect(12, 32, this.width - 24, 1);

    const items = disp.internal?.items || [];
    ctx.font = '12px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#CBD5E1';
    let y = 54;
    for (const line of items) {
      this.wrapCanvasText(ctx, line, 12, y, this.width - 24, 17);
      y += 22;
    }
  }

  private renderErrorScreen(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#0F131A';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = '#1E2430';
    ctx.fillRect(8, 12, this.width - 16, this.height - 24);
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 1;
    ctx.strokeRect(8.5, 12.5, this.width - 17, this.height - 25);

    ctx.fillStyle = '#F59E0B';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText('THÔNG BÁO MÁY ẢO J2ME', 16, 34);

    ctx.fillStyle = '#E2E8F0';
    ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(this.state.currentScreen.slice(0, 26), 16, 56);

    ctx.fillStyle = '#CBD5E1';
    ctx.font = '11px "Plus Jakarta Sans", sans-serif';
    const reason = this.state.errorReason || 'Không thể tiếp tục thực thi bytecode.';
    const nextY = this.wrapCanvasText(ctx, reason, 16, 78, this.width - 32, 15);

    if (this.state.missingApi) {
      ctx.fillStyle = '#38BDF8';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText('Chi tiết API:', 16, Math.max(nextY + 10, 146));
      this.wrapCanvasText(ctx, this.state.missingApi, 16, Math.max(nextY + 25, 161), this.width - 32, 13);
    }

    ctx.fillStyle = '#94A3B8';
    ctx.font = '10px "Plus Jakarta Sans", sans-serif';
    this.wrapCanvasText(
      ctx,
      'Mẹo: Xem tài nguyên ảnh & MANIFEST.MF ở bảng bên phải, hoặc dùng .JAR mẫu chuẩn MIDP 2.0.',
      16,
      this.height - 62,
      this.width - 32,
      14
    );
  }

  private wrapCanvasText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxW: number,
    lineH: number
  ): number {
    const words = text.split(/\s+/);
    let line = '';
    let curY = y;

    const flushLine = (txt: string) => {
      if (!txt) return;
      ctx.fillText(txt, x, curY);
      curY += lineH;
    };

    for (const w of words) {
      if (ctx.measureText(w).width > maxW) {
        if (line) {
          flushLine(line);
          line = '';
        }
        let chunk = '';
        for (const ch of w) {
          if (ctx.measureText(chunk + ch).width > maxW && chunk) {
            flushLine(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
        continue;
      }
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        flushLine(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) flushLine(line);
    return curY;
  }

  private createObject(className: string): JvmObject {
    return {
      __type: 'object',
      className,
      fields: {},
      internal: { hashId: this.nextHashId++ },
    };
  }

  private createGraphicsObject(ctx: CanvasRenderingContext2D): JvmObject {
    const state: CanvasGraphicState = {
      color: '#000000',
      rgb: 0,
      tx: 0,
      ty: 0,
      fontSize: 12,
      fontBold: false,
      clipX: 0,
      clipY: 0,
      clipW: this.width,
      clipH: this.height,
      strokeStyle: 0,
      ctx,
    };
    return {
      __type: 'object',
      className: 'javax/microedition/lcdui/Graphics',
      fields: {},
      nativeData: state,
    };
  }

  private ensureClassInit(className: string) {
    if (this.initializedClasses.has(className)) return;
    this.initializedClasses.add(className);
    const cls = this.classes.get(className);
    if (!cls) return;
    if (!this.staticFields.has(className)) {
      const statics: Record<string, JvmValue> = {};
      for (const f of cls.fields) {
        if ((f.accessFlags & 0x0008) !== 0) {
          if (f.constantValue !== undefined) statics[f.name] = f.constantValue;
          else if (f.descriptor.startsWith('L') || f.descriptor.startsWith('[')) statics[f.name] = null;
          else statics[f.name] = 0;
        }
      }
      this.staticFields.set(className, statics);
    }
    if (cls.superClass && this.classes.has(cls.superClass)) {
      this.ensureClassInit(cls.superClass);
    }
    const clinit = cls.methods.find((m) => m.name === '<clinit>' && m.descriptor === '()V');
    if (clinit && clinit.code) {
      this.runMethodSync(className, '<clinit>', '()V', [], 120000);
    }
  }

  private findMethod(className: string, name: string, descriptor: string): { cls: ParsedClassFile; method: ParsedMethod } | null {
    let cur: string | undefined = className;
    while (cur) {
      const cls = this.classes.get(cur);
      if (!cls) break;
      const m = cls.methods.find((mm) => mm.name === name && mm.descriptor === descriptor);
      if (m) return { cls, method: m };
      cur = cls.superClass || undefined;
    }
    return null;
  }

  private getStaticField(className: string, name: string): JvmValue {
    let cur: string | undefined = className;
    while (cur) {
      this.ensureClassInit(cur);
      const statics = this.staticFields.get(cur);
      if (statics && name in statics) return statics[name];
      const cls = this.classes.get(cur);
      cur = cls?.superClass || undefined;
    }
    return 0;
  }

  private static readonly NATIVE_SUPER: Record<string, string> = {
    'com/nokia/mid/ui/FullCanvas': 'javax/microedition/lcdui/Canvas',
    'javax/microedition/lcdui/game/GameCanvas': 'javax/microedition/lcdui/Canvas',
    'javax/microedition/lcdui/Canvas': 'javax/microedition/lcdui/Displayable',
    'javax/microedition/lcdui/Form': 'javax/microedition/lcdui/Screen',
    'javax/microedition/lcdui/Alert': 'javax/microedition/lcdui/Screen',
    'javax/microedition/lcdui/List': 'javax/microedition/lcdui/Screen',
    'javax/microedition/lcdui/TextBox': 'javax/microedition/lcdui/Screen',
    'javax/microedition/lcdui/Screen': 'javax/microedition/lcdui/Displayable',
    'javax/microedition/lcdui/Displayable': 'java/lang/Object',
    'java/io/DataInputStream': 'java/io/InputStream',
    'java/io/ByteArrayInputStream': 'java/io/InputStream',
    'java/io/InputStream': 'java/lang/Object',
    'java/io/DataOutputStream': 'java/io/OutputStream',
    'java/io/ByteArrayOutputStream': 'java/io/OutputStream',
    'java/io/OutputStream': 'java/lang/Object',
    'java/io/PrintStream': 'java/io/OutputStream',
    'java/lang/NumberFormatException': 'java/lang/RuntimeException',
    'java/lang/RuntimeException': 'java/lang/Exception',
    'java/io/IOException': 'java/lang/Exception',
    'java/lang/InterruptedException': 'java/lang/Exception',
    'java/lang/Exception': 'java/lang/Throwable',
    'java/lang/Throwable': 'java/lang/Object',
    'java/util/Stack': 'java/util/Vector',
  };

  private isSubclass(sub: string, sup: string): boolean {
    if (sub === sup || sup === 'java/lang/Object') return true;
    let cur: string | undefined = sub;
    let guard = 0;
    while (cur && guard++ < 32) {
      if (cur === sup) return true;
      const cls = this.classes.get(cur);
      if (cls) {
        if (cls.interfaces.includes(sup)) return true;
        cur = cls.superClass || undefined;
      } else {
        cur = J2MEVirtualMachine.NATIVE_SUPER[cur];
      }
    }
    return false;
  }

  private throwJvmException(thread: VmThread, excObj: JvmObject) {
    while (thread.frames.length > 0) {
      const f = thread.frames[thread.frames.length - 1];
      const pc = Math.max(0, f.pc - 1);
      for (const h of f.method.exceptionTable) {
        if (pc >= h.startPc && pc < h.endPc) {
          if (h.catchType === 0) {
            f.stack = [excObj];
            f.pc = h.handlerPc;
            return;
          }
          const catchClass = getCpClassName(f.cls.constantPool, h.catchType);
          if (this.isSubclass(excObj.className, catchClass) || catchClass === 'java/lang/Throwable' || catchClass === 'java/lang/Exception') {
            f.stack = [excObj];
            f.pc = h.handlerPc;
            return;
          }
        }
      }
      thread.frames.pop();
    }
    throw new Error(`Exception chưa được bắt: ${excObj.className}${excObj.internal?.str ? `: ${excObj.internal.str}` : ''}`);
  }

  private runMethodSync(
    className: string,
    name: string,
    descriptor: string,
    args: JvmValue[],
    maxOps: number
  ): JvmValue {
    const found = this.findMethod(className, name, descriptor);
    if (!found || !found.method.code) return null;
    const isStatic = (found.method.accessFlags & 0x0008) !== 0;
    const locals = isStatic
      ? buildMethodLocals(descriptor, null, true, args)
      : buildMethodLocals(descriptor, args[0] ?? null, false, args.slice(1));
    const thread: VmThread = {
      id: 0,
      frames: [
        {
          cls: found.cls,
          method: found.method,
          pc: 0,
          locals,
          stack: [],
        },
      ],
      sleepUntil: 0,
      finished: false,
    };
    return this.stepThread(thread, maxOps);
  }

  private stepThread(thread: VmThread, maxOps: number): JvmValue {
    let ops = 0;
    while (thread.frames.length > 0 && ops < maxOps) {
      if (thread.sleepUntil > performance.now()) {
        return null;
      }
      ops++;
      this.state.instructionsExecuted++;
      const frame = thread.frames[thread.frames.length - 1];
      const code = frame.method.code!;
      if (frame.pc >= code.length) {
        thread.frames.pop();
        continue;
      }

      const cp = frame.cls.constantPool;
      const op = code[frame.pc++];

      const readU1 = () => code[frame.pc++];
      const readI1 = () => {
        const v = code[frame.pc++];
        return v > 127 ? v - 256 : v;
      };
      const readU2 = () => {
        const v = (code[frame.pc] << 8) | code[frame.pc + 1];
        frame.pc += 2;
        return v;
      };
      const readI2 = () => {
        const u = readU2();
        return u > 32767 ? u - 65536 : u;
      };
      const readI4 = () => {
        const v =
          (code[frame.pc] << 24) |
          (code[frame.pc + 1] << 16) |
          (code[frame.pc + 2] << 8) |
          code[frame.pc + 3];
        frame.pc += 4;
        return v;
      };

      const popVal = (): JvmValue => frame.stack.pop() ?? null;
      const num = (v: JvmValue | undefined): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : 0);
      const toBig = (v: JvmValue | undefined): bigint =>
        typeof v === 'bigint' ? v : typeof v === 'number' ? BigInt(Math.trunc(v)) : 0n;

      switch (op) {
        case 0x00: break;
        case 0x01: frame.stack.push(null); break;
        case 0x02: case 0x03: case 0x04: case 0x05: case 0x06: case 0x07: case 0x08:
          frame.stack.push(op - 0x03); break;
        case 0x09: frame.stack.push(0n); break;
        case 0x0a: frame.stack.push(1n); break;
        case 0x0b: case 0x0c: case 0x0d: frame.stack.push(op - 0x0b); break;
        case 0x0e: case 0x0f: frame.stack.push(op - 0x0e); break;
        case 0x10: frame.stack.push(readI1()); break;
        case 0x11: frame.stack.push(readI2()); break;
        case 0x12: this.pushLdc(cp, readU1(), frame.stack); break;
        case 0x13: case 0x14: this.pushLdc(cp, readU2(), frame.stack); break;
        case 0x15: case 0x16: case 0x17: case 0x18: case 0x19:
          frame.stack.push(frame.locals[readU1()] ?? (op === 0x19 ? null : 0)); break;
        case 0x1a: case 0x1b: case 0x1c: case 0x1d:
          frame.stack.push(frame.locals[op - 0x1a] ?? 0); break;
        case 0x1e: case 0x1f: case 0x20: case 0x21:
          frame.stack.push(frame.locals[op - 0x1e] ?? 0n); break;
        case 0x22: case 0x23: case 0x24: case 0x25:
          frame.stack.push(frame.locals[op - 0x22] ?? 0); break;
        case 0x26: case 0x27: case 0x28: case 0x29:
          frame.stack.push(frame.locals[op - 0x26] ?? 0); break;
        case 0x2a: case 0x2b: case 0x2c: case 0x2d:
          frame.stack.push(frame.locals[op - 0x2a] ?? null); break;
        case 0x2e: case 0x2f: case 0x30: case 0x31: case 0x32: case 0x33: case 0x34: case 0x35: {
          const idx = num(popVal());
          const arr = popVal();
          frame.stack.push(isArray(arr) ? (arr.items[idx] ?? (op === 0x32 ? null : 0)) : 0);
          break;
        }
        case 0x36: case 0x37: case 0x38: case 0x39: case 0x3a:
          frame.locals[readU1()] = popVal(); break;
        case 0x3b: case 0x3c: case 0x3d: case 0x3e: frame.locals[op - 0x3b] = popVal() ?? 0; break;
        case 0x3f: case 0x40: case 0x41: case 0x42: frame.locals[op - 0x3f] = popVal() ?? 0n; break;
        case 0x43: case 0x44: case 0x45: case 0x46: frame.locals[op - 0x43] = popVal() ?? 0; break;
        case 0x47: case 0x48: case 0x49: case 0x4a: frame.locals[op - 0x47] = popVal() ?? 0; break;
        case 0x4b: case 0x4c: case 0x4d: case 0x4e: frame.locals[op - 0x4b] = popVal(); break;
        case 0x4f: case 0x50: case 0x51: case 0x52: case 0x53: case 0x54: case 0x55: case 0x56: {
          const val = popVal();
          const idx = num(popVal());
          const arr = popVal();
          if (isArray(arr)) arr.items[idx] = val;
          break;
        }
        case 0x57: popVal(); break;
        case 0x58: {
          const v = popVal();
          if (typeof v !== 'bigint' && frame.stack.length > 0) popVal();
          break;
        }
        case 0x59: frame.stack.push(frame.stack[frame.stack.length - 1] ?? null); break;
        case 0x5a: { const v1 = popVal(); const v2 = popVal(); frame.stack.push(v1, v2, v1); break; }
        case 0x5b: { const v1 = popVal(); const v2 = popVal(); const v3 = popVal(); frame.stack.push(v1, v3, v2, v1); break; }
        case 0x5c: {
          const v1 = popVal();
          if (typeof v1 === 'bigint') { frame.stack.push(v1, v1); }
          else { const v2 = popVal(); frame.stack.push(v2, v1, v2, v1); }
          break;
        }
        case 0x5d: {
          const v1 = popVal();
          if (typeof v1 === 'bigint') { const v2 = popVal(); frame.stack.push(v1, v2, v1); }
          else { const v2 = popVal(); const v3 = popVal(); frame.stack.push(v2, v1, v3, v2, v1); }
          break;
        }
        case 0x5e: {
          const v1 = popVal(); const v2 = popVal(); const v3 = popVal(); const v4 = popVal();
          frame.stack.push(v2, v1, v4, v3, v2, v1);
          break;
        }
        case 0x5f: { const a = popVal(); const b = popVal(); frame.stack.push(a, b); break; }
        case 0x60: { const b = num(popVal()); const a = num(popVal()); frame.stack.push((a + b) | 0); break; }
        case 0x61: { const b = toBig(popVal()); const a = toBig(popVal()); frame.stack.push(a + b); break; }
        case 0x62: case 0x63: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(a + b); break; }
        case 0x64: { const b = num(popVal()); const a = num(popVal()); frame.stack.push((a - b) | 0); break; }
        case 0x65: { const b = toBig(popVal()); const a = toBig(popVal()); frame.stack.push(a - b); break; }
        case 0x66: case 0x67: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(a - b); break; }
        case 0x68: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(Math.imul(a, b)); break; }
        case 0x69: { const b = toBig(popVal()); const a = toBig(popVal()); frame.stack.push(a * b); break; }
        case 0x6a: case 0x6b: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(a * b); break; }
        case 0x6c: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(b === 0 ? 0 : (a / b) | 0); break; }
        case 0x6d: { const b = toBig(popVal()); const a = toBig(popVal()); frame.stack.push(b === 0n ? 0n : a / b); break; }
        case 0x6e: case 0x6f: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(a / b); break; }
        case 0x70: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(b === 0 ? 0 : (a % b) | 0); break; }
        case 0x71: { const b = toBig(popVal()); const a = toBig(popVal()); frame.stack.push(b === 0n ? 0n : a % b); break; }
        case 0x72: case 0x73: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(a % b); break; }
        case 0x74: frame.stack.push((-num(popVal())) | 0); break;
        case 0x75: frame.stack.push(-toBig(popVal())); break;
        case 0x76: case 0x77: frame.stack.push(-num(popVal())); break;
        case 0x78: { const s = num(popVal()); const a = num(popVal()); frame.stack.push(a << (s & 0x1f)); break; }
        case 0x79: { const s = BigInt(num(popVal()) & 0x3f); const a = toBig(popVal()); frame.stack.push(a << s); break; }
        case 0x7a: { const s = num(popVal()); const a = num(popVal()); frame.stack.push(a >> (s & 0x1f)); break; }
        case 0x7b: { const s = BigInt(num(popVal()) & 0x3f); const a = toBig(popVal()); frame.stack.push(a >> s); break; }
        case 0x7c: { const s = num(popVal()); const a = num(popVal()); frame.stack.push(a >>> (s & 0x1f)); break; }
        case 0x7d: { const s = BigInt(num(popVal()) & 0x3f); const a = toBig(popVal()) & 0xffffffffffffffffn; frame.stack.push(a >> s); break; }
        case 0x7e: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(a & b); break; }
        case 0x7f: { const b = toBig(popVal()); const a = toBig(popVal()); frame.stack.push(a & b); break; }
        case 0x80: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(a | b); break; }
        case 0x81: { const b = toBig(popVal()); const a = toBig(popVal()); frame.stack.push(a | b); break; }
        case 0x82: { const b = num(popVal()); const a = num(popVal()); frame.stack.push(a ^ b); break; }
        case 0x83: { const b = toBig(popVal()); const a = toBig(popVal()); frame.stack.push(a ^ b); break; }
        case 0x84: {
          const idx = readU1();
          const c = readI1();
          frame.locals[idx] = (num(frame.locals[idx]) + c) | 0;
          break;
        }
        case 0x85: frame.stack.push(BigInt(Math.trunc(num(popVal())))); break;
        case 0x86: case 0x87: frame.stack.push(num(popVal())); break;
        case 0x88: frame.stack.push(Number(toBig(popVal()) & 0xffffffffn) | 0); break;
        case 0x89: case 0x8a: frame.stack.push(Number(toBig(popVal()))); break;
        case 0x8b: case 0x8e: frame.stack.push(num(popVal()) | 0); break;
        case 0x8c: case 0x8f: frame.stack.push(BigInt(Math.trunc(num(popVal())))); break;
        case 0x8d: case 0x90: frame.stack.push(num(popVal())); break;
        case 0x91: frame.stack.push((num(popVal()) << 24) >> 24); break;
        case 0x92: frame.stack.push(num(popVal()) & 0xffff); break;
        case 0x93: frame.stack.push((num(popVal()) << 16) >> 16); break;
        case 0x94: {
          const b = toBig(popVal());
          const a = toBig(popVal());
          frame.stack.push(a > b ? 1 : a < b ? -1 : 0);
          break;
        }
        case 0x95: case 0x96: case 0x97: case 0x98: {
          const b = num(popVal());
          const a = num(popVal());
          frame.stack.push(a > b ? 1 : a < b ? -1 : 0);
          break;
        }
        case 0x99: { const off = readI2(); if (num(popVal()) === 0) frame.pc += off - 3; break; }
        case 0x9a: { const off = readI2(); if (num(popVal()) !== 0) frame.pc += off - 3; break; }
        case 0x9b: { const off = readI2(); if (num(popVal()) < 0) frame.pc += off - 3; break; }
        case 0x9c: { const off = readI2(); if (num(popVal()) >= 0) frame.pc += off - 3; break; }
        case 0x9d: { const off = readI2(); if (num(popVal()) > 0) frame.pc += off - 3; break; }
        case 0x9e: { const off = readI2(); if (num(popVal()) <= 0) frame.pc += off - 3; break; }
        case 0x9f: { const off = readI2(); const b = num(popVal()); const a = num(popVal()); if (a === b) frame.pc += off - 3; break; }
        case 0xa0: { const off = readI2(); const b = num(popVal()); const a = num(popVal()); if (a !== b) frame.pc += off - 3; break; }
        case 0xa1: { const off = readI2(); const b = num(popVal()); const a = num(popVal()); if (a < b) frame.pc += off - 3; break; }
        case 0xa2: { const off = readI2(); const b = num(popVal()); const a = num(popVal()); if (a >= b) frame.pc += off - 3; break; }
        case 0xa3: { const off = readI2(); const b = num(popVal()); const a = num(popVal()); if (a > b) frame.pc += off - 3; break; }
        case 0xa4: { const off = readI2(); const b = num(popVal()); const a = num(popVal()); if (a <= b) frame.pc += off - 3; break; }
        case 0xa5: { const off = readI2(); const b = popVal(); const a = popVal(); if (a === b) frame.pc += off - 3; break; }
        case 0xa6: { const off = readI2(); const b = popVal(); const a = popVal(); if (a !== b) frame.pc += off - 3; break; }
        case 0xa7: { const off = readI2(); frame.pc += off - 3; break; }
        case 0xa8: { const off = readI2(); frame.stack.push(frame.pc); frame.pc += off - 3; break; }
        case 0xa9: { frame.pc = num(frame.locals[readU1()]); break; }
        case 0xaa: {
          const basePc = frame.pc - 1;
          while (frame.pc % 4 !== 0) frame.pc++;
          const def = readI4();
          const low = readI4();
          const high = readI4();
          const key = num(popVal());
          let target = basePc + def;
          if (key >= low && key <= high) {
            const idx = key - low;
            frame.pc += idx * 4;
            target = basePc + readI4();
          }
          frame.pc = target;
          break;
        }
        case 0xab: {
          const basePc = frame.pc - 1;
          while (frame.pc % 4 !== 0) frame.pc++;
          const def = readI4();
          const npairs = readI4();
          const key = num(popVal());
          let target = basePc + def;
          for (let p = 0; p < npairs; p++) {
            const k = readI4();
            const off = readI4();
            if (k === key) {
              target = basePc + off;
              break;
            }
          }
          frame.pc = target;
          break;
        }
        case 0xac: case 0xad: case 0xae: case 0xaf: case 0xb0: {
          const ret = popVal();
          thread.frames.pop();
          if (thread.frames.length === 0) {
            if (thread.id !== 0) thread.finished = true;
            return ret;
          }
          thread.frames[thread.frames.length - 1].stack.push(ret);
          break;
        }
        case 0xb1: {
          thread.frames.pop();
          if (thread.frames.length === 0) {
            if (thread.id !== 0) thread.finished = true;
            return null;
          }
          break;
        }
        case 0xb2: {
          const ref = this.resolveMemberRef(cp, readU2());
          frame.stack.push(this.getStaticField(ref.className, ref.name));
          break;
        }
        case 0xb3: {
          const ref = this.resolveMemberRef(cp, readU2());
          this.ensureClassInit(ref.className);
          let statics = this.staticFields.get(ref.className);
          if (!statics) {
            statics = {};
            this.staticFields.set(ref.className, statics);
          }
          statics[ref.name] = popVal();
          break;
        }
        case 0xb4: {
          const ref = this.resolveMemberRef(cp, readU2());
          const obj = popVal();
          frame.stack.push(isObject(obj) ? (obj.fields[ref.name] ?? 0) : 0);
          break;
        }
        case 0xb5: {
          const ref = this.resolveMemberRef(cp, readU2());
          const val = popVal();
          const obj = popVal();
          if (isObject(obj)) obj.fields[ref.name] = val;
          break;
        }
        case 0xb6:
        case 0xb7:
        case 0xb8:
        case 0xb9: {
          const idx = readU2();
          if (op === 0xb9) { readU1(); readU1(); }
          const ref = this.resolveMemberRef(cp, idx);
          const paramTypes = parseDescriptorParamTypes(ref.descriptor);
          const args: JvmValue[] = new Array(paramTypes.length);
          for (let a = paramTypes.length - 1; a >= 0; a--) {
            args[a] = popVal();
          }
          const receiver = op === 0xb8 ? null : popVal();
          const targetClass =
            op === 0xb6 || op === 0xb9
              ? isObject(receiver)
                ? receiver.className
                : ref.className
              : ref.className;

          const found = this.findMethod(targetClass, ref.name, ref.descriptor);
          // For invokevirtual/invokeinterface (or invokespecial on a loaded bytecode class),
          // run user bytecode implementation if it exists; otherwise fall back to native J2ME API.
          if (found && found.method.code && (op !== 0xb7 || this.classes.has(ref.className))) {
            this.ensureClassInit(found.cls.thisClass);
            const locals = buildMethodLocals(ref.descriptor, receiver, op === 0xb8, args);
            thread.frames.push({
              cls: found.cls,
              method: found.method,
              pc: 0,
              locals,
              stack: [],
            });
            break;
          }

          if (this.tryNativeInvoke(thread, frame, targetClass, ref.className, ref.name, ref.descriptor, receiver, args)) {
            break;
          }

          throw new Error(`API_UNSUPPORTED:${ref.className}.${ref.name}${ref.descriptor}`);
          break;
        }
        case 0xbb: {
          const clsName = getCpClassName(cp, readU2());
          this.ensureClassInit(clsName);
          frame.stack.push(this.createObject(clsName));
          break;
        }
        case 0xbc: {
          readU1();
          const count = Math.max(0, num(popVal()));
          frame.stack.push({ __type: 'array', elementType: 'I', items: new Array(count).fill(0) });
          break;
        }
        case 0xbd: {
          const clsName = getCpClassName(cp, readU2());
          const count = Math.max(0, num(popVal()));
          frame.stack.push({ __type: 'array', elementType: clsName, items: new Array(count).fill(null) });
          break;
        }
        case 0xbe: {
          const arr = popVal();
          frame.stack.push(isArray(arr) ? arr.items.length : 0);
          break;
        }
        case 0xbf: { // athrow
          const exc = popVal();
          const excObj = isObject(exc) ? exc : this.createObject('java/lang/Exception');
          this.throwJvmException(thread, excObj);
          break;
        }
        case 0xc0: readU2(); break;
        case 0xc1: {
          const clsName = getCpClassName(cp, readU2());
          const obj = popVal();
          if (obj === null) frame.stack.push(0);
          else if (typeof obj === 'string') frame.stack.push(clsName === 'java/lang/String' || clsName === 'java/lang/Object' ? 1 : 0);
          else if (isObject(obj)) frame.stack.push(this.isSubclass(obj.className, clsName) ? 1 : 0);
          else frame.stack.push(1);
          break;
        }
        case 0xc2: case 0xc3: popVal(); break;
        case 0xc4: { // wide
          const subOp = readU1();
          const idx = readU2();
          if (subOp === 0x84) {
            const c = readI2();
            frame.locals[idx] = (num(frame.locals[idx]) + c) | 0;
          } else if (subOp >= 0x15 && subOp <= 0x19) {
            frame.stack.push(frame.locals[idx] ?? 0);
          } else if (subOp >= 0x36 && subOp <= 0x3a) {
            frame.locals[idx] = popVal();
          } else if (subOp === 0xa9) {
            frame.pc = num(frame.locals[idx]);
          }
          break;
        }
        case 0xc5: { // multianewarray
          const typeDesc = getCpClassName(cp, readU2());
          const dimsCount = readU1();
          const dims: number[] = new Array(dimsCount);
          for (let d = dimsCount - 1; d >= 0; d--) dims[d] = num(popVal());
          frame.stack.push(createMultiArray(dims, typeDesc));
          break;
        }
        case 0xc6: { const off = readI2(); if (popVal() === null) frame.pc += off - 3; break; }
        case 0xc7: { const off = readI2(); if (popVal() !== null) frame.pc += off - 3; break; }
        case 0xc8: { const off = readI4(); frame.pc += off - 5; break; }
        case 0xc9: { const off = readI4(); frame.stack.push(frame.pc); frame.pc += off - 5; break; }
        default:
          throw new Error(`Opcode JVM chưa hỗ trợ: 0x${op.toString(16)}`);
      }
    }
    return null;
  }

  private pushLdc(cp: ConstantPoolEntry[], idx: number, stack: JvmValue[]) {
    const entry = cp[idx];
    if (!entry) { stack.push(null); return; }
    if (entry.tag === 3 || entry.tag === 4 || entry.tag === 5 || entry.tag === 6) {
      stack.push(entry.value);
    } else if (entry.tag === 8) {
      stack.push(getCpUtf8(cp, entry.stringIndex));
    } else if (entry.tag === 7) {
      const clsObj = this.createObject('java/lang/Class');
      clsObj.internal = { str: getCpUtf8(cp, entry.nameIndex) };
      stack.push(clsObj);
    } else {
      stack.push(null);
    }
  }

  private resolveMemberRef(cp: ConstantPoolEntry[], idx: number): { className: string; name: string; descriptor: string } {
    const entry = cp[idx];
    if (!entry || (entry.tag !== 9 && entry.tag !== 10 && entry.tag !== 11)) {
      return { className: '', name: '', descriptor: '' };
    }
    const className = getCpClassName(cp, entry.classIndex);
    const nt = cp[entry.nameAndTypeIndex];
    if (!nt || nt.tag !== 12) return { className, name: '', descriptor: '' };
    return {
      className,
      name: getCpUtf8(cp, nt.nameIndex),
      descriptor: getCpUtf8(cp, nt.descriptorIndex),
    };
  }

  private createStreamObject(className: string, bytes: Uint8Array): JvmObject {
    const obj = this.createObject(className);
    obj.internal = { stream: { data: bytes, pos: 0, mark: 0 } };
    return obj;
  }

  private findResourceBytes(rawPath: string, ownerClass?: string): Uint8Array | null {
    const clean = rawPath.trim();
    const candidates = [
      clean.startsWith('/') ? clean : `/${clean}`,
      clean.startsWith('/') ? clean.toLowerCase() : `/${clean.toLowerCase()}`,
    ];
    if (ownerClass && !clean.startsWith('/')) {
      const pkg = ownerClass.includes('/') ? ownerClass.slice(0, ownerClass.lastIndexOf('/')) : '';
      if (pkg) candidates.unshift(`/${pkg}/${clean}`, `/${pkg}/${clean}`.toLowerCase());
    }
    for (const c of candidates) {
      const hit = this.rawResources.get(c);
      if (hit) return hit;
    }
    return null;
  }

  private tryNativeInvoke(
    thread: VmThread,
    frame: VmFrame,
    targetClass: string,
    declaredClass: string,
    name: string,
    descriptor: string,
    receiver: JvmValue,
    args: JvmValue[]
  ): boolean {
    const hasReturn = !descriptor.endsWith(')V');
    const pushRet = (val: JvmValue) => {
      if (hasReturn) frame.stack.push(val);
    };

    // Array clone
    if (declaredClass.startsWith('[') && name === 'clone') {
      if (isArray(receiver)) {
        pushRet({ __type: 'array', elementType: receiver.elementType, items: [...receiver.items] });
      } else {
        pushRet(null);
      }
      return true;
    }

    // java.lang.Object methods (can be invoked on ANY receiver!)
    if (
      (declaredClass === 'java/lang/Object' ||
        name === 'getClass' ||
        name === 'hashCode' ||
        name === 'notify' ||
        name === 'notifyAll' ||
        name === 'wait') &&
      (declaredClass === 'java/lang/Object' ||
        !this.classes.has(targetClass) ||
        !this.findMethod(targetClass, name, descriptor))
    ) {
      if (name === '<init>') return true;
      if (name === 'getClass') {
        const clsObj = this.createObject('java/lang/Class');
        clsObj.internal = {
          str: isObject(receiver)
            ? receiver.className
            : typeof receiver === 'string'
              ? 'java/lang/String'
              : 'java/lang/Object',
        };
        pushRet(clsObj);
        return true;
      }
      if (name === 'hashCode') {
        pushRet(isObject(receiver) ? (receiver.internal?.hashId ?? 1) : 1);
        return true;
      }
      if (name === 'equals') {
        pushRet(receiver === args[0] ? 1 : 0);
        return true;
      }
      if (name === 'toString') {
        const cls = isObject(receiver) ? receiver.className : typeof receiver;
        pushRet(`${cls}@${isObject(receiver) ? receiver.internal?.hashId ?? 0 : 0}`);
        return true;
      }
      if (name === 'wait') {
        if (thread.id !== 0 && args.length === 1) {
          thread.sleepUntil = performance.now() + Math.max(10, Math.min(Number(args[0] ?? 16), 1000));
        }
        return true;
      }
      if (name === 'notify' || name === 'notifyAll') return true;
    }

    // java.lang.Class
    if (declaredClass === 'java/lang/Class' || targetClass === 'java/lang/Class') {
      if (name === 'forName') {
        const clsName = String(args[0] || '').replace(/\./g, '/');
        const clsObj = this.createObject('java/lang/Class');
        clsObj.internal = { str: clsName };
        pushRet(clsObj);
        return true;
      }
      if (name === 'getName') {
        const raw = isObject(receiver) ? receiver.internal?.str || 'java/lang/Object' : 'java/lang/Object';
        pushRet(raw.replace(/\//g, '.'));
        return true;
      }
      if (name === 'getResourceAsStream') {
        const owner = isObject(receiver) ? receiver.internal?.str : undefined;
        const path = String(args[0] || '');
        const bytes = this.findResourceBytes(path, owner);
        if (!bytes) {
          pushRet(null);
        } else {
          pushRet(this.createStreamObject('java/io/ByteArrayInputStream', bytes));
        }
        return true;
      }
    }

    // java.lang.Throwable / Exception / Error
    if (
      this.isSubclass(targetClass, 'java/lang/Throwable') ||
      declaredClass === 'java/lang/Throwable' ||
      declaredClass === 'java/lang/Exception' ||
      declaredClass === 'java/lang/RuntimeException' ||
      declaredClass === 'java/io/IOException' ||
      declaredClass === 'java/lang/InterruptedException'
    ) {
      if (name === '<init>') {
        if (isObject(receiver)) {
          if (!receiver.internal) receiver.internal = {};
          receiver.internal.str = args[0] ? String(args[0]) : '';
        }
        return true;
      }
      if (name === 'getMessage') { pushRet(isObject(receiver) ? receiver.internal?.str || '' : ''); return true; }
      if (name === 'toString') { pushRet(isObject(receiver) ? `${receiver.className}: ${receiver.internal?.str || ''}` : ''); return true; }
      if (name === 'printStackTrace') {
        this.log(`StackTrace: ${isObject(receiver) ? receiver.className : 'Throwable'}`);
        return true;
      }
    }

    // MIDlet (match declaredClass OR subclass)
    if (
      declaredClass === 'javax/microedition/midlet/MIDlet' ||
      this.isSubclass(targetClass, 'javax/microedition/midlet/MIDlet')
    ) {
      if (name === '<init>' || name === 'startApp' || name === 'pauseApp' || name === 'destroyApp') return true;
      if (name === 'notifyDestroyed') {
        this.state.status = 'halted';
        this.log('MIDlet đã gọi notifyDestroyed()');
        this.emitState();
        return true;
      }
      if (name === 'notifyPaused') { this.pause(); return true; }
      if (name === 'resumeRequest') { this.resume(); return true; }
      if (name === 'getAppProperty') {
        const key = String(args[0] || '');
        pushRet(this.manifestProps[key] ?? null);
        return true;
      }
      if (name === 'platformRequest') { pushRet(0); return true; }
    }

    // Display
    if (targetClass === 'javax/microedition/lcdui/Display' || declaredClass === 'javax/microedition/lcdui/Display') {
      if (name === 'getDisplay') {
        pushRet(this.createObject('javax/microedition/lcdui/Display'));
        return true;
      }
      if (name === 'setCurrent') {
        const disp = args.length === 2 ? args[1] : args[0];
        if (isObject(disp)) {
          this.currentDisplayable = disp;
          this.state.currentScreen = String(disp.internal?.title || disp.className.split('/').pop() || 'Canvas');
          this.needsRepaint = true;
          const showNotify = this.findMethod(disp.className, 'showNotify', '()V');
          if (showNotify && showNotify.method.code) {
            this.runMethodSync(showNotify.cls.thisClass, 'showNotify', '()V', [disp], 30000);
          }
          this.emitState();
        }
        return true;
      }
      if (name === 'getCurrent') { pushRet(this.currentDisplayable); return true; }
      if (name === 'isColor') { pushRet(1); return true; }
      if (name === 'numColors') { pushRet(65536); return true; }
      if (name === 'vibrate' || name === 'flashBacklight') { pushRet(1); return true; }
      if (name === 'callSerially' && isObject(args[0])) {
        const target = args[0];
        const found = this.findMethod(target.className, 'run', '()V');
        if (found && found.method.code) {
          this.threads.push({
            id: this.nextThreadId++,
            frames: [{ cls: found.cls, method: found.method, pc: 0, locals: [target], stack: [] }],
            sleepUntil: 0,
            finished: false,
          });
        }
        return true;
      }
    }

    // Nokia UI API (FullCanvas, DeviceControl, DirectUtils, DirectGraphics)
    if (
      declaredClass === 'com/nokia/mid/ui/DeviceControl' ||
      targetClass === 'com/nokia/mid/ui/DeviceControl'
    ) {
      return true;
    }
    if (
      declaredClass === 'com/nokia/mid/ui/DirectUtils' ||
      targetClass === 'com/nokia/mid/ui/DirectUtils'
    ) {
      if (name === 'getDirectGraphics') {
        const gObj = args[0];
        const dg = this.createObject('com/nokia/mid/ui/DirectGraphics');
        dg.nativeData = isObject(gObj) ? gObj.nativeData : undefined;
        pushRet(dg);
        return true;
      }
      if (name === 'createImage') {
        if (descriptor.startsWith('(II')) {
          const obj = this.createObject('javax/microedition/lcdui/Image');
          obj.nativeData = createBlankImage(Number(args[0] ?? 1), Number(args[1] ?? 1));
          pushRet(obj);
          return true;
        }
        if (descriptor.startsWith('([BII')) {
          const arr = args[0];
          const off = Number(args[1] ?? 0);
          const len = Number(args[2] ?? 0);
          const bytes = new Uint8Array(Math.max(0, len));
          if (isArray(arr)) {
            for (let i = 0; i < len; i++) bytes[i] = Number(arr.items[off + i] ?? 0) & 0xff;
          }
          const obj = this.createObject('javax/microedition/lcdui/Image');
          obj.nativeData = createImageFromBytes(bytes, () => { this.needsRepaint = true; });
          pushRet(obj);
          return true;
        }
      }
    }
    if (
      declaredClass === 'com/nokia/mid/ui/DirectGraphics' ||
      targetClass === 'com/nokia/mid/ui/DirectGraphics'
    ) {
      const gState = isObject(receiver) ? (receiver.nativeData as CanvasGraphicState | undefined) : undefined;
      if (name === 'setARGBColor' && gState) {
        const argb = Number(args[0] ?? 0);
        const a = ((argb >>> 24) & 0xff) / 255;
        const r = (argb >>> 16) & 0xff;
        const g = (argb >>> 8) & 0xff;
        const b = argb & 0xff;
        gState.rgb = argb & 0xffffff;
        gState.color = `rgba(${r},${g},${b},${a})`;
        gState.ctx.fillStyle = gState.color;
        gState.ctx.strokeStyle = gState.color;
        return true;
      }
      if (name === 'drawImage' && gState) {
        const imgObj = args[0];
        if (isObject(imgObj) && imgObj.nativeData) {
          const data = imgObj.nativeData as J2MEImageData;
          gState.ctx.drawImage(data.canvas, Number(args[1] ?? 0) + gState.tx, Number(args[2] ?? 0) + gState.ty);
        }
        return true;
      }
      if (name === 'fillPolygon' && gState && isArray(args[0]) && isArray(args[2])) {
        const xs = args[0].items;
        const ys = args[2].items;
        const xOff = Number(args[1] ?? 0);
        const yOff = Number(args[3] ?? 0);
        const count = Number(args[4] ?? 0);
        if (count > 0) {
          gState.ctx.fillStyle = gState.color;
          gState.ctx.beginPath();
          gState.ctx.moveTo(Number(xs[xOff] ?? 0) + gState.tx, Number(ys[yOff] ?? 0) + gState.ty);
          for (let i = 1; i < count; i++) {
            gState.ctx.lineTo(Number(xs[xOff + i] ?? 0) + gState.tx, Number(ys[yOff + i] ?? 0) + gState.ty);
          }
          gState.ctx.closePath();
          gState.ctx.fill();
        }
        return true;
      }
      return true;
    }

    // Canvas & GameCanvas & FullCanvas (match declaredClass OR subclass)
    if (
      declaredClass === 'javax/microedition/lcdui/Canvas' ||
      declaredClass === 'javax/microedition/lcdui/game/GameCanvas' ||
      declaredClass === 'com/nokia/mid/ui/FullCanvas' ||
      this.isSubclass(targetClass, 'javax/microedition/lcdui/Canvas') ||
      this.isSubclass(targetClass, 'javax/microedition/lcdui/game/GameCanvas')
    ) {
      if (
        name === '<init>' ||
        name === 'keyPressed' ||
        name === 'keyReleased' ||
        name === 'keyRepeated' ||
        name === 'showNotify' ||
        name === 'hideNotify' ||
        name === 'sizeChanged' ||
        name === 'pointerPressed' ||
        name === 'pointerReleased' ||
        name === 'pointerDragged' ||
        name === 'paint'
      ) {
        return true;
      }
      if (name === 'getWidth') { pushRet(this.width); return true; }
      if (name === 'getHeight') { pushRet(this.height); return true; }
      if (name === 'repaint' || name === 'serviceRepaints') { this.needsRepaint = true; return true; }
      if (name === 'setFullScreenMode') return true;
      if (name === 'isShown') { pushRet(1); return true; }
      if (name === 'hasPointerEvents' || name === 'hasPointerMotionEvents' || name === 'hasRepeatEvents' || name === 'isDoubleBuffered') {
        pushRet(1); return true;
      }
      if (name === 'getKeyStates') { pushRet(this.heldKeyFlags); return true; }
      if (name === 'getGraphics') { pushRet(this.createGraphicsObject(this.offscreenCtx)); return true; }
      if (name === 'flushGraphics') { this.needsRepaint = false; return true; }
      if (name === 'getKeyName') { pushRet(`Key ${args[0]}`); return true; }
      if (name === 'getGameAction') {
        const k = Number(args[0] ?? 0);
        let action = 0;
        if (k === J2MEKey.UP || k === J2MEKey.KEY_2) action = 1;
        else if (k === J2MEKey.LEFT || k === J2MEKey.KEY_4) action = 2;
        else if (k === J2MEKey.RIGHT || k === J2MEKey.KEY_6) action = 5;
        else if (k === J2MEKey.DOWN || k === J2MEKey.KEY_8) action = 6;
        else if (k === J2MEKey.FIRE || k === J2MEKey.KEY_5) action = 8;
        pushRet(action);
        return true;
      }
    }

    // Displayable & UI Forms/TextBox/List/Command
    if (
      declaredClass === 'javax/microedition/lcdui/Displayable' ||
      this.isSubclass(targetClass, 'javax/microedition/lcdui/Displayable')
    ) {
      if (name === 'getWidth') { pushRet(this.width); return true; }
      if (name === 'getHeight') { pushRet(this.height); return true; }
      if (name === 'isShown') { pushRet(this.currentDisplayable === receiver ? 1 : 0); return true; }
      if (name === 'getTitle' && isObject(receiver)) { pushRet(receiver.internal?.title ?? null); return true; }
    }

    if (
      name === 'addCommand' ||
      name === 'setCommandListener' ||
      name === 'setTitle' ||
      name === 'removeCommand' ||
      name === 'setTicker'
    ) {
      if (isObject(receiver)) {
        if (!receiver.internal) receiver.internal = {};
        if (name === 'addCommand' && isObject(args[0])) {
          const arr = receiver.internal.commands || [];
          arr.push(args[0]);
          receiver.internal.commands = arr;
        } else if (name === 'setCommandListener' && isObject(args[0])) {
          receiver.internal.cmdListener = args[0];
        } else if (name === 'setTitle') {
          receiver.internal.title = String(args[0] || '');
        }
      }
      return true;
    }

    if (
      this.isSubclass(targetClass, 'javax/microedition/lcdui/Screen') ||
      declaredClass === 'javax/microedition/lcdui/Form' ||
      declaredClass === 'javax/microedition/lcdui/Alert' ||
      declaredClass === 'javax/microedition/lcdui/Command' ||
      declaredClass === 'javax/microedition/lcdui/TextBox' ||
      declaredClass === 'javax/microedition/lcdui/TextField' ||
      declaredClass === 'javax/microedition/lcdui/List' ||
      declaredClass === 'javax/microedition/lcdui/StringItem' ||
      declaredClass === 'javax/microedition/lcdui/ChoiceGroup' ||
      declaredClass === 'javax/microedition/lcdui/Gauge' ||
      targetClass === 'javax/microedition/lcdui/Command' ||
      targetClass === 'javax/microedition/lcdui/TextField' ||
      targetClass === 'javax/microedition/lcdui/StringItem' ||
      targetClass === 'javax/microedition/lcdui/ChoiceGroup' ||
      targetClass === 'javax/microedition/lcdui/Gauge'
    ) {
      if (name === '<init>' && isObject(receiver)) {
        if (!receiver.internal) receiver.internal = {};
        receiver.internal.title = String(args[0] || '');
        if (args[1] && typeof args[1] === 'string') {
          receiver.internal.str = args[1];
          receiver.internal.items = [args[1]];
        }
        return true;
      }
      if (name === 'append' && isObject(receiver)) {
        if (!receiver.internal) receiver.internal = {};
        const items = receiver.internal.items || [];
        items.push(String(args[0] || ''));
        receiver.internal.items = items;
        pushRet(items.length - 1);
        return true;
      }
      if (name === 'getString' && isObject(receiver)) { pushRet(receiver.internal?.str || ''); return true; }
      if (name === 'setString' && isObject(receiver)) {
        if (!receiver.internal) receiver.internal = {};
        receiver.internal.str = String(args[0] || '');
        return true;
      }
      if (name === 'getSelectedIndex') { pushRet(0); return true; }
      if (name === 'size') { pushRet(isObject(receiver) ? (receiver.internal?.items?.length || 0) : 0); return true; }
      if (name === 'setTimeout' || name === 'setType' || name === 'setConstraints') return true;
    }

    // Graphics
    if (targetClass === 'javax/microedition/lcdui/Graphics' || declaredClass === 'javax/microedition/lcdui/Graphics') {
      if (isObject(receiver) && receiver.nativeData) {
        this.handleGraphicsCall(receiver.nativeData as CanvasGraphicState, name, descriptor, args, pushRet);
        return true;
      }
    }

    // Image
    if (targetClass === 'javax/microedition/lcdui/Image' || declaredClass === 'javax/microedition/lcdui/Image') {
      if (name === 'createImage') {
        if (descriptor === '(Ljava/lang/String;)Ljavax/microedition/lcdui/Image;') {
          const path = String(args[0] || '');
          const norm = path.startsWith('/') ? path : `/${path}`;
          let data = this.imageCache.get(norm);
          if (!data) {
            const bytes = this.findResourceBytes(path);
            if (bytes) {
              data = createImageFromBytes(bytes, () => { this.needsRepaint = true; });
              this.imageCache.set(norm, data);
            }
          }
          if (!data) {
            // Throw IOException if resource genuinely doesn't exist (standard J2ME contract)
            const exc = this.createObject('java/io/IOException');
            exc.internal = { str: `Image not found: ${path}` };
            this.throwJvmException(thread, exc);
            return true;
          }
          const obj = this.createObject('javax/microedition/lcdui/Image');
          obj.nativeData = data;
          pushRet(obj);
          return true;
        }
        if (descriptor === '(Ljava/io/InputStream;)Ljavax/microedition/lcdui/Image;') {
          const streamObj = args[0];
          let data: J2MEImageData | null = null;
          if (isObject(streamObj) && streamObj.internal?.stream) {
            const st = streamObj.internal.stream;
            const remaining = st.data.subarray(st.pos);
            st.pos = st.data.length;
            data = createImageFromBytes(remaining, () => { this.needsRepaint = true; });
          }
          const obj = this.createObject('javax/microedition/lcdui/Image');
          obj.nativeData = data ?? createBlankImage(16, 16);
          pushRet(obj);
          return true;
        }
        if (descriptor === '([BII)Ljavax/microedition/lcdui/Image;') {
          const arr = args[0];
          const off = Number(args[1] ?? 0);
          const len = Number(args[2] ?? 0);
          const bytes = new Uint8Array(Math.max(0, len));
          if (isArray(arr)) {
            for (let i = 0; i < len; i++) bytes[i] = Number(arr.items[off + i] ?? 0) & 0xff;
          }
          const data = createImageFromBytes(bytes, () => { this.needsRepaint = true; });
          const obj = this.createObject('javax/microedition/lcdui/Image');
          obj.nativeData = data;
          pushRet(obj);
          return true;
        }
        if (descriptor === '(II)Ljavax/microedition/lcdui/Image;') {
          const obj = this.createObject('javax/microedition/lcdui/Image');
          obj.nativeData = createBlankImage(Number(args[0] ?? 1), Number(args[1] ?? 1));
          pushRet(obj);
          return true;
        }
        if (descriptor === '(Ljavax/microedition/lcdui/Image;)Ljavax/microedition/lcdui/Image;') {
          const srcObj = args[0];
          const src = isObject(srcObj) ? (srcObj.nativeData as J2MEImageData | undefined) : undefined;
          const blank = createBlankImage(src?.width ?? 16, src?.height ?? 16);
          if (src) {
            const c = blank.canvas.getContext('2d');
            c?.drawImage(src.canvas, 0, 0);
          }
          const obj = this.createObject('javax/microedition/lcdui/Image');
          obj.nativeData = blank;
          pushRet(obj);
          return true;
        }
        if (descriptor === '(Ljavax/microedition/lcdui/Image;IIIII)Ljavax/microedition/lcdui/Image;') {
          const srcObj = args[0];
          const sx = Number(args[1] ?? 0);
          const sy = Number(args[2] ?? 0);
          const sw = Number(args[3] ?? 1);
          const sh = Number(args[4] ?? 1);
          const transform = Number(args[5] ?? 0);
          const swap = transform >= 4;
          const blank = createBlankImage(swap ? sh : sw, swap ? sw : sh);
          const c = blank.canvas.getContext('2d');
          if (c) c.clearRect(0, 0, blank.width, blank.height);
          const src = isObject(srcObj) ? (srcObj.nativeData as J2MEImageData | undefined) : undefined;
          if (src && c) {
            drawTransformedRegion(c, src.canvas, sx, sy, sw, sh, transform, 0, 0);
          }
          const obj = this.createObject('javax/microedition/lcdui/Image');
          obj.nativeData = blank;
          pushRet(obj);
          return true;
        }
      }
      if (name === 'createRGBImage') {
        const arr = args[0];
        const w = Number(args[1] ?? 1);
        const h = Number(args[2] ?? 1);
        const alpha = Boolean(args[3]);
        const nums = isArray(arr) ? arr.items.map((v) => Number(v ?? 0)) : [];
        const obj = this.createObject('javax/microedition/lcdui/Image');
        obj.nativeData = createRgbImage(nums, w, h, alpha);
        pushRet(obj);
        return true;
      }
      if (name === 'getGraphics' && isObject(receiver)) {
        const data = receiver.nativeData as J2MEImageData | undefined;
        const ctx = data?.canvas.getContext('2d') || this.offscreenCtx;
        pushRet(this.createGraphicsObject(ctx));
        return true;
      }
      if (name === 'getWidth' && isObject(receiver)) {
        const data = receiver.nativeData as J2MEImageData | undefined;
        pushRet(data?.width ?? 16);
        return true;
      }
      if (name === 'getHeight' && isObject(receiver)) {
        const data = receiver.nativeData as J2MEImageData | undefined;
        pushRet(data?.height ?? 16);
        return true;
      }
      if (name === 'getRGB' && isObject(receiver)) {
        const data = receiver.nativeData as J2MEImageData | undefined;
        const rgbArr = args[0];
        const offset = Number(args[1] ?? 0);
        const scan = Number(args[2] ?? 0);
        const rx = Number(args[3] ?? 0);
        const ry = Number(args[4] ?? 0);
        const rw = Number(args[5] ?? 0);
        const rh = Number(args[6] ?? 0);
        if (data && isArray(rgbArr) && rw > 0 && rh > 0) {
          const c = data.canvas.getContext('2d');
          if (c) {
            const imgData = c.getImageData(rx, ry, rw, rh).data;
            for (let row = 0; row < rh; row++) {
              for (let col = 0; col < rw; col++) {
                const p = (row * rw + col) * 4;
                const argb =
                  ((imgData[p + 3] & 0xff) << 24) |
                  ((imgData[p] & 0xff) << 16) |
                  ((imgData[p + 1] & 0xff) << 8) |
                  (imgData[p + 2] & 0xff);
                rgbArr.items[offset + row * scan + col] = argb | 0;
              }
            }
          }
        }
        return true;
      }
    }

    // Font
    if (targetClass === 'javax/microedition/lcdui/Font' || declaredClass === 'javax/microedition/lcdui/Font') {
      if (name === 'getDefaultFont' || name === 'getFont') {
        const f = this.createObject('javax/microedition/lcdui/Font');
        if (args.length === 3) {
          f.fields.face = Number(args[0] ?? 0);
          f.fields.style = Number(args[1] ?? 0);
          f.fields.size = Number(args[2] ?? 0);
        } else {
          f.fields.face = 0;
          f.fields.style = 0;
          f.fields.size = 0;
        }
        pushRet(f);
        return true;
      }
      const fontPx = isObject(receiver)
        ? Number(receiver.fields.size) === 16 ? 15 : Number(receiver.fields.size) === 8 ? 10 : 12
        : 12;
      if (name === 'getHeight') { pushRet(fontPx + 3); return true; }
      if (name === 'getBaselinePosition') { pushRet(fontPx); return true; }
      if (name === 'getSize') { pushRet(isObject(receiver) ? Number(receiver.fields.size ?? 0) : 0); return true; }
      if (name === 'getStyle') { pushRet(isObject(receiver) ? Number(receiver.fields.style ?? 0) : 0); return true; }
      if (name === 'getFace') { pushRet(isObject(receiver) ? Number(receiver.fields.face ?? 0) : 0); return true; }
      if (name === 'stringWidth') { pushRet(Math.round(String(args[0] || '').length * (fontPx * 0.56))); return true; }
      if (name === 'substringWidth') {
        const s = String(args[0] || '').slice(Number(args[1] ?? 0), Number(args[1] ?? 0) + Number(args[2] ?? 0));
        pushRet(Math.round(s.length * (fontPx * 0.56)));
        return true;
      }
      if (name === 'charWidth') { pushRet(Math.round(fontPx * 0.56)); return true; }
      if (name === 'charsWidth') { pushRet(Math.round(Number(args[2] ?? 0) * (fontPx * 0.56))); return true; }
    }

    // Streams: InputStream, ByteArrayInputStream, DataInputStream, ByteArrayOutputStream, DataOutputStream, PrintStream
    if (
      declaredClass === 'java/io/InputStream' ||
      declaredClass === 'java/io/ByteArrayInputStream' ||
      declaredClass === 'java/io/DataInputStream' ||
      this.isSubclass(targetClass, 'java/io/InputStream')
    ) {
      if (name === '<init>' && isObject(receiver)) {
        if (descriptor === '([B)V' && isArray(args[0])) {
          const bytes = new Uint8Array(args[0].items.map((v) => Number(v ?? 0) & 0xff));
          receiver.internal = { stream: { data: bytes, pos: 0, mark: 0 } };
        } else if (descriptor === '([BII)V' && isArray(args[0])) {
          const off = Number(args[1] ?? 0);
          const len = Number(args[2] ?? 0);
          const bytes = new Uint8Array(Math.max(0, len));
          for (let i = 0; i < len; i++) bytes[i] = Number(args[0].items[off + i] ?? 0) & 0xff;
          receiver.internal = { stream: { data: bytes, pos: 0, mark: 0 } };
        } else if (descriptor === '(Ljava/io/InputStream;)V' && isObject(args[0])) {
          receiver.internal = { stream: args[0].internal?.stream || { data: new Uint8Array(0), pos: 0, mark: 0 } };
        }
        return true;
      }

      const st = isObject(receiver) ? receiver.internal?.stream : undefined;
      if (!st) {
        if (name === 'close') return true;
        if (hasReturn) pushRet(-1);
        return true;
      }

      const readByteU = () => (st.pos < st.data.length ? st.data[st.pos++] : -1);
      const readByteS = () => {
        const b = readByteU();
        return b < 0 ? 0 : (b << 24) >> 24;
      };

      if (name === 'available') { pushRet(Math.max(0, st.data.length - st.pos)); return true; }
      if (name === 'close') return true;
      if (name === 'mark') { st.mark = st.pos; return true; }
      if (name === 'reset') { st.pos = st.mark; return true; }
      if (name === 'markSupported') { pushRet(1); return true; }
      if (name === 'skip' || name === 'skipBytes') {
        const n = Math.min(Number(args[0] ?? 0), st.data.length - st.pos);
        st.pos += Math.max(0, n);
        pushRet(declaredClass === 'java/io/DataInputStream' && name === 'skipBytes' ? n : BigInt(n));
        return true;
      }
      if (name === 'read') {
        if (args.length === 0) { pushRet(readByteU()); return true; }
        const arr = args[0];
        const off = args.length >= 3 ? Number(args[1] ?? 0) : 0;
        const len = args.length >= 3 ? Number(args[2] ?? 0) : isArray(arr) ? arr.items.length : 0;
        if (!isArray(arr) || st.pos >= st.data.length) { pushRet(-1); return true; }
        const count = Math.min(len, st.data.length - st.pos);
        for (let i = 0; i < count; i++) {
          arr.items[off + i] = (st.data[st.pos++] << 24) >> 24;
        }
        pushRet(count);
        return true;
      }
      if (name === 'readFully') {
        const arr = args[0];
        const off = args.length >= 3 ? Number(args[1] ?? 0) : 0;
        const len = args.length >= 3 ? Number(args[2] ?? 0) : isArray(arr) ? arr.items.length : 0;
        if (isArray(arr)) {
          for (let i = 0; i < len && st.pos < st.data.length; i++) {
            arr.items[off + i] = (st.data[st.pos++] << 24) >> 24;
          }
        }
        return true;
      }
      if (name === 'readBoolean') { pushRet(readByteU() > 0 ? 1 : 0); return true; }
      if (name === 'readByte') { pushRet(readByteS()); return true; }
      if (name === 'readUnsignedByte') { pushRet(Math.max(0, readByteU())); return true; }
      if (name === 'readShort') {
        const v = (Math.max(0, readByteU()) << 8) | Math.max(0, readByteU());
        pushRet((v << 16) >> 16);
        return true;
      }
      if (name === 'readUnsignedShort' || name === 'readChar') {
        const v = (Math.max(0, readByteU()) << 8) | Math.max(0, readByteU());
        pushRet(v & 0xffff);
        return true;
      }
      if (name === 'readInt') {
        const v =
          (Math.max(0, readByteU()) << 24) |
          (Math.max(0, readByteU()) << 16) |
          (Math.max(0, readByteU()) << 8) |
          Math.max(0, readByteU());
        pushRet(v | 0);
        return true;
      }
      if (name === 'readLong') {
        let v = 0n;
        for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(Math.max(0, readByteU()));
        pushRet(BigInt.asIntN(64, v));
        return true;
      }
      if (name === 'readFloat' || name === 'readDouble') { pushRet(0); return true; }
      if (name === 'readUTF') {
        const len = (Math.max(0, readByteU()) << 8) | Math.max(0, readByteU());
        const slice = st.data.subarray(st.pos, st.pos + len);
        st.pos = Math.min(st.data.length, st.pos + len);
        pushRet(decodeJavaModifiedUtf8(slice));
        return true;
      }
    }

    if (
      declaredClass === 'java/io/OutputStream' ||
      declaredClass === 'java/io/ByteArrayOutputStream' ||
      declaredClass === 'java/io/DataOutputStream' ||
      this.isSubclass(targetClass, 'java/io/OutputStream')
    ) {
      if (name === '<init>' && isObject(receiver)) {
        if (descriptor === '(Ljava/io/OutputStream;)V' && isObject(args[0])) {
          receiver.internal = { outStream: args[0].internal?.outStream || { bytes: [] } };
        } else {
          receiver.internal = { outStream: { bytes: [] } };
        }
        return true;
      }
      const out = isObject(receiver) ? (receiver.internal?.outStream || { bytes: [] }) : { bytes: [] };
      if (name === 'write') {
        if (args.length === 1 && typeof args[0] === 'number') out.bytes.push(args[0] & 0xff);
        else if (isArray(args[0])) {
          const off = args.length >= 3 ? Number(args[1] ?? 0) : 0;
          const len = args.length >= 3 ? Number(args[2] ?? 0) : args[0].items.length;
          for (let i = 0; i < len; i++) out.bytes.push(Number(args[0].items[off + i] ?? 0) & 0xff);
        }
        return true;
      }
      if (name === 'writeBoolean' || name === 'writeByte') { out.bytes.push(Number(args[0] ?? 0) & 0xff); return true; }
      if (name === 'writeShort' || name === 'writeChar') {
        const v = Number(args[0] ?? 0);
        out.bytes.push((v >> 8) & 0xff, v & 0xff);
        return true;
      }
      if (name === 'writeInt') {
        const v = Number(args[0] ?? 0);
        out.bytes.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
        return true;
      }
      if (name === 'writeLong') {
        let v = typeof args[0] === 'bigint' ? args[0] : BigInt(Number(args[0] ?? 0));
        for (let shift = 56n; shift >= 0n; shift -= 8n) out.bytes.push(Number((v >> shift) & 0xffn));
        return true;
      }
      if (name === 'writeUTF') {
        const enc = new TextEncoder().encode(String(args[0] || ''));
        out.bytes.push((enc.length >> 8) & 0xff, enc.length & 0xff, ...enc);
        return true;
      }
      if (name === 'toByteArray') {
        pushRet({ __type: 'array', elementType: 'B', items: out.bytes.map((b) => (b << 24) >> 24) });
        return true;
      }
      if (name === 'size') { pushRet(out.bytes.length); return true; }
      if (name === 'reset') { out.bytes.length = 0; return true; }
      if (name === 'flush' || name === 'close') return true;
    }

    if (declaredClass === 'java/io/PrintStream') {
      if (name === 'println' || name === 'print') {
        if (args[0] !== undefined && args[0] !== null) this.log(String(args[0]));
        return true;
      }
    }

    if (
      declaredClass === 'java/io/InputStreamReader' ||
      declaredClass === 'java/io/Reader' ||
      targetClass === 'java/io/InputStreamReader'
    ) {
      if (name === '<init>' && isObject(receiver) && isObject(args[0])) {
        receiver.internal = { stream: args[0].internal?.stream || { data: new Uint8Array(0), pos: 0, mark: 0 } };
        return true;
      }
      const st = isObject(receiver) ? receiver.internal?.stream : undefined;
      if (name === 'close') return true;
      if (name === 'read') {
        if (!st || st.pos >= st.data.length) { pushRet(-1); return true; }
        pushRet(st.data[st.pos++]);
        return true;
      }
    }

    // RecordStore (backed by localStorage)
    if (declaredClass === 'javax/microedition/rms/RecordStore') {
      const storageKey = (n: string) => `javadeck_rms_${n}`;
      const readAll = (n: string): number[][] => {
        try {
          const raw = localStorage.getItem(storageKey(n));
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      };
      const writeAll = (n: string, recs: number[][]) => {
        try { localStorage.setItem(storageKey(n), JSON.stringify(recs)); } catch { /* ignore */ }
      };

      if (name === 'openRecordStore') {
        const rsName = String(args[0] || 'default');
        const obj = this.createObject('javax/microedition/rms/RecordStore');
        obj.internal = { recordStoreName: rsName };
        pushRet(obj);
        return true;
      }
      if (name === 'deleteRecordStore') {
        try { localStorage.removeItem(storageKey(String(args[0] || ''))); } catch { /* ignore */ }
        return true;
      }
      if (name === 'listRecordStores') {
        pushRet(null);
        return true;
      }
      const rsName = isObject(receiver) ? receiver.internal?.recordStoreName || 'default' : 'default';
      if (name === 'closeRecordStore') return true;
      if (name === 'getNumRecords') { pushRet(readAll(rsName).length); return true; }
      if (name === 'getRecord') {
        const id = Number(args[0] ?? 1) - 1;
        const recs = readAll(rsName);
        const r = recs[id] || [];
        pushRet({ __type: 'array', elementType: 'B', items: r.map((b) => (b << 24) >> 24) });
        return true;
      }
      if (name === 'getRecordSize') {
        const id = Number(args[0] ?? 1) - 1;
        pushRet((readAll(rsName)[id] || []).length);
        return true;
      }
      if (name === 'addRecord') {
        const recs = readAll(rsName);
        const arr = args[0];
        const off = Number(args[1] ?? 0);
        const len = Number(args[2] ?? 0);
        const bytes: number[] = [];
        if (isArray(arr)) {
          for (let i = 0; i < len; i++) bytes.push(Number(arr.items[off + i] ?? 0) & 0xff);
        }
        recs.push(bytes);
        writeAll(rsName, recs);
        pushRet(recs.length);
        return true;
      }
      if (name === 'setRecord') {
        const id = Number(args[0] ?? 1) - 1;
        const recs = readAll(rsName);
        const arr = args[1];
        const off = Number(args[2] ?? 0);
        const len = Number(args[3] ?? 0);
        const bytes: number[] = [];
        if (isArray(arr)) {
          for (let i = 0; i < len; i++) bytes.push(Number(arr.items[off + i] ?? 0) & 0xff);
        }
        if (id >= 0) {
          recs[id] = bytes;
          writeAll(rsName, recs);
        }
        return true;
      }
    }

    // Thread & Timer
    if (
      declaredClass === 'java/lang/Thread' ||
      this.isSubclass(targetClass, 'java/lang/Thread')
    ) {
      if (name === '<init>' && isObject(receiver)) {
        if (!receiver.internal) receiver.internal = {};
        receiver.internal.runnable = isObject(args[0]) ? args[0] : receiver;
        return true;
      }
      if (name === 'start' && isObject(receiver)) {
        const target = receiver.internal?.runnable || receiver;
        const found = this.findMethod(target.className, 'run', '()V');
        if (found && found.method.code) {
          this.threads.push({
            id: this.nextThreadId++,
            frames: [{ cls: found.cls, method: found.method, pc: 0, locals: [target], stack: [] }],
            sleepUntil: 0,
            finished: false,
          });
        }
        return true;
      }
      if (name === 'sleep') {
        const ms = Number(args[0] ?? 16);
        if (thread.id !== 0) {
          thread.sleepUntil = performance.now() + Math.max(10, Math.min(ms, 2000));
        }
        return true;
      }
      if (name === 'yield' || name === 'setPriority' || name === 'join' || name === 'interrupt') return true;
      if (name === 'isAlive') { pushRet(1); return true; }
      if (name === 'currentThread') { pushRet(this.createObject('java/lang/Thread')); return true; }
    }

    if (
      declaredClass === 'java/util/Timer' ||
      declaredClass === 'java/util/TimerTask' ||
      this.isSubclass(targetClass, 'java/util/TimerTask') ||
      this.isSubclass(targetClass, 'java/util/Timer')
    ) {
      if (name === '<init>') return true;
      if (name === 'cancel') {
        if (isObject(receiver)) {
          if (!receiver.internal) receiver.internal = {};
          receiver.internal.timerCancelled = true;
        }
        if (hasReturn) pushRet(1);
        return true;
      }
      if ((name === 'schedule' || name === 'scheduleAtFixedRate') && isObject(args[0])) {
        const task = args[0];
        const delay = Number(args[1] ?? 16);
        const period = args.length >= 3 ? Number(args[2] ?? 0) : undefined;
        const found = this.findMethod(task.className, 'run', '()V');
        if (found && found.method.code) {
          this.threads.push({
            id: this.nextThreadId++,
            frames: [{ cls: found.cls, method: found.method, pc: 0, locals: [task], stack: [] }],
            sleepUntil: performance.now() + Math.max(10, delay),
            repeatIntervalMs: period && period > 0 ? Math.max(16, period) : undefined,
            timerTaskObj: task,
            finished: false,
          });
        }
        return true;
      }
    }

    // System, Runtime, Math, Random
    if (declaredClass === 'java/lang/System') {
      if (name === 'currentTimeMillis') { pushRet(BigInt(Date.now())); return true; }
      if (name === 'nanoTime') { pushRet(BigInt(Math.trunc(performance.now() * 1e6))); return true; }
      if (name === 'exit') {
        this.state.status = 'halted';
        this.log(`MIDlet đã thoát (exit ${args[0] ?? 0})`);
        this.emitState();
        return true;
      }
      if (name === 'gc') return true;
      if (name === 'identityHashCode') { pushRet(isObject(args[0]) ? args[0].internal?.hashId ?? 1 : 0); return true; }
      if (name === 'getProperty') {
        const k = String(args[0] || '');
        const table: Record<string, string> = {
          'microedition.platform': 'JavaDeck/MIDP-2.1',
          'microedition.locale': 'vi-VN',
          'microedition.encoding': 'UTF-8',
          'microedition.profiles': 'MIDP-2.1',
          'microedition.configuration': 'CLDC-1.1',
        };
        pushRet(table[k] ?? null);
        return true;
      }
      if (name === 'arraycopy') {
        const src = args[0];
        const srcPos = Number(args[1] ?? 0);
        const dest = args[2];
        const destPos = Number(args[3] ?? 0);
        const len = Number(args[4] ?? 0);
        if (isArray(src) && isArray(dest)) {
          const temp = src.items.slice(srcPos, srcPos + len);
          for (let i = 0; i < temp.length; i++) dest.items[destPos + i] = temp[i];
        }
        return true;
      }
    }

    if (declaredClass === 'java/lang/Runtime') {
      if (name === 'getRuntime') { pushRet(this.createObject('java/lang/Runtime')); return true; }
      if (name === 'freeMemory') { pushRet(4194304n); return true; }
      if (name === 'totalMemory') { pushRet(8388608n); return true; }
      if (name === 'gc') return true;
    }

    if (declaredClass === 'java/lang/Math') {
      const a = Number(args[0] ?? 0);
      const b = Number(args[1] ?? 0);
      if (name === 'abs') { pushRet(typeof args[0] === 'bigint' ? (args[0] < 0n ? -args[0] : args[0]) : Math.abs(a)); return true; }
      if (name === 'min') {
        if (typeof args[0] === 'bigint' && typeof args[1] === 'bigint') {
          pushRet(args[0] < args[1] ? args[0] : args[1]);
        } else {
          pushRet(Math.min(a, b));
        }
        return true;
      }
      if (name === 'max') {
        if (typeof args[0] === 'bigint' && typeof args[1] === 'bigint') {
          pushRet(args[0] > args[1] ? args[0] : args[1]);
        } else {
          pushRet(Math.max(a, b));
        }
        return true;
      }
      if (name === 'sin') { pushRet(Math.sin(a)); return true; }
      if (name === 'cos') { pushRet(Math.cos(a)); return true; }
      if (name === 'tan') { pushRet(Math.tan(a)); return true; }
      if (name === 'sqrt') { pushRet(Math.sqrt(a)); return true; }
      if (name === 'floor') { pushRet(Math.floor(a)); return true; }
      if (name === 'ceil') { pushRet(Math.ceil(a)); return true; }
    }

    if (declaredClass === 'java/util/Random') {
      if (name === '<init>') return true;
      if (name === 'setSeed') return true;
      if (name === 'nextInt') {
        if (args.length === 1) {
          const bound = Math.max(1, Number(args[0] ?? 1));
          pushRet(Math.floor(Math.random() * bound));
        } else {
          pushRet((Math.random() * 0xffffffff) | 0);
        }
        return true;
      }
      if (name === 'nextLong') { pushRet(BigInt(Math.floor(Math.random() * 1e12))); return true; }
      if (name === 'nextBoolean') { pushRet(Math.random() < 0.5 ? 1 : 0); return true; }
      if (name === 'nextFloat' || name === 'nextDouble') { pushRet(Math.random()); return true; }
      if (name === 'nextBytes' && isArray(args[0])) {
        for (let i = 0; i < args[0].items.length; i++) {
          args[0].items[i] = ((Math.random() * 256) | 0) - 128;
        }
        return true;
      }
    }

    // Vector, Stack, Hashtable, Enumeration
    if (
      declaredClass === 'java/util/Vector' ||
      declaredClass === 'java/util/Stack' ||
      this.isSubclass(targetClass, 'java/util/Vector')
    ) {
      if (name === '<init>' && isObject(receiver)) {
        receiver.internal = { ...receiver.internal, vec: [] };
        return true;
      }
      const vec = isObject(receiver) ? (receiver.internal?.vec || []) : [];
      if (name === 'addElement' || name === 'push') { vec.push(args[0] ?? null); if (hasReturn) pushRet(args[0] ?? null); return true; }
      if (name === 'insertElementAt') { vec.splice(Number(args[1] ?? 0), 0, args[0] ?? null); return true; }
      if (name === 'setElementAt') { vec[Number(args[1] ?? 0)] = args[0] ?? null; return true; }
      if (name === 'elementAt') { pushRet(vec[Number(args[0] ?? 0)] ?? null); return true; }
      if (name === 'firstElement') { pushRet(vec[0] ?? null); return true; }
      if (name === 'lastElement' || name === 'peek') { pushRet(vec[vec.length - 1] ?? null); return true; }
      if (name === 'pop') { pushRet(vec.pop() ?? null); return true; }
      if (name === 'size') { pushRet(vec.length); return true; }
      if (name === 'isEmpty' || name === 'empty') { pushRet(vec.length === 0 ? 1 : 0); return true; }
      if (name === 'indexOf') { pushRet(vec.indexOf(args[0] ?? null)); return true; }
      if (name === 'contains') { pushRet(vec.includes(args[0] ?? null) ? 1 : 0); return true; }
      if (name === 'removeElement') {
        const idx = vec.indexOf(args[0] ?? null);
        if (idx >= 0) vec.splice(idx, 1);
        pushRet(idx >= 0 ? 1 : 0);
        return true;
      }
      if (name === 'removeElementAt') { vec.splice(Number(args[0] ?? 0), 1); return true; }
      if (name === 'removeAllElements') { vec.length = 0; return true; }
      if (name === 'copyInto' && isArray(args[0])) {
        for (let i = 0; i < vec.length; i++) args[0].items[i] = vec[i];
        return true;
      }
      if (name === 'elements') {
        const en = this.createObject('java/util/Enumeration');
        en.internal = { vec: [...vec], hashId: 0 };
        pushRet(en);
        return true;
      }
    }

    if (declaredClass === 'java/util/Hashtable' || this.isSubclass(targetClass, 'java/util/Hashtable')) {
      if (name === '<init>' && isObject(receiver)) {
        receiver.internal = { ...receiver.internal, map: new Map() };
        return true;
      }
      const map = isObject(receiver) ? receiver.internal?.map : undefined;
      const keyStr = (k: JvmValue) => (isObject(k) ? `obj:${k.internal?.hashId}` : String(k));
      if (!map) return true;
      if (name === 'put') {
        const k = keyStr(args[0] ?? null);
        const prev = map.get(k)?.value ?? null;
        map.set(k, { key: args[0] ?? null, value: args[1] ?? null });
        pushRet(prev);
        return true;
      }
      if (name === 'get') { pushRet(map.get(keyStr(args[0] ?? null))?.value ?? null); return true; }
      if (name === 'remove') {
        const k = keyStr(args[0] ?? null);
        const prev = map.get(k)?.value ?? null;
        map.delete(k);
        pushRet(prev);
        return true;
      }
      if (name === 'containsKey') { pushRet(map.has(keyStr(args[0] ?? null)) ? 1 : 0); return true; }
      if (name === 'size') { pushRet(map.size); return true; }
      if (name === 'isEmpty') { pushRet(map.size === 0 ? 1 : 0); return true; }
      if (name === 'clear') { map.clear(); return true; }
      if (name === 'keys' || name === 'elements') {
        const en = this.createObject('java/util/Enumeration');
        const list = Array.from(map.values()).map((e) => (name === 'keys' ? e.key : e.value));
        en.internal = { vec: list, hashId: 0 };
        pushRet(en);
        return true;
      }
    }

    if (declaredClass === 'java/util/Enumeration') {
      const vec = isObject(receiver) ? receiver.internal?.vec || [] : [];
      const pos = isObject(receiver) ? receiver.internal?.hashId || 0 : 0;
      if (name === 'hasMoreElements') { pushRet(pos < vec.length ? 1 : 0); return true; }
      if (name === 'nextElement') {
        if (isObject(receiver) && receiver.internal) receiver.internal.hashId = pos + 1;
        pushRet(vec[pos] ?? null);
        return true;
      }
    }

    // Date & Calendar
    if (declaredClass === 'java/util/Date') {
      if (name === '<init>' && isObject(receiver)) {
        receiver.fields.__ms = args[0] !== undefined ? BigInt(args[0] as bigint) : BigInt(Date.now());
        return true;
      }
      if (name === 'getTime') { pushRet((isObject(receiver) ? receiver.fields.__ms : BigInt(Date.now())) ?? BigInt(Date.now())); return true; }
    }

    if (declaredClass === 'java/util/Calendar') {
      if (name === 'getInstance') { pushRet(this.createObject('java/util/Calendar')); return true; }
      if (name === 'setTime') return true;
      if (name === 'get') {
        const f = Number(args[0] ?? 0);
        const d = new Date();
        const vals: Record<number, number> = {
          1: d.getFullYear(), 2: d.getMonth(), 5: d.getDate(),
          11: d.getHours(), 12: d.getMinutes(), 13: d.getSeconds(),
        };
        pushRet(vals[f] ?? 0);
        return true;
      }
    }

    // StringBuffer / StringBuilder
    if (declaredClass === 'java/lang/StringBuffer' || declaredClass === 'java/lang/StringBuilder') {
      if (name === '<init>' && isObject(receiver)) {
        receiver.internal = { ...receiver.internal, str: typeof args[0] === 'string' ? args[0] : '' };
        return true;
      }
      if (name === 'append' && isObject(receiver)) {
        if (!receiver.internal) receiver.internal = {};
        let chunk = '';
        if (descriptor.startsWith('(C)')) {
          chunk = String.fromCharCode(Number(args[0] ?? 0));
        } else if (descriptor.startsWith('(Z)')) {
          chunk = Number(args[0] ?? 0) !== 0 ? 'true' : 'false';
        } else if (isArray(args[0])) {
          const off = args.length >= 3 ? Number(args[1] ?? 0) : 0;
          const len = args.length >= 3 ? Number(args[2] ?? 0) : args[0].items.length;
          chunk = args[0].items.slice(off, off + len).map((c) => String.fromCharCode(Number(c ?? 0))).join('');
        } else {
          chunk = String(args[0] ?? 'null');
        }
        receiver.internal.str = (receiver.internal.str || '') + chunk;
        pushRet(receiver);
        return true;
      }
      if (name === 'insert' && isObject(receiver)) {
        if (!receiver.internal) receiver.internal = {};
        const s = receiver.internal.str || '';
        const idx = Math.max(0, Math.min(s.length, Number(args[0] ?? 0)));
        const ins = descriptor.includes('(IC)') ? String.fromCharCode(Number(args[1] ?? 0)) : String(args[1] ?? '');
        receiver.internal.str = s.slice(0, idx) + ins + s.slice(idx);
        pushRet(receiver);
        return true;
      }
      if (name === 'delete' && isObject(receiver)) {
        if (!receiver.internal) receiver.internal = {};
        const s = receiver.internal.str || '';
        const start = Number(args[0] ?? 0);
        const end = Number(args[1] ?? s.length);
        receiver.internal.str = s.slice(0, start) + s.slice(end);
        pushRet(receiver);
        return true;
      }
      if (name === 'length' && isObject(receiver)) { pushRet((receiver.internal?.str || '').length); return true; }
      if (name === 'setLength' && isObject(receiver)) {
        if (receiver.internal) receiver.internal.str = (receiver.internal.str || '').slice(0, Number(args[0] ?? 0));
        return true;
      }
      if (name === 'charAt' && isObject(receiver)) { pushRet((receiver.internal?.str || '').charCodeAt(Number(args[0] ?? 0)) || 0); return true; }
      if (name === 'deleteCharAt' && isObject(receiver)) {
        const s = receiver.internal?.str || '';
        const idx = Number(args[0] ?? 0);
        if (receiver.internal) receiver.internal.str = s.slice(0, idx) + s.slice(idx + 1);
        pushRet(receiver);
        return true;
      }
      if (name === 'toString' && isObject(receiver)) { pushRet(receiver.internal?.str || ''); return true; }
    }

    // java.lang.String
    if (declaredClass === 'java/lang/String') {
      if (name === '<init>') {
        let s = '';
        if (args.length === 0) s = '';
        else if (typeof args[0] === 'string') s = args[0];
        else if (isObject(args[0]) && args[0].internal?.str !== undefined) s = args[0].internal.str;
        else if (isArray(args[0])) {
          const arr = args[0].items;
          const off = typeof args[1] === 'number' ? args[1] : 0;
          const len = typeof args[2] === 'number' ? args[2] : arr.length - off;
          if (descriptor.includes('[C')) {
            s = arr.slice(off, off + len).map((c) => String.fromCharCode(Number(c ?? 0))).join('');
          } else {
            const bytes = new Uint8Array(Math.max(0, len));
            for (let i = 0; i < len; i++) bytes[i] = Number(arr[off + i] ?? 0) & 0xff;
            s = decodeJavaModifiedUtf8(bytes);
          }
        }
        // Replace 'new String(...)' uninitialized object on stack with JS string!
        if (isObject(receiver)) {
          for (const f of thread.frames) {
            f.stack = f.stack.map((v) => (v === receiver ? s : v));
            f.locals = f.locals.map((v) => (v === receiver ? s : v));
          }
        }
        return true;
      }
      const str = String(receiver ?? '');
      if (name === 'valueOf') {
        if (descriptor === '(C)Ljava/lang/String;') pushRet(String.fromCharCode(Number(args[0] ?? 0)));
        else if (descriptor === '(Z)Ljava/lang/String;') pushRet(Number(args[0] ?? 0) !== 0 ? 'true' : 'false');
        else pushRet(String(args[0] ?? 'null'));
        return true;
      }
      if (name === 'length') { pushRet(str.length); return true; }
      if (name === 'charAt') { pushRet(str.charCodeAt(Number(args[0] ?? 0)) || 0); return true; }
      if (name === 'substring') {
        const a = Number(args[0] ?? 0);
        pushRet(args.length >= 2 ? str.slice(a, Number(args[1] ?? str.length)) : str.slice(a));
        return true;
      }
      if (name === 'indexOf') {
        const needle = typeof args[0] === 'number' ? String.fromCharCode(args[0]) : String(args[0] ?? '');
        pushRet(str.indexOf(needle, Number(args[1] ?? 0)));
        return true;
      }
      if (name === 'lastIndexOf') {
        const needle = typeof args[0] === 'number' ? String.fromCharCode(args[0]) : String(args[0] ?? '');
        pushRet(args.length >= 2 ? str.lastIndexOf(needle, Number(args[1])) : str.lastIndexOf(needle));
        return true;
      }
      if (name === 'startsWith') { pushRet(str.startsWith(String(args[0] ?? ''), Number(args[1] ?? 0)) ? 1 : 0); return true; }
      if (name === 'endsWith') { pushRet(str.endsWith(String(args[0] ?? '')) ? 1 : 0); return true; }
      if (name === 'equals') { pushRet(str === String(args[0]) ? 1 : 0); return true; }
      if (name === 'equalsIgnoreCase') { pushRet(str.toLowerCase() === String(args[0] ?? '').toLowerCase() ? 1 : 0); return true; }
      if (name === 'compareTo') {
        const o = String(args[0] ?? '');
        pushRet(str === o ? 0 : str < o ? -1 : 1);
        return true;
      }
      if (name === 'trim') { pushRet(str.trim()); return true; }
      if (name === 'toLowerCase') { pushRet(str.toLowerCase()); return true; }
      if (name === 'toUpperCase') { pushRet(str.toUpperCase()); return true; }
      if (name === 'concat') { pushRet(str + String(args[0] ?? '')); return true; }
      if (name === 'replace') {
        const o = String.fromCharCode(Number(args[0] ?? 0));
        const n = String.fromCharCode(Number(args[1] ?? 0));
        pushRet(str.split(o).join(n));
        return true;
      }
      if (name === 'toCharArray') {
        pushRet({ __type: 'array', elementType: 'C', items: Array.from(str).map((c) => c.charCodeAt(0)) });
        return true;
      }
      if (name === 'getBytes') {
        const enc = new TextEncoder().encode(str);
        pushRet({ __type: 'array', elementType: 'B', items: Array.from(enc).map((b) => (b << 24) >> 24) });
        return true;
      }
      if (name === 'hashCode') {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
        pushRet(h);
        return true;
      }
      if (name === 'toString' || name === 'intern') { pushRet(str); return true; }
    }

    // Wrappers: Integer, Long, Byte, Short, Boolean, Character
    if (declaredClass === 'java/lang/Integer' || declaredClass === 'java/lang/Long' || declaredClass === 'java/lang/Short' || declaredClass === 'java/lang/Byte') {
      if (name === '<init>' && isObject(receiver)) { receiver.fields.val = args[0] ?? 0; return true; }
      if (name === 'intValue' || name === 'shortValue' || name === 'byteValue') { pushRet(Number(isObject(receiver) ? receiver.fields.val : 0)); return true; }
      if (name === 'longValue') { pushRet(BigInt(Number(isObject(receiver) ? receiver.fields.val : 0))); return true; }
      if (name === 'toString') { pushRet(String(args[0] ?? (isObject(receiver) ? receiver.fields.val : 0))); return true; }
      if (name === 'toHexString') { pushRet((Number(args[0] ?? 0) >>> 0).toString(16)); return true; }
      if (name === 'toBinaryString') { pushRet((Number(args[0] ?? 0) >>> 0).toString(2)); return true; }
      if (name === 'parseInt' || name === 'parseLong') {
        const radix = args.length >= 2 ? Number(args[1] ?? 10) : 10;
        const parsed = parseInt(String(args[0] || '0').trim(), radix);
        if (Number.isNaN(parsed)) {
          const exc = this.createObject('java/lang/NumberFormatException');
          this.throwJvmException(thread, exc);
          return true;
        }
        pushRet(declaredClass === 'java/lang/Long' || name === 'parseLong' ? BigInt(parsed) : parsed | 0);
        return true;
      }
      if (name === 'valueOf') {
        const obj = this.createObject(declaredClass);
        obj.fields.val = typeof args[0] === 'string' ? parseInt(args[0], 10) || 0 : (args[0] ?? 0);
        pushRet(obj);
        return true;
      }
    }

    if (declaredClass === 'java/lang/Boolean') {
      if (name === '<init>' && isObject(receiver)) { receiver.fields.val = Number(args[0] ?? 0); return true; }
      if (name === 'booleanValue') { pushRet(isObject(receiver) ? Number(receiver.fields.val ?? 0) : 0); return true; }
    }

    if (declaredClass === 'java/lang/Character') {
      const ch = String.fromCharCode(Number(args[0] ?? 0));
      if (name === 'isDigit') { pushRet(/\d/.test(ch) ? 1 : 0); return true; }
      if (name === 'isLetter') { pushRet(/[a-zA-Z]/.test(ch) ? 1 : 0); return true; }
      if (name === 'toLowerCase') { pushRet(ch.toLowerCase().charCodeAt(0)); return true; }
      if (name === 'toUpperCase') { pushRet(ch.toUpperCase().charCodeAt(0)); return true; }
    }

    // Media / Sound stubs (Manager, Player, VolumeControl)
    if (
      declaredClass === 'javax/microedition/media/Manager' ||
      declaredClass === 'javax/microedition/media/Player' ||
      declaredClass === 'javax/microedition/media/Control' ||
      declaredClass === 'javax/microedition/media/control/VolumeControl'
    ) {
      if (name === 'createPlayer') { pushRet(this.createObject('javax/microedition/media/Player')); return true; }
      if (name === 'getControl') { pushRet(this.createObject('javax/microedition/media/control/VolumeControl')); return true; }
      if (name === 'getState') { pushRet(200); return true; }
      if (name === 'setLevel') { pushRet(Number(args[0] ?? 50)); return true; }
      if (name === 'playTone' || name === 'realize' || name === 'prefetch' || name === 'start' || name === 'stop' || name === 'close' || name === 'deallocate' || name === 'setLoopCount' || name === 'addPlayerListener') {
        return true;
      }
    }

    // Network Connector stub (throws IOException cleanly so games show network/offline prompt rather than crashing VM)
    if (declaredClass === 'javax/microedition/io/Connector') {
      const url = String(args[0] || '');
      this.log(`Yêu cầu mạng: ${url} (Chế độ trình duyệt ngoại tuyến)`);
      const exc = this.createObject('java/io/IOException');
      exc.internal = { str: `Socket/HTTP offline: ${url}` };
      this.throwJvmException(thread, exc);
      return true;
    }

    return false;
  }

  private handleGraphicsCall(
    g: CanvasGraphicState,
    name: string,
    descriptor: string,
    args: JvmValue[],
    pushRet: (val: JvmValue) => void
  ) {
    const ctx = g.ctx;
    const tx = g.tx;
    const ty = g.ty;
    const n = (i: number) => Number(args[i] ?? 0);

    switch (name) {
      case 'setColor': {
        const rgb = args.length === 1 ? n(0) : ((n(0) & 0xff) << 16) | ((n(1) & 0xff) << 8) | (n(2) & 0xff);
        g.rgb = rgb;
        g.color = rgbToCss(rgb);
        ctx.fillStyle = g.color;
        ctx.strokeStyle = g.color;
        break;
      }
      case 'getColor': pushRet(g.rgb); break;
      case 'getDisplayColor': pushRet(n(0)); break;
      case 'setStrokeStyle': g.strokeStyle = n(0); break;
      case 'getStrokeStyle': pushRet(g.strokeStyle); break;
      case 'fillRect':
        ctx.fillStyle = g.color;
        ctx.fillRect(n(0) + tx, n(1) + ty, n(2), n(3));
        break;
      case 'drawRect':
        ctx.strokeStyle = g.color;
        ctx.strokeRect(n(0) + tx + 0.5, n(1) + ty + 0.5, n(2), n(3));
        break;
      case 'fillRoundRect':
        ctx.fillStyle = g.color;
        ctx.beginPath();
        ctx.roundRect(n(0) + tx, n(1) + ty, n(2), n(3), Math.max(0, Math.min(n(4), n(5)) / 2));
        ctx.fill();
        break;
      case 'drawRoundRect':
        ctx.strokeStyle = g.color;
        ctx.beginPath();
        ctx.roundRect(n(0) + tx + 0.5, n(1) + ty + 0.5, n(2), n(3), Math.max(0, Math.min(n(4), n(5)) / 2));
        ctx.stroke();
        break;
      case 'drawLine':
        ctx.strokeStyle = g.color;
        ctx.beginPath();
        ctx.moveTo(n(0) + tx + 0.5, n(1) + ty + 0.5);
        ctx.lineTo(n(2) + tx + 0.5, n(3) + ty + 0.5);
        ctx.stroke();
        break;
      case 'fillArc': {
        const x = n(0) + tx; const y = n(1) + ty; const w = n(2); const h = n(3);
        const startDeg = -n(4); const arcDeg = -n(5);
        ctx.fillStyle = g.color;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, (startDeg * Math.PI) / 180, ((startDeg + arcDeg) * Math.PI) / 180, arcDeg < 0);
        ctx.lineTo(x + w / 2, y + h / 2);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'drawArc': {
        const x = n(0) + tx; const y = n(1) + ty; const w = n(2); const h = n(3);
        const startDeg = -n(4); const arcDeg = -n(5);
        ctx.strokeStyle = g.color;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, (startDeg * Math.PI) / 180, ((startDeg + arcDeg) * Math.PI) / 180, arcDeg < 0);
        ctx.stroke();
        break;
      }
      case 'fillTriangle':
        ctx.fillStyle = g.color;
        ctx.beginPath();
        ctx.moveTo(n(0) + tx, n(1) + ty);
        ctx.lineTo(n(2) + tx, n(3) + ty);
        ctx.lineTo(n(4) + tx, n(5) + ty);
        ctx.closePath();
        ctx.fill();
        break;
      case 'drawString':
      case 'drawSubstring':
      case 'drawChar':
      case 'drawChars': {
        let str = '';
        let x = 0; let y = 0; let anchor = 20;
        if (name === 'drawString') {
          str = String(args[0] ?? '');
          x = n(1) + tx; y = n(2) + ty; anchor = n(3);
        } else if (name === 'drawSubstring') {
          str = String(args[0] ?? '').slice(n(1), n(1) + n(2));
          x = n(3) + tx; y = n(4) + ty; anchor = n(5);
        } else if (name === 'drawChar') {
          str = String.fromCharCode(n(0));
          x = n(1) + tx; y = n(2) + ty; anchor = n(3);
        } else {
          const arr = args[0];
          if (isArray(arr)) {
            str = arr.items.slice(n(1), n(1) + n(2)).map((c) => String.fromCharCode(Number(c ?? 0))).join('');
          }
          x = n(3) + tx; y = n(4) + ty; anchor = n(5);
        }
        ctx.fillStyle = g.color;
        ctx.font = `${g.fontBold ? 'bold ' : ''}${g.fontSize}px "JetBrains Mono", monospace`;
        if (anchor & ANCHOR_HCENTER) ctx.textAlign = 'center';
        else if (anchor & ANCHOR_RIGHT) ctx.textAlign = 'right';
        else ctx.textAlign = 'left';

        if (anchor & ANCHOR_BOTTOM) y -= 2;
        else if (anchor & ANCHOR_VCENTER) y += g.fontSize / 3;
        else if (!(anchor & ANCHOR_BASELINE)) y += g.fontSize;

        ctx.fillText(str, x, y);
        ctx.textAlign = 'left';
        break;
      }
      case 'drawImage': {
        const imgObj = args[0];
        let x = n(1) + tx;
        let y = n(2) + ty;
        const anchor = n(3);
        if (isObject(imgObj) && imgObj.nativeData) {
          const data = imgObj.nativeData as J2MEImageData;
          const iw = data.width || 16;
          const ih = data.height || 16;
          if (anchor & ANCHOR_HCENTER) x -= iw / 2;
          else if (anchor & ANCHOR_RIGHT) x -= iw;
          if (anchor & ANCHOR_VCENTER) y -= ih / 2;
          else if (anchor & ANCHOR_BOTTOM) y -= ih;
          ctx.drawImage(data.canvas, x, y);
        }
        break;
      }
      case 'drawRegion': {
        const imgObj = args[0];
        const sx = n(1); const sy = n(2); const sw = n(3); const sh = n(4);
        const transform = n(5);
        let dx = n(6) + tx; let dy = n(7) + ty;
        const anchor = n(8);
        if (isObject(imgObj) && imgObj.nativeData) {
          const data = imgObj.nativeData as J2MEImageData;
          const swap = transform >= 4;
          const dw = swap ? sh : sw;
          const dh = swap ? sw : sh;
          if (anchor & ANCHOR_HCENTER) dx -= dw / 2;
          else if (anchor & ANCHOR_RIGHT) dx -= dw;
          if (anchor & ANCHOR_VCENTER) dy -= dh / 2;
          else if (anchor & ANCHOR_BOTTOM) dy -= dh;
          drawTransformedRegion(ctx, data.canvas, sx, sy, sw, sh, transform, dx, dy);
        }
        break;
      }
      case 'drawRGB': {
        const rgbArr = args[0];
        const offset = n(1); const scan = n(2);
        const dx = n(3) + tx; const dy = n(4) + ty;
        const w = n(5); const h = n(6);
        const processAlpha = Boolean(args[7]);
        if (isArray(rgbArr) && w > 0 && h > 0) {
          const imgData = ctx.createImageData(w, h);
          const out = imgData.data;
          for (let row = 0; row < h; row++) {
            for (let col = 0; col < w; col++) {
              const px = Number(rgbArr.items[offset + row * scan + col] ?? 0) | 0;
              const o = (row * w + col) * 4;
              out[o] = (px >>> 16) & 0xff;
              out[o + 1] = (px >>> 8) & 0xff;
              out[o + 2] = px & 0xff;
              out[o + 3] = processAlpha ? (px >>> 24) & 0xff : 255;
            }
          }
          ctx.putImageData(imgData, dx, dy);
        }
        break;
      }
      case 'translate': g.tx += n(0); g.ty += n(1); break;
      case 'getTranslateX': pushRet(g.tx); break;
      case 'getTranslateY': pushRet(g.ty); break;
      case 'setClip': {
        g.clipX = n(0) + tx; g.clipY = n(1) + ty; g.clipW = n(2); g.clipH = n(3);
        break;
      }
      case 'clipRect': {
        const nx = n(0) + tx; const ny = n(1) + ty; const nw = n(2); const nh = n(3);
        const x1 = Math.max(g.clipX, nx);
        const y1 = Math.max(g.clipY, ny);
        const x2 = Math.min(g.clipX + g.clipW, nx + nw);
        const y2 = Math.min(g.clipY + g.clipH, ny + nh);
        g.clipX = x1; g.clipY = y1; g.clipW = Math.max(0, x2 - x1); g.clipH = Math.max(0, y2 - y1);
        break;
      }
      case 'getClipX': pushRet(g.clipX - g.tx); break;
      case 'getClipY': pushRet(g.clipY - g.ty); break;
      case 'getClipWidth': pushRet(g.clipW); break;
      case 'getClipHeight': pushRet(g.clipH); break;
      case 'setFont': {
        const f = args[0];
        if (isObject(f)) {
          g.fontSize = Number(f.fields.size) === 16 ? 15 : Number(f.fields.size) === 8 ? 10 : 12;
          g.fontBold = (Number(f.fields.style) & 1) !== 0;
        }
        break;
      }
      case 'getFont': pushRet(this.createObject('javax/microedition/lcdui/Font')); break;
      default:
        if (descriptor.endsWith(')I')) pushRet(0);
        break;
    }
  }
}
