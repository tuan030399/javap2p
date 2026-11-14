import React from 'react';
import { Gamepad2, MonitorPlay, Smartphone, Zap } from 'lucide-react';
import { AppMode } from '../types/j2me';

interface ModeSelectorProps {
  onSelectMode: (mode: AppMode) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({ onSelectMode }) => {
  return (
    <div className="min-h-screen bg-[#0D1017] text-slate-100 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-4xl space-y-8 text-center">
        {/* Header Branding */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1 text-xs font-semibold text-amber-400">
            <Zap className="h-3.5 w-3.5" />
            <span>JavaDeck Cloud &amp; Remote Engine v2.0</span>
          </div>
          <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-slate-100">
            Trạm Trò Chơi Java Đám Mây &amp; Điều Khiển Từ Xa
          </h1>
          <p className="mx-auto max-w-2xl text-sm sm:text-base text-slate-400">
            Chọn chế độ hoạt động: Treo máy Host 24/24 hoặc kết nối từ thiết bị khác để điều khiển từ xa qua mạng bất kỳ.
          </p>
        </div>

        {/* 2 Mode Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
          {/* Host Mode Card */}
          <button
            type="button"
            onClick={() => onSelectMode('host')}
            className="group relative flex flex-col items-start rounded-2xl border border-white/12 bg-gradient-to-b from-[#181C26] to-[#12151D] p-6 sm:p-8 text-left transition-all hover:border-amber-500/60 hover:shadow-2xl hover:shadow-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors">
              <MonitorPlay className="h-7 w-7" />
            </div>
            <h2 className="mt-6 font-display text-xl font-bold text-slate-100">
              🖥️ Chế Độ Host (Treo Máy 24/24)
            </h2>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              Chạy game Java trực tiếp trên máy này. Hệ thống sẽ tự động tạo một <strong>Mã Phòng</strong> duy nhất để chia sẻ và phát sóng trực tiếp màn hình game.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-amber-400 group-hover:translate-x-1 transition-transform">
              <span>Bắt đầu treo Host</span>
              <span>→</span>
            </div>
          </button>

          {/* Controller Mode Card */}
          <button
            type="button"
            onClick={() => onSelectMode('controller')}
            className="group relative flex flex-col items-start rounded-2xl border border-white/12 bg-gradient-to-b from-[#181C26] to-[#12151D] p-6 sm:p-8 text-left transition-all hover:border-emerald-500/60 hover:shadow-2xl hover:shadow-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-slate-950 transition-colors">
              <Smartphone className="h-7 w-7" />
            </div>
            <h2 className="mt-6 font-display text-xl font-bold text-slate-100">
              📱 Chế Độ Máy Điều Hướng
            </h2>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              Dùng điện thoại di động ở <strong>mạng khác hoặc vị trí khác</strong>. Nhập Mã Phòng của Host để xem màn hình game thời gian thực và điều khiển mượt mà.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-emerald-400 group-hover:translate-x-1 transition-transform">
              <span>Kết nối điều khiển từ xa</span>
              <span>→</span>
            </div>
          </button>
        </div>

        <div className="pt-8 text-center text-xs text-slate-500">
          JavaDeck Engine · Hỗ trợ J2ME MIDP 2.0, WebSocket Realtime Streaming &amp; Cloud Relays.
        </div>
      </div>
    </div>
  );
};
