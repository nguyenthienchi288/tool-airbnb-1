import {
  Building2,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Globe,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeepLinkExtractorTab } from './components/DeepLinkExtractorTab';
import { Header } from './components/Header';
import { LarkSevenNightsTab } from './components/LarkSevenNightsTab';
import { LiveConsole } from './components/LiveConsole';
import {
  HeartbeatPayload,
  IpTraceInfo,
  ListingsResponse,
  LogEntry,
  PauseStatePayload,
  ReportFile,
  RoomItem,
  SystemVersionResponse,
} from './types/api';

function getFutureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

const SEOUL_PRICE_BUCKETS_DEFAULT =
  '0-1000000, 1000001-1500000, 1500001-2200000, 2200001-3200000, 3200001-5000000, 5000001+';

const SEOUL_KEYWORD_PRESETS = {
  cityVariants: ['Seoul', 'Seoul, South Korea', '서울', '서울특별시', '首尔', 'ソウル'],
  cbd: [
    'Myeongdong Seoul',
    'Jung-gu Seoul',
    'Jongno-gu Seoul',
    'Dongdaemun Seoul',
    'Yongsan-gu Seoul',
    'Itaewon Seoul',
  ],
  northwest: [
    'Hongdae Seoul',
    'Mapo-gu Seoul',
    'Yeonnam-dong Seoul',
    'Sinchon Seoul',
    'Yeongdeungpo-gu Seoul',
  ],
  south: [
    'Gangnam-gu Seoul',
    'Seocho-gu Seoul',
    'Songpa-gu Seoul',
    'Jamsil Seoul',
    'Seongsu-dong Seoul',
  ],
};

function parseKeywordsInput(raw: string): string[] {
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Cho phép phân cách bằng dấu phẩy trừ cụm "Seoul, South Korea"
    if (trimmed.toLowerCase() === 'seoul, south korea') {
      seen.add(trimmed);
      continue;
    }
    for (const part of trimmed.split(',')) {
      const clean = part.trim();
      if (clean) seen.add(clean);
    }
  }
  return Array.from(seen);
}

function countPriceBuckets(raw: string): number {
  const tokens = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Math.max(1, tokens.length);
}

export function App() {
  const [versionInfo, setVersionInfo] = useState<SystemVersionResponse | null>(null);
  const [connected, setConnected] = useState(false);

  // Form cấu hình cốt lõi (Seoul Multi-Dimensional Search Combinator v3.8.0)
  const [cityName, setCityName] = useState('Seoul');
  const [keywordsText, setKeywordsText] = useState('Seoul');
  const [showSeoulPresetGroups, setShowSeoulPresetGroups] = useState(false);
  const [seoulGroups, setSeoulGroups] = useState({
    cityVariants: true,
    cbd: true,
    northwest: true,
    south: true,
  });
  const [checkIn, setCheckIn] = useState(() => getFutureDate(14));
  const [checkOut, setCheckOut] = useState(() => getFutureDate(18));
  const [extraDateWindows, setExtraDateWindows] = useState<Array<{ checkIn: string; checkOut: string }>>([]);
  const [autoGenerateStrategicDates, setAutoGenerateStrategicDates] = useState(false);
  const [includeFlexibleDates, setIncludeFlexibleDates] = useState(false);
  const [maxPages, setMaxPages] = useState(15);
  const [tabsCount, setTabsCount] = useState(2);
  const [humanLikeMode, setHumanLikeMode] = useState(true);
  const [enablePriceSlicing, setEnablePriceSlicing] = useState(true);
  const [priceBucketsText, setPriceBucketsText] = useState(SEOUL_PRICE_BUCKETS_DEFAULT);
  const [entireHomeOnly, setEntireHomeOnly] = useState(true);
  const [proxyUrl, setProxyUrl] = useState('');
  const [useWarpProxy, setUseWarpProxy] = useState(false);
  const [includeHostRooms, setIncludeHostRooms] = useState(true);

  // Quản lý IP & VPN Persistent Profile
  const [ipInfo, setIpInfo] = useState<IpTraceInfo | null>(null);
  const [isCheckingIp, setIsCheckingIp] = useState(false);
  const [isOpeningSetup, setIsOpeningSetup] = useState(false);
  const [vpnStatusMsg, setVpnStatusMsg] = useState<string | null>(null);
  const [lastResultFiles, setLastResultFiles] = useState<{
    cityReportFile?: string;
    masterReportFile?: string;
  } | null>(null);

  // Dữ liệu & Báo cáo
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [totalRooms, setTotalRooms] = useState(0);
  const [stats, setStats] = useState<ListingsResponse['stats']>({
    totalRooms: 0,
    uniqueHosts: 0,
    avgPrice: 0,
    totalHostRooms: 0,
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [reports, setReports] = useState<ReportFile[]>([]);

  // Trạng thái Job SSE
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'idle' | 'running' | 'completed' | 'stopped' | 'error'>(
    'idle',
  );
  const [percent, setPercent] = useState(0);
  const [label, setLabel] = useState('Sẵn sàng');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [heartbeat, setHeartbeat] = useState<HeartbeatPayload | null>(null);
  const [pauseState, setPauseState] = useState<PauseStatePayload>({
    status: 'running',
    countdownSeconds: 0,
  });
  const [liveProxyUrl, setLiveProxyUrl] = useState('');
  const [isStopping, setIsStopping] = useState(false);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Định danh tòa nhà qua Excel (Gemini Workflow)
  const [isExportingClusters, setIsExportingClusters] = useState(false);
  const [isImportingClusters, setIsImportingClusters] = useState(false);
  const [clusterStatusMsg, setClusterStatusMsg] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const clusterFileInputRef = useRef<HTMLInputElement | null>(null);

  const esRef = useRef<EventSource | null>(null);

  const fetchListings = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (cityName.trim()) p.set('locationQuery', cityName.trim());
      if (search.trim()) p.set('search', search.trim());
      p.set('page', String(page));
      p.set('limit', '50');

      const res = await fetch(`/api/listings?${p.toString()}`);
      if (res.ok) {
        const data: ListingsResponse = await res.json();
        setRooms(data.items || []);
        setTotalRooms(data.total || 0);
        if (data.stats) setStats(data.stats);
      }
    } catch {
      // Ignore
    }
  }, [cityName, search, page]);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch('/api/reports');
      if (res.ok) {
        const data = await res.json();
        setReports(data.files || []);
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    const loadVersion = async () => {
      try {
        const res = await fetch(`/api/system/version?v=3.0.0&_t=${Date.now()}`);
        if (res.ok) {
          setVersionInfo(await res.json());
          setConnected(true);
        }
      } catch {
        setConnected(false);
      }
    };
    void loadVersion();
  }, []);

  const handleCheckIp = useCallback(async () => {
    setIsCheckingIp(true);
    try {
      const res = await fetch('/api/browser/check-ip');
      if (res.ok) {
        const data: IpTraceInfo = await res.json();
        setIpInfo(data);
      }
    } catch {
      // Ignore
    } finally {
      setIsCheckingIp(false);
    }
  }, []);

  const handleOpenVpnSetup = async () => {
    if (isOpeningSetup) return;
    setIsOpeningSetup(true);
    setErrorBanner(null);
    setVpnStatusMsg(null);
    try {
      const res = await fetch('/api/browser/open-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyUrl: proxyUrl.trim() || undefined,
          useWarpProxy,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data?.message || data?.error || 'Không thể mở Chrome cài VPN.');
        return;
      }
      setVpnStatusMsg(data.message);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi kết nối Backend khi mở Chrome VPN Profile.');
    } finally {
      setIsOpeningSetup(false);
    }
  };

  useEffect(() => {
    void fetchListings();
    void fetchReports();
    void handleCheckIp();
  }, [fetchListings, fetchReports, handleCheckIp]);

  const attachStream = useCallback((id: string) => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`/api/jobs/${id}/stream`);
    esRef.current = es;

    es.addEventListener('progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setPercent(data.percent ?? 0);
      setLabel(data.label ?? '');
    });

    es.addEventListener('log', (e) => {
      const entry: LogEntry = JSON.parse((e as MessageEvent).data);
      setLogs((prev) => [...prev.slice(-499), entry]);
    });

    es.addEventListener('heartbeat', (e) => {
      try {
        const data: HeartbeatPayload = JSON.parse((e as MessageEvent).data);
        setHeartbeat(data);
      } catch {
        // Ignore
      }
    });

    es.addEventListener('pause_state', (e) => {
      try {
        const data: PauseStatePayload = JSON.parse((e as MessageEvent).data);
        setPauseState(data);
      } catch {
        // Ignore
      }
    });

    es.addEventListener('done', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (data?.result) {
          setLastResultFiles({
            cityReportFile: data.result.cityReportFile,
            masterReportFile: data.result.masterReportFile,
          });
        }
      } catch {
        // Ignore
      }
      setJobStatus('completed');
      setIsStopping(false);
      setPercent(100);
      es.close();
      void fetchListings();
      void fetchReports();
    });

    es.addEventListener('stopped', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (data?.result) {
          setLastResultFiles({
            cityReportFile: data.result.cityReportFile,
            masterReportFile: data.result.masterReportFile,
          });
        }
      } catch {
        // Ignore
      }
      setJobStatus('stopped');
      setIsStopping(false);
      es.close();
      void fetchListings();
      void fetchReports();
    });

    es.addEventListener('error', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setErrorBanner(data.error || 'Có lỗi xảy ra trong quá trình cào.');
      } catch {
        // Ignore generic SSE reconnect/close event
      }
      if (es.readyState === EventSource.CLOSED) {
        setJobStatus('error');
        setIsStopping(false);
      }
    });
  }, [fetchListings, fetchReports]);

  useEffect(() => {
    const checkActive = async () => {
      try {
        const res = await fetch('/api/jobs/active');
        if (res.ok) {
          const data = await res.json();
          if (data?.activeJob?.jobId) {
            setJobId(data.activeJob.jobId);
            setJobStatus('running');
            setPercent(data.activeJob.percent ?? 3);
            setLabel(data.activeJob.label || 'Đang chạy...');
            if (data.activeJob.pauseState) {
              setPauseState(data.activeJob.pauseState);
            }
            attachStream(data.activeJob.jobId);
          }
        }
      } catch {
        // Ignore
      }
    };
    void checkActive();
  }, [attachStream]);

  const parsedKeywords = useMemo(() => {
    const list = parseKeywordsInput(keywordsText);
    return list.length > 0 ? list : cityName.trim() ? [cityName.trim()] : [];
  }, [keywordsText, cityName]);

  const dateWindowsCount = useMemo(() => {
    let count = checkIn && checkOut ? 1 : 0;
    count += extraDateWindows.filter((w) => w.checkIn && w.checkOut).length;
    if (autoGenerateStrategicDates) count += 4;
    if (includeFlexibleDates) count += 1;
    return Math.max(1, count);
  }, [checkIn, checkOut, extraDateWindows, autoGenerateStrategicDates, includeFlexibleDates]);

  const priceBucketsCount = useMemo(
    () => (enablePriceSlicing ? countPriceBuckets(priceBucketsText) : 1),
    [enablePriceSlicing, priceBucketsText],
  );

  const totalCombinationsCount = parsedKeywords.length * dateWindowsCount * priceBucketsCount;

  const applySeoulPresetGroups = (nextGroups: typeof seoulGroups) => {
    const combined: string[] = [];
    if (nextGroups.cityVariants) combined.push(...SEOUL_KEYWORD_PRESETS.cityVariants);
    if (nextGroups.cbd) combined.push(...SEOUL_KEYWORD_PRESETS.cbd);
    if (nextGroups.northwest) combined.push(...SEOUL_KEYWORD_PRESETS.northwest);
    if (nextGroups.south) combined.push(...SEOUL_KEYWORD_PRESETS.south);
    setKeywordsText(combined.length > 0 ? combined.join('\n') : 'Seoul');
    if (cityName.trim().toLowerCase() !== 'seoul') {
      setCityName('Seoul');
    }
    setPriceBucketsText(SEOUL_PRICE_BUCKETS_DEFAULT);
  };

  const handleToggleSeoulPresets = () => {
    setShowSeoulPresetGroups(true);
    applySeoulPresetGroups(seoulGroups);
  };

  const handleToggleSeoulGroup = (key: keyof typeof seoulGroups) => {
    const next = { ...seoulGroups, [key]: !seoulGroups[key] };
    setSeoulGroups(next);
    applySeoulPresetGroups(next);
  };

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    setLogs([]);
    setHeartbeat(null);
    setPauseState({ status: 'running', countdownSeconds: 0 });
    setLiveProxyUrl(proxyUrl);
    setIsStopping(false);
    setPercent(2);
    setLabel('Đang khởi chạy...');

    const dateWindows: Array<{ checkIn: string; checkOut: string }> = [];
    if (checkIn && checkOut) {
      dateWindows.push({ checkIn, checkOut });
    }
    for (const w of extraDateWindows) {
      if (w.checkIn && w.checkOut) {
        dateWindows.push({ checkIn: w.checkIn, checkOut: w.checkOut });
      }
    }

    try {
      const res = await fetch('/api/jobs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cityName: cityName.trim(),
          keywords: parsedKeywords,
          checkIn,
          checkOut,
          dateWindows,
          autoGenerateStrategicDates,
          includeFlexibleDates,
          maxPages,
          tabsCount,
          humanLikeMode,
          enablePriceSlicing,
          priceBucketsText: priceBucketsText.trim(),
          entireHomeOnly,
          proxyUrl: proxyUrl.trim() || undefined,
          useWarpProxy,
          includeHostRooms,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data?.activeJobId) {
          setJobId(data.activeJobId);
          setJobStatus('running');
          attachStream(data.activeJobId);
          return;
        }
        setErrorBanner(data.error || data.message || 'Không thể bắt đầu tác vụ.');
        setJobStatus('error');
        return;
      }
      setJobId(data.jobId);
      setJobStatus('running');
      attachStream(data.jobId);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi kết nối Backend.');
      setJobStatus('error');
    }
  };

  const handleStop = async () => {
    if (!jobId || isStopping) return;
    setIsStopping(true);
    try {
      await fetch(`/api/jobs/${jobId}/stop`, { method: 'POST' });
    } catch {
      setIsStopping(false);
    }
  };

  const callInterventionEndpoint = async (endpoint: string, body?: Record<string, unknown>) => {
    if (!jobId || isActionBusy) return;
    setIsActionBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, ...(body || {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErrorBanner(data?.error || data?.message || 'Thao tác can thiệp thủ công thất bại.');
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi kết nối Backend.');
    } finally {
      setIsActionBusy(false);
    }
  };

  const handlePause = () => void callInterventionEndpoint('/api/jobs/pause');
  const handleResume = () => void callInterventionEndpoint('/api/jobs/resume');
  const handleResetSession = () => void callInterventionEndpoint('/api/jobs/reset-session');
  const handleSkipCurrent = () => void callInterventionEndpoint('/api/jobs/skip-current');
  const handleUpdateProxy = () => {
    setProxyUrl(liveProxyUrl);
    void callInterventionEndpoint('/api/jobs/update-proxy', {
      proxyUrl: liveProxyUrl.trim(),
    });
  };

  const handleExportClusters = async () => {
    if (isExportingClusters) return;
    setIsExportingClusters(true);
    setErrorBanner(null);
    setClusterStatusMsg(null);
    try {
      const res = await fetch('/api/buildings/export-clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cityName: cityName.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data?.message || data?.error || 'Không thể xuất file Excel cụm tòa nhà.');
        return;
      }
      setClusterStatusMsg(
        `Đã gom ${data.totalClusters} cụm tòa nhà từ ${data.totalRooms} căn hộ → File: ${data.fileName}`,
      );
      void fetchReports();
      if (data.downloadUrl) {
        const a = document.createElement('a');
        a.href = data.downloadUrl;
        a.download = data.fileName || 'Cum_Toa_Nha_Can_Giai_Ma.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi kết nối Backend khi xuất cụm tòa nhà.');
    } finally {
      setIsExportingClusters(false);
    }
  };

  const handleImportClusters = async (file?: File | null) => {
    if (!file || isImportingClusters) return;
    setIsImportingClusters(true);
    setErrorBanner(null);
    setClusterStatusMsg(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (cityName.trim()) {
        formData.append('cityName', cityName.trim());
      }
      const res = await fetch('/api/buildings/import-clusters', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data?.message || data?.error || 'Lỗi khi nhập file Excel từ Gemini.');
        return;
      }
      setClusterStatusMsg(data.message);
      setLastResultFiles({
        cityReportFile: data.cityReportFile,
        masterReportFile: data.masterReportFile,
      });
      void fetchListings();
      void fetchReports();
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi kết nối Backend khi nhập Excel.');
    } finally {
      setIsImportingClusters(false);
      if (clusterFileInputRef.current) {
        clusterFileInputRef.current.value = '';
      }
    }
  };

  const handleCopyGeminiPrompt = async () => {
    const promptText = `Tôi đính kèm file Excel danh sách các cụm tọa độ căn hộ Airbnb (sheet Danh_Sach_Cum_Toa_Nha).\nHãy dựa vào các cột Center_Lat, Center_Lng, Khu_Vuc_Hien_Tai, Ten_Cac_Can_Ho_Mau và Ten_Toa_Nha_Goi_Y_Cu để xác định chính xác tên tòa nhà / chung cư / dự án cho từng Cluster_ID.\nGiữ nguyên toàn bộ cột và dữ liệu gốc (đặc biệt là Cluster_ID), chỉ điền kết quả vào 2 cột:\n- Ten_Toa_Nha_Chuan: Tên tòa nhà/dự án chuẩn (VD: Vinhomes Central Park, Masteri Thảo Điền, Millennium, The GoldView...). Nếu là nhà phố/không phải chung cư hoặc không rõ thì ghi "Chưa xác định".\n- Ghi_Chu_Dia_Chi: Tên đường / phường / quận tham khảo.\nSau đó xuất trả lại cho tôi file .xlsx hoàn chỉnh.`;
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2500);
    } catch {
      setErrorBanner('Không thể copy vào clipboard. Hãy cấp quyền clipboard cho trình duyệt.');
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalRooms / 50));
  const [activeMainTab, setActiveMainTab] = useState<'market' | 'deep_link' | 'lark_sync'>('market');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header versionInfo={versionInfo} connected={connected} />

      <main className="mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:px-6">
        {/* Thanh chuyển đổi chế độ chính */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-2 shadow-lg">
          <button
            type="button"
            onClick={() => setActiveMainTab('market')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
              activeMainTab === 'market'
                ? 'bg-gradient-to-r from-rose-500 to-orange-500 text-white shadow-md shadow-rose-500/20'
                : 'text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            <span>🌐 Quét Thị Trường Đa Chiều (Bản gốc)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMainTab('deep_link')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
              activeMainTab === 'deep_link'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20'
                : 'text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            <span>🎯 Trích Xuất Chi Tiết Từ Link (Chuẩn 7Nights Global)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMainTab('lark_sync')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
              activeMainTab === 'lark_sync'
                ? 'bg-gradient-to-r from-blue-500 to-sky-500 text-white shadow-md shadow-sky-500/20'
                : 'text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            <span>🚀 Đồng Bộ Lark Base (7Nights)</span>
          </button>
        </div>

        <div className={activeMainTab === 'deep_link' ? '' : 'hidden'}>
          <DeepLinkExtractorTab />
        </div>

        <div className={activeMainTab === 'lark_sync' ? '' : 'hidden'}>
          <LarkSevenNightsTab />
        </div>

        <div className={activeMainTab === 'market' ? 'space-y-5' : 'hidden'}>
        {errorBanner && (
          <div className="flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
            <span>{errorBanner}</span>
            <button type="button" onClick={() => setErrorBanner(null)} className="font-semibold underline">
              Đóng
            </button>
          </div>
        )}

        {/* 0. Thanh Quản lý IP & VPN Né Chặn 503 */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-300">
                <Globe className="h-4 w-4 text-sky-400" />
                <span>Quản lý IP &amp; VPN Né Chặn 503</span>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-xs">
                {ipInfo ? (
                  <>
                    <span className="text-emerald-300">
                      IP: {ipInfo.ip} ({ipInfo.loc})
                    </span>
                    <span className="text-slate-600">|</span>
                    <span
                      className={
                        ipInfo.warp === 'ON' || ipInfo.warp === 'PLUS'
                          ? 'font-semibold text-amber-300'
                          : 'text-slate-400'
                      }
                    >
                      WARP: {ipInfo.warp}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400">Chưa kiểm tra IP</span>
                )}
              </div>

              <button
                type="button"
                disabled={isCheckingIp}
                onClick={() => void handleCheckIp()}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-sky-500/40 hover:text-white disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-sky-400 ${isCheckingIp ? 'animate-spin' : ''}`} />
                <span>Kiểm tra IP</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 hover:border-amber-500/40">
                <input
                  type="checkbox"
                  checked={useWarpProxy}
                  onChange={(e) => setUseWarpProxy(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-amber-500"
                />
                <span>Bật Proxy Cloudflare WARP cục bộ (127.0.0.1:40000)</span>
              </label>

              <button
                type="button"
                disabled={isOpeningSetup || jobStatus === 'running'}
                onClick={() => void handleOpenVpnSetup()}
                className="flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/15 px-3.5 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Shield className="h-3.5 w-3.5 text-sky-400" />
                <span>
                  {isOpeningSetup ? 'Đang mở Chrome VPN...' : 'Mở Chrome cài/bật VPN Extension'}
                </span>
              </button>
            </div>
          </div>

          {vpnStatusMsg && (
            <div className="mt-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200">
              {vpnStatusMsg}
            </div>
          )}
        </section>

        {/* 1. Form cấu hình gọn nhẹ */}
        <form
          onSubmit={handleStart}
          className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                Cấu hình Tìm kiếm Đa chiều (Tối ưu Seoul)
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Tổ hợp Từ khóa × Khung ngày × Khoảng giá (Xáo trộn chống 503 &amp; Dừng sớm thông minh)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <a
                href={
                  lastResultFiles?.cityReportFile
                    ? `/api/reports/download/${encodeURIComponent(lastResultFiles.cityReportFile)}`
                    : `/api/export/homes?cityName=${encodeURIComponent(cityName.trim())}`
                }
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
              >
                <Download className="h-3.5 w-3.5" />
                <span>
                  {lastResultFiles?.cityReportFile
                    ? `Tải ${lastResultFiles.cityReportFile}`
                    : 'Tải Bao_Cao_Tong_Hop_<City>.xlsx'}
                </span>
              </a>
              <a
                href="/api/export/master"
                className="flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3.5 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/20"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Tải Master_City_Comparison.xlsx</span>
              </a>

              {jobStatus === 'running' ? (
                <button
                  type="button"
                  disabled={isStopping}
                  onClick={handleStop}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-rose-500/25 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  <span>{isStopping ? 'Đang dừng & xuất Excel...' : 'Dừng & Xuất Excel hiện có'}</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-rose-500/20 hover:brightness-110"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Bắt đầu</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Thành phố mục tiêu (Tên file Excel &amp; DB)
              </label>
              <input
                type="text"
                required
                value={cityName}
                onChange={(e) => {
                  const val = e.target.value;
                  setCityName(val);
                  setPage(1);
                }}
                placeholder="VD: Seoul, Ho Chi Minh City..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">Check-in chính</label>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">Check-out chính</label>
              <input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Số trang / Tổ hợp
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value) || 15)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Số Tab song song (1–6)
              </label>
              <input
                type="number"
                min={1}
                max={6}
                value={tabsCount}
                onChange={(e) => setTabsCount(Math.max(1, Math.min(6, Number(e.target.value) || 2)))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-rose-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Trục 1 & Trục 2: Từ khóa đa ngôn ngữ + Khung ngày chiến lược */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="text-[11px] font-semibold text-slate-300">
                  Danh sách Từ khóa / Bản dịch &amp; Quận (mỗi dòng 1 từ khóa) — {parsedKeywords.length} từ khóa
                </label>
                <button
                  type="button"
                  onClick={handleToggleSeoulPresets}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Gợi ý từ khóa &amp; Quận trọng điểm Seoul</span>
                </button>
              </div>
              {showSeoulPresetGroups && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {(
                    [
                      ['cityVariants', 'Đa ngôn ngữ (서울/首尔/ソウル)'],
                      ['cbd', 'CBD & Phố cổ (Myeongdong/Jung-gu)'],
                      ['northwest', 'Tây Bắc (Hongdae/Mapo)'],
                      ['south', 'Nam sông Hàn (Gangnam/Seocho)'],
                    ] as const
                  ).map(([key, labelText]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleToggleSeoulGroup(key)}
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                        seoulGroups[key]
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                          : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {seoulGroups[key] ? '✓ ' : '+ '}
                      {labelText}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                rows={3}
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                placeholder={'Seoul\n서울\nGangnam-gu Seoul\nHongdae Seoul'}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-[11px] text-slate-100 focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-300">
                    Khung ngày Check-in / Check-out ({dateWindowsCount} khung ngày)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setExtraDateWindows((prev) => [
                        ...prev,
                        { checkIn: getFutureDate(21), checkOut: getFutureDate(24) },
                      ])
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-slate-500"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Thêm khung ngày</span>
                  </button>
                </div>

                {extraDateWindows.length > 0 && (
                  <div className="mb-2 space-y-1.5 max-h-24 overflow-y-auto pr-1">
                    {extraDateWindows.map((w, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="date"
                          value={w.checkIn}
                          onChange={(e) =>
                            setExtraDateWindows((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, checkIn: e.target.value } : item)),
                            )
                          }
                          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                        />
                        <span className="text-xs text-slate-500">→</span>
                        <input
                          type="date"
                          value={w.checkOut}
                          onChange={(e) =>
                            setExtraDateWindows((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, checkOut: e.target.value } : item)),
                            )
                          }
                          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setExtraDateWindows((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-1 text-rose-300 hover:bg-rose-500/20"
                          title="Xóa khung ngày"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5 pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={autoGenerateStrategicDates}
                      onChange={(e) => setAutoGenerateStrategicDates(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500"
                    />
                    <span>Tự động tạo 4 khung ngày (Cận ngày / Giữa tuần / Cuối tuần / Đặt xa)</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={includeFlexibleDates}
                      onChange={(e) => setIncludeFlexibleDates(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500"
                    />
                    <span>Quét thêm chế độ Không cố định ngày (bắt Officetel thuê dài hạn)</span>
                  </label>
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs">
                <span className="text-sky-200">Tổng tổ hợp dự kiến:</span>
                <span className="font-bold text-sky-300">
                  {parsedKeywords.length} từ khóa × {dateWindowsCount} khung ngày × {priceBucketsCount} mức giá ={' '}
                  {totalCombinationsCount} tổ hợp quét
                </span>
              </div>
            </div>
          </div>

          {enablePriceSlicing && (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Các mốc chia khoảng giá VND (Price-Range Slicing)
              </label>
              <input
                type="text"
                value={priceBucketsText}
                onChange={(e) => setPriceBucketsText(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-[11px] text-slate-200 focus:border-rose-500 focus:outline-none"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <div className="flex-1 min-w-[220px]">
              <input
                type="text"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="Proxy URL (Tùy chọn, để trống = chạy Wi-Fi trực tiếp)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={enablePriceSlicing}
                onChange={(e) => setEnablePriceSlicing(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500"
              />
              <span>Chia khoảng giá</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={entireHomeOnly}
                onChange={(e) => setEntireHomeOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500"
              />
              <span>Chỉ lọc &quot;Toàn bộ nhà&quot;</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={humanLikeMode}
                onChange={(e) => setHumanLikeMode(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500"
              />
              <span>Trình duyệt thật</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={includeHostRooms}
                onChange={(e) => setIncludeHostRooms(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500"
              />
              <span>Mở rộng danh mục Host</span>
            </label>
          </div>
        </form>

        {/* 2. Khung Log & Thanh tiến độ */}
        <LiveConsole
          status={jobStatus}
          percent={percent}
          label={label}
          logs={logs}
          heartbeat={heartbeat}
          pauseState={pauseState}
          liveProxyUrl={liveProxyUrl}
          onLiveProxyUrlChange={setLiveProxyUrl}
          isStopping={isStopping}
          isActionBusy={isActionBusy}
          onStop={handleStop}
          onPause={handlePause}
          onResume={handleResume}
          onResetSession={handleResetSession}
          onSkipCurrent={handleSkipCurrent}
          onUpdateProxy={handleUpdateProxy}
          onClear={() => setLogs([])}
        />

        {/* 2.5. Định danh Tòa nhà qua Excel (Gemini Workflow) */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Định danh Tòa nhà qua Excel (Gemini Workflow)
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Bước 1: Gom cụm DBSCAN 50m &amp; xuất Excel → Bước 2: Gửi Gemini điền cột{' '}
                  <code className="text-amber-300">Ten_Toa_Nha_Chuan</code> → Bước 3: Tải ngược Excel vào Tool để đồng bộ SQLite &amp; xuất lại báo cáo.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isExportingClusters}
                onClick={handleExportClusters}
                className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>
                  {isExportingClusters
                    ? 'Đang gom cụm 50m...'
                    : 'Xuất Excel cụm tòa nhà cho Gemini'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleCopyGeminiPrompt}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-300 hover:border-sky-500/40 hover:text-white"
              >
                {copiedPrompt ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Đã copy Prompt!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-sky-400" />
                    <span>Copy Prompt mẫu</span>
                  </>
                )}
              </button>

              <input
                ref={clusterFileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => void handleImportClusters(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={isImportingClusters}
                onClick={() => clusterFileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleImportClusters(e.dataTransfer.files?.[0]);
                }}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>
                  {isImportingClusters
                    ? 'Đang sáp nhập SQLite...'
                    : 'Nhập Excel tên tòa nhà từ Gemini (.xlsx)'}
                </span>
              </button>
            </div>
          </div>

          {clusterStatusMsg && (
            <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-300">
              {clusterStatusMsg}
            </div>
          )}
        </section>

        {/* 3. Bảng xem trước dữ liệu & Danh sách file Excel */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
          {/* Bảng dữ liệu phòng (3 cột) */}
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl lg:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span className="font-bold text-white">Dữ liệu đã lưu ({stats.totalRooms} phòng)</span>
                <span className="text-slate-400">
                  Host duy nhất: <strong className="text-sky-400">{stats.uniqueHosts}</strong>
                </span>
                <span className="text-slate-400">
                  Giá TB/đêm: <strong className="text-emerald-400">{stats.avgPrice}</strong>
                </span>
                <span className="text-slate-400">
                  Phòng của Host: <strong className="text-amber-400">{stats.totalHostRooms}</strong>
                </span>
              </div>

              <div className="relative w-64">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Tìm tên phòng, Host, ID..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-950 text-[11px] uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">Tên phòng / Loại</th>
                    <th className="px-3 py-2.5">Thông số</th>
                    <th className="px-3 py-2.5">Giá / đêm</th>
                    <th className="px-3 py-2.5">Tổng giá</th>
                    <th className="px-3 py-2.5">Chủ nhà (Host)</th>
                    <th className="px-3 py-2.5 text-right">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {rooms.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                        Chưa có dữ liệu cho khu vực này.
                      </td>
                    </tr>
                  ) : (
                    rooms.map((r) => (
                      <tr key={r.listing_id} className="hover:bg-slate-800/40">
                        <td className="max-w-[260px] px-3 py-2">
                          <div className="truncate font-medium text-slate-200" title={r.title}>
                            {r.title || `Room #${r.listing_id}`}
                          </div>
                          <div className="flex items-center gap-1.5 truncate text-[11px] text-slate-400">
                            <span>{r.room_type || r.listing_id}</span>
                            {r.building_name && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                                {r.building_name}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-300">
                          {r.bedrooms}PN · {r.beds}G · {r.bathrooms}PT · {r.max_guests}K
                        </td>
                        <td className="px-3 py-2 font-mono text-emerald-300">
                          {r.price_per_night > 0 ? `${r.price_per_night.toLocaleString()} ${r.currency}` : '-'}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-300">
                          {r.total_price > 0 ? `${r.total_price.toLocaleString()} ${r.currency}` : '-'}
                        </td>
                        <td className="px-3 py-2 text-slate-200">
                          {r.host_name || (r.host_id ? `Host #${r.host_id}` : '-')}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
                          >
                            <span>Mở</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                Hiển thị {rooms.length} / {totalRooms} phòng (Trang {page}/{totalPages})
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded border border-slate-700 px-2.5 py-1 hover:text-white disabled:opacity-40"
                >
                  Trước
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="rounded border border-slate-700 px-2.5 py-1 hover:text-white disabled:opacity-40"
                >
                  Sau
                </button>
              </div>
            </div>
          </div>

          {/* Danh sách file Excel trong output/ (1 cột) */}
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                <span>File Excel (output/)</span>
              </div>
              <button
                type="button"
                onClick={() => void fetchReports()}
                className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-white"
                title="Làm mới danh sách"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="max-h-[450px] space-y-2 overflow-y-auto pr-1">
              {reports.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">Chưa có file Excel nào.</p>
              ) : (
                reports.map((f) => (
                  <a
                    key={f.name}
                    href={`/api/reports/download/${encodeURIComponent(f.name)}`}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5 text-xs hover:border-emerald-500/40 hover:bg-slate-900"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="truncate font-medium text-slate-200" title={f.name}>
                        {f.name}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {(f.sizeBytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <Download className="h-4 w-4 shrink-0 text-emerald-400" />
                  </a>
                ))
              )}
            </div>
          </div>
        </div>
        </div>
      </main>
    </div>
  );
}

export default App;
