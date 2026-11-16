import React, { useEffect, useRef, useState } from 'react';
import { Download, FileArchive, Play, Plus, Trash2, Upload } from 'lucide-react';
import { UploadedJarRecord } from '../types/j2me';

interface JarUploadPanelProps {
  uploadedJars: UploadedJarRecord[];
  onUploadFiles: (files: FileList | null) => Promise<UploadedJarRecord>;
  onCreateSampleJar: () => Promise<UploadedJarRecord>;
  onDownloadSampleJar: () => Promise<void>;
  onDeleteJar: (id: string) => Promise<void>;
  onCreateVmWithJar: (jarId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const JarUploadPanel: React.FC<JarUploadPanelProps> = ({
  uploadedJars,
  onUploadFiles,
  onCreateSampleJar,
  onDownloadSampleJar,
  onDeleteJar,
  onCreateVmWithJar,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [selectedJarId, setSelectedJarId] = useState<string | null>(
    uploadedJars[0]?.id ?? null
  );

  useEffect(() => {
    if (!selectedJarId && uploadedJars.length > 0) {
      setSelectedJarId(uploadedJars[0].id);
    } else if (selectedJarId && !uploadedJars.some((j) => j.id === selectedJarId)) {
      setSelectedJarId(uploadedJars[0]?.id ?? null);
    }
  }, [uploadedJars, selectedJarId]);

  const inspectedJar = uploadedJars.find((j) => j.id === selectedJarId) ?? null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setIsBusy(true);
    try {
      const record = await onUploadFiles(files);
      setSelectedJarId(record.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Không thể đọc tệp .JAR.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSample = async () => {
    setUploadError(null);
    setIsBusy(true);
    try {
      const record = await onCreateSampleJar();
      setSelectedJarId(record.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Không thể tạo .JAR mẫu.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <section
      aria-label="Kho tệp .JAR"
      onContextMenu={(e) => e.preventDefault()}
      className="space-y-8 select-none"
    >
      {/* Upload Dropzone */}
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
          Kho Tệp .JAR / .JAD
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Tải lên tệp game Java (.JAR/.JAD) để gán cho một hoặc nhiều máy ảo chạy song song. Tệp được lưu cục bộ trong trình duyệt.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`mt-5 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
            isDragging
              ? 'border-amber-400 bg-amber-500/10'
              : 'border-white/15 bg-[#151820] hover:border-white/25'
          }`}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#202531] text-amber-400">
            <FileArchive className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm font-semibold text-slate-100">
            {isBusy ? 'Đang giải nén và phân tích tệp .JAR...' : 'Kéo và thả tệp .JAR vào đây'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Hoặc chọn tệp trực tiếp từ máy tính của bạn (.jar, tối đa 32 MB)
          </p>

          <input
            ref={inputRef}
            type="file"
            accept=".jar,.jad"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>Chọn tệp .JAR</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={handleSample}
              className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-[#222733] px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-[#2C3342] disabled:opacity-50 whitespace-nowrap"
            >
              <Play className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              <span>Tạo .JAR mẫu</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onDownloadSampleJar}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-transparent px-3.5 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.05] disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Tải về .JAR mẫu</span>
            </button>
          </div>

          {uploadError && (
            <p role="alert" className="mt-4 text-xs font-medium text-rose-400">
              {uploadError}
            </p>
          )}
        </div>
      </div>

      {/* Stored JARs List */}
      {uploadedJars.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-100">
            Tệp đã lưu ({uploadedJars.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {uploadedJars.map((jar) => {
              const isSelected = jar.id === selectedJarId;
              return (
                <div
                  key={jar.id}
                  onClick={() => setSelectedJarId(jar.id)}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-amber-500/50 bg-amber-500/[0.06]'
                      : 'border-white/[0.08] bg-[#151821] hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#0D1016]">
                      {jar.inspect.iconDataUrl ? (
                        <img
                          src={jar.inspect.iconDataUrl}
                          alt={jar.inspect.manifest.midletName}
                          draggable={false}
                          className="pixel-canvas h-7 w-7 object-contain"
                        />
                      ) : (
                        <FileArchive className="h-5 w-5 text-amber-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-100">
                        {jar.inspect.manifest.midletName}
                      </p>
                      <p className="truncate font-mono-tabular text-[11px] text-slate-400">
                        {jar.fileName} · {formatBytes(jar.inspect.totalSizeBytes)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateVmWithJar(jar.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Tạo máy ảo</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteJar(jar.id);
                      }}
                      aria-label={`Xóa ${jar.fileName}`}
                      title="Xóa tệp .JAR"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* JAR Manifest & Asset Inspector */}
      {inspectedJar && (
        <div className="border-t border-white/[0.08] pt-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-100">
                Chi Tiết Gói: {inspectedJar.inspect.manifest.midletName}
              </h3>
              <p className="text-xs text-slate-400">
                {inspectedJar.fileName} · {inspectedJar.inspect.totalFiles} tệp ·{' '}
                {inspectedJar.inspect.classFiles.length} lớp bytecode
              </p>
            </div>
            <button
              type="button"
              onClick={() => onCreateVmWithJar(inspectedJar.id)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Tạo máy ảo chạy tệp này</span>
            </button>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs border-y border-white/[0.06] py-4">
            <div>
              <dt className="text-slate-500">Nhà phát triển</dt>
              <dd className="mt-0.5 font-medium text-slate-200">
                {inspectedJar.inspect.manifest.midletVendor}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Phiên bản &amp; Chuẩn</dt>
              <dd className="mt-0.5 font-mono-tabular font-medium text-slate-200">
                v{inspectedJar.inspect.manifest.midletVersion} · {inspectedJar.inspect.manifest.profile} / {inspectedJar.inspect.manifest.configuration}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Lớp khởi chạy (MIDlet-1)</dt>
              <dd className="mt-0.5 font-mono-tabular text-amber-400 break-all">
                {inspectedJar.inspect.manifest.midletClass || 'Không khai báo'}
              </dd>
            </div>
          </dl>

          {inspectedJar.inspect.imageAssets.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-300 mb-3">
                Tài nguyên ảnh giải nén ({inspectedJar.inspect.imageAssets.length})
              </h4>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2.5">
                {inspectedJar.inspect.imageAssets.slice(0, 16).map((img) => (
                  <div
                    key={img.path}
                    title={img.path}
                    className="flex flex-col items-center justify-center rounded-lg border border-white/[0.08] bg-[#14171F] p-2"
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.path}
                      draggable={false}
                      referrerPolicy="no-referrer"
                      className="pixel-canvas h-10 w-10 object-contain"
                    />
                    <span className="mt-1.5 w-full truncate text-center font-mono-tabular text-[10px] text-slate-500">
                      {img.path.split('/').pop()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
