import React from 'react';
import { Upload } from 'lucide-react';

export type WorkbenchTab = 'library' | 'upload' | 'controls';

interface TopBarProps {
  activeTab: WorkbenchTab;
  onSelectTab: (tab: WorkbenchTab) => void;
  onQuickUploadClick: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  onQuickUploadClick,
}) => {
  return (
    <header className="w-full border-b border-white/[0.08] bg-[#14171D]">
      <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-8 px-6 py-4">
        <a
          href="#console"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('library');
          }}
          className="font-display text-xl font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
        >
          JavaDeck
        </a>

        <nav
          aria-label="Điều hướng chính"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          <button
            type="button"
            onClick={() => onSelectTab('library')}
            className={`whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              activeTab === 'library'
                ? 'text-amber-400 border-amber-400'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            Kho Game
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('upload')}
            className={`whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              activeTab === 'upload'
                ? 'text-amber-400 border-amber-400'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            Tải Game .JAR
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('controls')}
            className={`whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              activeTab === 'controls'
                ? 'text-amber-400 border-amber-400'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            Phím &amp; Màn Hình
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onQuickUploadClick}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 active:translate-y-[1px] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Tải lên .JAR</span>
          </button>
        </div>
      </div>
    </header>
  );
};
