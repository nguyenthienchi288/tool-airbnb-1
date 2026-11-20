import {
  Archive,
  Building2,
  Download,
  FileSpreadsheet,
  Home,
  Link2,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  Search,
  SkipForward,
  Square,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ParsedUrlInfo {
  originalUrl: string;
  platformLocation: {
    origin: string;
    domain: string;
    rawLocationPath: string;
    locationDisplay: string;
    cityGuess: string;
    countryGuess: string;
    placeId: string;
    source: string;
    searchMode: string;
  };
  dates: {
    checkIn: string;
    checkOut: string;
    nights: number;
    datePickerType: string;
    flexibleTripLengths: string[];
    monthlyStartDate: string;
    monthlyLength: string;
    monthlyEndDate: string;
  };
  mapBounds: {
    neLat: number | null;
    swLat: number | null;
    neLng: number | null;
    swLng: number | null;
    zoom: string;
    searchByMap: boolean;
    searchType: string;
    hasBounds: boolean;
  };
  filters: {
    l2PropertyTypeIds: string[];
    roomTypes: string[];
    priceMin: string;
    priceMax: string;
    priceFilterNumNights: string;
    channel: string;
    selectedFilterOrder: string[];
  };
  tracking: {
    refFsid: string;
    refSearchSessionId: string;
  };
}

interface PreviewData {
  buildings: Array<Record<string, any>>;
  hosts: Array<Record<string, any>>;
  rooms: Array<Record<string, any>>;
}

interface BundleResult {
  bundleName: string;
  sevenNightsExcelFile: string;
  rawExcelFile: string;
  rawJsonFile: string;
  zipFileName: string;
  totalFound: number;
  totalExtracted: number;
  totalPhotosDownloaded: number;
}

export function DeepLinkExtractorTab() {
  const [urlInput, setUrlInput] = useState('');
  const [parsedInfo, setParsedInfo] = useState<ParsedUrlInfo | null>(null);
  const [downloadPhotos, setDownloadPhotos] = useState(true);
  const [strictBoundsOnly, setStrictBoundsOnly] = useState(true);
  const [proxyUrl, setProxyUrl] = useState('');
  const [useWarpProxy, setUseWarpProxy] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'stopped' | 'error'>('idle');
  const [percent, setPercent] = useState(0);
  const [label, setLabel] = useState('Sẵn sàng');
  const [logs, setLogs] = useState<Array<{ timestamp: string; level: string; message: string }>>([]);
  const [pauseState, setPauseState] = useState<{
    status: 'running' | 'paused' | 'paused_503';
    countdownSeconds: number;
    reason?: string;
  }>({ status: 'running', countdownSeconds: 0 });
  const [preview, setPreview] = useState<PreviewData>({ buildings: [], hosts: [], rooms: [] });
  const [result, setResult] = useState<BundleResult | null>(null);
  const [previewTab, setPreviewTab] = useState<'buildings' | 'hosts' | 'rooms'>('rooms');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  const handleParseUrl = async (): Promise<ParsedUrlInfo | null> => {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/deep-extract/parse-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.message || 'Không thể phân tích URL.');
        return null;
      }
      setParsedInfo(data);
      return data;
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi kết nối Backend.');
      return null;
    }
  };

  const attachStream = (id: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/deep-extract/${id}/stream`);
    esRef.current = es;

    es.addEventListener('progress', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      setPercent(d.percent ?? 0);
      setLabel(d.label ?? '');
    });
    es.addEventListener('pause_state', (ev) => {
      setPauseState(JSON.parse((ev as MessageEvent).data));
    });
    es.addEventListener('preview', (ev) => {
      setPreview(JSON.parse((ev as MessageEvent).data));
    });
    es.addEventListener('log', (ev) => {
      const entry = JSON.parse((ev as MessageEvent).data);
      setLogs((prev) => [...prev.slice(-400), entry]);
    });
    es.addEventListener('done', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      setStatus('completed');
      if (d.result) setResult(d.result);
      es.close();
    });
    es.addEventListener('stopped', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      setStatus('stopped');
      if (d.result) setResult(d.result);
      es.close();
    });
    es.addEventListener('error', (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data);
        if (d?.error) setErrorMsg(d.error);
      } catch {
        // SSE disconnect
      }
      setStatus('error');
      es.close();
    });
  };

  const handleStart = async () => {
    setErrorMsg(null);
    setResult(null);
    setLogs([]);
    setPreview({ buildings: [], hosts: [], rooms: [] });
    if (!parsedInfo) {
      const p = await handleParseUrl();
      if (!p) return;
    }
    try {
      const res = await fetch('/api/deep-extract/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput.trim(),
          downloadPhotos,
          strictBoundsOnly,
          proxyUrl: proxyUrl.trim() || undefined,
          useWarpProxy,
          humanLikeMode: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || data?.message || 'Không thể bắt đầu trích xuất.');
        return;
      }
      setJobId(data.jobId);
      setStatus('running');
      attachStream(data.jobId);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi kết nối Backend.');
    }
  };

  const callAction = async (path: string, body?: Record<string, unknown>) => {
    if (!jobId) return;
    await fetch(`/api/deep-extract/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, ...(body || {}) }),
    }).catch(() => null);
  };

  const activeRows =
    previewTab === 'buildings'
      ? preview.buildings
      : previewTab === 'hosts'
        ? preview.hosts
        : preview.rooms;

  const activeHeaders = activeRows.length > 0 ? Object.keys(activeRows[0]) : [];

  return (
    <div className="space-y-5">
      {errorMsg && (
        <div className="flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="font-semibold underline">
            Đóng
          </button>
        </div>
      )}

      {/* 1. Ô Dán URL & Nút Phân tích */}
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">
              Trích Xuất Sâu Theo Link Bản Đồ (Chuẩn 7Nights Global)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Chạy Single-Tab chậm rãi (3–5s/thao tác) — Độ chính xác 100%, bóc tách đủ 3 Sheet &amp; tải ảnh phòng
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {result && (
              <>
                <a
                  href={`/api/deep-extract/download-file/${encodeURIComponent(result.bundleName)}/${encodeURIComponent(result.sevenNightsExcelFile)}`}
                  className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Tải file Excel 7Nights Global (.xlsx)</span>
                </a>
                <a
                  href={`/api/deep-extract/download-zip/${encodeURIComponent(result.zipFileName)}`}
                  className="flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/15 px-3.5 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25"
                >
                  <Archive className="h-3.5 w-3.5" />
                  <span>Tải trọn bộ thư mục dữ liệu &amp; ảnh (.zip)</span>
                </a>
              </>
            )}

            {status === 'running' ? (
              <button
                type="button"
                onClick={() => void callAction('stop')}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-600 px-4 py-2 text-xs font-bold text-white shadow-lg"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Dừng &amp; Xuất Bundle</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2 text-xs font-bold text-white shadow-lg hover:brightness-110"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Bắt đầu Trích Xuất Sâu</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Dán URL tìm kiếm Airbnb (airbnb.cn, airbnb.com, airbnb.com.vn kèm tọa độ ne_lat, sw_lat...)"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleParseUrl()}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Phân tích tham số Link</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-5 pt-1 text-xs text-slate-200">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={downloadPhotos}
              onChange={(e) => setDownloadPhotos(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500"
            />
            <span>Tải kèm toàn bộ ảnh từng phòng vào thư mục</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={strictBoundsOnly}
              onChange={(e) => setStrictBoundsOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500"
            />
            <span>Chỉ lấy căn nằm gọn trong khung tọa độ bản đồ</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={useWarpProxy}
              onChange={(e) => setUseWarpProxy(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500"
            />
            <span>Dùng Cloudflare 1.1.1.1 WARP</span>
          </label>
          <input
            type="text"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="Proxy URL (tùy chọn)"
            className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500"
          />
        </div>

        {/* Hiển thị 5 nhóm thông tin giải mã từ URL */}
        {parsedInfo && (
          <div className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px]">
              <div className="mb-1 font-bold text-sky-300">1. Nền tảng &amp; Địa điểm</div>
              <div className="text-slate-300">Domain: {parsedInfo.platformLocation.domain}</div>
              <div className="text-slate-300">Địa điểm: {parsedInfo.platformLocation.locationDisplay}</div>
              <div className="truncate text-slate-400">Place ID: {parsedInfo.platformLocation.placeId || '—'}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px]">
              <div className="mb-1 font-bold text-emerald-300">2. Thời gian lưu trú</div>
              <div className="text-slate-300">
                Check-in: {parsedInfo.dates.checkIn || 'Flexible'}
              </div>
              <div className="text-slate-300">
                Check-out: {parsedInfo.dates.checkOut || 'Flexible'} ({parsedInfo.dates.nights} đêm)
              </div>
              <div className="text-slate-400">
                Picker: {parsedInfo.dates.datePickerType || 'default'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px]">
              <div className="mb-1 flex items-center gap-1 font-bold text-amber-300">
                <MapPin className="h-3 w-3" />
                <span>3. Khung bản đồ (Bounds)</span>
              </div>
              <div className="text-slate-300">
                NE: {parsedInfo.mapBounds.neLat ?? '—'}, {parsedInfo.mapBounds.neLng ?? '—'}
              </div>
              <div className="text-slate-300">
                SW: {parsedInfo.mapBounds.swLat ?? '—'}, {parsedInfo.mapBounds.swLng ?? '—'}
              </div>
              <div className="text-slate-400">Zoom: {parsedInfo.mapBounds.zoom || '—'}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px]">
              <div className="mb-1 font-bold text-violet-300">4. Bộ lọc &amp; Giá</div>
              <div className="truncate text-slate-300">
                Loại: {parsedInfo.filters.roomTypes.join(', ') || 'Tất cả'}
              </div>
              <div className="text-slate-300">
                Giá: {parsedInfo.filters.priceMin || '0'} – {parsedInfo.filters.priceMax || '∞'}
              </div>
              <div className="truncate text-slate-400">Channel: {parsedInfo.filters.channel || '—'}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px]">
              <div className="mb-1 font-bold text-rose-300">5. Tracking IDs</div>
              <div className="truncate text-slate-300">
                ref_fsid: {parsedInfo.tracking.refFsid || '—'}
              </div>
              <div className="truncate text-slate-400">
                session: {parsedInfo.tracking.refSearchSessionId || '—'}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 2. Tiến độ & Can thiệp thủ công */}
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-200">
            {label} ({percent}%)
          </div>
          {status === 'running' && (
            <div className="flex flex-wrap items-center gap-2">
              {pauseState.status === 'running' ? (
                <button
                  type="button"
                  onClick={() => void callAction('pause')}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300"
                >
                  <Pause className="h-3 w-3" />
                  <span>Tạm dừng</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void callAction('resume')}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"
                >
                  <Play className="h-3 w-3" />
                  <span>Tiếp tục ({pauseState.countdownSeconds}s)</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void callAction('reset-session')}
                className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold text-sky-300"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Reset Session</span>
              </button>
              <button
                type="button"
                onClick={() => void callAction('skip-current')}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300"
              >
                <SkipForward className="h-3 w-3" />
                <span>Bỏ qua căn này</span>
              </button>
            </div>
          )}
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px]">
          {logs.length === 0 ? (
            <div className="text-slate-500">Chưa có log. Dán URL Airbnb ở trên và bấm Bắt đầu Trích Xuất Sâu.</div>
          ) : (
            logs.map((l, idx) => (
              <div
                key={idx}
                className={
                  l.level === 'error'
                    ? 'text-rose-400'
                    : l.level === 'warn'
                      ? 'text-amber-300'
                      : l.level === 'success'
                        ? 'text-emerald-300'
                        : l.level === 'step'
                          ? 'font-semibold text-sky-300'
                          : 'text-slate-300'
                }
              >
                [{l.timestamp}] {l.message}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </section>

      {/* 3. Bảng xem trước trực tiếp 3 Sheet chuẩn 7Nights Global */}
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewTab('buildings')}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold ${
                previewTab === 'buildings'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-slate-950 text-slate-400 border border-slate-800'
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>Building Infor ({preview.buildings.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setPreviewTab('hosts')}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold ${
                previewTab === 'hosts'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'bg-slate-950 text-slate-400 border border-slate-800'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Host Infor ({preview.hosts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setPreviewTab('rooms')}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold ${
                previewTab === 'rooms'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-950 text-slate-400 border border-slate-800'
              }`}
            >
              <Home className="h-3.5 w-3.5" />
              <span>ROOM INFOR ({preview.rooms.length})</span>
            </button>
          </div>

          {result && (
            <div className="text-xs text-emerald-300">
              Bundle: <span className="font-mono font-semibold">{result.bundleName}</span> ({result.totalPhotosDownloaded} ảnh)
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
          {activeRows.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Dữ liệu xem trước 3 sheet sẽ hiển thị trực tiếp ngay khi từng căn hộ được bóc tách xong.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-800 text-left text-[11px]">
              <thead className="bg-slate-900 text-slate-300">
                <tr>
                  {activeHeaders.map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-200">
                {activeRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-900/50">
                    {activeHeaders.map((h) => (
                      <td key={h} className="max-w-[220px] truncate whitespace-nowrap px-3 py-1.5">
                        {String(row[h] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
