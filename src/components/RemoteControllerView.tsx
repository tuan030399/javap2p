import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Delete,
  Keyboard,
  LogOut,
  Maximize2,
  Minimize2,
  Phone,
  PhoneOff,
  Radio,
} from 'lucide-react';
import { J2MEKey, ScreenResolution, SoftkeyLabels } from '../types/j2me';

interface RemoteControllerViewProps {
  onBackToMenu: () => void;
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

export const RemoteControllerView: React.FC<RemoteControllerViewProps> = ({ onBackToMenu }) => {
  const [roomInput, setRoomInput] = useState('');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [hostOnline, setHostOnline] = useState(false);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [resolution] = useState<ScreenResolution>('240x320');
  const [isExpanded, setIsExpanded] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [inputText, setInputText] = useState('');
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());
  const [softkeys, setSoftkeys] = useState<SoftkeyLabels>({
    left: 'Menu',
    center: 'OK',
    right: 'Thoát',
  });
  const [touchIndicator, setTouchIndicator] = useState<{ x: number; y: number } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const heldKeysRef = useRef<Set<number>>(new Set());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const chassisRef = useRef<HTMLDivElement | null>(null);

  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height: typeof window !== 'undefined' ? window.innerHeight - 60 : 700,
  });
  const [chassisSize, setChassisSize] = useState<{ width: number; height: number }>({
    width: 324,
    height: 700,
  });

  const [resW, resH] = useMemo(() => {
    const parts = resolution.split('x').map(Number);
    return [parts[0] || 240, parts[1] || 320];
  }, [resolution]);

  useEffect(() => {
    if (!roomCode) return;
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
  }, [roomCode]);

  const fitScale = useMemo(() => {
    const availW = Math.max(200, stageSize.width - 16);
    const availH = Math.max(220, stageSize.height - 16);
    const maxScale = isExpanded ? 1.15 : 1.0;
    const raw = Math.min(
      maxScale,
      availW / (chassisSize.width || 324),
      availH / (chassisSize.height || 700)
    );
    return Math.max(0.35, Number(raw.toFixed(3)));
  }, [stageSize, chassisSize, isExpanded]);

  const handleScreenPointer = (
    e: React.PointerEvent<HTMLDivElement>,
    action: 'down' | 'move' | 'up'
  ) => {
    e.preventDefault();
    if (action === 'down') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const x = Math.max(0, Math.min(resW, (relX / (rect.width || 1)) * resW));
    const y = Math.max(0, Math.min(resH, (relY / (rect.height || 1)) * resH));

    if (action === 'down' || action === 'move') {
      setTouchIndicator({ x: (relX / (rect.width || 1)) * 256, y: (relY / (rect.height || 1)) * Math.round((256 * resH) / resW) });
    } else {
      setTouchIndicator(null);
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'pointer',
          action,
          x: Math.round(x),
          y: Math.round(y),
        })
      );
    }
  };

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = roomInput.trim().toUpperCase();
    if (!clean) return;
    setRoomCode(clean);
  };

  useEffect(() => {
    if (!roomCode) return;
    let isCancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (isCancelled) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${location.host}/api/j2me-relay?role=controller&room=${encodeURIComponent(roomCode)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (isCancelled) return;
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'host-status') {
              setHostOnline(!!msg.connected);
            } else if (msg.type === 'softkeys') {
              setSoftkeys({
                left: typeof msg.left === 'string' ? msg.left : '',
                center: typeof msg.center === 'string' ? msg.center : '',
                right: typeof msg.right === 'string' ? msg.right : '',
              });
            }
          } catch {
            // ignore
          }
        } else if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
          const blob =
            event.data instanceof Blob
              ? event.data
              : new Blob([event.data], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          setFrameSrc((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
      };

      ws.onclose = () => {
        if (isCancelled) return;
        setHostOnline(false);
        timer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        if (isCancelled) return;
        ws.close();
      };
    };

    connect();

    return () => {
      isCancelled = true;
      if (timer) clearTimeout(timer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [roomCode]);

  const sendKeyCommand = (keyCode: number, down: boolean) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      wsRef.current.send(JSON.stringify({ type: 'key', keyCode, down }));
    } catch {
      // ignore
    }
  };

  const handlePressKey = (code: number) => {
    if (!heldKeysRef.current.has(code)) {
      heldKeysRef.current.add(code);
      setPressedKeys(new Set(heldKeysRef.current));
      sendKeyCommand(code, true);
    }
  };

  const handleReleaseKey = (code: number) => {
    if (heldKeysRef.current.has(code)) {
      heldKeysRef.current.delete(code);
      setPressedKeys(new Set(heldKeysRef.current));
      sendKeyCommand(code, false);
    }
  };

  const keyBind = (code: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      handlePressKey(code);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      handleReleaseKey(code);
    },
    onPointerCancel: () => handleReleaseKey(code),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const isActive = (code: number) => pressedKeys.has(code);

  const displayWidthPx = 256;
  const displayHeightPx = Math.round((displayWidthPx * resH) / resW);

  if (!roomCode) {
    return (
      <div
        onContextMenu={(e) => e.preventDefault()}
        className="min-h-[100dvh] bg-[#0D1017] text-slate-100 flex flex-col items-center justify-center px-4 py-8 select-none"
      >
        <div className="w-full max-w-md rounded-2xl border border-white/12 bg-[#151922] p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onBackToMenu}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-100 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Quay lại</span>
            </button>
            <span className="font-mono-tabular text-xs text-emerald-400 font-medium">
              Chế độ Điều Hướng
            </span>
          </div>

          <div>
            <h1 className="font-display text-2xl font-bold text-slate-100">
              Nhập Mã Phòng (Room Code)
            </h1>
            <p className="mt-1.5 text-xs text-slate-400">
              Nhập mã phòng của máy ảo Host đang treo game 24/24 để kết nối và điều khiển từ xa.
            </p>
          </div>

          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Mã Phòng</label>
              <input
                type="text"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                placeholder="VD: JAVA-8888"
                required
                className="w-full rounded-xl border border-white/15 bg-black px-4 py-3 text-sm font-mono-tabular uppercase tracking-wider text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
            >
              Kết Nối Tới Máy Host
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="fixed inset-0 flex flex-col bg-[#0D1017] text-slate-100 overflow-hidden overscroll-none select-none"
      style={{ touchAction: 'none' }}
    >
      {/* Top Controller Bar */}
      <header className="shrink-0 border-b border-white/[0.08] bg-[#14171F] px-3 sm:px-5 py-2.5">
        <div className="mx-auto flex max-w-[900px] items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setRoomCode(null)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-300 hover:text-white"
              title="Đổi phòng"
            >
              <LogOut className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Radio
                  className={`h-3.5 w-3.5 ${hostOnline ? 'text-emerald-400' : 'text-amber-400'}`}
                />
                <p className="truncate text-xs font-semibold text-slate-100 font-mono-tabular">
                  Phòng: {roomCode}
                </p>
              </div>
              <p className="font-mono-tabular text-[10px] text-slate-400">
                {hostOnline ? 'Host đang phát trực tiếp' : 'Đang chờ máy Host...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowTextInput((v) => !v)}
              aria-label="Nhập chữ"
              title="Nhập chữ nhanh (Tài khoản / Mật khẩu)"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                showTextInput
                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                  : 'border-white/10 bg-[#1B1F28] text-slate-200'
              }`}
            >
              <Keyboard className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              aria-label="Phóng to hoặc thu gọn"
              className="hidden md:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-200"
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Viewport Stage */}
      <div
        ref={stageRef}
        className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden p-2"
      >
        {showTextInput && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-[min(420px,calc(100%-24px))] rounded-xl border border-emerald-500/30 bg-[#151A22] p-3 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-emerald-400">⌨ Gửi Văn Bản Từ Xa</span>
              <button
                type="button"
                onClick={() => setShowTextInput(false)}
                className="text-slate-400 text-xs"
              >
                ✕ Đóng
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (inputText && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'text', text: inputText }));
                  setInputText('');
                }
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Nhập TK, MK hoặc tin nhắn..."
                className="flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 whitespace-nowrap"
              >
                Gửi
              </button>
            </form>
          </div>
        )}

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
              width: 324,
              transform: `scale(${fitScale})`,
              transformOrigin: 'center center',
            }}
            className="relative flex flex-col items-center shrink-0 rounded-[32px] border border-white/15 bg-gradient-to-b from-[#222733] via-[#171B24] to-[#11141B] p-4 shadow-2xl select-none"
          >
            {/* Speaker grille */}
            <div className="mb-2.5 flex flex-col items-center gap-1">
              <div className="h-1.5 w-12 rounded-full bg-black/60 border border-white/10" />
              <span className="font-mono-tabular text-[9px] tracking-[0.18em] text-slate-400 uppercase">
                REMOTE CONTROLLER
              </span>
            </div>

            {/* Screen Bezel */}
            <div className="w-full rounded-[16px] border border-white/10 bg-[#080A0E] p-2 shadow-inner flex flex-col items-center">
              <div
                onPointerDown={(e) => handleScreenPointer(e, 'down')}
                onPointerMove={(e) => e.buttons === 1 && handleScreenPointer(e, 'move')}
                onPointerUp={(e) => handleScreenPointer(e, 'up')}
                onPointerCancel={(e) => handleScreenPointer(e, 'up')}
                onContextMenu={(e) => e.preventDefault()}
                className="relative overflow-hidden rounded-[8px] bg-black border border-white/[0.06] flex items-center justify-center cursor-crosshair select-none touch-none"
                style={{ width: displayWidthPx, height: displayHeightPx, touchAction: 'none' }}
              >
                {frameSrc ? (
                  <img
                    src={frameSrc}
                    alt="Live Game Stream"
                    draggable={false}
                    className="h-full w-full object-contain image-rendering-pixelated pointer-events-none select-none"
                  />
                ) : (
                  <div className="text-center p-4">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent mb-2" />
                    <p className="text-xs text-slate-400">Đang kết nối luồng màn hình...</p>
                  </div>
                )}
                {touchIndicator && (
                  <div
                    className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-2 border-emerald-400 bg-emerald-400/30"
                    style={{ left: touchIndicator.x, top: touchIndicator.y }}
                  />
                )}
              </div>

              {/* Softkey Bar */}
              <div
                className="mt-1.5 flex items-center justify-between px-2 py-1 text-[11px] font-medium text-slate-300 bg-[#0F131B] rounded border border-white/[0.05]"
                style={{ width: displayWidthPx }}
              >
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.SOFT_LEFT)}
                  className="truncate max-w-[33%] text-left text-emerald-400 select-none"
                >
                  {softkeys.left || '\u00A0'}
                </button>
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.FIRE)}
                  className="truncate max-w-[33%] text-center font-semibold text-slate-200 select-none"
                >
                  {softkeys.center || '\u00A0'}
                </button>
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.SOFT_RIGHT)}
                  className="truncate max-w-[33%] text-right text-slate-300 select-none"
                >
                  {softkeys.right || '\u00A0'}
                </button>
              </div>
            </div>

            {/* D-Pad & Controls */}
            <div className="mt-3.5 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.SOFT_LEFT)}
                  className={`flex h-[38px] items-center justify-center rounded-xl border text-xs font-semibold select-none ${
                    isActive(J2MEKey.SOFT_LEFT)
                      ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300'
                      : 'border-white/10 bg-[#252A36] text-slate-200'
                  }`}
                >
                  <span className="block h-1 w-6 rounded-full bg-emerald-400" />
                </button>
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.CALL)}
                  className={`flex h-[38px] items-center justify-center rounded-xl border select-none ${
                    isActive(J2MEKey.CALL)
                      ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300'
                      : 'border-white/10 bg-[#252A36] text-emerald-400'
                  }`}
                >
                  <Phone className="h-4 w-4" />
                </button>
              </div>

              <div className="relative grid h-[116px] w-[116px] grid-cols-3 grid-rows-3 gap-1 rounded-[24px] border border-white/10 bg-[#14171F] p-1.5 shadow-inner">
                <div />
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.UP)}
                  className={`flex items-center justify-center rounded-t-xl border select-none ${
                    isActive(J2MEKey.UP)
                      ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300'
                      : 'border-white/10 bg-[#2A303D] text-slate-200'
                  }`}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <div />

                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.LEFT)}
                  className={`flex items-center justify-center rounded-l-xl border select-none ${
                    isActive(J2MEKey.LEFT)
                      ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300'
                      : 'border-white/10 bg-[#2A303D] text-slate-200'
                  }`}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.FIRE)}
                  className={`flex items-center justify-center rounded-xl border text-[11px] font-bold select-none ${
                    isActive(J2MEKey.FIRE)
                      ? 'bg-emerald-300 border-emerald-200 text-slate-950'
                      : 'border-emerald-500/50 bg-emerald-500 text-slate-950'
                  }`}
                >
                  OK
                </button>

                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.RIGHT)}
                  className={`flex items-center justify-center rounded-r-xl border select-none ${
                    isActive(J2MEKey.RIGHT)
                      ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300'
                      : 'border-white/10 bg-[#2A303D] text-slate-200'
                  }`}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>

                <div />
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.DOWN)}
                  className={`flex items-center justify-center rounded-b-xl border select-none ${
                    isActive(J2MEKey.DOWN)
                      ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300'
                      : 'border-white/10 bg-[#2A303D] text-slate-200'
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
                  className={`flex h-[38px] items-center justify-center rounded-xl border text-xs font-semibold select-none ${
                    isActive(J2MEKey.SOFT_RIGHT)
                      ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300'
                      : 'border-white/10 bg-[#252A36] text-slate-200'
                  }`}
                >
                  <span className="block h-1 w-6 rounded-full bg-slate-300" />
                </button>
                <button
                  type="button"
                  draggable={false}
                  {...keyBind(J2MEKey.END)}
                  className={`flex h-[38px] items-center justify-center rounded-xl border select-none ${
                    isActive(J2MEKey.END)
                      ? 'bg-rose-500/25 border-rose-400 text-rose-300'
                      : 'border-white/10 bg-[#252A36] text-rose-400'
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
                    ? 'translate-y-[1px] bg-emerald-500/20 border-emerald-400 text-emerald-200'
                    : 'border-white/[0.08] bg-[#222732] text-slate-200 hover:bg-[#2B313F]'
                }`}
              >
                <Delete className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                <span>Xóa chữ</span>
                <span className="font-mono-tabular text-[10px] text-slate-400">(C / ⌫)</span>
              </button>
            </div>

            {/* T9 Keypad */}
            <div className="mt-2.5 grid w-full grid-cols-3 gap-1.5">
              {T9_KEYS.map((k) => {
                const active = isActive(k.code);
                return (
                  <button
                    key={k.code}
                    type="button"
                    draggable={false}
                    {...keyBind(k.code)}
                    className={`flex h-[38px] items-center justify-between rounded-xl border px-2.5 py-1 transition-transform select-none ${
                      active
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                        : 'border-white/[0.08] bg-[#222732] text-slate-100'
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
      </div>
    </div>
  );
};
