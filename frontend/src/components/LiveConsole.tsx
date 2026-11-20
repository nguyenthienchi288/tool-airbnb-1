import {
  Eraser,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { HeartbeatPayload, LogEntry, PauseStatePayload } from '../types/api';

interface LiveConsoleProps {
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'error';
  percent: number;
  label: string;
  logs: LogEntry[];
  heartbeat: HeartbeatPayload | null;
  pauseState: PauseStatePayload;
  liveProxyUrl: string;
  onLiveProxyUrlChange: (val: string) => void;
  isStopping?: boolean;
  isActionBusy?: boolean;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onResetSession: () => void;
  onSkipCurrent: () => void;
  onUpdateProxy: () => void;
  onClear: () => void;
}

function formatElapsed(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function LiveConsole({
  status,
  percent,
  label,
  logs,
  heartbeat,
  pauseState,
  liveProxyUrl,
  onLiveProxyUrlChange,
  isStopping = false,
  isActionBusy = false,
  onStop,
  onPause,
  onResume,
  onResetSession,
  onSkipCurrent,
  onUpdateProxy,
  onClear,
}: LiveConsoleProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs]);

  const colorFor = (level: LogEntry['level']) => {
    switch (level) {
      case 'success':
        return 'text-emerald-400';
      case 'warn':
        return 'text-amber-400';
      case 'error':
        return 'text-rose-400';
      case 'step':
        return 'text-sky-400 font-semibold';
      default:
        return 'text-slate-300';
    }
  };

  const renderHeartbeatBadge = () => {
    if (status !== 'running' || !heartbeat) return null;
    const { idleSeconds, elapsedSeconds, savedCount } = heartbeat;

    let statusText = `🟢 Đang hoạt động (Cập nhật ${idleSeconds}s trước)`;
    let badgeClass = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';

    if (idleSeconds > 45) {
      statusText =
        '🔴 Cảnh báo: Tiến trình đứng im > 45s (Có thể đang kẹt — Bấm Dừng & Xuất Excel ngay)';
      badgeClass = 'border-rose-500/50 bg-rose-500/15 text-rose-300 animate-pulse';
    } else if (idleSeconds >= 20) {
      statusText = `🟡 Đang chờ phản hồi mạng (${idleSeconds}s)...`;
      badgeClass = 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-300">
          ⏱ {formatElapsed(elapsedSeconds)}
        </span>
        <span className={`rounded-md border px-2.5 py-0.5 text-[11px] font-medium ${badgeClass}`}>
          {statusText}
        </span>
        <span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-300">
          SQLite: {savedCount} căn
        </span>
      </div>
    );
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Terminal className="h-4 w-4 text-sky-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Tiến độ &amp; Live Console
          </span>
          <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
            {percent}%
          </span>
          {renderHeartbeatBadge()}
        </div>

        <div className="flex items-center gap-2">
          {status === 'running' && (
            <button
              type="button"
              disabled={isStopping}
              onClick={onStop}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-rose-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg shadow-rose-500/25 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>{isStopping ? 'Đang dừng & xuất Excel...' : 'Dừng & Xuất Excel hiện có'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-300 hover:text-white"
          >
            <Trash2 className="h-3 w-3" />
            <span>Xóa log</span>
          </button>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
        <span>{label}</span>
        {status === 'running' && heartbeat?.currentAction && heartbeat.currentAction !== label && (
          <span className="max-w-xl truncate font-mono text-[11px] text-slate-400">
            {heartbeat.currentAction}
          </span>
        )}
      </div>
      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full transition-all duration-300 ${
            status === 'error'
              ? 'bg-rose-500'
              : status === 'completed'
              ? 'bg-emerald-500'
              : pauseState.status !== 'running' && status === 'running'
              ? 'bg-amber-500'
              : 'bg-gradient-to-r from-rose-500 to-sky-500'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>

      {status === 'running' && (
        <div className="mb-3 space-y-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          {pauseState.status !== 'running' && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
              <span>
                {pauseState.status === 'paused_503'
                  ? `⚠️ Đang hạ nhiệt 503/Anti-Bot (${pauseState.countdownSeconds}s) — Giữ nguyên trình duyệt để bạn đổi mạng/Proxy hoặc thao tác tay.`
                  : '⏸ Đang tạm dừng thủ công — Trình duyệt vẫn mở để bạn bấm F5, giải Captcha hoặc đổi Proxy.'}
              </span>
              {pauseState.reason && (
                <span className="font-mono text-[11px] text-amber-300">{pauseState.reason}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Can thiệp thủ công:
            </span>

            {pauseState.status === 'running' ? (
              <button
                type="button"
                disabled={isActionBusy}
                onClick={onPause}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
              >
                <Pause className="h-3.5 w-3.5" />
                <span>Tạm dừng</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={isActionBusy}
                  onClick={onResume}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>
                    {pauseState.status === 'paused_503' && pauseState.countdownSeconds > 0
                      ? `Tiếp tục ngay (${pauseState.countdownSeconds}s)`
                      : 'Tiếp tục ngay'}
                  </span>
                </button>
                {pauseState.status === 'paused_503' && (
                  <button
                    type="button"
                    disabled={isActionBusy}
                    onClick={onPause}
                    className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    <span>Giữ tạm dừng</span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              disabled={isActionBusy}
              onClick={onResetSession}
              className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
            >
              <Eraser className="h-3.5 w-3.5" />
              <span>Làm mới Cookie/Session</span>
            </button>

            <button
              type="button"
              disabled={isActionBusy}
              onClick={onSkipCurrent}
              className="flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 disabled:opacity-50"
            >
              <SkipForward className="h-3.5 w-3.5" />
              <span>Bỏ qua mục đang kẹt</span>
            </button>

            <div className="flex flex-1 min-w-[260px] items-center gap-1.5">
              <input
                type="text"
                value={liveProxyUrl}
                onChange={(e) => onLiveProxyUrlChange(e.target.value)}
                placeholder="Đổi Proxy nóng (host:port:user:pass hoặc trống = Direct)"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
              <button
                type="button"
                disabled={isActionBusy}
                onClick={onUpdateProxy}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Áp dụng</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={ref}
        className="h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-slate-600">
            Sẵn sàng. Nhập thông số bên trên và nhấn Bắt đầu để chạy thu thập...
          </div>
        ) : (
          logs.map((entry, idx) => (
            <div key={idx} className="flex gap-2 py-0.5">
              <span className="shrink-0 text-slate-600">[{entry.timestamp}]</span>
              <span className={colorFor(entry.level)}>{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
