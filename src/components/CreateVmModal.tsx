import React, { useEffect, useRef, useState } from 'react';
import { FileArchive, Play, Plus, Upload, X } from 'lucide-react';
import { JarEngineId, ScreenResolution, UploadedJarRecord } from '../types/j2me';

interface CreateVmModalProps {
  isOpen: boolean;
  nextIndex: number;
  uploadedJars: UploadedJarRecord[];
  initialJarId?: string | null;
  onClose: () => void;
  onUploadJarFiles: (files: FileList | null) => Promise<UploadedJarRecord>;
  onCreateSampleJar: () => Promise<UploadedJarRecord>;
  onCreateVm: (payload: {
    name: string;
    jarId: string | null;
    resolution: ScreenResolution;
    jarEngine: JarEngineId;
    openImmediately: boolean;
  }) => void;
}

const RESOLUTIONS: { value: ScreenResolution; label: string }[] = [
  { value: '240x320', label: '240 × 320 (Chuẩn)' },
  { value: '176x220', label: '176 × 220' },
  { value: '128x160', label: '128 × 160' },
  { value: '320x240', label: '320 × 240 (Ngang)' },
];

export const CreateVmModal: React.FC<CreateVmModalProps> = ({
  isOpen,
  nextIndex,
  uploadedJars,
  initialJarId,
  onClose,
  onUploadJarFiles,
  onCreateSampleJar,
  onCreateVm,
}) => {
  const [name, setName] = useState(`Máy ảo #${nextIndex}`);
  const [selectedJarId, setSelectedJarId] = useState<string>('');
  const [resolution, setResolution] = useState<ScreenResolution>('240x320');
  const [jarEngine, setJarEngine] = useState<JarEngineId>('j2mejs');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(`Máy ảo #${nextIndex}`);
    setErrorMsg(null);
    if (initialJarId && uploadedJars.some((j) => j.id === initialJarId)) {
      setSelectedJarId(initialJarId);
    } else if (uploadedJars.length > 0) {
      setSelectedJarId(uploadedJars[0].id);
    } else {
      setSelectedJarId('');
    }
  }, [isOpen, nextIndex, initialJarId, uploadedJars]);

  if (!isOpen) return null;

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsBusy(true);
    try {
      const created = await onUploadJarFiles(files);
      setSelectedJarId(created.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể nạp tệp .JAR.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSample = async () => {
    setErrorMsg(null);
    setIsBusy(true);
    try {
      const created = await onCreateSampleJar();
      setSelectedJarId(created.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tạo .JAR mẫu.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim() || `Máy ảo #${nextIndex}`;
    onCreateVm({
      name: cleanName,
      jarId: selectedJarId || null,
      resolution,
      jarEngine,
      openImmediately: true,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-vm-title"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs px-4 py-6 overflow-y-auto overscroll-contain select-none"
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/12 bg-[#151821] p-5 sm:p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div>
            <h2 id="create-vm-title" className="font-display text-lg font-bold text-slate-100">
              Thêm Máy Ảo Java Mới
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Mỗi máy ảo có mã phòng và bộ nhớ lưu dữ liệu riêng, có thể treo song song nhiều máy.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-400 hover:bg-[#252A36] hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          <div>
            <label htmlFor="vm-name-input" className="block text-xs font-medium text-slate-300 mb-1.5">
              Tên máy ảo
            </label>
            <input
              id="vm-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Acc chính, Treo NSO 1..."
              maxLength={40}
              className="w-full rounded-xl border border-white/15 bg-[#0C0E13] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label htmlFor="vm-jar-select" className="block text-xs font-medium text-slate-300">
                Chọn tệp game .JAR cho máy ảo
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-[#1D222D] px-2.5 py-1 text-[11px] font-medium text-amber-400 hover:bg-[#252B39] disabled:opacity-50"
                >
                  <Upload className="h-3 w-3" />
                  <span>Tải .JAR lên</span>
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleSample}
                  className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-[#1D222D] px-2.5 py-1 text-[11px] font-medium text-emerald-400 hover:bg-[#252B39] disabled:opacity-50"
                >
                  <FileArchive className="h-3 w-3" />
                  <span>Tạo .JAR mẫu</span>
                </button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".jar,.jad"
              multiple
              className="hidden"
              onChange={(e) => {
                handleUpload(e.target.files);
                e.target.value = '';
              }}
            />

            {uploadedJars.length > 0 ? (
              <select
                id="vm-jar-select"
                value={selectedJarId}
                onChange={(e) => setSelectedJarId(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-[#0C0E13] px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">— Chưa chọn .JAR (cấu hình sau) —</option>
                {uploadedJars.map((jar) => (
                  <option key={jar.id} value={jar.id}>
                    {jar.inspect.manifest.midletName} ({jar.fileName})
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-xl border border-dashed border-white/15 bg-[#0E1117] p-3.5 text-xs text-slate-400">
                Kho .JAR đang trống. Bạn có thể bấm <strong className="text-amber-400">Tải .JAR lên</strong> hoặc <strong className="text-emerald-400">Tạo .JAR mẫu</strong> ngay ở trên, hoặc tạo máy ảo trước rồi chọn game trong phần Cài đặt.
              </div>
            )}

            {errorMsg && (
              <p role="alert" className="mt-2 text-xs text-rose-400">
                {errorMsg}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="vm-res-select" className="block text-xs font-medium text-slate-300 mb-1.5">
                Độ phân giải màn hình
              </label>
              <select
                id="vm-res-select"
                value={resolution}
                onChange={(e) => setResolution(e.target.value as ScreenResolution)}
                className="w-full rounded-xl border border-white/15 bg-[#0C0E13] px-3 py-2.5 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="vm-engine-select" className="block text-xs font-medium text-slate-300 mb-1.5">
                Lõi giả lập
              </label>
              <select
                id="vm-engine-select"
                value={jarEngine}
                onChange={(e) => setJarEngine(e.target.value as JarEngineId)}
                className="w-full rounded-xl border border-white/15 bg-[#0C0E13] px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="j2mejs">J2meJS (Tốc độ cao · Online)</option>
                <option value="freej2me">FreeJ2ME (CheerpJ · 3D M3G)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-white/[0.08] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/12 bg-transparent px-4 py-2.5 text-xs font-medium text-slate-300 hover:bg-white/[0.05]"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {selectedJarId ? (
                <>
                  <Play className="h-3.5 w-3.5" />
                  <span>Tạo &amp; Mở Máy Ảo</span>
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  <span>Tạo Máy Ảo</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
