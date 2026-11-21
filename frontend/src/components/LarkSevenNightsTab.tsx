import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Play,
  RefreshCw,
  Terminal,
  Upload,
} from 'lucide-react';
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react';

interface OutputExcelItem {
  relativePath: string;
  fileName: string;
  bundleFolder: string;
  size: number;
  mtimeMs: number;
  updatedAt: string;
}

type SheetName = 'Building Infor' | 'Host Infor' | 'ROOM INFOR';

interface PreviewRow {
  excelRow: number;
  values: Record<string, unknown>;
  errors: string[];
  systemActions: string[];
  photoCount?: number;
  photoFound?: boolean;
  syncAction?: 'create' | 'update';
}

interface PreviewSheet {
  name: SheetName;
  headers: string[];
  rows: PreviewRow[];
}

interface WorkbookPreview {
  sheets: PreviewSheet[];
  errorCount: number;
  systemActions: string[];
}

interface SyncResult {
  created: number;
  updated: number;
  failed: number;
}

const SHEETS: SheetName[] = ['Building Infor', 'Host Infor', 'ROOM INFOR'];

function getErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const body = data as { message?: unknown; error?: unknown };
    if (typeof body.message === 'string') return body.message;
    if (typeof body.error === 'string') return body.error;
  }
  return fallback;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function LarkSevenNightsTab() {
  const [file, setFile] = useState<File | null>(null);
  const [selectedBundlePath, setSelectedBundlePath] = useState<string>('');
  const [reports, setReports] = useState<OutputExcelItem[]>([]);
  const [selectedReport, setSelectedReport] = useState('');
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [activeSheet, setActiveSheet] = useState<SheetName>('ROOM INFOR');
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isLoadingOutput, setIsLoadingOutput] = useState(false);
  const [isStartingSync, setIsStartingSync] = useState(false);
  const [includePhotos, setIncludePhotos] = useState(true);
  const [result, setResult] = useState<SyncResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchOutputFiles = () => {
    setIsLoadingReports(true);
    fetch('/lark-7nights/output-files')
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { files?: OutputExcelItem[] };
        setReports(data.files || []);
      })
      .catch(() => undefined)
      .finally(() => setIsLoadingReports(false));
  };

  useEffect(() => {
    fetchOutputFiles();
    return () => eventSourceRef.current?.close();
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const chooseFile = (nextFile: File | null, bundlePath = '') => {
    if (!nextFile) return;
    if (!/\.(xlsx|xls)$/i.test(nextFile.name)) {
      setErrorMessage('Chỉ hỗ trợ file Excel .xlsx hoặc .xls.');
      return;
    }
    if (nextFile.size > 20 * 1024 * 1024) {
      setErrorMessage('File vượt quá giới hạn 20 MB.');
      return;
    }
    setFile(nextFile);
    setSelectedBundlePath(bundlePath);
    setPreview(null);
    setResult(null);
    setStatus('idle');
    setErrorMessage(null);
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0] || null);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    chooseFile(event.dataTransfer.files[0] || null);
  };

  const loadOutputFile = async () => {
    if (!selectedReport) return;
    setIsLoadingOutput(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/lark-7nights/output-file?path=${encodeURIComponent(selectedReport)}`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(getErrorMessage(body, 'Không thể tải file trong output/.'));
      }
      const blob = await response.blob();
      const fileName = selectedReport.split('/').pop() || selectedReport;
      chooseFile(new File([blob], fileName, { type: blob.type }), selectedReport);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Lỗi tải file output/.');
    } finally {
      setIsLoadingOutput(false);
    }
  };

  const uploadWorkbook = async (endpoint: 'preview' | 'sync') => {
    if (!file) throw new Error('Vui lòng chọn file Excel trước.');
    const body = new FormData();
    body.append('file', file);
    if (selectedBundlePath) {
      body.append('bundleRelativePath', selectedBundlePath);
    }
    if (endpoint === 'sync') {
      body.append('uploadPhotos', String(includePhotos));
    }
    const response = await fetch(`/lark-7nights/${endpoint}`, {
      method: 'POST',
      body,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(getErrorMessage(data, `Yêu cầu ${endpoint} thất bại.`));
    }
    return data;
  };

  const previewWorkbook = async () => {
    setErrorMessage(null);
    setIsPreviewing(true);
    setPreview(null);
    try {
      const data = (await uploadWorkbook('preview')) as WorkbookPreview;
      setPreview(data);
      setActiveSheet(data.sheets[0]?.name || 'ROOM INFOR');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Không thể xem trước workbook.');
    } finally {
      setIsPreviewing(false);
    }
  };

  const startSync = async () => {
    setErrorMessage(null);
    setIsStartingSync(true);
    setLogs([]);
    setResult(null);
    try {
      const data = (await uploadWorkbook('sync')) as { jobId: string };
      if (!data.jobId) throw new Error('Backend không trả về mã tiến trình.');
      setStatus('running');
      setLogs([`[${new Date().toLocaleTimeString()}] Đang kết nối tiến trình ${data.jobId}...`]);

      eventSourceRef.current?.close();
      const source = new EventSource(
        `/lark-7nights/${encodeURIComponent(data.jobId)}/stream`,
      );
      eventSourceRef.current = source;

      source.addEventListener('log', (event) => {
        const raw = (event as MessageEvent<string>).data;
        let line = raw;
        try {
          line = JSON.parse(raw) as string;
        } catch {
          // Keep the raw SSE message if it is not JSON encoded.
        }
        setLogs((current) => [...current.slice(-499), String(line)]);
      });

      source.addEventListener('done', (event) => {
        const totals = JSON.parse((event as MessageEvent<string>).data) as SyncResult;
        setResult(totals);
        setStatus('completed');
        source.close();
      });

      source.addEventListener('error', (event) => {
        const raw = (event as MessageEvent<string>).data;
        if (!raw) return;
        let message = 'Tiến trình đồng bộ thất bại.';
        try {
          const data = JSON.parse(raw) as { error?: string };
          message = data.error || message;
        } catch {
          message = raw;
        }
        setErrorMessage(message);
        setStatus('error');
        setLogs((current) => [...current, `[${new Date().toLocaleTimeString()}] ❌ ${message}`]);
        source.close();
      });

      source.onopen = () => setIsStartingSync(false);
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) {
          setIsStartingSync(false);
          if (status === 'running') {
            setStatus('error');
            setErrorMessage('Mất kết nối tới luồng log SSE.');
          }
        }
      };
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Không thể bắt đầu đồng bộ.');
      setIsStartingSync(false);
    }
  };

  const activePreview = preview?.sheets.find((sheet) => sheet.name === activeSheet);
  const roomPreviewRows = preview?.sheets.find((sheet) => sheet.name === 'ROOM INFOR')?.rows || [];
  const roomCreateCount = roomPreviewRows.filter((row) => row.syncAction === 'create').length;
  const roomUpdateCount = roomPreviewRows.filter((row) => row.syncAction === 'update').length;
  const isRunning = status === 'running';
  const hasPreviewErrors = Boolean(preview && preview.errorCount > 0);

  return (
    <div className="space-y-5">
      {errorMessage && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="shrink-0 font-semibold underline"
          >
            Đóng
          </button>
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
              <FileSpreadsheet className="h-4 w-4 text-sky-400" />
              Đồng bộ Excel lên Lark Base
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Kiểm tra schema và mã liên kết Building/Host trước khi đồng bộ 7Nights Global.
            </p>
          </div>
          <a
            href="/lark-7nights/download-template"
            className="inline-flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3.5 py-2 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Tải file Excel mẫu 3 sheet
          </a>
        </div>

        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          className="rounded-2xl border-2 border-dashed border-slate-700 bg-slate-950/60 p-5 text-center transition hover:border-sky-500/50"
        >
          <Upload className="mx-auto mb-2 h-6 w-6 text-sky-400" />
          <p className="text-sm font-semibold text-slate-200">
            {file ? file.name : 'Kéo thả file Excel vào đây'}
          </p>
          <p className="mt-1 text-xs text-slate-500">.xlsx / .xls · tối đa 20 MB</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileInput}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-sky-500/50 hover:text-white"
            >
              Chọn file từ máy
            </button>
            <span className="text-xs text-slate-600">hoặc</span>
            <select
              value={selectedReport}
              onChange={(event) => setSelectedReport(event.target.value)}
              className="max-w-[340px] rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="">
                {isLoadingReports
                  ? 'Đang quét thư mục output/...'
                  : reports.length
                    ? 'Hoặc chọn nhanh file vừa cào từ thư mục output/'
                    : 'Không có file Excel trong output/'}
              </option>
              {reports.map((report) => (
                <option key={report.relativePath} value={report.relativePath}>
                  {report.bundleFolder} / {report.fileName}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedReport || isLoadingOutput}
              onClick={() => void loadOutputFile()}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingOutput ? 'Đang nạp...' : 'Nạp file output/'}
            </button>
            <button
              type="button"
              onClick={fetchOutputFiles}
              title="Làm mới danh sách output/"
              className="rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-400 hover:text-white"
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingReports ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-slate-400">
            {file ? (
              <>
                Đã chọn <span className="font-semibold text-slate-200">{file.name}</span>
                <span className="ml-2 text-slate-500">({(file.size / 1024).toFixed(1)} KB)</span>
              </>
            ) : (
              'Chọn workbook có sheet Building Infor, Host Infor và/hoặc ROOM INFOR.'
            )}
          </div>
          <button
            type="button"
            disabled={!file || isPreviewing || isRunning || isStartingSync}
            onClick={() => void previewWorkbook()}
            className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-bold text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPreviewing ? 'Đang kiểm tra...' : 'Xem trước & kiểm tra'}
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
            <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
            Xem trước dữ liệu
          </div>
          {preview && (
            <div className="flex flex-wrap items-center gap-2">
              {roomPreviewRows.length > 0 && (
                <>
                  <span className="inline-flex items-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                    ROOM INFOR tạo mới: {roomCreateCount}
                  </span>
                  <span className="inline-flex items-center rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300">
                    ROOM INFOR cập nhật: {roomUpdateCount}
                  </span>
                </>
              )}
              <span
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] ${
                  preview.errorCount
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                }`}
              >
                {preview.errorCount ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {preview.errorCount
                  ? `${preview.errorCount} lỗi dữ liệu gốc`
                  : 'Dữ liệu gốc hợp lệ'}
              </span>
            </div>
          )}
        </div>

        {preview?.systemActions.length ? (
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.07] p-3">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-sky-300">
              Hệ thống tự xử lý trước khi ghi dữ liệu
            </div>
            <ul className="max-h-24 list-inside list-disc space-y-0.5 overflow-y-auto text-[11px] text-sky-100/80">
              {preview.systemActions.map((action, index) => (
                <li key={`${index}-${action}`}>{action}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {SHEETS.map((sheetName) => {
            const sheet = preview?.sheets.find((item) => item.name === sheetName);
            return (
              <button
                key={sheetName}
                type="button"
                onClick={() => setActiveSheet(sheetName)}
                className={`rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition ${
                  activeSheet === sheetName
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {sheetName} ({sheet?.rows.length || 0})
              </button>
            );
          })}
        </div>

        {!preview ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-8 text-center text-xs text-slate-500">
            Chọn file và nhấn “Xem trước & kiểm tra” để tải schema Lark và xem dữ liệu.
          </div>
        ) : !activePreview ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-8 text-center text-xs text-slate-500">
            Sheet {activeSheet} không có trong workbook này.
          </div>
        ) : (
          <div className="max-h-[440px] overflow-auto rounded-xl border border-slate-800">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-950 text-slate-300">
                <tr>
                  <th className="whitespace-nowrap border-b border-slate-800 px-3 py-2.5">Excel row</th>
                  {activePreview.headers.map((header) => (
                    <th
                      key={header}
                      className="max-w-[280px] whitespace-nowrap border-b border-slate-800 px-3 py-2.5"
                    >
                      {header}
                    </th>
                  ))}
                  <th className="min-w-[220px] border-b border-slate-800 px-3 py-2.5">Lỗi dữ liệu gốc</th>
                  <th className="min-w-[240px] border-b border-slate-800 px-3 py-2.5">Hệ thống tự xử lý</th>
                </tr>
              </thead>
              <tbody>
                {activePreview.rows.map((row) => (
                  <tr
                    key={row.excelRow}
                    className={
                      row.errors.length
                        ? 'bg-rose-500/[0.08] text-rose-100'
                        : row.systemActions.length
                          ? 'bg-sky-500/[0.04] text-slate-300 hover:bg-sky-500/[0.08]'
                          : 'text-slate-300 hover:bg-slate-800/40'
                    }
                  >
                    <td className="whitespace-nowrap border-b border-slate-800/80 px-3 py-2 font-mono text-slate-500">
                      {row.excelRow}
                    </td>
                    {activePreview.headers.map((header) => {
                      const isRoomPhotoCol =
                        activeSheet === 'ROOM INFOR' &&
                        header.trim().toLowerCase() === 'photo';
                      return (
                        <td
                          key={header}
                          title={displayValue(row.values[header])}
                          className="max-w-[280px] truncate border-b border-slate-800/80 px-3 py-2"
                        >
                          {isRoomPhotoCol ? (
                            <div className="flex items-center gap-2">
                              {row.photoFound && (row.photoCount ?? 0) > 0 ? (
                                <span className="inline-flex shrink-0 items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                                  📸 Tìm thấy {row.photoCount} ảnh
                                </span>
                              ) : (
                                <span className="inline-flex shrink-0 items-center rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                                  ⚠️ Không thấy thư mục ảnh
                                </span>
                              )}
                              <span className="truncate text-[11px] text-slate-400">
                                {displayValue(row.values[header])}
                              </span>
                            </div>
                          ) : (
                            displayValue(row.values[header])
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-slate-800/80 px-3 py-2">
                      {row.errors.length ? (
                        <span className="text-rose-300">{row.errors.join(' · ')}</span>
                      ) : (
                        <span className="text-emerald-500">Không có</span>
                      )}
                    </td>
                    <td className="border-b border-slate-800/80 px-3 py-2">
                      {row.systemActions.length ? (
                        <span className="text-sky-300">{row.systemActions.join(' · ')}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {activePreview.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={activePreview.headers.length + 3}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Sheet chưa có dòng dữ liệu.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
          <p className="text-[11px] text-slate-500">
            Đỏ = thiếu/sai dữ liệu gốc; xanh = option, upsert danh mục hoặc attachment do hệ thống xử lý.
            Phòng chỉ được đẩy khi toàn bộ khóa liên kết hợp lệ.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-200 select-none">
              <input
                type="checkbox"
                checked={includePhotos}
                onChange={(event) => setIncludePhotos(event.target.checked)}
                disabled={isRunning || isStartingSync}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500"
              />
              <span>Kèm upload ảnh phòng (Photos/)</span>
            </label>
            <button
              type="button"
              disabled={!preview || hasPreviewErrors || isRunning || isStartingSync}
              onClick={() => void startSync()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-sky-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {isRunning || isStartingSync ? 'Đang đồng bộ...' : 'Đồng bộ lên Lark Base'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
            <Terminal className="h-4 w-4 text-sky-400" />
            Tiến độ &amp; Live Console
          </div>
          <span
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
              status === 'running'
                ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                : status === 'completed'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : status === 'error'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : 'border-slate-700 bg-slate-950 text-slate-400'
            }`}
          >
            {status === 'running'
              ? 'Đang chạy'
              : status === 'completed'
                ? 'Hoàn tất'
                : status === 'error'
                  ? 'Có lỗi'
                  : 'Sẵn sàng'}
          </span>
        </div>
        {result && (
          <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">
              Tạo mới: {result.created}
            </span>
            <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-sky-300">
              Cập nhật: {result.updated}
            </span>
            <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-300">
              Lỗi: {result.failed}
            </span>
          </div>
        )}
        <div
          ref={logContainerRef}
          className="h-56 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed"
          aria-live="polite"
        >
          {logs.length ? (
            logs.map((line, index) => (
              <div
                key={`${index}-${line}`}
                className={
                  line.includes('❌')
                    ? 'whitespace-pre-wrap text-rose-400'
                    : line.includes('⚠️')
                      ? 'whitespace-pre-wrap text-amber-300'
                      : line.includes('✅')
                        ? 'whitespace-pre-wrap text-emerald-300'
                        : 'whitespace-pre-wrap text-slate-300'
                }
              >
                {line}
              </div>
            ))
          ) : (
            <div className="flex h-full items-center justify-center text-slate-600">
              Chọn workbook, kiểm tra dữ liệu và bắt đầu đồng bộ để theo dõi log realtime.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
