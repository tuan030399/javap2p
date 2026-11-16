import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppMode,
  J2MEKey,
  PersistedVmConfig,
  SoftkeyLabels,
  UploadedJarRecord,
  VmRuntimeState,
  VmStatusSummary,
} from '../types/j2me';
import { retroAudio } from '../utils/sound';
import { PhoneConsole } from './PhoneConsole';

interface VmSlotProps {
  vm: PersistedVmConfig;
  jarRecord: UploadedJarRecord | null;
  uploadedJars: UploadedJarRecord[];
  appMode: AppMode;
  isOpen: boolean;
  initialOpenSettings?: boolean;
  onClose: () => void;
  onUpdateVm: (vmId: string, patch: Partial<PersistedVmConfig>) => void;
  onDeleteVm: (vmId: string) => void;
  onUploadJarForVm: (vmId: string, files: FileList | null) => Promise<void>;
  onCreateSampleJarForVm: (vmId: string) => Promise<void>;
  onStatusUpdate: (vmId: string, summary: VmStatusSummary) => void;
}

const DEFAULT_VM_STATE: VmRuntimeState = {
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
      return J2MEKey.CLEAR;
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
    case J2MEKey.CLEAR:
      return { code: 'Backspace', symbol: '\x00' };
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

export const VmSlot: React.FC<VmSlotProps> = ({
  vm,
  jarRecord,
  uploadedJars,
  appMode,
  isOpen,
  initialOpenSettings,
  onClose,
  onUpdateVm,
  onDeleteVm,
  onUploadJarForVm,
  onCreateSampleJarForVm,
  onStatusUpdate,
}) => {
  const [emuRestartCount, setEmuRestartCount] = useState(0);
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(() => new Set());
  const [softkeys, setSoftkeys] = useState<SoftkeyLabels>({
    left: 'Tùy chọn',
    center: 'OK',
    right: 'Quay lại',
  });
  const [vmState, setVmState] = useState<VmRuntimeState>(DEFAULT_VM_STATE);
  const [controllerCount, setControllerCount] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);

  const emuIframeRef = useRef<HTMLIFrameElement | null>(null);
  const hostWsRef = useRef<WebSocket | null>(null);
  const heldKeysRef = useRef<Set<number>>(new Set());
  const softkeysRef = useRef<SoftkeyLabels>(softkeys);
  const controllerCountRef = useRef(0);
  controllerCountRef.current = controllerCount;

  const isMutedRef = useRef(vm.isMuted);
  isMutedRef.current = vm.isMuted;
  const phoneProfileRef = useRef(vm.phoneProfile);
  phoneProfileRef.current = vm.phoneProfile;

  const [resW, resH] = useMemo(() => {
    const [w, h] = vm.resolution.split('x').map(Number);
    return [w || 240, h || 320];
  }, [vm.resolution]);

  useEffect(() => {
    if (isOpen && initialOpenSettings) {
      setShowSettings(true);
    } else if (!isOpen) {
      setShowSettings(false);
      setShowTextInput(false);
    }
  }, [isOpen, initialOpenSettings]);

  const emuInstanceKey = useMemo(() => {
    if (!vm.isRunning || !jarRecord) return 'stopped';
    return `${vm.id}_${vm.jarEngine}_${jarRecord.id}_${resW}x${resH}_${vm.phoneProfile}_${emuRestartCount}`;
  }, [vm.id, vm.isRunning, vm.jarEngine, vm.phoneProfile, jarRecord, resW, resH, emuRestartCount]);

  // Reset runtime status banner whenever emulator instance key changes
  useEffect(() => {
    heldKeysRef.current.clear();
    setPressedKeys(new Set());

    if (!vm.isRunning || !jarRecord) {
      setVmState({
        status: 'idle',
        currentScreen: jarRecord ? 'Đã tắt' : 'Chưa nạp .JAR',
        instructionsExecuted: 0,
        logs: [],
      });
      return;
    }

    const sk: SoftkeyLabels = { left: 'Tùy chọn', center: 'OK', right: 'Quay lại' };
    softkeysRef.current = sk;
    setSoftkeys(sk);
    const engineLabel = vm.jarEngine === 'j2mejs' ? 'J2meJS' : 'FreeJ2ME';
    setVmState({
      status: 'loading',
      currentScreen: jarRecord.inspect.manifest.midletName,
      instructionsExecuted: 0,
      logs: [`Đang khởi động ${engineLabel} (${resW}×${resH}) cho ${jarRecord.fileName}...`],
    });
  }, [emuInstanceKey, vm.isRunning, jarRecord, vm.jarEngine, resW, resH]);

  // Sync runtime & controller count up to parent VM list
  useEffect(() => {
    onStatusUpdate(vm.id, { runtime: vmState, controllerCount });
  }, [vm.id, vmState, controllerCount, onStatusUpdate]);

  // Forward mute updates immediately to running iframe
  useEffect(() => {
    emuIframeRef.current?.contentWindow?.postMessage({ type: 'mute', muted: vm.isMuted }, '*');
  }, [vm.isMuted]);

  // Scoped message bridge strictly for THIS VM's iframe
  useEffect(() => {
    if (!vm.isRunning || !jarRecord) return;

    const onMessage = (e: MessageEvent) => {
      if (!emuIframeRef.current?.contentWindow || e.source !== emuIframeRef.current.contentWindow) {
        return;
      }
      const data = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'ready') {
        emuIframeRef.current?.contentWindow?.postMessage(
          {
            type: 'launch',
            vmId: vm.id,
            fileName: jarRecord.fileName,
            buffer: jarRecord.buffer,
            width: resW,
            height: resH,
            muted: isMutedRef.current,
            phone: phoneProfileRef.current,
            engineMode: 'compat',
            extraProperties: jarRecord.inspect.manifest.rawProperties,
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
      } else if (data.type === 'softkeys') {
        const nextSk: SoftkeyLabels = {
          left: typeof data.left === 'string' ? data.left : '',
          center: typeof data.center === 'string' ? data.center : '',
          right: typeof data.right === 'string' ? data.right : '',
        };
        softkeysRef.current = nextSk;
        setSoftkeys(nextSk);
        if (hostWsRef.current && hostWsRef.current.readyState === WebSocket.OPEN) {
          hostWsRef.current.send(JSON.stringify({ type: 'softkeys', ...nextSk }));
        }
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
  }, [vm.id, vm.isRunning, jarRecord, resW, resH]);

  const handlePressKey = useCallback(
    (keyCode: number) => {
      if (!vm.isRunning || !jarRecord) return;
      if (!heldKeysRef.current.has(keyCode)) {
        heldKeysRef.current.add(keyCode);
        setPressedKeys(new Set(heldKeysRef.current));
        if (isOpen && !vm.isMuted) {
          retroAudio.setMuted(false);
          retroAudio.playKeyClick();
        }

        if (vm.jarEngine === 'j2mejs') {
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
    },
    [vm.isRunning, vm.jarEngine, vm.isMuted, jarRecord, isOpen]
  );

  const handleReleaseKey = useCallback(
    (keyCode: number) => {
      if (heldKeysRef.current.has(keyCode)) {
        heldKeysRef.current.delete(keyCode);
        setPressedKeys(new Set(heldKeysRef.current));

        if (vm.jarEngine === 'j2mejs') {
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
    },
    [vm.jarEngine]
  );

  const handleSendText = useCallback(
    (text: string) => {
      if (!text || !vm.isRunning || !jarRecord) return;
      if (vm.jarEngine === 'j2mejs') {
        emuIframeRef.current?.contentWindow?.postMessage({ type: 'text', text }, '*');
        return;
      }
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
    [vm.isRunning, vm.jarEngine, jarRecord, handlePressKey, handleReleaseKey]
  );

  // Physical keyboard listener active ONLY when this VM modal is open and not typing in Settings/Text bar
  useEffect(() => {
    if (!isOpen || showSettings || showTextInput || !vm.isRunning || !jarRecord) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
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
  }, [isOpen, showSettings, showTextInput, vm.isRunning, jarRecord, handlePressKey, handleReleaseKey]);

  // Independent Host WebSocket relay per running VM (encodes JPEG only when remote controllerCount > 0)
  useEffect(() => {
    if (appMode !== 'host' || !vm.isRunning || !jarRecord) {
      setControllerCount(0);
      return;
    }

    let isCancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let streamInterval: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (isCancelled) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${location.host}/api/j2me-relay?role=host&room=${encodeURIComponent(vm.roomCode)}`;
      const ws = new WebSocket(wsUrl);
      hostWsRef.current = ws;

      ws.onopen = () => {
        if (isCancelled) {
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ type: 'softkeys', ...softkeysRef.current }));
      };

      ws.onmessage = (event) => {
        if (isCancelled || typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'controller-joined') {
            ws.send(JSON.stringify({ type: 'softkeys', ...softkeysRef.current }));
          } else if (msg.type === 'controller-count' && typeof msg.count === 'number') {
            setControllerCount(msg.count);
          } else if (msg.type === 'key' && typeof msg.keyCode === 'number') {
            if (msg.down) {
              handlePressKey(msg.keyCode);
            } else {
              handleReleaseKey(msg.keyCode);
            }
          } else if (msg.type === 'text' && typeof msg.text === 'string') {
            handleSendText(msg.text);
          } else if (msg.type === 'pointer' && typeof msg.x === 'number' && typeof msg.y === 'number') {
            emuIframeRef.current?.contentWindow?.postMessage(
              { type: 'pointer', action: msg.action, x: msg.x, y: msg.y },
              '*'
            );
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (isCancelled) return;
        setControllerCount(0);
        reconnectTimer = setTimeout(connect, 2500);
      };

      ws.onerror = () => {
        if (isCancelled) return;
        ws.close();
      };
    };

    connect();

    streamInterval = setInterval(() => {
      const ws = hostWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (controllerCountRef.current <= 0) return;

      let targetCanvas: HTMLCanvasElement | null = null;
      try {
        const doc = emuIframeRef.current?.contentDocument;
        targetCanvas =
          (doc?.querySelector('#canvas') as HTMLCanvasElement | null) ||
          (doc?.querySelector('#display') as HTMLCanvasElement | null);
      } catch {
        targetCanvas = null;
      }

      if (targetCanvas) {
        targetCanvas.toBlob(
          (blob) => {
            if (blob && ws.readyState === WebSocket.OPEN && controllerCountRef.current > 0) {
              ws.send(blob);
            }
          },
          'image/jpeg',
          0.35
        );
      }
    }, 50);

    return () => {
      isCancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (streamInterval) clearInterval(streamInterval);
      if (hostWsRef.current) {
        hostWsRef.current.close();
        hostWsRef.current = null;
      }
    };
  }, [appMode, vm.isRunning, vm.roomCode, jarRecord, handlePressKey, handleReleaseKey, handleSendText]);

  const handleRestart = useCallback(() => {
    if (!vm.isRunning) {
      onUpdateVm(vm.id, { isRunning: true });
      return;
    }
    setEmuRestartCount((k) => k + 1);
  }, [vm.id, vm.isRunning, onUpdateVm]);

  return (
    <PhoneConsole
      vm={vm}
      jarRecord={jarRecord}
      uploadedJars={uploadedJars}
      vmState={vmState}
      controllerCount={controllerCount}
      isOpen={isOpen}
      showSettings={showSettings}
      showTextInput={showTextInput}
      emuIframeRef={emuIframeRef}
      emuSrc={vm.jarEngine === 'j2mejs' ? '/j2mejs/launcher.html' : '/freej2me/player.html'}
      emuInstanceKey={emuInstanceKey}
      softkeys={softkeys}
      pressedKeys={pressedKeys}
      onClose={onClose}
      onToggleSettings={(open) => setShowSettings((prev) => (typeof open === 'boolean' ? open : !prev))}
      onToggleTextInput={(open) => setShowTextInput((prev) => (typeof open === 'boolean' ? open : !prev))}
      onPressKey={handlePressKey}
      onReleaseKey={handleReleaseKey}
      onRestart={handleRestart}
      onToggleRunning={() => onUpdateVm(vm.id, { isRunning: !vm.isRunning })}
      onUpdateVm={(patch) => onUpdateVm(vm.id, patch)}
      onDeleteVm={() => onDeleteVm(vm.id)}
      onUploadJarForVm={(files) => onUploadJarForVm(vm.id, files)}
      onCreateSampleJarForVm={() => onCreateSampleJarForVm(vm.id)}
      onSendText={handleSendText}
    />
  );
};
