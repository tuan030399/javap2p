import React, { useMemo } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Keyboard,
  Maximize2,
  Minimize2,
  Pause,
  Phone,
  PhoneOff,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { DisplayFilter, J2MEKey, ScreenResolution, SoftkeyLabels } from '../types/j2me';

interface PhoneConsoleProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  emuIframeRef: React.RefObject<HTMLIFrameElement | null>;
  isJarMode: boolean;
  emuSrc: string;
  emuInstanceKey: string | number;
  gameTitle: string;
  resolution: ScreenResolution;
  filter: DisplayFilter;
  softkeys: SoftkeyLabels;
  pressedKeys: Set<number>;
  isPaused: boolean;
  isMuted: boolean;
  isExpanded: boolean;
  onPressKey: (keyCode: number) => void;
  onReleaseKey: (keyCode: number) => void;
  onTogglePause: () => void;
  onRestart: () => void;
  onToggleMute: () => void;
  onToggleExpand: () => void;
  onSendText?: (text: string) => void;
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
  canvasRef,
  emuIframeRef,
  isJarMode,
  emuSrc,
  emuInstanceKey,
  gameTitle,
  resolution,
  filter,
  softkeys,
  pressedKeys,
  isPaused,
  isMuted,
  isExpanded,
  onPressKey,
  onReleaseKey,
  onTogglePause,
  onRestart,
  onToggleMute,
  onToggleExpand,
  onSendText,
}) => {
  const [showTextInput, setShowTextInput] = React.useState(false);
  const [inputText, setInputText] = React.useState('');

  const [resW, resH] = useMemo(() => {
    const parts = resolution.split('x').map(Number);
    return [parts[0] || 240, parts[1] || 320];
  }, [resolution]);

  const isLandscape = resW > resH;

  // Bind pointer down/up/leave cleanly for responsive hold gameplay
  const keyBind = (code: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore if pointer capture not supported
      }
      onPressKey(code);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      onReleaseKey(code);
    },
    onPointerCancel: () => onReleaseKey(code),
  });

  const isActive = (code: number) => pressedKeys.has(code);

  const displayWidthPx = isExpanded
    ? isLandscape ? 460 : 340
    : isLandscape ? 360 : 276;

  const displayHeightPx = Math.round((displayWidthPx * resH) / resW);

  return (
    <section
      id="console"
      aria-label="Máy chơi game Java cầm tay"
      className="flex flex-col items-center"
    >
      {/* Quick Hardware Bar */}
      <div className="mb-4 flex w-full max-w-[420px] items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">{gameTitle}</p>
          <p className="font-mono-tabular text-xs text-slate-400">
            {resolution} · MIDP 2.0
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onTogglePause}
            aria-label={isPaused ? 'Tiếp tục game' : 'Tạm dừng game'}
            title={isPaused ? 'Tiếp tục' : 'Tạm dừng'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-200 transition-colors hover:bg-[#252A36] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onRestart}
            aria-label="Khởi động lại game"
            title="Chơi lại"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-200 transition-colors hover:bg-[#252A36] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={isMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            title={isMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-200 transition-colors hover:bg-[#252A36] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {isMuted ? <VolumeX className="h-4 w-4 text-slate-400" /> : <Volume2 className="h-4 w-4 text-amber-400" />}
          </button>
          <button
            type="button"
            onClick={() => setShowTextInput((v) => !v)}
            aria-label="Nhập văn bản nhanh"
            title="Nhập chữ (Tài khoản / Mật khẩu / Chat)"
            className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
              showTextInput
                ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                : 'border-white/10 bg-[#1B1F28] text-slate-200 hover:bg-[#252A36] hover:text-white'
            }`}
          >
            <Keyboard className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={isExpanded ? 'Thu gọn màn hình' : 'Phóng to màn hình'}
            title={isExpanded ? 'Thu gọn' : 'Phóng to'}
            className="hidden sm:inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-200 transition-colors hover:bg-[#252A36] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Quick Text Input Drawer for Login / Chat */}
      {showTextInput && (
        <div className="mb-4 w-full max-w-[420px] rounded-xl border border-amber-500/30 bg-[#161A23] p-3 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-amber-400">⌨ Nhập Văn Bản Nhanh (Đăng nhập / Chat)</span>
            <button
              type="button"
              onClick={() => setShowTextInput(false)}
              className="text-slate-400 hover:text-slate-200 text-xs px-1"
            >
              ✕ Đóng
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inputText && onSendText) {
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
              Gửi vào Game
            </button>
          </form>
          <p className="mt-1.5 text-[10px] text-slate-400">
            Hỗ trợ gõ chữ cái, số và ký tự để đăng nhập tài khoản hoặc nhắn tin trong game online.
          </p>
        </div>
      )}

      {/* Tactile Phone Chassis */}
      <div
        className="relative flex flex-col items-center rounded-[36px] border border-white/15 bg-gradient-to-b from-[#262B37] via-[#1B1F28] to-[#14171F] p-5 sm:p-6 shadow-2xl"
        style={{
          width: isLandscape ? (isExpanded ? 516 : 416) : isExpanded ? 396 : 336,
          maxWidth: '100%',
        }}
      >
        {/* Earpiece speaker grille */}
        <div className="mb-3 flex flex-col items-center gap-1.5">
          <div className="h-1.5 w-14 rounded-full bg-black/60 border border-white/10" />
          <span className="font-mono-tabular text-[10px] tracking-[0.18em] text-slate-400 uppercase select-none">
            JAVADECK SERIES
          </span>
        </div>

        {/* Recessed LCD Bezel */}
        <div className="w-full rounded-[18px] border border-white/10 bg-[#080A0E] p-2.5 shadow-inner flex flex-col items-center">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] text-amber-400/90 font-medium tracking-wide">
              👆 Hỗ trợ cảm ứng &amp; vuốt trực tiếp trên màn hình
            </span>
          </div>
          <div
            className="relative overflow-hidden rounded-[8px] bg-black border border-white/[0.06]"
            style={{
              width: displayWidthPx,
              height: displayHeightPx,
              maxWidth: '100%',
              touchAction: 'none',
            }}
          >
            {isJarMode ? (
              <iframe
                key={emuInstanceKey}
                ref={emuIframeRef}
                src={emuSrc}
                title={gameTitle}
                allow="autoplay"
                className={`block h-full w-full border-0 bg-black ${
                  filter === 'nokia-mono' ? 'nokia-mono-filter' : ''
                }`}
              />
            ) : (
              <canvas
                ref={canvasRef}
                width={resW}
                height={resH}
                className={`pixel-canvas block h-full w-full ${
                  filter === 'nokia-mono' ? 'nokia-mono-filter' : ''
                }`}
              />
            )}
            {filter === 'lcd-grid' && (
              <div className="lcd-grid-overlay pointer-events-none absolute inset-0" />
            )}
          </div>

          {/* Authentic MIDP Softkey Bar at bottom of screen */}
          <div
            className="mt-1.5 flex items-center justify-between px-2 py-1 text-[11px] font-medium text-slate-300 bg-[#0F131B] rounded border border-white/[0.05]"
            style={{ width: displayWidthPx, maxWidth: '100%' }}
          >
            <button
              type="button"
              {...keyBind(J2MEKey.SOFT_LEFT)}
              className="truncate max-w-[33%] text-left text-amber-400 hover:text-amber-300 focus-visible:outline-none"
            >
              {softkeys.left || '\u00A0'}
            </button>
            <button
              type="button"
              {...keyBind(J2MEKey.FIRE)}
              className="truncate max-w-[33%] text-center font-semibold text-slate-200 hover:text-white focus-visible:outline-none"
            >
              {softkeys.center || '\u00A0'}
            </button>
            <button
              type="button"
              {...keyBind(J2MEKey.SOFT_RIGHT)}
              className="truncate max-w-[33%] text-right text-slate-300 hover:text-white focus-visible:outline-none"
            >
              {softkeys.right || '\u00A0'}
            </button>
          </div>
        </div>

        {/* Navigation Cluster: Softkeys + Call/End + 5-Way D-Pad */}
        <div className="mt-5 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2.5">
          {/* Left Softkey + Call */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              {...keyBind(J2MEKey.SOFT_LEFT)}
              aria-label="Phím chức năng trái"
              className={`flex min-h-[42px] items-center justify-center rounded-xl border text-xs font-semibold transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                isActive(J2MEKey.SOFT_LEFT)
                  ? 'translate-y-[1px] border-amber-400 bg-amber-500/20 text-amber-300'
                  : 'border-white/10 bg-[#252A36] text-slate-200 hover:bg-[#2E3443]'
              }`}
            >
              <span className="block h-1 w-6 rounded-full bg-amber-400/80" />
            </button>
            <button
              type="button"
              {...keyBind(J2MEKey.CALL)}
              aria-label="Phím Gọi / Xác nhận"
              className={`flex min-h-[42px] items-center justify-center rounded-xl border transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                isActive(J2MEKey.CALL)
                  ? 'translate-y-[1px] border-emerald-400 bg-emerald-500/25 text-emerald-300'
                  : 'border-white/10 bg-[#252A36] text-emerald-400 hover:bg-[#2E3443]'
              }`}
            >
              <Phone className="h-4 w-4" />
            </button>
          </div>

          {/* 5-Way Tactile D-Pad */}
          <div
            role="group"
            aria-label="Cụm phím điều hướng 5 chiều"
            className="relative grid h-[132px] w-[132px] grid-cols-3 grid-rows-3 gap-1 rounded-[28px] border border-white/10 bg-[#14171F] p-1.5 shadow-inner"
          >
            <div />
            <button
              type="button"
              {...keyBind(J2MEKey.UP)}
              aria-label="Điều hướng lên"
              className={`flex items-center justify-center rounded-t-xl border transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                isActive(J2MEKey.UP)
                  ? 'scale-95 border-amber-400 bg-amber-500/25 text-amber-300'
                  : 'border-white/10 bg-[#2A303D] text-slate-200 hover:bg-[#343B4B]'
              }`}
            >
              <ChevronUp className="h-5 w-5" />
            </button>
            <div />

            <button
              type="button"
              {...keyBind(J2MEKey.LEFT)}
              aria-label="Điều hướng trái"
              className={`flex items-center justify-center rounded-l-xl border transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                isActive(J2MEKey.LEFT)
                  ? 'scale-95 border-amber-400 bg-amber-500/25 text-amber-300'
                  : 'border-white/10 bg-[#2A303D] text-slate-200 hover:bg-[#343B4B]'
              }`}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <button
              type="button"
              {...keyBind(J2MEKey.FIRE)}
              aria-label="Nút OK / Chọn"
              className={`flex items-center justify-center rounded-xl border text-xs font-bold transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                isActive(J2MEKey.FIRE)
                  ? 'scale-95 border-amber-300 bg-amber-400 text-slate-950'
                  : 'border-amber-500/50 bg-amber-500 text-slate-950 hover:bg-amber-400'
              }`}
            >
              OK
            </button>

            <button
              type="button"
              {...keyBind(J2MEKey.RIGHT)}
              aria-label="Điều hướng phải"
              className={`flex items-center justify-center rounded-r-xl border transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                isActive(J2MEKey.RIGHT)
                  ? 'scale-95 border-amber-400 bg-amber-500/25 text-amber-300'
                  : 'border-white/10 bg-[#2A303D] text-slate-200 hover:bg-[#343B4B]'
              }`}
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <div />
            <button
              type="button"
              {...keyBind(J2MEKey.DOWN)}
              aria-label="Điều hướng xuống"
              className={`flex items-center justify-center rounded-b-xl border transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                isActive(J2MEKey.DOWN)
                  ? 'scale-95 border-amber-400 bg-amber-500/25 text-amber-300'
                  : 'border-white/10 bg-[#2A303D] text-slate-200 hover:bg-[#343B4B]'
              }`}
            >
              <ChevronDown className="h-5 w-5" />
            </button>
            <div />
          </div>

          {/* Right Softkey + End */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              {...keyBind(J2MEKey.SOFT_RIGHT)}
              aria-label="Phím chức năng phải"
              className={`flex min-h-[42px] items-center justify-center rounded-xl border text-xs font-semibold transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                isActive(J2MEKey.SOFT_RIGHT)
                  ? 'translate-y-[1px] border-amber-400 bg-amber-500/20 text-amber-300'
                  : 'border-white/10 bg-[#252A36] text-slate-200 hover:bg-[#2E3443]'
              }`}
            >
              <span className="block h-1 w-6 rounded-full bg-slate-300/80" />
            </button>
            <button
              type="button"
              {...keyBind(J2MEKey.END)}
              aria-label="Phím Tắt / Quay lại"
              className={`flex min-h-[42px] items-center justify-center rounded-xl border transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                isActive(J2MEKey.END)
                  ? 'translate-y-[1px] border-rose-400 bg-rose-500/25 text-rose-300'
                  : 'border-white/10 bg-[#252A36] text-rose-400 hover:bg-[#2E3443]'
              }`}
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* T9 Numeric Keypad (1-9, *, 0, #) */}
        <div
          role="group"
          aria-label="Bàn phím số T9"
          className="mt-4 grid w-full grid-cols-3 gap-2"
        >
          {T9_KEYS.map((k) => {
            const active = isActive(k.code);
            return (
              <button
                key={k.code}
                type="button"
                {...keyBind(k.code)}
                aria-label={`Phím ${k.digit}`}
                className={`flex min-h-[44px] items-center justify-between rounded-xl border px-3 py-1.5 transition-transform select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  active
                    ? 'translate-y-[1px] border-amber-400 bg-amber-500/20 text-amber-200'
                    : 'border-white/[0.08] bg-[#222732] text-slate-100 hover:bg-[#2B313F]'
                }`}
              >
                <span className="font-mono-tabular text-base font-semibold leading-none">
                  {k.digit}
                </span>
                <span className="font-mono-tabular text-[10px] text-slate-400 leading-none">
                  {k.sub}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
