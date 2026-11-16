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

export type WorkbenchTab = 'vms' | 'jars';

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

export interface PersistedVmConfig {
  id: string;
  name: string;
  roomCode: string;
  jarId: string | null;
  resolution: ScreenResolution;
  filter: DisplayFilter;
  phoneProfile: PhoneProfile;
  jarEngine: JarEngineId;
  isMuted: boolean;
  isRunning: boolean;
  createdAt: number;
}

export interface VmRuntimeState {
  status: 'idle' | 'loading' | 'running' | 'paused' | 'halted' | 'error';
  currentScreen: string;
  instructionsExecuted: number;
  errorReason?: string;
  missingApi?: string;
  logs: string[];
}

export interface VmStatusSummary {
  runtime: VmRuntimeState;
  controllerCount: number;
}

export interface SoftkeyLabels {
  left: string;
  center: string;
  right: string;
}
