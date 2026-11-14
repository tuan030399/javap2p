import React from 'react';
import { DisplayFilter, JarEngineId, PhoneProfile, ScreenResolution } from '../types/j2me';

interface ControlsConfigPanelProps {
  resolution: ScreenResolution;
  filter: DisplayFilter;
  phoneProfile: PhoneProfile;
  jarEngine: JarEngineId;
  isMuted: boolean;
  onChangeResolution: (res: ScreenResolution) => void;
  onChangeFilter: (f: DisplayFilter) => void;
  onChangePhoneProfile: (p: PhoneProfile) => void;
  onChangeJarEngine: (e: JarEngineId) => void;
  onToggleMute: () => void;
}

const RESOLUTIONS: { value: ScreenResolution; label: string; desc: string }[] = [
  { value: '240x320', label: '240 × 320', desc: 'Chuẩn S40 / S60' },
  { value: '176x220', label: '176 × 220', desc: 'Màn hình trung' },
  { value: '128x160', label: '128 × 160', desc: 'Cổ điển nhỏ' },
  { value: '320x240', label: '320 × 240', desc: 'Màn hình ngang' },
];

const FILTERS: { value: DisplayFilter; label: string }[] = [
  { value: 'crisp', label: 'LCD Sắc Nét' },
  { value: 'lcd-grid', label: 'Lưới Pixel Retro' },
  { value: 'nokia-mono', label: 'LCD Xanh Cổ Điển' },
];

const PHONE_PROFILES: { value: PhoneProfile; label: string }[] = [
  { value: 'Nokia', label: 'Nokia (S40/S60)' },
  { value: 'SonyEricsson', label: 'Sony Ericsson' },
  { value: 'Motorola', label: 'Motorola' },
  { value: 'Siemens', label: 'Siemens' },
  { value: 'Standard', label: 'Chuẩn MIDP' },
];

const KEY_MAPPINGS: { phoneKey: string; keyboard: string; action: string }[] = [
  { phoneKey: 'D-Pad (Lên/Xuống/Trái/Phải)', keyboard: 'Phím mũi tên hoặc W / S / A / D', action: 'Di chuyển nhân vật / chọn menu' },
  { phoneKey: 'Nút OK (Giữa D-Pad)', keyboard: 'Enter hoặc Space', action: 'Xác nhận, bắn đạn, nhảy' },
  { phoneKey: 'Softkey Trái', keyboard: 'Q hoặc [', action: 'Menu trái / Bắt đầu / Tạm dừng' },
  { phoneKey: 'Softkey Phải', keyboard: 'E hoặc ]', action: 'Quay lại / Tùy chọn phải' },
  { phoneKey: 'Nút Tắt đỏ (End)', keyboard: 'Esc', action: 'Mở menu cấu hình nhanh FreeJ2ME' },
  { phoneKey: 'Bàn phím số 0 – 9', keyboard: 'Phím số 0 – 9', action: 'Điều khiển T9 (2/4/6/8/5)' },
  { phoneKey: 'Phím * và #', keyboard: 'Phím * (Shift+8) hoặc # (Shift+3)', action: 'Kỹ năng phụ / Tên lửa' },
];

export const ControlsConfigPanel: React.FC<ControlsConfigPanelProps> = ({
  resolution,
  filter,
  phoneProfile,
  jarEngine,
  isMuted,
  onChangeResolution,
  onChangeFilter,
  onChangePhoneProfile,
  onChangeJarEngine,
  onToggleMute,
}) => {
  return (
    <div className="space-y-8">
      {/* JAR Engine Selector */}
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-100">
          Lõi Giả Lập Tệp .JAR
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Chọn trình giả lập dùng để chạy game Java (.JAR / .JAD) tải lên.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onChangeJarEngine('j2mejs')}
            className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              jarEngine === 'j2mejs'
                ? 'border-amber-500/60 bg-amber-500/10 text-slate-100'
                : 'border-white/[0.08] bg-[#161922] text-slate-300 hover:bg-[#1E222D]'
            }`}
          >
            <span className="text-sm font-semibold">J2meJS (Tốc độ cao · Khuyên dùng)</span>
            <span className="mt-0.5 text-xs text-slate-400">
              Chạy nội bộ (~1–2 giây), hỗ trợ MIDP 2.0, Nokia UI và cầu nối mạng TCP/HTTP cho game online.
            </span>
          </button>
          <button
            type="button"
            onClick={() => onChangeJarEngine('freej2me')}
            className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              jarEngine === 'freej2me'
                ? 'border-amber-500/60 bg-amber-500/10 text-slate-100'
                : 'border-white/[0.08] bg-[#161922] text-slate-300 hover:bg-[#1E222D]'
            }`}
          >
            <span className="text-sm font-semibold">FreeJ2ME (CheerpJ OpenJDK)</span>
            <span className="mt-0.5 text-xs text-slate-400">
              Hỗ trợ 3D M3G, cần tải WebAssembly OpenJDK từ mạng ngoài (chậm hơn).
            </span>
          </button>
        </div>
      </div>

      {/* Screen Resolution */}
      <div className="border-t border-white/[0.08] pt-6">
        <h3 className="font-display text-base font-semibold text-slate-100">
          Độ Phân Giải Màn Hình Java
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          Thay đổi kích thước hiển thị tương ứng với các dòng điện thoại J2ME phổ biến.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {RESOLUTIONS.map((item) => {
            const active = resolution === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onChangeResolution(item.value)}
                className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  active
                    ? 'border-amber-500/60 bg-amber-500/10 text-slate-100'
                    : 'border-white/[0.08] bg-[#161922] text-slate-300 hover:bg-[#1E222D]'
                }`}
              >
                <span className="font-mono-tabular text-sm font-semibold">
                  {item.label}
                </span>
                <span className="mt-0.5 text-xs text-slate-400">{item.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Phone Profile for FreeJ2ME */}
      <div className="border-t border-white/[0.08] pt-6">
        <h3 className="font-display text-base font-semibold text-slate-100">
          Hệ Máy Giả Lập (FreeJ2ME)
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Một số game tối ưu riêng cho dòng phím Nokia, Sony Ericsson hoặc Motorola.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PHONE_PROFILES.map((p) => {
            const active = phoneProfile === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => onChangePhoneProfile(p.value)}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  active
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'border border-white/10 bg-[#1B1F28] text-slate-300 hover:bg-[#252A36]'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Display Filter & Sound */}
      <div className="border-t border-white/[0.08] pt-6">
        <h3 className="font-display text-base font-semibold text-slate-100">
          Chế Độ Hiển Thị &amp; Âm Thanh
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => onChangeFilter(f.value)}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                  active
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'border border-white/10 bg-[#1B1F28] text-slate-300 hover:bg-[#252A36]'
                }`}
              >
                {f.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onToggleMute}
            className="rounded-lg border border-white/10 bg-[#1B1F28] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#252A36] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            Âm thanh: {isMuted ? 'Đang tắt' : 'Đang bật'}
          </button>
        </div>
      </div>

      {/* Keyboard Mapping Table */}
      <div className="border-t border-white/[0.08] pt-6">
        <h3 className="font-display text-base font-semibold text-slate-100">
          Bảng Ánh Xạ Phím Bàn Phím
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Bạn có thể bấm trực tiếp vào các nút điều hướng trên thân máy ảo hoặc dùng bàn phím máy tính.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="py-2.5 pr-3 font-medium">Nút trên máy</th>
                <th className="py-2.5 px-3 font-medium">Phím máy tính</th>
                <th className="py-2.5 pl-3 font-medium">Chức năng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-slate-300">
              {KEY_MAPPINGS.map((row) => (
                <tr key={row.phoneKey}>
                  <td className="py-2.5 pr-3 font-medium text-slate-100">
                    {row.phoneKey}
                  </td>
                  <td className="py-2.5 px-3 font-mono-tabular text-amber-400">
                    {row.keyboard}
                  </td>
                  <td className="py-2.5 pl-3 text-slate-400">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
