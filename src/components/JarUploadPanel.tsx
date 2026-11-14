import React, { useRef, useState } from 'react';
import { Download, FileArchive, Play, Upload } from 'lucide-react';
import { UploadedJarRecord, VmRuntimeState } from '../types/j2me';

interface JarUploadPanelProps {
  activeJar: UploadedJarRecord | null;
  vmState: VmRuntimeState;
  onUploadFiles: (files: FileList | null) => Promise<void>;
  onRunSampleJar: () => Promise<void>;
  onDownloadSampleJar: () => Promise<void>;
}

export const JarUploadPanel: React.FC<JarUploadPanelProps> = ({
  activeJar,
  vmState,
  onUploadFiles,
  onRunSampleJar,
  onDownloadSampleJar,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setIsBusy(true);
    try {
      await onUploadFiles(files);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Không thể đọc tệp .JAR.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Upload Dropzone */}
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-100">
          Tải Game Java (.JAR / .JAD) Lên
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Khởi chạy tức thì trên máy ảo Java J2meJS nội bộ (hỗ trợ MIDP 2.0, Nokia UI, nhạc MIDI/AMR và kết nối mạng TCP/HTTP cho game online), hoặc chuyển sang FreeJ2ME trong mục Cấu Hình cho game 3D M3G.
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
          className={`mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors ${
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
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>Chọn tệp .JAR</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onRunSampleJar}
              className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-[#222733] px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-[#2C3342] disabled:opacity-50 whitespace-nowrap"
            >
              <Play className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              <span>Chạy thử .JAR mẫu</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onDownloadSampleJar}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-transparent px-3.5 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.05] disabled:opacity-50 whitespace-nowrap"
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

      {/* JAR Manifest & Asset Inspector */}
      {activeJar && (
        <div className="border-t border-white/[0.08] pt-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {activeJar.inspect.iconDataUrl && (
                <img
                  src={activeJar.inspect.iconDataUrl}
                  alt={activeJar.inspect.manifest.midletName}
                  referrerPolicy="no-referrer"
                  className="pixel-canvas h-12 w-12 shrink-0 rounded-lg border border-white/10 bg-[#0D1016] object-contain p-1"
                />
              )}
              <div className="min-w-0">
                <h3 className="truncate font-display text-base font-semibold text-slate-100">
                  Chi Tiết Gói: {activeJar.inspect.manifest.midletName}
                </h3>
                <p className="truncate text-xs text-slate-400">
                  {activeJar.fileName} · {activeJar.inspect.totalFiles} tệp ·{' '}
                  {activeJar.inspect.classFiles.length} lớp bytecode
                </p>
              </div>
            </div>
            <span className="font-mono-tabular text-xs font-medium text-slate-300 shrink-0 whitespace-nowrap">
              {vmState.status === 'running'
                ? 'Đang chạy'
                : vmState.status === 'loading'
                  ? 'Đang khởi chạy...'
                  : vmState.status === 'paused'
                    ? 'Tạm dừng'
                    : vmState.status === 'error'
                      ? 'Không chạy được'
                      : 'Sẵn sàng'}
            </span>
          </div>

          {/* Manifest Key-Value Grid */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs border-y border-white/[0.06] py-4">
            <div>
              <dt className="text-slate-500">Nhà phát triển</dt>
              <dd className="mt-0.5 font-medium text-slate-200">
                {activeJar.inspect.manifest.midletVendor}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Phiên bản &amp; Chuẩn</dt>
              <dd className="mt-0.5 font-mono-tabular font-medium text-slate-200">
                v{activeJar.inspect.manifest.midletVersion} · {activeJar.inspect.manifest.profile} / {activeJar.inspect.manifest.configuration}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Lớp khởi chạy (MIDlet-1)</dt>
              <dd className="mt-0.5 font-mono-tabular text-amber-400 break-all">
                {activeJar.inspect.manifest.midletClass || 'Không khai báo'}
              </dd>
            </div>
          </dl>

          {/* Extracted Image Assets */}
          {activeJar.inspect.imageAssets.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-300 mb-3">
                Tài nguyên ảnh giải nén ({activeJar.inspect.imageAssets.length})
              </h4>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5">
                {activeJar.inspect.imageAssets.slice(0, 12).map((img) => (
                  <div
                    key={img.path}
                    title={img.path}
                    className="flex flex-col items-center justify-center rounded-lg border border-white/[0.08] bg-[#14171F] p-2"
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.path}
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

          {/* VM Diagnostic Logs */}
          {vmState.logs.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-300 mb-2">
                Nhật ký máy ảo J2ME
              </h4>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-white/[0.07] bg-[#0C0E13] p-3 font-mono-tabular text-[11px] text-slate-400 space-y-1">
                {vmState.logs.map((line, i) => (
                  <div key={i} className="leading-relaxed">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
