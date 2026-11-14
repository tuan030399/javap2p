import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ControlsConfigPanel } from './components/ControlsConfigPanel';
import { GameLibraryPanel } from './components/GameLibraryPanel';
import { JarUploadPanel } from './components/JarUploadPanel';
import { ModeSelector } from './components/ModeSelector';
import { PhoneConsole } from './components/PhoneConsole';
import { RemoteControllerView } from './components/RemoteControllerView';
import { TopBar, WorkbenchTab } from './components/TopBar';
import { BUILTIN_GAMES_META, createBuiltinGameEngine } from './games/builtinGames';
import {
  ActiveGameSource,
  AppMode,
  BuiltinGameId,
  DisplayFilter,
  J2MEKey,
  JarEngineId,
  JavaGameEngine,
  PhoneProfile,
  ScreenResolution,
  SoftkeyLabels,
  UploadedJarRecord,
  VmRuntimeState,
} from './types/j2me';
import { createSamplePlayableJar, inspectJarBuffer, parseManifestText } from './utils/jarParser';
import { deleteUploadedJar, listUploadedJars, saveUploadedJar } from './utils/jarStorage';
import { retroAudio } from './utils/sound';

const INITIAL_VM_STATE: VmRuntimeState = {
  status: 'idle',
  currentScreen: 'Chưa nạp .JAR',
  instructionsExecuted: 0,
  logs: [],
};

function mapBrowserKeyToJ2ME(e: KeyboardEvent): number | null {
  switch (e.key) {
    case 'ArrowUp':
      return J2MEKey.UP;
    case 'ArrowDown':
      return J2MEKey.DOWN;
    case 'ArrowLeft':
      return J2MEKey.LEFT;
    case 'ArrowRight':
      return J2MEKey.RIGHT;
    case 'Enter':
      return J2MEKey.FIRE;
    case ' ':
      return 32;
    case 'Escape':
      return J2MEKey.END;
    case 'Backspace':
      return 8;
    case '*':
      return J2MEKey.KEY_STAR;
    case '#':
      return J2MEKey.KEY_POUND;
    default:
      if (e.key.length === 1) {
        const code = e.key.charCodeAt(0);
        if (code >= 32 && code <= 126) {
          return code;
        }
      }
      return null;
  }
}

function mapJ2MEKeyToFreeJ2ME(keyCode: number): { code: string; symbol: string } | null {
  switch (keyCode) {
    case J2MEKey.UP:
      return { code: 'ArrowUp', symbol: '\x00' };
    case J2MEKey.DOWN:
      return { code: 'ArrowDown', symbol: '\x00' };
    case J2MEKey.LEFT:
      return { code: 'ArrowLeft', symbol: '\x00' };
    case J2MEKey.RIGHT:
      return { code: 'ArrowRight', symbol: '\x00' };
    case J2MEKey.FIRE:
    case J2MEKey.CALL:
      return { code: 'Enter', symbol: '\x00' };
    case J2MEKey.SOFT_LEFT:
      return { code: 'F1', symbol: '\x00' };
    case J2MEKey.SOFT_RIGHT:
      return { code: 'F2', symbol: '\x00' };
    case J2MEKey.END:
      return { code: 'Escape', symbol: '\x00' };
    case J2MEKey.KEY_STAR:
      return { code: 'NumpadAsterisk', symbol: '*' };
    case J2MEKey.KEY_POUND:
      return { code: 'NumpadDivide', symbol: '#' };
    default:
      if (keyCode >= J2MEKey.KEY_0 && keyCode <= J2MEKey.KEY_9) {
        const digit = keyCode - 48;
        return { code: `Digit${digit}`, symbol: String(digit) };
      }
      return null;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('library');
  const [activeSource, setActiveSource] = useState<ActiveGameSource>({
    type: 'builtin',
    id: 'snake',
  });
  const [uploadedJars, setUploadedJars] = useState<UploadedJarRecord[]>([]);
  const [resolution, setResolution] = useState<ScreenResolution>('240x320');
  const [filter, setFilter] = useState<DisplayFilter>('crisp');
  const [phoneProfile, setPhoneProfile] = useState<PhoneProfile>('Nokia');
  const [jarEngine, setJarEngine] = useState<JarEngineId>('j2mejs');
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [emuRestartCount, setEmuRestartCount] = useState(0);
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(() => new Set());
  const [softkeys, setSoftkeys] = useState<SoftkeyLabels>({
    left: 'Bắt đầu',
    center: 'Chơi',
    right: '',
  });
  const [appMode, setAppMode] = useState<AppMode>('menu');
  const [roomCode] = useState<string>(() => `JAVA-${Math.floor(1000 + Math.random() * 9000)}`);
  const [vmState, setVmState] = useState<VmRuntimeState>(INITIAL_VM_STATE);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emuIframeRef = useRef<HTMLIFrameElement | null>(null);
  const quickUploadInputRef = useRef<HTMLInputElement | null>(null);
  const heldKeysRef = useRef<Set<number>>(new Set());
  const builtinEngineRef = useRef<JavaGameEngine | null>(null);
  const softkeysRef = useRef<SoftkeyLabels>(softkeys);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const phoneProfileRef = useRef(phoneProfile);
  phoneProfileRef.current = phoneProfile;

  const [resW, resH] = useMemo(() => {
    const [w, h] = resolution.split('x').map(Number);
    return [w || 240, h || 320];
  }, [resolution]);

  // Load persisted .JAR library from IndexedDB on mount
  useEffect(() => {
    listUploadedJars().then((items) => {
      setUploadedJars(items);
    });
  }, []);

  const emuInstanceKey = useMemo(() => {
    if (activeSource.type !== 'jar') return 'builtin';
    return `${jarEngine}_${activeSource.record.id}_${resW}x${resH}_${phoneProfile}_${emuRestartCount}`;
  }, [jarEngine, activeSource, resW, resH, phoneProfile, emuRestartCount]);

  // Initialize active game whenever activeSource, resolution, phoneProfile, or jarEngine changes
  useEffect(() => {
    setIsPaused(false);
    heldKeysRef.current.clear();
    setPressedKeys(new Set());

    if (activeSource.type === 'builtin') {
      const engine = createBuiltinGameEngine(activeSource.id);
      engine.init(resW, resH);
      builtinEngineRef.current = engine;
      setVmState(INITIAL_VM_STATE);
      const sk = engine.getSoftkeys();
      softkeysRef.current = sk;
      setSoftkeys(sk);
    } else {
      builtinEngineRef.current = null;
      const sk: SoftkeyLabels = { left: 'Tùy chọn', center: 'OK', right: 'Quay lại' };
      softkeysRef.current = sk;
      setSoftkeys(sk);
      const engineLabel = jarEngine === 'j2mejs' ? 'J2meJS' : 'FreeJ2ME';
      setVmState({
        status: 'loading',
        currentScreen: activeSource.record.inspect.manifest.midletName,
        instructionsExecuted: 0,
        logs: [`Đang khởi động ${engineLabel} (${resW}×${resH}) cho ${activeSource.record.fileName}...`],
      });
    }
  }, [activeSource, resW, resH, phoneProfile, jarEngine]);

  // Listen to FreeJ2ME iframe bridge messages
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (activeSource.type !== 'jar') return;
      if (emuIframeRef.current?.contentWindow && e.source !== emuIframeRef.current.contentWindow) {
        return;
      }
      const data = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'ready') {
        emuIframeRef.current?.contentWindow?.postMessage(
          {
            type: 'launch',
            fileName: activeSource.record.fileName,
            buffer: activeSource.record.buffer,
            width: resW,
            height: resH,
            muted: isMutedRef.current,
            phone: phoneProfileRef.current,
            engineMode: 'compat',
            extraProperties: activeSource.record.inspect.manifest.rawProperties,
          },
          '*'
        );
      } else if (data.type === 'vm-status') {
        setVmState((prev) => ({
          ...prev,
          status: data.status || prev.status,
          logs: data.message ? [...prev.logs.slice(-40), String(data.message)] : prev.logs,
        }));
      } else if (data.type === 'vm-title' && data.title) {
        setVmState((prev) => ({ ...prev, currentScreen: String(data.title) }));
      } else if (data.type === 'vm-log' && data.message) {
        setVmState((prev) => ({
          ...prev,
          logs: [...prev.logs.slice(-40), String(data.message)],
        }));
      } else if (data.type === 'vm-restart') {
        setEmuRestartCount((k) => k + 1);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [activeSource, resW, resH, jarEngine]);

  // 60fps Built-in Game Render Loop
  useEffect(() => {
    if (activeSource.type !== 'builtin') return;
    let rafId = 0;
    let lastTime = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(50, now - lastTime);
      lastTime = now;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');

      if (ctx && builtinEngineRef.current) {
        const eng = builtinEngineRef.current;
        if (!isPausedRef.current) {
          eng.update(dt, heldKeysRef.current);
        }
        eng.render(ctx, resW, resH);
        const nextSk = eng.getSoftkeys();
        if (
          nextSk.left !== softkeysRef.current.left ||
          nextSk.center !== softkeysRef.current.center ||
          nextSk.right !== softkeysRef.current.right
        ) {
          softkeysRef.current = nextSk;
          setSoftkeys(nextSk);
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [activeSource, resW, resH]);

  const handlePressKey = useCallback(
    (keyCode: number) => {
      if (!heldKeysRef.current.has(keyCode)) {
        heldKeysRef.current.add(keyCode);
        setPressedKeys(new Set(heldKeysRef.current));
        retroAudio.playKeyClick();

        if (activeSource.type === 'builtin' && builtinEngineRef.current) {
          builtinEngineRef.current.onKeyDown(keyCode);
        } else if (activeSource.type === 'jar') {
          if (jarEngine === 'j2mejs') {
            const j2meCode = keyCode === J2MEKey.CALL ? J2MEKey.FIRE : keyCode;
            emuIframeRef.current?.contentWindow?.postMessage(
              { type: 'key', down: true, keyCode: j2meCode },
              '*'
            );
          } else {
            const mapped = mapJ2MEKeyToFreeJ2ME(keyCode);
            if (mapped) {
              emuIframeRef.current?.contentWindow?.postMessage(
                { type: 'key', down: true, code: mapped.code, symbol: mapped.symbol },
                '*'
              );
            }
          }
        }
      }
    },
    [activeSource.type, jarEngine]
  );

  const handleReleaseKey = useCallback(
    (keyCode: number) => {
      if (heldKeysRef.current.has(keyCode)) {
        heldKeysRef.current.delete(keyCode);
        setPressedKeys(new Set(heldKeysRef.current));

        if (activeSource.type === 'builtin' && builtinEngineRef.current) {
          builtinEngineRef.current.onKeyUp(keyCode);
        } else if (activeSource.type === 'jar') {
          if (jarEngine === 'j2mejs') {
            const j2meCode = keyCode === J2MEKey.CALL ? J2MEKey.FIRE : keyCode;
            emuIframeRef.current?.contentWindow?.postMessage(
              { type: 'key', down: false, keyCode: j2meCode },
              '*'
            );
          } else {
            const mapped = mapJ2MEKeyToFreeJ2ME(keyCode);
            if (mapped) {
              emuIframeRef.current?.contentWindow?.postMessage(
                { type: 'key', down: false, code: mapped.code, symbol: mapped.symbol },
                '*'
              );
            }
          }
        }
      }
    },
    [activeSource.type, jarEngine]
  );

  // Physical Keyboard Bindings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const mapped = mapBrowserKeyToJ2ME(e);
      if (mapped !== null) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Escape'].includes(e.key)) {
          e.preventDefault();
        }
        handlePressKey(mapped);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const mapped = mapBrowserKeyToJ2ME(e);
      if (mapped !== null) {
        handleReleaseKey(mapped);
      }
    };

    const onBlur = () => {
      heldKeysRef.current.clear();
      setPressedKeys(new Set());
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [handlePressKey, handleReleaseKey]);

  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const handleRestart = useCallback(() => {
    setIsPaused(false);
    if (activeSource.type === 'builtin') {
      const engine = createBuiltinGameEngine(activeSource.id);
      engine.init(resW, resH);
      builtinEngineRef.current = engine;
    } else {
      setEmuRestartCount((k) => k + 1);
      setVmState((prev) => ({
        ...prev,
        status: 'loading',
        logs: [...prev.logs.slice(-30), `Đang khởi động lại ${jarEngine === 'j2mejs' ? 'J2meJS' : 'FreeJ2ME'}...`],
      }));
    }
  }, [activeSource, resW, resH, jarEngine]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      retroAudio.setMuted(next);
      emuIframeRef.current?.contentWindow?.postMessage({ type: 'mute', muted: next }, '*');
      return next;
    });
  }, []);

  const handleSendText = useCallback(
    (text: string) => {
      if (!text) return;
      let i = 0;
      const interval = setInterval(() => {
        if (i >= text.length) {
          clearInterval(interval);
          return;
        }
        const char = text[i++];
        const code = char.charCodeAt(0);
        handlePressKey(code);
        setTimeout(() => {
          handleReleaseKey(code);
        }, 50);
      }, 90);
    },
    [handlePressKey, handleReleaseKey]
  );

  // Host streaming & remote control effect
  useEffect(() => {
    if (appMode !== 'host') return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/api/j2me-relay?role=host&room=${encodeURIComponent(roomCode)}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'key' && typeof msg.keyCode === 'number') {
            if (msg.down) {
              handlePressKey(msg.keyCode);
            } else {
              handleReleaseKey(msg.keyCode);
            }
          } else if (msg.type === 'text' && typeof msg.text === 'string') {
            handleSendText(msg.text);
          }
        } catch {}
      }
    };

    const interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      let targetCanvas: HTMLCanvasElement | null = null;
      if (activeSource.type === 'builtin') {
        targetCanvas = canvasRef.current;
      } else {
        try {
          const doc = emuIframeRef.current?.contentDocument;
          targetCanvas = doc?.querySelector('#canvas') as HTMLCanvasElement | null;
        } catch {
          targetCanvas = canvasRef.current;
        }
      }
      if (targetCanvas) {
        targetCanvas.toBlob(
          (blob) => {
            if (blob && ws.readyState === WebSocket.OPEN) {
              ws.send(blob);
            }
          },
          'image/jpeg',
          0.6
        );
      }
    }, 80);

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [appMode, roomCode, activeSource.type, handlePressKey, handleReleaseKey, handleSendText]);

  const ingestJarBuffer = useCallback(
    async (buffer: ArrayBuffer, fileName: string, extraProps?: Record<string, string>) => {
      if (buffer.byteLength > 32 * 1024 * 1024) {
        throw new Error('Tệp vượt quá giới hạn 32 MB.');
      }
      const inspect = await inspectJarBuffer(buffer, fileName, extraProps);
      const record: UploadedJarRecord = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fileName,
        uploadedAt: Date.now(),
        buffer,
        inspect,
      };
      await saveUploadedJar(record);
      setUploadedJars((prev) => [record, ...prev]);
      setActiveSource({ type: 'jar', record });
      setActiveTab('upload');
    },
    []
  );

  const handleUploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const list = Array.from(files);
      const jarFile = list.find((f) => f.name.toLowerCase().endsWith('.jar'));
      const jadFile = list.find((f) => f.name.toLowerCase().endsWith('.jad'));
      if (!jarFile) {
        if (jadFile) {
          throw new Error('Tệp .JAD chỉ chứa mô tả ứng dụng. Vui lòng chọn kèm tệp .JAR tương ứng.');
        }
        throw new Error('Vui lòng chọn tệp định dạng .JAR (Java MIDlet).');
      }
      const extraProps = jadFile ? parseManifestText(await jadFile.text()) : undefined;
      const buffer = await jarFile.arrayBuffer();
      await ingestJarBuffer(buffer, jarFile.name, extraProps);
    },
    [ingestJarBuffer]
  );

  const handleRunSampleJar = useCallback(async () => {
    const { buffer, fileName } = await createSamplePlayableJar();
    await ingestJarBuffer(buffer, fileName);
  }, [ingestJarBuffer]);

  const handleDownloadSampleJar = useCallback(async () => {
    const { buffer, fileName } = await createSamplePlayableJar();
    const blob = new Blob([buffer], { type: 'application/java-archive' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const handleDeleteJar = useCallback(
    async (id: string) => {
      await deleteUploadedJar(id);
      setUploadedJars((prev) => prev.filter((item) => item.id !== id));
      if (activeSource.type === 'jar' && activeSource.record.id === id) {
        setActiveSource({ type: 'builtin', id: 'snake' });
      }
    },
    [activeSource]
  );

  const activeGameTitle = useMemo(() => {
    if (activeSource.type === 'builtin') {
      return BUILTIN_GAMES_META.find((g) => g.id === activeSource.id)?.title || 'Java Game';
    }
    return activeSource.record.inspect.manifest.midletName;
  }, [activeSource]);

  const activeJarRecord = useMemo(() => {
    if (activeSource.type === 'jar') return activeSource.record;
    return uploadedJars[0] ?? null;
  }, [activeSource, uploadedJars]);

  if (appMode === 'menu') {
    return <ModeSelector onSelectMode={setAppMode} />;
  }

  if (appMode === 'controller') {
    return <RemoteControllerView onBackToMenu={() => setAppMode('menu')} />;
  }

  return (
    <div className="min-h-screen bg-[#111317] text-slate-100 flex flex-col">
      {/* Host Mode Info Banner */}
      <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 text-center text-xs font-medium text-amber-300 flex flex-wrap items-center justify-center gap-3">
        <span>🖥️ <strong>Chế độ Host (Treo game 24/24)</strong> · Mã phòng: <code className="rounded bg-black/40 px-2 py-0.5 font-mono-tabular font-bold text-amber-200">{roomCode}</code></span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(roomCode);
            alert('Đã sao chép mã phòng: ' + roomCode);
          }}
          className="rounded bg-amber-500/25 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/40 transition-colors"
        >
          Sao chép mã phòng
        </button>
        <button
          type="button"
          onClick={() => setAppMode('menu')}
          className="rounded bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/20 transition-colors ml-2"
        >
          Thoát về Menu
        </button>
      </div>

      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onQuickUploadClick={() => quickUploadInputRef.current?.click()}
      />

      <input
        ref={quickUploadInputRef}
        type="file"
        accept=".jar,.jad"
        multiple
        className="hidden"
        onChange={(e) => {
          handleUploadFiles(e.target.files).catch(() => {
            setActiveTab('upload');
          });
          e.target.value = '';
        }}
      />

      <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 sm:px-6 py-8 overflow-x-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[auto_minmax(0,1fr)] gap-6 xl:gap-10 items-start">
          {/* Left Focal Anchor: Tactile Java Phone Hardware */}
          <div className="flex justify-center lg:sticky lg:top-6">
            <PhoneConsole
              canvasRef={canvasRef}
              emuIframeRef={emuIframeRef}
              isJarMode={activeSource.type === 'jar'}
              emuSrc={jarEngine === 'j2mejs' ? '/j2mejs/launcher.html' : '/freej2me/player.html'}
              emuInstanceKey={emuInstanceKey}
              gameTitle={activeGameTitle}
              resolution={resolution}
              filter={filter}
              softkeys={softkeys}
              pressedKeys={pressedKeys}
              isPaused={isPaused}
              isMuted={isMuted}
              isExpanded={isExpanded}
              onPressKey={handlePressKey}
              onReleaseKey={handleReleaseKey}
              onTogglePause={handleTogglePause}
              onRestart={handleRestart}
              onToggleMute={handleToggleMute}
              onToggleExpand={() => setIsExpanded((v) => !v)}
              onSendText={handleSendText}
            />
          </div>

          {/* Right Workbench: Game Library, JAR Upload & Controls Config */}
          <div className="min-w-0">
            <div className="mb-6 flex flex-col xl:flex-row xl:items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
              <div className="min-w-0">
                <h1
                  className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-100"
                  style={{ textWrap: 'balance' }}
                >
                  Trạm Chơi Game Java Di Động
                </h1>
                <p className="mt-1.5 text-sm text-slate-400">
                  Điều khiển bằng cụm phím D-Pad, bàn phím T9 trên màn hình hoặc bàn phím máy tính.
                </p>
              </div>

              {/* Segmented Control */}
              <div
                role="tablist"
                aria-label="Khu vực làm việc"
                className="inline-flex items-center gap-1 rounded-lg bg-[#181C24] p-1 border border-white/[0.08] shrink-0 self-start xl:self-auto"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'library'}
                  onClick={() => setActiveTab('library')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === 'library'
                      ? 'bg-[#262C38] text-amber-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Kho Game
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'upload'}
                  onClick={() => setActiveTab('upload')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === 'upload'
                      ? 'bg-[#262C38] text-amber-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Tải .JAR
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'controls'}
                  onClick={() => setActiveTab('controls')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === 'controls'
                      ? 'bg-[#262C38] text-amber-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Cấu Hình
                </button>
              </div>
            </div>

            {activeTab === 'library' && (
              <GameLibraryPanel
                activeSource={activeSource}
                uploadedJars={uploadedJars}
                onSelectBuiltin={(id: BuiltinGameId) =>
                  setActiveSource({ type: 'builtin', id })
                }
                onSelectJar={(record) => setActiveSource({ type: 'jar', record })}
                onDeleteJar={handleDeleteJar}
                onGoToUpload={() => setActiveTab('upload')}
              />
            )}

            {activeTab === 'upload' && (
              <JarUploadPanel
                activeJar={activeJarRecord}
                vmState={vmState}
                onUploadFiles={handleUploadFiles}
                onRunSampleJar={handleRunSampleJar}
                onDownloadSampleJar={handleDownloadSampleJar}
              />
            )}

            {activeTab === 'controls' && (
              <ControlsConfigPanel
                resolution={resolution}
                filter={filter}
                phoneProfile={phoneProfile}
                jarEngine={jarEngine}
                isMuted={isMuted}
                onChangeResolution={setResolution}
                onChangeFilter={setFilter}
                onChangePhoneProfile={setPhoneProfile}
                onChangeJarEngine={setJarEngine}
                onToggleMute={handleToggleMute}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
