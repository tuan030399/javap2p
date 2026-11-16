import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CreateVmModal } from './components/CreateVmModal';
import { JarUploadPanel } from './components/JarUploadPanel';
import { ModeSelector } from './components/ModeSelector';
import { RemoteControllerView } from './components/RemoteControllerView';
import { TopBar } from './components/TopBar';
import { VmManagerPanel } from './components/VmManagerPanel';
import { VmSlot } from './components/VmSlot';
import {
  AppMode,
  JarEngineId,
  PersistedVmConfig,
  ScreenResolution,
  UploadedJarRecord,
  VmStatusSummary,
  WorkbenchTab,
} from './types/j2me';
import { createSamplePlayableJar, inspectJarBuffer, parseManifestText } from './utils/jarParser';
import { deleteUploadedJar, listUploadedJars, saveUploadedJar } from './utils/jarStorage';

const VMS_STORAGE_KEY = 'javadeck_vms_v1';

function generateRoomCode(): string {
  return `JAVA-${Math.floor(1000 + Math.random() * 9000)}`;
}

function generateVmId(): string {
  return `vm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function loadSavedVms(): PersistedVmConfig[] {
  try {
    const raw = localStorage.getItem(VMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PersistedVmConfig =>
        Boolean(item && typeof item.id === 'string' && typeof item.name === 'string')
    );
  } catch {
    return [];
  }
}

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('menu');
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('vms');
  const [uploadedJars, setUploadedJars] = useState<UploadedJarRecord[]>([]);
  const [vms, setVms] = useState<PersistedVmConfig[]>(() => loadSavedVms());
  const [openedVmId, setOpenedVmId] = useState<string | null>(null);
  const [openSettingsVmId, setOpenSettingsVmId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createPreselectedJarId, setCreatePreselectedJarId] = useState<string | null>(null);
  const [vmStatuses, setVmStatuses] = useState<Record<string, VmStatusSummary>>({});

  // Load persisted .JAR library from IndexedDB on mount
  useEffect(() => {
    listUploadedJars().then((items) => {
      setUploadedJars(items);
    });
  }, []);

  // Persist VM list to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(VMS_STORAGE_KEY, JSON.stringify(vms));
    } catch {
      // ignore storage quota errors
    }
  }, [vms]);

  // Lock background scroll while phone modal overlay is open
  useEffect(() => {
    if (openedVmId !== null) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
    document.body.style.overflow = '';
    return undefined;
  }, [openedVmId]);

  const jarsById = useMemo(() => {
    const map = new Map<string, UploadedJarRecord>();
    for (const jar of uploadedJars) {
      map.set(jar.id, jar);
    }
    return map;
  }, [uploadedJars]);

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
      return record;
    },
    []
  );

  const handleUploadFiles = useCallback(
    async (files: FileList | null): Promise<UploadedJarRecord> => {
      if (!files || files.length === 0) {
        throw new Error('Chưa chọn tệp nào.');
      }
      const list = Array.from(files);
      const jarFile = list.find((f) => f.name.toLowerCase().endsWith('.jar'));
      const jadFile = list.find((f) => f.name.toLowerCase().endsWith('.jad'));
      if (!jarFile) {
        if (jadFile) {
          throw new Error(
            'Tệp .JAD chỉ chứa mô tả ứng dụng. Vui lòng chọn kèm tệp .JAR tương ứng.'
          );
        }
        throw new Error('Vui lòng chọn tệp định dạng .JAR (Java MIDlet).');
      }
      const extraProps = jadFile ? parseManifestText(await jadFile.text()) : undefined;
      const buffer = await jarFile.arrayBuffer();
      return ingestJarBuffer(buffer, jarFile.name, extraProps);
    },
    [ingestJarBuffer]
  );

  const handleCreateSampleJar = useCallback(async (): Promise<UploadedJarRecord> => {
    const { buffer, fileName } = await createSamplePlayableJar();
    return ingestJarBuffer(buffer, fileName);
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

  const handleDeleteJar = useCallback(async (id: string) => {
    await deleteUploadedJar(id);
    setUploadedJars((prev) => prev.filter((item) => item.id !== id));
    setVms((prev) =>
      prev.map((vm) => (vm.jarId === id ? { ...vm, jarId: null, isRunning: false } : vm))
    );
  }, []);

  const handleCreateVm = useCallback(
    (payload: {
      name: string;
      jarId: string | null;
      resolution: ScreenResolution;
      jarEngine: JarEngineId;
      openImmediately: boolean;
    }) => {
      const newVm: PersistedVmConfig = {
        id: generateVmId(),
        name: payload.name,
        roomCode: generateRoomCode(),
        jarId: payload.jarId,
        resolution: payload.resolution,
        filter: 'crisp',
        phoneProfile: 'Nokia',
        jarEngine: payload.jarEngine,
        isMuted: false,
        isRunning: payload.jarId !== null,
        createdAt: Date.now(),
      };
      setVms((prev) => [...prev, newVm]);
      setShowCreateModal(false);
      setCreatePreselectedJarId(null);
      setActiveTab('vms');
      if (payload.openImmediately) {
        setOpenedVmId(newVm.id);
        setOpenSettingsVmId(payload.jarId ? null : newVm.id);
      }
    },
    []
  );

  const handleQuickCreateSampleVm = useCallback(async () => {
    const sample = await handleCreateSampleJar();
    handleCreateVm({
      name: `Máy ảo #${vms.length + 1}`,
      jarId: sample.id,
      resolution: '240x320',
      jarEngine: 'j2mejs',
      openImmediately: true,
    });
  }, [handleCreateSampleJar, handleCreateVm, vms.length]);

  const handleOpenVm = useCallback((vmId: string, openSettings = false) => {
    setVms((prev) =>
      prev.map((v) => (v.id === vmId && !v.isRunning && v.jarId ? { ...v, isRunning: true } : v))
    );
    setOpenSettingsVmId(openSettings ? vmId : null);
    setOpenedVmId(vmId);
  }, []);

  const handleUpdateVm = useCallback((vmId: string, patch: Partial<PersistedVmConfig>) => {
    setVms((prev) => prev.map((v) => (v.id === vmId ? { ...v, ...patch } : v)));
  }, []);

  const handleToggleVmRunning = useCallback((vmId: string) => {
    setVms((prev) =>
      prev.map((v) => (v.id === vmId ? { ...v, isRunning: !v.isRunning } : v))
    );
  }, []);

  const handleDeleteVm = useCallback((vmId: string) => {
    setOpenedVmId((prev) => (prev === vmId ? null : prev));
    setOpenSettingsVmId((prev) => (prev === vmId ? null : prev));
    setVms((prev) => prev.filter((v) => v.id !== vmId));
    setVmStatuses((prev) => {
      const next = { ...prev };
      delete next[vmId];
      return next;
    });
  }, []);

  const handleUploadJarForVm = useCallback(
    async (vmId: string, files: FileList | null) => {
      const record = await handleUploadFiles(files);
      handleUpdateVm(vmId, { jarId: record.id, isRunning: true });
    },
    [handleUploadFiles, handleUpdateVm]
  );

  const handleCreateSampleJarForVm = useCallback(
    async (vmId: string) => {
      const record = await handleCreateSampleJar();
      handleUpdateVm(vmId, { jarId: record.id, isRunning: true });
    },
    [handleCreateSampleJar, handleUpdateVm]
  );

  const handleStatusUpdate = useCallback((vmId: string, summary: VmStatusSummary) => {
    setVmStatuses((prev) => ({ ...prev, [vmId]: summary }));
  }, []);

  const runningCount = useMemo(() => vms.filter((v) => v.isRunning).length, [vms]);

  if (appMode === 'menu') {
    return <ModeSelector onSelectMode={setAppMode} />;
  }

  if (appMode === 'controller') {
    return <RemoteControllerView onBackToMenu={() => setAppMode('menu')} />;
  }

  return (
    <div className="relative min-h-[100dvh] bg-[#111317] text-slate-100 flex flex-col select-none">
      {/* Main Workbench Layer (kept above -z-50 minimized VMs) */}
      <div className="relative z-10 flex flex-col flex-1 bg-[#111317]">
        <TopBar
          activeTab={activeTab}
          vmCount={vms.length}
          runningCount={runningCount}
          jarCount={uploadedJars.length}
          onSelectTab={setActiveTab}
          onAddVmClick={() => {
            setCreatePreselectedJarId(null);
            setShowCreateModal(true);
          }}
          onBackToMenu={() => setAppMode('menu')}
        />

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 sm:px-6 py-7 overflow-x-hidden">
          {activeTab === 'vms' && (
            <VmManagerPanel
              vms={vms}
              jarsById={jarsById}
              vmStatuses={vmStatuses}
              onOpenVm={handleOpenVm}
              onToggleVmRunning={handleToggleVmRunning}
              onDeleteVm={handleDeleteVm}
              onAddVmClick={() => {
                setCreatePreselectedJarId(null);
                setShowCreateModal(true);
              }}
              onQuickCreateSampleVm={handleQuickCreateSampleVm}
            />
          )}

          {activeTab === 'jars' && (
            <JarUploadPanel
              uploadedJars={uploadedJars}
              onUploadFiles={handleUploadFiles}
              onCreateSampleJar={handleCreateSampleJar}
              onDownloadSampleJar={handleDownloadSampleJar}
              onDeleteJar={handleDeleteJar}
              onCreateVmWithJar={(jarId) => {
                setCreatePreselectedJarId(jarId);
                setShowCreateModal(true);
              }}
            />
          )}
        </main>
      </div>

      {/* Persistent VM Slots: NEVER unmount/move iframes when minimized or switching VMs */}
      {vms.map((vm) => (
        <VmSlot
          key={vm.id}
          vm={vm}
          jarRecord={vm.jarId ? jarsById.get(vm.jarId) || null : null}
          uploadedJars={uploadedJars}
          appMode={appMode}
          isOpen={openedVmId === vm.id}
          initialOpenSettings={openSettingsVmId === vm.id}
          onClose={() => {
            setOpenedVmId(null);
            setOpenSettingsVmId(null);
          }}
          onUpdateVm={handleUpdateVm}
          onDeleteVm={handleDeleteVm}
          onUploadJarForVm={handleUploadJarForVm}
          onCreateSampleJarForVm={handleCreateSampleJarForVm}
          onStatusUpdate={handleStatusUpdate}
        />
      ))}

      <CreateVmModal
        isOpen={showCreateModal}
        nextIndex={vms.length + 1}
        uploadedJars={uploadedJars}
        initialJarId={createPreselectedJarId}
        onClose={() => {
          setShowCreateModal(false);
          setCreatePreselectedJarId(null);
        }}
        onUploadJarFiles={handleUploadFiles}
        onCreateSampleJar={handleCreateSampleJar}
        onCreateVm={handleCreateVm}
      />
    </div>
  );
}
