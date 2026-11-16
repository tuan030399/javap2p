import React from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { WorkbenchTab } from '../types/j2me';

interface TopBarProps {
  activeTab: WorkbenchTab;
  vmCount: number;
  runningCount: number;
  jarCount: number;
  onSelectTab: (tab: WorkbenchTab) => void;
  onAddVmClick: () => void;
  onBackToMenu: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  vmCount,
  runningCount,
  jarCount,
  onSelectTab,
  onAddVmClick,
  onBackToMenu,
}) => {
  return (
    <header
      onContextMenu={(e) => e.preventDefault()}
      className="w-full border-b border-white/[0.08] bg-[#14171D] select-none"
    >
      <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-4 px-4 sm:px-6 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToMenu}
            aria-label="Quay lại menu chính"
            title="Quay lại menu chính"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B1F28] text-slate-300 transition-colors hover:bg-[#252A36] hover:text-white shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <a
            href="#vms"
            onClick={(e) => {
              e.preventDefault();
              onSelectTab('vms');
            }}
            className="font-display text-lg sm:text-xl font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
          >
            JavaDeck
          </a>
        </div>

        <nav
          aria-label="Điều hướng chính"
          className="flex items-center gap-4 sm:gap-7 text-xs sm:text-sm font-medium"
        >
          <button
            type="button"
            onClick={() => onSelectTab('vms')}
            className={`whitespace-nowrap shrink-0 py-1.5 transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              activeTab === 'vms'
                ? 'text-amber-400 border-amber-400'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            Máy Ảo{' '}
            <span className="font-mono-tabular text-xs text-slate-400">
              ({runningCount}/{vmCount})
            </span>
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('jars')}
            className={`whitespace-nowrap shrink-0 py-1.5 transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              activeTab === 'jars'
                ? 'text-amber-400 border-amber-400'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            Kho .JAR{' '}
            <span className="font-mono-tabular text-xs text-slate-400">
              ({jarCount})
            </span>
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onAddVmClick}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 active:translate-y-[1px] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Thêm máy ảo</span>
            <span className="sm:hidden">Thêm</span>
          </button>
        </div>
      </div>
    </header>
  );
};
