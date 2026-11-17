import React, { useState } from 'react';
import {
  Check,
  Copy,
  FileArchive,
  Play,
  Plus,
  Power,
  Settings,
  ShieldCheck,
  Smartphone,
  Square,
  Trash2,
} from 'lucide-react';
import { PersistedVmConfig, UploadedJarRecord, VmStatusSummary } from '../types/j2me';

interface VmManagerPanelProps {
  vms: PersistedVmConfig[];
  jarsById: Map<string, UploadedJarRecord>;
  vmStatuses: Record<string, VmStatusSummary>;
  keepAwakeEnabled: boolean;
  onToggleKeepAwake: () => void;
  onOpenVm: (vmId: string, openSettings?: boolean) => void;
  onToggleVmRunning: (vmId: string) => void;
  onDeleteVm: (vmId: string) => void;
  onAddVmClick: () => void;
  onQuickCreateSampleVm: () => Promise<void>;
}

export const VmManagerPanel: React.FC<VmManagerPanelProps> = ({
  vms,
  jarsById,
  vmStatuses,
  keepAwakeEnabled,
  onToggleKeepAwake,
  onOpenVm,
  onToggleVmRunning,
  onDeleteVm,
  onAddVmClick,
  onQuickCreateSampleVm,
}) => {
  const [copiedVmId, setCopiedVmId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isCreatingSample, setIsCreatingSample] = useState(false);

  const runningCount = vms.filter((v) => v.isRunning).length;

  const handleCopyRoom = (vm: PersistedVmConfig) => {
    navigator.clipboard?.writeText(vm.roomCode).catch(() => {});
    setCopiedVmId(vm.id);
    setTimeout(() => {
      setCopiedVmId((prev) => (prev === vm.id ? null : prev));
    }, 1800);
  };

  const handleQuickSample = async () => {
    setIsCreatingSample(true);
    try {
      await onQuickCreateSampleVm();
    } finally {
      setIsCreatingSample(false);
    }
  };

  const getStatusLabel = (vm: PersistedVmConfig, statusSummary?: VmStatusSummary) => {
    if (!vm.isRunning) {
      return { text: 'Đã tắt', dotClass: 'bg-slate-500', textClass: 'text-slate-400' };
    }
    if (!vm.jarId || !jarsById.has(vm.jarId)) {
      return { text: 'Chưa nạp .JAR', dotClass: 'bg-amber-400', textClass: 'text-amber-400' };
    }
    const st = statusSummary?.runtime.status || 'loading';
    if (st === 'running') {
      return { text: 'Đang chạy', dotClass: 'bg-emerald-400', textClass: 'text-emerald-400' };
    }
    if (st === 'error') {
      return { text: 'Lỗi nạp .JAR', dotClass: 'bg-rose-400', textClass: 'text-rose-400' };
    }
    return { text: 'Đang khởi chạy...', dotClass: 'bg-amber-400', textClass: 'text-amber-300' };
  };

  return (
    <section
      id="vms"
      aria-label="Danh sách máy ảo Java"
      onContextMenu={(e) => e.preventDefault()}
      className="space-y-6 select-none"
    >
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <h1
            className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-100"
            style={{ textWrap: 'balance' }}
          >
            Danh Sách Máy Ảo Treo Game
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Mỗi máy ảo chạy độc lập với bộ nhớ lưu dữ liệu và mã phòng riêng. Bấm vào máy ảo để mở điện thoại và cài đặt.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Đang hoạt động</p>
            <p className="font-mono-tabular text-base font-semibold text-slate-100">
              {runningCount} / {vms.length} máy
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleKeepAwake}
            title="Giữ kết nối máy chủ, bật WakeLock & chống trình duyệt đóng băng tab sau 30 phút"
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              keepAwakeEnabled
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                : 'border-white/12 bg-[#1A1F29] text-slate-300 hover:bg-[#232937]'
            }`}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <span>{keepAwakeEnabled ? 'Chống ngủ tab: BẬT' : 'Chống ngủ tab: TẮT'}</span>
          </button>
          <button
            type="button"
            onClick={onAddVmClick}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 active:translate-y-[1px] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Thêm máy ảo</span>
          </button>
        </div>
      </div>

      {/* Empty State */}
      {vms.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-[#151821] px-6 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1F2430] text-amber-400">
            <Smartphone className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold text-slate-100">
            Chưa có máy ảo nào được tạo
          </h2>
          <p className="mt-1.5 max-w-md text-xs sm:text-sm text-slate-400">
            Tạo nhiều máy ảo để treo song song nhiều tài khoản hoặc nhiều tệp .JAR cùng lúc. Bấm vào máy ảo bất kỳ để mở màn hình điện thoại và tùy chỉnh cài đặt.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onAddVmClick}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400"
            >
              <Plus className="h-4 w-4" />
              <span>Thêm máy ảo đầu tiên</span>
            </button>
            <button
              type="button"
              disabled={isCreatingSample}
              onClick={handleQuickSample}
              className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-[#212632] px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-[#2A3040] disabled:opacity-50"
            >
              <FileArchive className="h-4 w-4 text-emerald-400" />
              <span>{isCreatingSample ? 'Đang tạo...' : 'Chạy thử với .JAR mẫu'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {vms.map((vm) => {
            const jar = vm.jarId ? jarsById.get(vm.jarId) || null : null;
            const summary = vmStatuses[vm.id];
            const status = getStatusLabel(vm, summary);
            const controllerCount = summary?.controllerCount || 0;
            const isConfirmingDelete = confirmDeleteId === vm.id;

            return (
              <article
                key={vm.id}
                className="group flex flex-col justify-between rounded-2xl border border-white/10 bg-[#161A23] transition-colors hover:border-amber-500/40"
              >
                {/* Clickable Main Area -> Opens Phone Overlay */}
                <button
                  type="button"
                  onClick={() => onOpenVm(vm.id, false)}
                  className="flex w-full items-start gap-3.5 p-4 sm:p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-t-2xl"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#0D1016] text-amber-400 overflow-hidden">
                    {jar?.inspect.iconDataUrl ? (
                      <img
                        src={jar.inspect.iconDataUrl}
                        alt={jar.inspect.manifest.midletName}
                        draggable={false}
                        className="pixel-canvas h-9 w-9 object-contain"
                      />
                    ) : (
                      <Smartphone className="h-6 w-6 text-slate-300 group-hover:text-amber-400 transition-colors" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate font-display text-base font-semibold text-slate-100 group-hover:text-amber-300 transition-colors">
                        {vm.name}
                      </h3>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium shrink-0 ${status.textClass}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`} />
                        {status.text}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-xs text-slate-300">
                      {jar ? jar.inspect.manifest.midletName : 'Chưa chọn tệp .JAR'}
                    </p>

                    <p className="mt-2 font-mono-tabular text-[11px] text-slate-400 truncate">
                      {vm.resolution} · {vm.jarEngine === 'j2mejs' ? 'J2meJS' : 'FreeJ2ME'} · Phòng:{' '}
                      <span className="text-slate-200">{vm.roomCode}</span>
                      {controllerCount > 0 ? ` · ${controllerCount} điều khiển` : ''}
                    </p>
                  </div>
                </button>

                {/* Action Footer */}
                <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenVm(vm.id, false)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors whitespace-nowrap"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>Mở điện thoại</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleVmRunning(vm.id)}
                      title={vm.isRunning ? 'Tắt máy ảo' : 'Bật máy ảo'}
                      aria-label={vm.isRunning ? `Tắt ${vm.name}` : `Bật ${vm.name}`}
                      className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        vm.isRunning
                          ? 'border-white/10 bg-[#1E232F] text-slate-300 hover:bg-[#272E3E]'
                          : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                      }`}
                    >
                      {vm.isRunning ? (
                        <>
                          <Square className="h-3 w-3" />
                          <span>Tắt</span>
                        </>
                      ) : (
                        <>
                          <Power className="h-3.5 w-3.5" />
                          <span>Bật</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopyRoom(vm)}
                      title="Sao chép mã phòng điều khiển từ xa"
                      aria-label={`Sao chép mã phòng ${vm.roomCode}`}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-[#1B1F28] px-2 text-[11px] font-medium text-slate-300 hover:bg-[#252A36] hover:text-white"
                    >
                      {copiedVmId === vm.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Mã</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenVm(vm.id, true)}
                      title="Cài đặt máy ảo"
                      aria-label={`Cài đặt ${vm.name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-300 hover:bg-[#252A36] hover:text-amber-400"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>

                    {isConfirmingDelete ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          onDeleteVm(vm.id);
                        }}
                        onBlur={() => setConfirmDeleteId(null)}
                        className="inline-flex h-8 items-center rounded-lg bg-rose-500 px-2.5 text-[11px] font-semibold text-white hover:bg-rose-400 whitespace-nowrap"
                      >
                        Xác nhận xóa
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(vm.id)}
                        title="Xóa máy ảo"
                        aria-label={`Xóa ${vm.name}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-400 hover:bg-rose-500/15 hover:border-rose-500/30 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
