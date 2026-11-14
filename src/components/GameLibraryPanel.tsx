import React from 'react';
import { Play, Trash2, Upload } from 'lucide-react';
import { BUILTIN_GAMES_META } from '../games/builtinGames';
import { ActiveGameSource, BuiltinGameId, UploadedJarRecord } from '../types/j2me';
import { getHighScore } from '../utils/jarStorage';

interface GameLibraryPanelProps {
  activeSource: ActiveGameSource;
  uploadedJars: UploadedJarRecord[];
  onSelectBuiltin: (id: BuiltinGameId) => void;
  onSelectJar: (record: UploadedJarRecord) => void;
  onDeleteJar: (id: string) => void;
  onGoToUpload: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export const GameLibraryPanel: React.FC<GameLibraryPanelProps> = ({
  activeSource,
  uploadedJars,
  onSelectBuiltin,
  onSelectJar,
  onDeleteJar,
  onGoToUpload,
}) => {
  return (
    <div className="space-y-8">
      {/* Built-in Classic J2ME Games */}
      <div>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Kho Game Kinh Điển
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Chọn trò chơi bên dưới để khởi chạy ngay trên màn hình điện thoại Java.
            </p>
          </div>
        </div>

        <div className="divide-y divide-white/[0.07] border-t border-b border-white/[0.07]">
          {BUILTIN_GAMES_META.map((game) => {
            const isActive = activeSource.type === 'builtin' && activeSource.id === game.id;
            const hs = getHighScore(game.id);
            return (
              <div
                key={game.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 px-2 transition-colors ${
                  isActive ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: game.accentColor }}
                      aria-hidden="true"
                    />
                    <h3 className="truncate text-base font-semibold text-slate-100">
                      {game.title}
                    </h3>
                  </div>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    {game.subtitle}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{game.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>{game.vendor}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">v{game.version}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular text-slate-400">
                      Kỷ lục: {hs}
                    </span>
                  </div>
                </div>

                <div className="flex items-center shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelectBuiltin(game.id)}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                      isActive
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40'
                        : 'bg-[#252A36] text-slate-100 hover:bg-amber-500 hover:text-slate-950'
                    }`}
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{isActive ? 'Đang chạy' : 'Chơi ngay'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* User-uploaded .JAR Games */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Game .JAR Đã Tải Lên
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Lưu trữ cục bộ trên trình duyệt của bạn ({uploadedJars.length} tệp).
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToUpload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#1E222B] px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#272D39] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Thêm tệp .JAR</span>
          </button>
        </div>

        {uploadedJars.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 bg-[#151820] px-6 py-8 text-center">
            <p className="text-sm font-medium text-slate-300">
              Chưa có tệp .JAR nào trong kho cá nhân
            </p>
            <p className="mt-1.5 text-xs text-slate-500">
              Kéo thả tệp .JAR từ máy tính hoặc dùng tệp .JAR mẫu ở mục Tải Game .JAR.
            </p>
            <button
              type="button"
              onClick={onGoToUpload}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tải lên game Java</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.07] border-t border-b border-white/[0.07]">
            {uploadedJars.map((item) => {
              const isActive = activeSource.type === 'jar' && activeSource.record.id === item.id;
              const m = item.inspect.manifest;
              return (
                <div
                  key={item.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 px-2 transition-colors ${
                    isActive ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {item.inspect.iconDataUrl ? (
                      <img
                        src={item.inspect.iconDataUrl}
                        alt={`Biểu tượng ${m.midletName}`}
                        referrerPolicy="no-referrer"
                        className="pixel-canvas h-11 w-11 shrink-0 rounded-lg border border-white/10 bg-[#0D1016] object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] font-mono-tabular text-xs font-bold text-amber-400">
                        JAR
                      </div>
                    )}
                    <div className="min-w-0 space-y-1">
                      <h3 className="truncate text-base font-semibold text-slate-100">
                        {m.midletName}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{m.midletVendor}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">v{m.midletVersion}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">{formatBytes(item.inspect.totalSizeBytes)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">{item.inspect.classFiles.length} lớp</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSelectJar(item)}
                      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                        isActive
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40'
                          : 'bg-[#252A36] text-slate-100 hover:bg-amber-500 hover:text-slate-950'
                      }`}
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{isActive ? 'Đang chạy' : 'Chơi ngay'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteJar(item.id)}
                      aria-label={`Xóa ${m.midletName}`}
                      title="Xóa khỏi kho"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
