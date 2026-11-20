import { Activity, Building2, CheckCircle2, Info, ShieldCheck, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { SystemVersionResponse } from '../types/api';

interface HeaderProps {
  versionInfo: SystemVersionResponse | null;
  connected: boolean;
}

export function Header({ versionInfo, connected }: HeaderProps) {
  const [showChangelog, setShowChangelog] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-lg shadow-rose-500/20">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white sm:text-lg">
                Airbnb Market Intelligence
              </h1>
              <span className="hidden rounded-md bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-400 ring-1 ring-rose-500/30 sm:inline-block">
                OTA Arbitrage
              </span>
            </div>
            <p className="text-xs text-slate-400">
              NestJS + React Monorepo • High-Rise Condo &amp; Host Portfolio Engine
            </p>
          </div>
        </div>

        <div className="relative flex items-center gap-2.5">
          {versionInfo?.proxyConfigured && (
            <div className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 md:flex">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Proxy .env: {versionInfo.proxyServerMasked}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowChangelog((v) => !v)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              connected
                ? 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
                : 'border-red-500/40 bg-red-500/10 text-red-300'
            }`}
          >
            {connected ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Backend {versionInfo?.shortVersion || 'v2.0.0'}</span>
                <Info className="h-3.5 w-3.5 text-slate-400" />
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-red-400" />
                <span>Mất kết nối Backend</span>
              </>
            )}
          </button>

          {showChangelog && versionInfo && (
            <div className="absolute right-0 top-12 z-50 w-96 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
              <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Activity className="h-4 w-4 text-rose-400" />
                  <span>{versionInfo.shortVersion}</span>
                </div>
                <span className="text-[11px] text-slate-400">{versionInfo.updatedAt}</span>
              </div>
              <p className="mb-2 text-xs font-medium text-slate-300">{versionInfo.version}</p>
              <ul className="space-y-1.5 text-xs text-slate-400">
                {versionInfo.changelog.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
