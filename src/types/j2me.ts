export enum J2MEKey {
  UP = -1,
  DOWN = -2,
  LEFT = -3,
  RIGHT = -4,
  FIRE = -5,
  SOFT_LEFT = -6,
  SOFT_RIGHT = -7,
  CLEAR = -8,
  CALL = -10,
  END = -11,
  KEY_0 = 48,
  KEY_1 = 49,
  KEY_2 = 50,
  KEY_3 = 51,
  KEY_4 = 52,
  KEY_5 = 53,
  KEY_6 = 54,
  KEY_7 = 55,
  KEY_8 = 56,
  KEY_9 = 57,
  KEY_STAR = 42,
  KEY_POUND = 35,
}

export type ScreenResolution = '240x320' | '176x220' | '128x160' | '320x240';

export type DisplayFilter = 'crisp' | 'lcd-grid' | 'nokia-mono';

export type PhoneProfile = 'Nokia' | 'SonyEricsson' | 'Motorola' | 'Siemens' | 'Standard';

export type JarEngineId = 'j2mejs' | 'freej2me';

export type AppMode = 'menu' | 'host' | 'controller';

export type GameCategory = 'Arcade' | 'Phiêu lưu' | 'Bắn súng' | 'Giải đố' | 'Java .JAR';

export interface JarManifestInfo {
  midletName: string;
  midletVendor: string;
  midletVersion: string;
  midletClass: string;
  midletIconPath: string | null;
  profile: string;
  configuration: string;
  rawProperties: Record<string, string>;
}

export interface JarAssetImage {
  path: string;
  dataUrl: string;
}

export interface JarInspectResult {
  manifest: JarManifestInfo;
  iconDataUrl: string | null;
  classFiles: string[];
  imageAssets: JarAssetImage[];
  audioAssets: string[];
  totalFiles: number;
  totalSizeBytes: number;
}

export interface UploadedJarRecord {
  id: string;
  fileName: string;
  uploadedAt: number;
  buffer: ArrayBuffer;
  inspect: JarInspectResult;
}

export type BuiltinGameId = 'snake' | 'bounce' | 'space' | 'brick';

export interface BuiltinGameMeta {
  id: BuiltinGameId;
  title: string;
  subtitle: string;
  category: GameCategory;
  vendor: string;
  version: string;
  year: string;
  controlsHint: string;
  accentColor: string;
}

export type ActiveGameSource =
  | { type: 'builtin'; id: BuiltinGameId }
  | { type: 'jar'; record: UploadedJarRecord };

export interface VmRuntimeState {
  status: 'idle' | 'loading' | 'running' | 'paused' | 'halted' | 'error';
  currentScreen: string;
  instructionsExecuted: number;
  errorReason?: string;
  missingApi?: string;
  logs: string[];
}

export interface SoftkeyLabels {
  left: string;
  center: string;
  right: string;
}

export interface JavaGameEngine {
  id: string;
  title: string;
  init: (width: number, height: number) => void;
  update: (dtMs: number, heldKeys: Set<number>) => void;
  render: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  onKeyDown: (keyCode: number) => void;
  onKeyUp: (keyCode: number) => void;
  getSoftkeys: () => SoftkeyLabels;
  getHighScore: () => number;
}
