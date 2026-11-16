import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Delete,
  FileArchive,
  Keyboard,
  Maximize2,
  Minimize2,
  Phone,
  PhoneOff,
  Power,
  RotateCcw,
  Settings,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  J2MEKey,
  PersistedVmConfig,
  SoftkeyLabels,
  UploadedJarRecord,
  VmRuntimeState,
} from '../types/j2me';
import { ControlsConfigPanel } from './ControlsConfigPanel';

interface PhoneConsoleProps {
  vm: PersistedVmConfig;
  jarRecord: UploadedJarRecord | null;
  uploadedJars: UploadedJarRecord[];
  vmState: VmRuntimeState;
  controllerCount: number;
  isOpen: boolean;
  showSettings: boolean;
  showTextInput: boolean;
  emuIframeRef: React.RefObject<HTMLIFrameElement | null>;
  emuSrc: string;
  emuInstanceKey: string;
  softkeys: SoftkeyLabels;
  pressedKeys: Set<number>;
  onClose: () => void;
  onToggleSettings: (open?: boolean) => void;
  onToggleTextInput: (open?: boolean) => void;
  onPressKey: (keyCode: number) => void;
  onReleaseKey: (keyCode: number) => void;
  onRestart: () => void;
  onToggleRunning: () => void;
  onUpdateVm: (patch: Partial<PersistedVmConfig>) => void;
  onDeleteVm: () => void;
  onUploadJarForVm: (files: FileList | null) => Promise<void>;
  onCreateSampleJarForVm: () => Promise<void>;
  onSendText: (text: string) => void;
}

const T9_KEYS: { code: number; digit: string; sub: string }[] = [
  { code: J2MEKey.KEY_1, digit: '1', sub: '.,' },
  { code: J2MEKey.KEY_2, digit: '2', sub: '↑ ABC' },
  { code: J2MEKey.KEY_3, digit: '3', sub: 'DEF' },
  { code: J2MEKey.KEY_4, digit: '4', sub: '← GHI' },
  { code: J2MEKey.KEY_5, digit: '5', sub: '● JKL' },
  { code: J2MEKey.KEY_6, digit: '6', sub: '→ MNO' },
  { code: J2MEKey.KEY_7, digit: '7', sub: 'PQRS' },
  { code: J2MEKey.KEY_8, digit: '8', sub: '↓ TUV' },
  { code: J2MEKey.KEY_9, digit: '9', sub: 'WXYZ' },
  { code: J2MEKey.KEY_STAR, digit: '*', sub: '+' },
  { code: J2MEKey.KEY_0, digit: '0', sub: '␣' },
  { code: J2MEKey.KEY_POUND, digit: '#', sub: '⇧' },
];

export const PhoneConsole: React.FC<PhoneConsoleProps> = ({
  vm,
  jarRecord,
  uploadedJars,
  vmState,
  controllerCount,
  isOpen,
  showSettings,
  showTextInput,
  emuIframeRef,
  emuSrc,
  emuInstanceKey,
  softkeys,
  pressedKeys,
  onClose,
  onToggleSettings,
  onToggleTextInput,
  onPressKey,
  onReleaseKey,
  onRestart,
  onToggleRunning,
  onUpdateVm,
  onDeleteVm,
  onUploadJarForVm,
  onCreateSampleJarForVm,
  onSendText,
}) => {
  const [inputText, setInputText] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedRoom, setCopiedRoom] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const chassisRef = useRef<HTMLDivElement | null>(null);
  const settingsFileRef = useRef<HTMLInputElement | null>(null);

  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height: typeof window !== 'undefined' ? window.innerHeight - 60 : 700,
  });
  const [chassisSize, setChassisSize] = useState<{ width: number; height: number }>({
    width: 332,
    height: 700,
  });

  const [resW, resH] = useMemo(() => {
    const parts = vm.resolution.split('x').map(Number);
    return [parts[0] || 240, parts[1] || 320];
  }, [vm.resolution]);

  const isLandscape = resW > resH;

  // Measure available stage & natural phone chassis size so the phone ALWAYS fits the viewport
  useEffect(() => {
    const measure = () => {
      if (stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setStageSize({ width: rect.width, height: rect.height });
        }
      }
      if (chassisRef.current) {
        const w = chassisRef.current.offsetWidth;
        const h = chassisRef.current.offsetHeight;
        if (w > 0 && h > 0) {
          setChassisSize({ width: w, height: h });
        }
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    if (stageRef.current) ro.observe(stageRef.current);
    if (chassisRef.current) ro.observe(chassisRef.current);

    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [isOpen, isLandscape, resW, resH]);

  const fitScale = useMemo(() => {
    const availW = Math.max(200, stageSize.width - 16);
    const availH = Math.max(220, stageSize.height - 16);
    const maxScale = isExpanded ? 1.15 : 1.0;
    const raw = Math.min(
      maxScale,
      availW / (chassisSize.width || 332),
      availH / (chassisSize.height || 700)
    );
    return Math.max(0.35, Number(raw.toFixed(3)));
  }, [stageSize, chassisSize, isExpanded]);

  const keyBind = (code: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      onPressKey(code);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      onReleaseKey(code);
    },
    onPointerCancel: () => onReleaseKey(code),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const isActive = (code: number) => pressedKeys.has(code);

  const displayWidthPx = isLandscape ? 320 : 256;
  const displayHeightPx = Math.round((displayWidthPx * resH) / resW);
  const chassisWidthPx = isLandscape ? 368 : 324;
  const gameTitle = jarRecord ? jarRecord.inspect.manifest.midletName : 'Chưa chọn tệp .JAR';

  const handleSettingsUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSettingsError(null);
    setSettingsBusy(true);
    try {
      await onUploadJarForVm(files);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Không thể nạp tệp .JAR.');
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleSettingsSample = async () => {
    setSettingsError(null);
    setSettingsBusy(true);
    try {
      await onCreateSampleJarForVm();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Không thể tạo .JAR mẫu.');
    } finally {
      setSettingsBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal={isOpen}
      aria-hidden={!isOpen}
      aria-label={`Điện thoại máy ảo ${vm.name}`}
      onContextMenu={(e) => e.preventDefault()}
      className={
        isOpen
          ? 'fixed inset-0 z-50 flex flex-col bg-[#0B0D12]/96 backdrop-blur-sm opacity-100 pointer-events-auto overflow-hidden overscroll-none select-none'
          : 'fixed inset-0 -z-50 flex flex-col opacity-0 pointer-events-none overflow-hidden select-none'
      }
      style={{ touchAction: 'none' }}
    >
      {/* Top Modal Action Bar */}
      <header className="shrink-0 border-b border-white/[0.08] bg-[#14171F] px-2.5 sm:px-5 py-2 sm:py-2.5">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={onClose}
              aria-label="Quay lại danh sách máy ảo"
              title="Thu nhỏ về danh sách (máy ảo vẫn chạy nền)"
              className="inline-flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-300 hover:bg-[#252A36] hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="truncate text-xs sm:text-sm font-semibold text-slate-100">{vm.name}</p>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(vm.roomCode).catch(() => {});
                    setCopiedRoom(true);
                    setTimeout(() => setCopiedRoom(false), 1800);
                  }}
                  title="Sao chép mã phòng điều khiển từ xa"
                  className="hidden sm:inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#1B1F28] px-2 py-0.5 font-mono-tabular text-[11px] text-amber-300 hover:bg-[#252A36] shrink-0"
                >
                  <span>{vm.roomCode}</span>
                  {copiedRoom ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3 text-slate-400" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-1.5 min-w-0 font-mono-tabular text-[10px] sm:text-[11px] text-slate-400">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(vm.roomCode).catch(() => {});
                    setCopiedRoom(true);
                    setTimeout(() => setCopiedRoom(false), 1800);
                  }}
                  className="sm:hidden inline-flex items-center gap-1 text-amber-300 shrink-0"
                >
                  <span>{copiedRoom ? 'Đã chép' : vm.roomCode}</span>
                </button>
                <span className="sm:hidden text-slate-600">·</span>
                <span className="truncate">
                  {gameTitle} · {vm.resolution}
                  {controllerCount > 0 ? ` · ${controllerCount} ĐK` : ''}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onRestart}
              aria-label="Khởi động lại máy ảo"
              title="Khởi động lại"
              className="inline-flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-200 transition-colors hover:bg-[#252A36] hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            <button
              type="button"
              onClick={() => onUpdateVm({ isMuted: !vm.isMuted })}
              aria-label={vm.isMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
              title={vm.isMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
              className="inline-flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-200 transition-colors hover:bg-[#252A36] hover:text-white"
            >
              {vm.isMuted ? (
                <VolumeX className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-400" />
              ) : (
                <Volume2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-400" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onToggleTextInput()}
              aria-label="Nhập văn bản nhanh"
              title="Nhập chữ (Tài khoản / Mật khẩu / Chat)"
              className={`inline-flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border transition-colors ${
                showTextInput
                  ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                  : 'border-white/10 bg-[#1B1F28] text-slate-200 hover:bg-[#252A36] hover:text-white'
              }`}
            >
              <Keyboard className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              aria-label={isExpanded ? 'Thu gọn vừa khung' : 'Phóng to nhẹ'}
              title={isExpanded ? 'Thu gọn' : 'Phóng to'}
              className="hidden md:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-200 transition-colors hover:bg-[#252A36] hover:text-white"
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => onToggleSettings()}
              aria-label="Cài đặt máy ảo"
              title="Cài đặt máy ảo"
              className={`inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border px-2 sm:px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                showSettings
                  ? 'border-amber-400 bg-amber-500 text-slate-950'
                  : 'border-white/12 bg-[#1B1F28] text-slate-100 hover:bg-[#252A36] hover:text-amber-300'
              }`}
            >
              <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Cài đặt</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng màn hình điện thoại"
              title="Đóng (máy ảo tiếp tục chạy)"
              className="inline-flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-300 hover:bg-rose-500/20 hover:border-rose-500/40 hover:text-rose-300"
            >
              <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Viewport Stage */}
      <div
        ref={stageRef}
        className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden p-2"
      >
        {/* Quick Text Input Floating Bar */}
        {showTextInput && !showSettings && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-[min(420px,calc(100%-24px))] rounded-xl border border-amber-500/40 bg-[#161A23] p-3 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-amber-400">
                ⌨ Nhập Văn Bản Nhanh (Đăng nhập / Chat)
              </span>
              <button
                type="button"
                onClick={() => onToggleTextInput(false)}
                className="text-slate-400 hover:text-slate-200 text-xs px-1"
              >
                ✕ Đóng
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (inputText) {
                  onSendText(inputText);
                  setInputText('');
                }
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Nhập tên TK, mật khẩu hoặc chat..."
                className="flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button
                type="submit"
                className="rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap"
              >
                Gửi
              </button>
            </form>
          </div>
        )}

        {/* Scaled Phone Wrapper that always fits cleanly inside stage */}
        <div
          style={{
            width: Math.round(chassisSize.width * fitScale),
            height: Math.round(chassisSize.height * fitScale),
          }}
          className="relative flex items-center justify-center shrink-0"
        >
          <div
            ref={chassisRef}
            style={{
              width: chassisWidthPx,
              transform: `scale(${fitScale})`,
              transformOrigin: 'center center',
            }}
            className="relative flex flex-col items-center shrink-0 rounded-[32px] border border-white/15 bg-gradient-to-b from-[#262B37] via-[#1B1F28] to-[#14171F] p-4 shadow-2xl select-none"
          >
            {/* Speaker grille */}
            <div className="mb-2.5 flex flex-col items-center gap-1">
              <div className="h-1.5 w-12 rounded-full bg-black/60 border border-white/10" />
              <span className="font-mono-tabular text-[9px] tracking-[0.18em] text-slate-400 uppercase">
                JAVADECK SERIES
              </span>
            </div>

            {/* Recessed LCD Bezel */}
            <div className="w-full rounded-[16px] border border-white/10 bg-[#080A0E] p-2 shadow-inner flex flex-col items-center">
              <div
                className="relative overflow-hidden rounded-[8px] bg-black border border-white/[0.06]"
                style={{
                  width: displayWidthPx,
                  height: displayHeightPx,
                  touchAction: 'none',
                }}
              >
                {vm.isRunning && jarRecord ? (
                  <iframe
                    key={emuInstanceKey}
                    ref={emuIframeRef}
                    src={emuSrc}
                    title={vm.name}
                    allow="autoplay"
                    className={`block h-full w-full border-0 bg-black ${
                      vm.filter === 'nokia-mono' ? 'nokia-mono-filter' : ''
                    }`}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center bg-[#0C0F16]">
                    <p className="text-xs font-semibold text-slate-200">
                      {!vm.isRunning ? 'Máy ảo đang tắt' : 'Chưa chọn tệp .JAR'}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {!vm.isRunning
                        ? 'Bấm Bật máy ảo để tiếp tục treo game.'
                        : 'Mở Cài đặt để nạp tệp game .JAR cho máy ảo này.'}
                    </p>
                    {!vm.isRunning ? (
                      <button
                        type="button"
                        onClick={onToggleRunning}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                      >
                        <Power className="h-3.5 w-3.5" />
                        <span>Bật máy ảo</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggleSettings(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                      >
                        <Settings className="h-3.5 w-3.5" />
                        <span>Chọn tệp .JAR</span>
                      </button>
                    )}
                  </div>
                )}

                {vm.filter === 'lcd-grid' && (
                  <div className="lcd-grid-overlay pointer-events-none absolute inset-0" />
                )}
              </div>

              {/* Authentic MIDP Softkey Bar */}
              <div
                className="mt-1.5 flex items-center justify-between px-2 py-1 text-[11px] font-medium text-slate-300 bg-[#0F131B] rounded border border-white/[0.05]"
                style={{ width: displayWidthPx }}
              >
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.SOFT_LEFT)}
                  className="truncate max-w-[33%] text-left text-amber-400 hover:text-amber-300 focus-visible:outline-none select-none"
                >
                  {softkeys.left || '\u00A0'}
                </button>
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.FIRE)}
                  className="truncate max-w-[33%] text-center font-semibold text-slate-200 hover:text-white focus-visible:outline-none select-none"
                >
                  {softkeys.center || '\u00A0'}
                </button>
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.SOFT_RIGHT)}
                  className="truncate max-w-[33%] text-right text-slate-300 hover:text-white focus-visible:outline-none select-none"
                >
                  {softkeys.right || '\u00A0'}
                </button>
              </div>
            </div>

            {/* Navigation Cluster: Softkeys + Call/End + 5-Way D-Pad */}
            <div className="mt-3.5 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.SOFT_LEFT)}
                  aria-label="Phím chức năng trái"
                  className={`flex h-[38px] items-center justify-center rounded-xl border text-xs font-semibold transition-transform select-none focus-visible:outline-none ${
                    isActive(J2MEKey.SOFT_LEFT)
                      ? 'translate-y-[1px] border-amber-400 bg-amber-500/20 text-amber-300'
                      : 'border-white/10 bg-[#252A36] text-slate-200 hover:bg-[#2E3443]'
                  }`}
                >
                  <span className="block h-1 w-6 rounded-full bg-amber-400/80" />
                </button>
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.CALL)}
                  aria-label="Phím Gọi / Xác nhận"
                  className={`flex h-[38px] items-center justify-center rounded-xl border transition-transform select-none focus-visible:outline-none ${
                    isActive(J2MEKey.CALL)
                      ? 'translate-y-[1px] border-emerald-400 bg-emerald-500/25 text-emerald-300'
                      : 'border-white/10 bg-[#252A36] text-emerald-400 hover:bg-[#2E3443]'
                  }`}
                >
                  <Phone className="h-4 w-4" />
                </button>
              </div>

              <div
                role="group"
                aria-label="Cụm phím điều hướng 5 chiều"
                className="relative grid h-[116px] w-[116px] grid-cols-3 grid-rows-3 gap-1 rounded-[24px] border border-white/10 bg-[#14171F] p-1.5 shadow-inner"
              >
                <div />
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.UP)}
                  aria-label="Điều hướng lên"
                  className={`flex items-center justify-center rounded-t-xl border transition-transform select-none focus-visible:outline-none ${
                    isActive(J2MEKey.UP)
                      ? 'scale-95 border-amber-400 bg-amber-500/25 text-amber-300'
                      : 'border-white/10 bg-[#2A303D] text-slate-200 hover:bg-[#343B4B]'
                  }`}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <div />

                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.LEFT)}
                  aria-label="Điều hướng trái"
                  className={`flex items-center justify-center rounded-l-xl border transition-transform select-none focus-visible:outline-none ${
                    isActive(J2MEKey.LEFT)
                      ? 'scale-95 border-amber-400 bg-amber-500/25 text-amber-300'
                      : 'border-white/10 bg-[#2A303D] text-slate-200 hover:bg-[#343B4B]'
                  }`}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.FIRE)}
                  aria-label="Nút OK / Chọn"
                  className={`flex items-center justify-center rounded-xl border text-[11px] font-bold transition-transform select-none focus-visible:outline-none ${
                    isActive(J2MEKey.FIRE)
                      ? 'scale-95 border-amber-300 bg-amber-400 text-slate-950'
                      : 'border-amber-500/50 bg-amber-500 text-slate-950 hover:bg-amber-400'
                  }`}
                >
                  OK
                </button>

                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.RIGHT)}
                  aria-label="Điều hướng phải"
                  className={`flex items-center justify-center rounded-r-xl border transition-transform select-none focus-visible:outline-none ${
                    isActive(J2MEKey.RIGHT)
                      ? 'scale-95 border-amber-400 bg-amber-500/25 text-amber-300'
                      : 'border-white/10 bg-[#2A303D] text-slate-200 hover:bg-[#343B4B]'
                  }`}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>

                <div />
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.DOWN)}
                  aria-label="Điều hướng xuống"
                  className={`flex items-center justify-center rounded-b-xl border transition-transform select-none focus-visible:outline-none ${
                    isActive(J2MEKey.DOWN)
                      ? 'scale-95 border-amber-400 bg-amber-500/25 text-amber-300'
                      : 'border-white/10 bg-[#2A303D] text-slate-200 hover:bg-[#343B4B]'
                  }`}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <div />
              </div>

              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.SOFT_RIGHT)}
                  aria-label="Phím chức năng phải"
                  className={`flex h-[38px] items-center justify-center rounded-xl border text-xs font-semibold transition-transform select-none focus-visible:outline-none ${
                    isActive(J2MEKey.SOFT_RIGHT)
                      ? 'translate-y-[1px] border-amber-400 bg-amber-500/20 text-amber-300'
                      : 'border-white/10 bg-[#252A36] text-slate-200 hover:bg-[#2E3443]'
                  }`}
                >
                  <span className="block h-1 w-6 rounded-full bg-slate-300/80" />
                </button>
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.END)}
                  aria-label="Phím Tắt / Quay lại"
                  className={`flex h-[38px] items-center justify-center rounded-xl border transition-transform select-none focus-visible:outline-none ${
                    isActive(J2MEKey.END)
                      ? 'translate-y-[1px] border-rose-400 bg-rose-500/25 text-rose-300'
                      : 'border-white/10 bg-[#252A36] text-rose-400 hover:bg-[#2E3443]'
                  }`}
                >
                  <PhoneOff className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Clear / Delete Character Key */}
            <div className="mt-2.5 w-full">
              <button
                type="button"
                draggable={false}
                {...keyBind(J2MEKey.CLEAR)}
                aria-label="Xóa chữ cái đã nhập"
                className={`flex h-[34px] w-full items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-transform select-none focus-visible:outline-none ${
                  isActive(J2MEKey.CLEAR)
                    ? 'translate-y-[1px] border-amber-400 bg-amber-500/20 text-amber-200'
                    : 'border-white/[0.08] bg-[#222732] text-slate-200 hover:bg-[#2B313F]'
                }`}
              >
                <Delete className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                <span>Xóa chữ</span>
                <span className="font-mono-tabular text-[10px] text-slate-400">(C / ⌫)</span>
              </button>
            </div>

            {/* T9 Numeric Keypad */}
            <div
              role="group"
              aria-label="Bàn phím số T9"
              className="mt-2.5 grid w-full grid-cols-3 gap-1.5"
            >
              {T9_KEYS.map((k) => {
                const active = isActive(k.code);
                return (
                  <button
                    key={k.code}
                    type="button"
                    draggable={false}
                    {...keyBind(k.code)}
                    aria-label={`Phím ${k.digit}`}
                    className={`flex h-[38px] items-center justify-between rounded-xl border px-2.5 py-1 transition-transform select-none focus-visible:outline-none ${
                      active
                        ? 'translate-y-[1px] border-amber-400 bg-amber-500/20 text-amber-200'
                        : 'border-white/[0.08] bg-[#222732] text-slate-100 hover:bg-[#2B313F]'
                    }`}
                  >
                    <span className="font-mono-tabular text-sm font-semibold leading-none">
                      {k.digit}
                    </span>
                    <span className="font-mono-tabular text-[9px] text-slate-400 leading-none">
                      {k.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Per-VM Settings Overlay (keeps iframe mounted underneath!) */}
        {showSettings && (
          <div
            onContextMenu={(e) => e.preventDefault()}
            className="absolute inset-0 z-40 bg-[#111317]/98 overflow-y-auto overscroll-contain touch-pan-y px-4 py-6 select-none"
            style={{ touchAction: 'pan-y' }}
          >
            <div className="mx-auto max-w-2xl space-y-6 pb-10">
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-100">
                    Cài Đặt Máy Ảo: {vm.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400 font-mono-tabular">
                    Mã phòng: {vm.roomCode} · Trạng thái: {vmState.status}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleSettings(false)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Quay lại điện thoại</span>
                </button>
              </div>

              {/* VM Identity & JAR Assignment */}
              <div className="rounded-2xl border border-white/10 bg-[#151821] p-4 sm:p-5 space-y-4">
                <div>
                  <label htmlFor="settings-vm-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Tên máy ảo
                  </label>
                  <input
                    id="settings-vm-name"
                    type="text"
                    value={vm.name}
                    onChange={(e) => onUpdateVm({ name: e.target.value })}
                    maxLength={40}
                    className="w-full rounded-xl border border-white/15 bg-[#0C0E13] px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <label htmlFor="settings-vm-jar" className="block text-xs font-medium text-slate-300">
                      Tệp game .JAR đang chạy trên máy ảo này
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={settingsBusy}
                        onClick={() => settingsFileRef.current?.click()}
                        className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-[#1D222D] px-2.5 py-1 text-[11px] font-medium text-amber-400 hover:bg-[#252B39] disabled:opacity-50"
                      >
                        <Upload className="h-3 w-3" />
                        <span>Tải .JAR mới</span>
                      </button>
                      <button
                        type="button"
                        disabled={settingsBusy}
                        onClick={handleSettingsSample}
                        className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-[#1D222D] px-2.5 py-1 text-[11px] font-medium text-emerald-400 hover:bg-[#252B39] disabled:opacity-50"
                      >
                        <FileArchive className="h-3 w-3" />
                        <span>Tạo .JAR mẫu</span>
                      </button>
                    </div>
                  </div>

                  <input
                    ref={settingsFileRef}
                    type="file"
                    accept=".jar,.jad"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleSettingsUpload(e.target.files);
                      e.target.value = '';
                    }}
                  />

                  <select
                    id="settings-vm-jar"
                    value={vm.jarId || ''}
                    onChange={(e) =>
                      onUpdateVm({
                        jarId: e.target.value || null,
                        isRunning: e.target.value ? true : vm.isRunning,
                      })
                    }
                    className="w-full rounded-xl border border-white/15 bg-[#0C0E13] px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">— Chưa chọn tệp .JAR —</option>
                    {uploadedJars.map((jar) => (
                      <option key={jar.id} value={jar.id}>
                        {jar.inspect.manifest.midletName} ({jar.fileName})
                      </option>
                    ))}
                  </select>

                  {settingsError && (
                    <p role="alert" className="mt-2 text-xs text-rose-400">
                      {settingsError}
                    </p>
                  )}
                </div>
              </div>

              {/* Engine, Resolution, Filter & Keymap Controls */}
              <div className="rounded-2xl border border-white/10 bg-[#151821] p-4 sm:p-5">
                <ControlsConfigPanel
                  resolution={vm.resolution}
                  filter={vm.filter}
                  phoneProfile={vm.phoneProfile}
                  jarEngine={vm.jarEngine}
                  isMuted={vm.isMuted}
                  onChangeResolution={(resolution) => onUpdateVm({ resolution })}
                  onChangeFilter={(filter) => onUpdateVm({ filter })}
                  onChangePhoneProfile={(phoneProfile) => onUpdateVm({ phoneProfile })}
                  onChangeJarEngine={(jarEngine) => onUpdateVm({ jarEngine })}
                  onToggleMute={() => onUpdateVm({ isMuted: !vm.isMuted })}
                />
              </div>

              {/* VM Logs */}
              {vmState.logs.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-[#151821] p-4">
                  <h3 className="text-xs font-semibold text-slate-300 mb-2">Nhật ký máy ảo</h3>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#0B0D12] p-2.5 font-mono-tabular text-[11px] text-slate-400 space-y-1">
                    {vmState.logs.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Power & Delete Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#151821] p-4">
                <button
                  type="button"
                  onClick={onToggleRunning}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-colors ${
                    vm.isRunning
                      ? 'border-white/12 bg-[#222733] text-slate-200 hover:bg-[#2C3342]'
                      : 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                  }`}
                >
                  <Power className="h-4 w-4" />
                  <span>{vm.isRunning ? 'Tắt máy ảo này' : 'Bật máy ảo này'}</span>
                </button>

                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={onDeleteVm}
                      className="rounded-xl bg-rose-500 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-400"
                    >
                      Xác nhận xóa máy ảo
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Xóa máy ảo</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
