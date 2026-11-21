import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from '@e965/xlsx';
import { AppConfigService } from '../../config/app-config.service';
import {
  SevenNightsPreview,
  SevenNightsPreviewRow,
  SevenNightsPreviewSheet,
  SevenNightsSheetName,
} from './seven-nights.dto';

const LARK_API_BASE = 'https://open.larksuite.com/open-apis';
const SHEET_NAMES: SevenNightsSheetName[] = [
  'Building Infor',
  'Host Infor',
  'ROOM INFOR',
];
const MAX_BATCH_SIZE = 500;
const REQUEST_DELAY_MS = 250;

interface LarkField {
  field_id: string;
  field_name: string;
  type: number;
  is_primary?: boolean;
  is_primary_field?: boolean;
  property?: {
    [key: string]: unknown;
    options?: Array<{ name: string; [key: string]: unknown }>;
  };
}

interface LarkRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

interface LarkEnvelope<T> {
  code: number;
  msg?: string;
  data?: T;
}

interface LarkTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface LarkPage<T> {
  items?: T[];
  records?: T[];
  has_more?: boolean;
  page_token?: string;
}

interface LarkWriteResponse {
  records?: LarkRecord[];
  record?: LarkRecord;
}

interface LarkConfig {
  appId: string;
  appSecret: string;
  appToken: string;
  tables: Record<SevenNightsSheetName, string>;
}

interface WorkbookRow {
  excelRow: number;
  values: Record<string, unknown>;
}

interface ParsedSheet {
  name: SevenNightsSheetName;
  headers: string[];
  rows: WorkbookRow[];
}

interface ReferenceMaps {
  building: Map<string, string>;
  buildingByName: Map<string, string>;
  buildingByGoogleLink: Map<string, string>;
  host: Map<string, string>;
  hostByAirbnbLink: Map<string, string>;
  hostByName: Map<string, string>;
  roomByAirbnbId: Map<string, string>;
  roomByUrlId: Map<string, string>;
  roomByComposite: Map<string, string>;
}

interface MissingOptions {
  sheetName: SevenNightsSheetName;
  tableId: string;
  field: LarkField;
  values: string[];
}

interface PhotoFile {
  path: string;
  name: string;
}

export interface SevenNightsJob {
  jobId: string;
  status: 'running' | 'completed' | 'error';
  logs: string[];
  clients: Set<Response>;
  result?: { created: number; updated: number; failed: number };
  error?: string;
}

class LarkApiError extends Error {
  constructor(
    message: string,
    readonly responseData: unknown,
  ) {
    super(message);
    this.name = 'LarkApiError';
  }
}

@Injectable()
export class SevenNightsSyncService {
  private tenantAccessToken = '';
  private tokenExpiresAt = 0;
  private readonly jobs = new Map<string, SevenNightsJob>();
  private activeJobId?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly appConfig: AppConfigService,
  ) {}

  getUiHtml(): string {
    return String.raw`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>7Nights Global - Đồng bộ Excel</title>
  <style>
    :root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#172033;background:#f4f6fb}
    *{box-sizing:border-box}body{margin:0;padding:32px}.wrap{max-width:1180px;margin:auto}
    h1{margin:0 0 8px;font-size:26px}.muted{color:#667085}.card{background:white;border:1px solid #e4e7ec;border-radius:12px;padding:20px;margin-top:18px}
    .drop{border:2px dashed #98a2b3;border-radius:10px;padding:26px;text-align:center;background:#fafbff}
    button,.button{border:0;border-radius:8px;padding:10px 15px;font-weight:650;cursor:pointer;background:#e9edf5;color:#182230}
    button.primary{background:#2457d6;color:white}button:disabled{opacity:.5;cursor:not-allowed}
    .actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:15px 0}
    .tabs button.active{background:#182230;color:white}.table-wrap{overflow:auto;max-height:430px;border:1px solid #eaecf0;border-radius:8px}
    table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid #eaecf0;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis}
    th{position:sticky;top:0;background:#f9fafb;z-index:1}.bad-row{background:#fff0f0}.errors{color:#b42318;white-space:normal;min-width:220px}
    #console{background:#101820;color:#c5f7cc;border-radius:8px;padding:14px;min-height:180px;max-height:340px;overflow:auto;font:13px/1.6 Consolas,monospace;white-space:pre-wrap}
    .status{margin-top:12px;color:#b42318}.hint{font-size:13px;margin-top:12px}@media(max-width:600px){body{padding:16px}.card{padding:14px}}
  </style>
</head>
<body><main class="wrap">
  <h1>Đồng bộ 7Nights Global</h1>
  <div class="muted">Tải Excel lên để kiểm tra schema, khóa liên kết Building/Host và xem trước dữ liệu trước khi đồng bộ.</div>
  <section class="card">
    <div id="drop" class="drop">
      <strong>Kéo thả file Excel vào đây</strong><div class="hint">Hỗ trợ .xlsx và .xls · tối đa 20 MB</div>
      <p><input id="file" type="file" accept=".xlsx,.xls"></p>
      <div class="actions"><button id="preview">Xem trước & kiểm tra</button><a class="button" href="/lark-7nights/download-template">Tải template 3 sheet</a></div>
    </div>
    <div id="status" class="status" role="status"></div>
    <div class="tabs" id="tabs"></div><div id="previewTable"></div>
    <div class="actions" style="margin-top:16px"><button id="sync" class="primary" disabled>Đồng bộ lên Lark Base</button></div>
  </section>
  <section class="card"><strong>Terminal / Execution Log</strong><div id="console" aria-live="polite"></div></section>
</main>
<script>
const fileInput=document.getElementById('file'), previewButton=document.getElementById('preview'), syncButton=document.getElementById('sync');
const statusEl=document.getElementById('status'), tabsEl=document.getElementById('tabs'), tableEl=document.getElementById('previewTable'), consoleEl=document.getElementById('console');
let currentFile=null, previewData=null, selectedSheet=0, eventSource=null;
function setStatus(text){statusEl.textContent=text||''}
function appendLog(text){consoleEl.textContent+=(consoleEl.textContent?'\n':'')+text;consoleEl.scrollTop=consoleEl.scrollHeight}
function formatValue(value){if(value===null||value===undefined)return '';if(typeof value==='object')return JSON.stringify(value);return String(value)}
function renderPreview(){
  tabsEl.replaceChildren();tableEl.replaceChildren();
  if(!previewData||!previewData.sheets.length)return;
  previewData.sheets.forEach((sheet,index)=>{
    const tab=document.createElement('button');tab.textContent=sheet.name+' ('+sheet.rows.length+')';tab.className=index===selectedSheet?'active':'';
    tab.onclick=()=>{selectedSheet=index;renderPreview()};tabsEl.append(tab);
  });
  const sheet=previewData.sheets[selectedSheet];if(!sheet)return;
  const wrap=document.createElement('div');wrap.className='table-wrap';const table=document.createElement('table');
  const head=document.createElement('thead'), headRow=document.createElement('tr');
  ['Excel row',...sheet.headers,'Validation'].forEach(label=>{const th=document.createElement('th');th.textContent=label;headRow.append(th)});
  head.append(headRow);table.append(head);
  const body=document.createElement('tbody');
  sheet.rows.forEach(row=>{const tr=document.createElement('tr');if(row.errors.length)tr.className='bad-row';
    const rowNo=document.createElement('td');rowNo.textContent=String(row.excelRow);tr.append(rowNo);
    sheet.headers.forEach(header=>{const td=document.createElement('td');td.textContent=formatValue(row.values[header]);tr.append(td)});
    const error=document.createElement('td');error.className='errors';error.textContent=row.errors.join(' · ');tr.append(error);body.append(tr);
  });
  table.append(body);wrap.append(table);tableEl.append(wrap);
}
async function submitFile(path){
  if(!currentFile){setStatus('Vui lòng chọn file Excel trước.');return null}
  const form=new FormData();form.append('file',currentFile);
  const response=await fetch('/lark-7nights/'+path,{method:'POST',body:form});
  const data=await response.json().catch(()=>({message:'Phản hồi không hợp lệ từ máy chủ.'}));
  if(!response.ok)throw new Error(data.message||data.error||response.statusText);
  return data;
}
fileInput.onchange=()=>{currentFile=fileInput.files[0]||null;previewData=null;syncButton.disabled=true;renderPreview();setStatus(currentFile?currentFile.name:'')};
const drop=document.getElementById('drop');drop.ondragover=event=>{event.preventDefault();drop.style.borderColor='#2457d6'};
drop.ondragleave=()=>drop.style.borderColor='';drop.ondrop=event=>{event.preventDefault();drop.style.borderColor='';const f=event.dataTransfer.files[0];if(f){currentFile=f;fileInput.files=event.dataTransfer.files;setStatus(f.name)}};
previewButton.onclick=async()=>{previewButton.disabled=true;syncButton.disabled=true;setStatus('Đang tải schema Lark và kiểm tra dữ liệu...');
  try{previewData=await submitFile('preview');selectedSheet=0;renderPreview();const errors=previewData.errorCount||0;setStatus(errors?('Có '+errors+' cảnh báo/lỗi; dòng lỗi được tô đỏ.'): 'Kiểm tra hợp lệ, sẵn sàng đồng bộ.');syncButton.disabled=errors>0||!previewData.sheets.some(s=>s.rows.length)}
  catch(error){setStatus(error.message)}finally{previewButton.disabled=false}
};
syncButton.onclick=async()=>{syncButton.disabled=true;previewButton.disabled=true;setStatus('Đang khởi tạo đồng bộ...');
  try{const job=await submitFile('sync');appendLog('['+new Date().toLocaleTimeString()+'] Tiến trình '+job.jobId+' bắt đầu.');
    if(eventSource)eventSource.close();eventSource=new EventSource('/lark-7nights/'+encodeURIComponent(job.jobId)+'/stream');
    eventSource.addEventListener('log',event=>appendLog(event.data));
    eventSource.addEventListener('done',event=>{const result=JSON.parse(event.data);appendLog('Hoàn tất: Thành công '+result.created+' | Cập nhật '+result.updated+' | Lỗi '+result.failed+'.');setStatus('Đồng bộ hoàn tất.');eventSource.close();previewButton.disabled=false});
    eventSource.addEventListener('error',event=>{if(event.data){try{const data=JSON.parse(event.data);appendLog('LỖI: '+data.error);setStatus(data.error)}catch(_){appendLog('Kết nối log bị gián đoạn.')}}eventSource.close();previewButton.disabled=false});
  }catch(error){setStatus(error.message);previewButton.disabled=false;syncButton.disabled=false}
};
</script></body></html>`;
  }

  async createTemplate(): Promise<Buffer> {
    const schemas = await this.getSchemas();
    const workbook = XLSX.utils.book_new();
    for (const name of SHEET_NAMES) {
      const headers = schemas[name]
        .filter((field) => field.type !== 20)
        .map((field) => field.field_name);
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([headers]),
        name,
      );
    }
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  async previewWorkbook(
    buffer: Buffer,
    originalName: string,
    bundleRelativePath?: string,
  ): Promise<SevenNightsPreview> {
    const sheets = this.parseWorkbook(buffer);
    const schemas = await this.getSchemas();
    const references = await this.loadReferenceMaps(schemas);
    const preview = this.validateWorkbook(sheets, schemas, references, true, true);
    const optionUpdates = this.findMissingOptions(sheets, schemas);
    preview.systemActions = optionUpdates.map(
      ({ sheetName, field, values }) =>
        `${sheetName}: sẽ thêm ${values.length} option vào "${field.field_name}" (${values.join(', ')}).`,
    );
    const photoSourceDir = this.findWorkbookBundleDir(originalName, buffer);
    this.addPreviewSystemActions(
      preview,
      sheets,
      schemas,
      references,
      originalName,
      photoSourceDir,
      bundleRelativePath,
    );
    return preview;
  }

  startSync(
    buffer: Buffer,
    originalName: string,
    uploadPhotos = true,
    bundleRelativePath?: string,
  ): { jobId: string; status: 'running' } {
    if (this.activeJobId) {
      const active = this.jobs.get(this.activeJobId);
      if (active?.status === 'running') {
        throw new ConflictException('Đang có tiến trình 7Nights đồng bộ.');
      }
    }

    const jobId = randomUUID();
    const job: SevenNightsJob = {
      jobId,
      status: 'running',
      logs: [],
      clients: new Set<Response>(),
    };
    this.jobs.set(jobId, job);
    this.activeJobId = jobId;
    for (const [oldJobId, oldJob] of this.jobs) {
      if (this.jobs.size <= 12) break;
      if (oldJob.status !== 'running' && oldJobId !== jobId) this.jobs.delete(oldJobId);
    }
    void this.runSyncJob(job, buffer, originalName, uploadPhotos, bundleRelativePath);
    return { jobId, status: 'running' };
  }

  getJob(jobId: string): SevenNightsJob | undefined {
    return this.jobs.get(jobId);
  }

  sendSse(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private async runSyncJob(
    job: SevenNightsJob,
    buffer: Buffer,
    originalName: string,
    uploadPhotos = true,
    bundleRelativePath?: string,
  ): Promise<void> {
    const totals = { created: 0, updated: 0, failed: 0 };
    try {
      this.addLog(job, '🔑 Đang kiểm tra Tenant Access Token...');
      await this.getTenantAccessToken();
      this.addLog(job, '🔑 Tenant Access Token hợp lệ.');

      const parsed = this.parseWorkbook(buffer);
      let schemas = await this.getSchemas();
      this.addLog(job, '⚙️ Bước 1/4: Đang kiểm tra option SingleSelect/MultiSelect trên 3 bảng...');
      await this.addMissingOptions(this.findMissingOptions(parsed, schemas), job);
      this.addLog(job, '🔄 Đang tải lại schema mới nhất từ Lark...');
      schemas = await this.getSchemas();

      this.addLog(job, '📥 Đang tải danh mục Building Infor & Host Infor...');
      let references = await this.loadReferenceMaps(schemas);
      const parentValidation = this.validateWorkbook(
        parsed,
        schemas,
        references,
        false,
        true,
      );
      const sheetRows = new Map(
        parentValidation.sheets.map((sheet) => [sheet.name, sheet.rows]),
      );

      for (const name of ['Building Infor', 'Host Infor'] as const) {
        const sheet = parsed.find((candidate) => candidate.name === name);
        if (!sheet) continue;
        this.addLog(
          job,
          name === 'Building Infor'
            ? '🏢 Bước 2/4: Upsert Building Infor...'
            : '👤 Bước 3/4: Upsert Host Infor...',
        );
        const rows = sheetRows.get(name) || [];
        totals.failed += await this.logInvalidRows(job, name, rows);
        const validRows = rows.filter((row) => row.errors.length === 0);
        const result = await this.upsertParentRows(
          job,
          name,
          sheet,
          validRows,
          schemas[name],
          references,
        );
        totals.created += result.created;
        totals.updated += result.updated;
        totals.failed += result.failed;
      }

      this.addLog(job, '🔄 Bước 4/4: Tải lại record_id Building/Host và kiểm tra toàn bộ ROOM INFOR...');
      const refreshedReferences = await this.loadReferenceMaps(schemas);
      for (const [key, recordId] of references.building) {
        refreshedReferences.building.set(key, recordId);
      }
      for (const [key, recordId] of references.host) {
        refreshedReferences.host.set(key, recordId);
      }
      references = refreshedReferences;
      const validation = this.validateWorkbook(parsed, schemas, references, false, false);
      const roomSheet = parsed.find((sheet) => sheet.name === 'ROOM INFOR');
      if (roomSheet) {
        const roomRows =
          validation.sheets.find((sheet) => sheet.name === 'ROOM INFOR')?.rows || [];
        const invalid = await this.logInvalidRows(job, 'ROOM INFOR', roomRows);
        totals.failed += invalid;
        const validRows = roomRows.filter((row) => row.errors.length === 0);
        const mapped = validRows.filter((row) => this.hasRoomReferences(row, schemas['ROOM INFOR'])).length;
        this.addLog(
          job,
          `🔗 Đã map thành công ${mapped}/${validRows.length} dòng phòng với record_id tương ứng.`,
        );
        if (invalid > 0) {
          this.addLog(
            job,
            `🚫 ROOM INFOR chưa đạt 100% điều kiện (${invalid} dòng lỗi); không đẩy dòng phòng nào lên Lark.`,
          );
        } else {
          const photoSourceDir = this.findWorkbookBundleDir(originalName, buffer);
          const result = await this.upsertRoomRows(
            job,
            roomSheet,
            validRows,
            schemas['ROOM INFOR'],
            references,
            originalName,
            uploadPhotos,
            photoSourceDir,
            bundleRelativePath,
          );
          totals.created += result.created;
          totals.updated += result.updated;
          totals.failed += result.failed;
        }
      }

      job.result = totals;
      job.status = 'completed';
      this.addLog(
        job,
        `✅ Hoàn tất: Thành công ${totals.created} | Cập nhật ${totals.updated} | Lỗi ${totals.failed}.`,
      );
      this.broadcast(job, 'done', totals);
    } catch (error) {
      job.status = 'error';
      job.error = this.errorMessage(error);
      this.addLog(job, `❌ Đồng bộ thất bại: ${job.error}`);
      this.broadcast(job, 'error', { error: job.error });
    } finally {
      if (this.activeJobId === job.jobId) this.activeJobId = undefined;
      for (const client of job.clients) client.end();
      job.clients.clear();
    }
  }

  private parseWorkbook(buffer: Buffer): ParsedSheet[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    } catch (error) {
      throw new BadRequestException(
        `Không đọc được file Excel: ${this.errorMessage(error)}`,
      );
    }

    const parsed: ParsedSheet[] = [];
    for (const worksheetName of workbook.SheetNames) {
      const name = SHEET_NAMES.find(
        (candidate) => this.normalizeKey(candidate) === this.normalizeKey(worksheetName),
      );
      if (!name) continue;
      const data = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[worksheetName], {
        header: 1,
        defval: '',
        raw: false,
        blankrows: false,
      });
      if (!data.length) {
        parsed.push({ name, headers: [], rows: [] });
        continue;
      }
      const headers = data[0].map((value) => String(value ?? '').trim());
      const rows: WorkbookRow[] = [];
      for (let index = 1; index < data.length; index += 1) {
        const values = data[index];
        if (!values.some((value) => String(value ?? '').trim() !== '')) continue;
        const row: Record<string, unknown> = {};
        headers.forEach((header, columnIndex) => {
          if (header) row[header] = values[columnIndex] ?? '';
        });
        rows.push({ excelRow: index + 1, values: row });
      }
      parsed.push({ name, headers: headers.filter(Boolean), rows });
    }
    if (!parsed.length) {
      throw new BadRequestException(
        `Workbook không có sheet phù hợp. Tên sheet hỗ trợ: ${SHEET_NAMES.join(', ')}.`,
      );
    }
    if (parsed.every((sheet) => sheet.rows.length === 0)) {
      throw new BadRequestException('File Excel không có dòng dữ liệu.');
    }
    return parsed;
  }

  private validateWorkbook(
    sheets: ParsedSheet[],
    schemas: Record<SevenNightsSheetName, LarkField[]>,
    references: ReferenceMaps,
    allowMissingOptions = false,
    allowParentKeys = false,
  ): SevenNightsPreview {
    const buildingSheet = sheets.find((sheet) => sheet.name === 'Building Infor');
    const hostSheet = sheets.find((sheet) => sheet.name === 'Host Infor');
    const buildingKeys = allowParentKeys
      ? this.parentKeys(buildingSheet, schemas['Building Infor'], 'building')
      : new Set<string>();
    const hostKeys = allowParentKeys
      ? this.parentKeys(hostSheet, schemas['Host Infor'], 'host')
      : new Set<string>();
    const previewSheets: SevenNightsPreviewSheet[] = sheets.map((sheet) => {
      const fields = schemas[sheet.name];
      const rows = sheet.rows.map((row) =>
        this.validateRow(
          row,
          sheet,
          fields,
          references,
          buildingKeys,
          hostKeys,
          allowMissingOptions,
          allowParentKeys,
        ),
      );
      this.markDuplicateParentCodes(sheet, fields, rows);
      return { name: sheet.name, headers: sheet.headers, rows };
    });
    return {
      sheets: previewSheets,
      systemActions: [],
      errorCount: previewSheets.reduce(
        (total, sheet) =>
          total + sheet.rows.reduce((count, row) => count + row.errors.length, 0),
        0,
      ),
    };
  }

  private validateRow(
    row: WorkbookRow,
    sheet: ParsedSheet,
    fields: LarkField[],
    references: ReferenceMaps,
    buildingKeys: Set<string>,
    hostKeys: Set<string>,
    allowMissingOptions: boolean,
    allowParentKeys: boolean,
  ): SevenNightsPreviewRow {
    const errors: string[] = [];
    const systemActions: string[] = [];
    const fieldMap = new Map(
      fields.map((field) => [this.normalizeFieldName(field.field_name), field]),
    );

    if (sheet.name !== 'ROOM INFOR') {
      const primary = this.primaryField(fields, sheet.name);
      if (this.isBlank(this.valueForField(row.values, primary))) {
        errors.push(`Thiếu khóa chính "${primary.field_name}".`);
      }
    }

    for (const header of sheet.headers) {
      const field = fieldMap.get(this.normalizeFieldName(header));
      const value = row.values[header];
      if (!field) {
        if (
          this.isExcelOnlyRoomColumn(sheet, header) ||
          (sheet.name === 'ROOM INFOR' &&
            this.normalizeFieldName(header) === 'photo')
        ) {
          continue;
        }
        if (
          sheet.name !== 'ROOM INFOR' &&
          this.normalizeFieldName(header) === 'roominfor'
        ) {
          continue;
        }
        errors.push(`Cột "${header}" không tồn tại trong schema Lark.`);
        continue;
      }
      if (this.shouldIgnoreField(sheet, field) || this.isBlank(value)) continue;
      const text = String(value).trim();
      if (field.type === 2 && !Number.isFinite(Number(text))) {
        errors.push(`"${header}" phải là số.`);
      }
      if (field.type === 3) {
        const options = field.property?.options?.map((option) => option.name.trim()) || [];
        if (!options.includes(text)) {
          if (allowMissingOptions) {
            systemActions.push(`Sẽ tự thêm option "${text}" vào cột "${field.field_name}".`);
          } else {
            errors.push(`"${header}" chưa có option "${text}" trên Lark.`);
          }
        }
      }
      if (field.type === 4) {
        const options = field.property?.options?.map((option) => option.name.trim()) || [];
        const selected = this.parseMultiSelect(value);
        const invalid = selected.filter((item) => !options.includes(item));
        if (invalid.length) {
          if (allowMissingOptions) {
            systemActions.push(
              `Sẽ tự thêm option ${invalid.map((item) => `"${item}"`).join(', ')} vào cột "${field.field_name}".`,
            );
          } else {
            errors.push(`"${header}" chưa có option: ${invalid.join(', ')}.`);
          }
        }
      }
    }

    if (sheet.name === 'ROOM INFOR') {
      const relations = this.roomRelations(fields);
      if (!relations.some((field) => this.roomRelationKind(field) === 'building')) {
        errors.push('Schema ROOM INFOR thiếu cột liên kết Building code.');
      }
      if (!relations.some((field) => this.roomRelationKind(field) === 'host')) {
        errors.push('Schema ROOM INFOR thiếu cột liên kết Host code.');
      }
      for (const relation of relations) {
        const value = this.valueForField(row.values, relation);
        const relationKind = this.roomRelationKind(relation);
        if (!relationKind) continue;
        const isBuilding = relationKind === 'building';
        const map = isBuilding ? references.building : references.host;
        const workbookKeys = isBuilding ? buildingKeys : hostKeys;
        const kind = isBuilding ? 'Building Code' : 'Host Code';
        const code = String(value ?? '').trim();
        if (!code) {
          errors.push(`Thiếu ${kind}.`);
        } else if (
          !map.has(this.normalizeKey(code)) &&
          !(allowParentKeys && workbookKeys.has(this.normalizeKey(code)))
        ) {
          errors.push(`${kind} "${code}" không khớp Lark hoặc sheet danh mục.`);
        }
      }
    }
    return { excelRow: row.excelRow, values: row.values, errors, systemActions };
  }

  private markDuplicateParentCodes(
    sheet: ParsedSheet,
    fields: LarkField[],
    rows: SevenNightsPreviewRow[],
  ): void {
    if (sheet.name === 'ROOM INFOR') return;
    const primary = this.primaryField(fields, sheet.name);
    const seen = new Set<string>();
    for (const row of rows) {
      const code = String(this.valueForField(row.values, primary) ?? '').trim();
      if (!code) continue;
      const key = this.normalizeKey(code);
      if (seen.has(key)) row.errors.push(`Mã khóa "${code}" bị lặp trong sheet.`);
      seen.add(key);
    }
  }

  private normalizeUrlNoQuery(raw: unknown): string {
    const str = this.extractLarkCellText(raw).trim();
    if (!str) return '';
    return str.split('?')[0].replace(/\/+$/, '').toLowerCase();
  }

  private extractAirbnbRoomIdFromUrl(raw: unknown): string {
    const str = this.extractLarkCellText(raw).trim();
    if (!str) return '';
    const match = str.match(/\/rooms\/(\d+)/i);
    return match ? match[1] : '';
  }

  private extractCleanRoomId(raw: unknown): string {
    const str = this.extractLarkCellText(raw).trim().toLowerCase();
    if (!str) return '';
    const digits = str.replace(/[^0-9]/g, '');
    return digits || str;
  }

  private fieldValueByNames(
    values: Record<string, unknown>,
    normalizedTargets: string[],
  ): unknown {
    for (const [k, v] of Object.entries(values || {})) {
      if (normalizedTargets.includes(this.normalizeFieldName(k))) {
        return v;
      }
    }
    return undefined;
  }

  private extractLarkRelationRecordId(raw: unknown): string {
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && item.trim()) return item.trim();
        if (item && typeof item === 'object') {
          const rec = (item as { record_id?: unknown; record_ids?: unknown[] }).record_id;
          if (typeof rec === 'string' && rec.trim()) return rec.trim();
          const recs = (item as { record_ids?: unknown[] }).record_ids;
          if (Array.isArray(recs) && typeof recs[0] === 'string') return recs[0].trim();
        }
      }
    }
    if (raw && typeof raw === 'object') {
      const rec = (raw as { record_id?: unknown }).record_id;
      if (typeof rec === 'string' && rec.trim()) return rec.trim();
    }
    return '';
  }

  private buildRoomCompositeKeyFromValues(
    buildingRecordId: string,
    hostRecordId: string,
    values: Record<string, unknown>,
  ): string {
    const roomType = this.extractLarkCellText(
      this.fieldValueByNames(values, ['roomtype']),
    )
      .toLowerCase()
      .trim();
    const beds = this.extractLarkCellText(
      this.fieldValueByNames(values, ['howmanybed']),
    )
      .toLowerCase()
      .trim();
    const maxPeople = this.extractLarkCellText(
      this.fieldValueByNames(values, ['maxpeople']),
    )
      .toLowerCase()
      .trim();
    const checkIn = this.extractLarkCellText(
      this.fieldValueByNames(values, ['checkintime']),
    )
      .toLowerCase()
      .trim();
    if (!buildingRecordId || !hostRecordId || !roomType) return '';
    return `${buildingRecordId}|${hostRecordId}|${roomType}|${beds}|${maxPeople}|${checkIn}`;
  }

  private async loadReferenceMaps(
    schemas: Record<SevenNightsSheetName, LarkField[]>,
  ): Promise<ReferenceMaps> {
    const config = this.getConfig();
    const [buildingRecords, hostRecords, roomRecords] = await Promise.all([
      this.getRecords(config.tables['Building Infor']),
      this.getRecords(config.tables['Host Infor']),
      this.getRecords(config.tables['ROOM INFOR']),
    ]);

    const buildingPrimary = this.primaryField(schemas['Building Infor'], 'Building Infor');
    const hostPrimary = this.primaryField(schemas['Host Infor'], 'Host Infor');

    const building = new Map<string, string>();
    const buildingByName = new Map<string, string>();
    const buildingByGoogleLink = new Map<string, string>();

    for (const rec of buildingRecords) {
      const f = rec.fields || {};
      const codeKey = this.extractLarkCellText(f[buildingPrimary.field_name]);
      if (codeKey) building.set(this.normalizeKey(codeKey), rec.record_id);

      const bName = this.extractLarkCellText(
        this.fieldValueByNames(f, ['buildingname']),
      );
      if (bName) buildingByName.set(bName.toLowerCase().trim(), rec.record_id);

      const gLink = this.normalizeUrlNoQuery(
        this.fieldValueByNames(f, ['googlelink']),
      );
      if (gLink) buildingByGoogleLink.set(gLink, rec.record_id);
    }

    const host = new Map<string, string>();
    const hostByAirbnbLink = new Map<string, string>();
    const hostByName = new Map<string, string>();

    for (const rec of hostRecords) {
      const f = rec.fields || {};
      const codeKey = this.extractLarkCellText(f[hostPrimary.field_name]);
      if (codeKey) host.set(this.normalizeKey(codeKey), rec.record_id);

      const hLink = this.normalizeUrlNoQuery(
        this.fieldValueByNames(f, ['hostairbnblink']),
      );
      if (hLink) hostByAirbnbLink.set(hLink, rec.record_id);

      const hName = this.extractLarkCellText(
        this.fieldValueByNames(f, ['hostname']),
      );
      if (hName) hostByName.set(hName.toLowerCase().trim(), rec.record_id);
    }

    const roomByAirbnbId = new Map<string, string>();
    const roomByUrlId = new Map<string, string>();
    const roomByComposite = new Map<string, string>();

    const roomRelations = this.roomRelations(schemas['ROOM INFOR']);
    const buildingRelField = roomRelations.find((r) => this.roomRelationKind(r) === 'building');
    const hostRelField = roomRelations.find((r) => this.roomRelationKind(r) === 'host');

    for (const rec of roomRecords) {
      const f = rec.fields || {};
      const airbnbId = this.extractCleanRoomId(
        this.fieldValueByNames(f, ['airbnbroomid']),
      );
      if (airbnbId) roomByAirbnbId.set(airbnbId, rec.record_id);

      const urlId = this.extractAirbnbRoomIdFromUrl(
        this.fieldValueByNames(f, ['roomurl']),
      );
      if (urlId) roomByUrlId.set(urlId, rec.record_id);

      const bRecId = buildingRelField
        ? this.extractLarkRelationRecordId(f[buildingRelField.field_name])
        : '';
      const hRecId = hostRelField
        ? this.extractLarkRelationRecordId(f[hostRelField.field_name])
        : '';
      const comp = this.buildRoomCompositeKeyFromValues(bRecId, hRecId, f);
      if (comp) roomByComposite.set(comp, rec.record_id);
    }

    return {
      building,
      buildingByName,
      buildingByGoogleLink,
      host,
      hostByAirbnbLink,
      hostByName,
      roomByAirbnbId,
      roomByUrlId,
      roomByComposite,
    };
  }

  private parentKeys(
    sheet: ParsedSheet | undefined,
    fields: LarkField[],
    kind: 'building' | 'host',
  ): Set<string> {
    const result = new Set<string>();
    if (!sheet) return result;
    const primary = this.primaryField(fields, sheet.name);
    for (const row of sheet.rows) {
      const key = this.normalizeKey(
        String(this.valueForField(row.values, primary) ?? '').trim(),
      );
      if (key) result.add(key);
    }
    void kind;
    return result;
  }

  private primaryField(fields: LarkField[], sheetName: SevenNightsSheetName): LarkField {
    const primary =
      fields.find((field) => field.is_primary || field.is_primary_field) ||
      fields.find((field) => {
        const key = this.normalizeFieldName(field.field_name);
        return sheetName === 'Building Infor'
          ? key === 'buildingcode' || key === 'buidingcode'
          : sheetName === 'Host Infor'
            ? key === 'hostcode'
            : false;
      }) ||
      fields.find((field) => field.type !== 20);
    if (!primary) {
      throw new ServiceUnavailableException(
        `Không tìm thấy trường khóa chính của bảng ${sheetName}.`,
      );
    }
    return primary;
  }

  private roomRelations(fields: LarkField[]): LarkField[] {
    return fields.filter((field) => {
      if (field.type !== 18 && field.type !== 21) return false;
      return this.roomRelationKind(field) !== undefined;
    });
  }

  private roomRelationKind(field: LarkField): 'building' | 'host' | undefined {
    const name = this.normalizeFieldName(field.field_name);
    if (name.includes('building')) return 'building';
    if (name.includes('host')) return 'host';
    return undefined;
  }

  private shouldIgnoreField(sheet: ParsedSheet, field: LarkField): boolean {
    if (field.type === 20 || field.type === 17) return true;
    if (this.isExcelOnlyRoomColumn(sheet, field.field_name)) return true;
    return (
      sheet.name !== 'ROOM INFOR' &&
      this.normalizeFieldName(field.field_name) === 'roominfor'
    );
  }

  private isExcelOnlyRoomColumn(sheet: ParsedSheet, header: string): boolean {
    return (
      sheet.name === 'ROOM INFOR' &&
      ['buildingname', 'hostname'].includes(this.normalizeFieldName(header))
    );
  }

  private hasRoomReferences(row: SevenNightsPreviewRow, fields: LarkField[]): boolean {
    const relations = this.roomRelations(fields);
    return (
      relations.length > 0 &&
      relations.every((field) => !this.isBlank(this.valueForField(row.values, field)))
    );
  }

  private findParentExistingRecordId(
    name: 'Building Infor' | 'Host Infor',
    values: Record<string, unknown>,
    primary: LarkField,
    references: ReferenceMaps,
  ): string | undefined {
    const primaryCode = this.extractLarkCellText(this.valueForField(values, primary));
    if (name === 'Building Infor') {
      const bName = this.extractLarkCellText(
        this.fieldValueByNames(values, ['buildingname']),
      )
        .toLowerCase()
        .trim();
      if (bName && references.buildingByName.has(bName)) {
        return references.buildingByName.get(bName);
      }
      const gLink = this.normalizeUrlNoQuery(
        this.fieldValueByNames(values, ['googlelink']),
      );
      if (gLink && references.buildingByGoogleLink.has(gLink)) {
        return references.buildingByGoogleLink.get(gLink);
      }
      return primaryCode ? references.building.get(this.normalizeKey(primaryCode)) : undefined;
    }

    const hLink = this.normalizeUrlNoQuery(
      this.fieldValueByNames(values, ['hostairbnblink']),
    );
    if (hLink && references.hostByAirbnbLink.has(hLink)) {
      return references.hostByAirbnbLink.get(hLink);
    }
    const hName = this.extractLarkCellText(
      this.fieldValueByNames(values, ['hostname']),
    )
      .toLowerCase()
      .trim();
    if (hName && references.hostByName.has(hName)) {
      return references.hostByName.get(hName);
    }
    return primaryCode ? references.host.get(this.normalizeKey(primaryCode)) : undefined;
  }

  private findRoomExistingRecordId(
    values: Record<string, unknown>,
    fields: LarkField[],
    references: ReferenceMaps,
  ): string | undefined {
    // Ưu tiên 1: Airbnb Room ID
    const airbnbId = this.extractCleanRoomId(
      this.fieldValueByNames(values, ['airbnbroomid']),
    );
    if (airbnbId && references.roomByAirbnbId.has(airbnbId)) {
      return references.roomByAirbnbId.get(airbnbId);
    }

    // Ưu tiên 2: Room URL (/rooms/<id>)
    const urlId = this.extractAirbnbRoomIdFromUrl(
      this.fieldValueByNames(values, ['roomurl']),
    );
    if (urlId && references.roomByUrlId.has(urlId)) {
      return references.roomByUrlId.get(urlId);
    }

    // Ưu tiên 3: Tổ hợp buildingRecordId + hostRecordId + Room type + HOW MANY BED + max people + check in time
    const relations = this.roomRelations(fields);
    const buildingRel = relations.find((r) => this.roomRelationKind(r) === 'building');
    const hostRel = relations.find((r) => this.roomRelationKind(r) === 'host');
    const buildingCode = buildingRel
      ? String(this.valueForField(values, buildingRel) ?? '').trim()
      : '';
    const hostCode = hostRel
      ? String(this.valueForField(values, hostRel) ?? '').trim()
      : '';
    const bRecId = buildingCode
      ? references.building.get(this.normalizeKey(buildingCode)) || ''
      : '';
    const hRecId = hostCode
      ? references.host.get(this.normalizeKey(hostCode)) || ''
      : '';
    const comp = this.buildRoomCompositeKeyFromValues(bRecId, hRecId, values);
    if (comp && references.roomByComposite.has(comp)) {
      return references.roomByComposite.get(comp);
    }

    return undefined;
  }

  private async upsertParentRows(
    job: SevenNightsJob,
    name: 'Building Infor' | 'Host Infor',
    sheet: ParsedSheet,
    rows: SevenNightsPreviewRow[],
    fields: LarkField[],
    references: ReferenceMaps,
  ): Promise<{ created: number; updated: number; failed: number }> {
    const config = this.getConfig();
    const tableId = config.tables[name];
    const primary = this.primaryField(fields, name);
    const existing = name === 'Building Infor' ? references.building : references.host;
    const creates: Array<{ row: SevenNightsPreviewRow; fields: Record<string, unknown> }> = [];
    const updates: Array<{
      row: SevenNightsPreviewRow;
      recordId: string;
      fields: Record<string, unknown>;
    }> = [];
    for (const row of rows) {
      const recordFields = this.fieldsFromRow(row.values, sheet, fields, references);
      const recordId = this.findParentExistingRecordId(name, row.values, primary, references);
      if (recordId) updates.push({ row, recordId, fields: recordFields });
      else creates.push({ row, fields: recordFields });
    }

    this.addLog(job, `📤 ${name}: chuẩn bị ${creates.length} mới, ${updates.length} cập nhật.`);
    const updateReference = (recordId: string, row: SevenNightsPreviewRow) => {
      const key = this.extractLarkCellText(this.valueForField(row.values, primary));
      if (key) existing.set(this.normalizeKey(key), recordId);
    };
    const created = await this.writeRecords(
      job,
      name,
      tableId,
      creates,
      'create',
      updateReference,
    );
    const updated = await this.writeRecords(
      job,
      name,
      tableId,
      updates,
      'update',
      updateReference,
    );
    return {
      created: created.success,
      updated: updated.success,
      failed: created.failed + updated.failed,
    };
  }

  private async upsertRoomRows(
    job: SevenNightsJob,
    sheet: ParsedSheet,
    rows: SevenNightsPreviewRow[],
    fields: LarkField[],
    references: ReferenceMaps,
    originalName: string,
    uploadPhotos = true,
    photoSourceDir?: string,
    bundleRelativePath?: string,
  ): Promise<{ created: number; updated: number; failed: number }> {
    const tableId = this.getConfig().tables['ROOM INFOR'];
    const creates: Array<{ row: SevenNightsPreviewRow; fields: Record<string, unknown> }> = [];
    const updates: Array<{
      row: SevenNightsPreviewRow;
      recordId: string;
      fields: Record<string, unknown>;
    }> = [];
    const photoField = fields.find(
      (field) =>
        field.type === 17 &&
        (this.normalizeFieldName(field.field_name) === 'photo' ||
          this.normalizeFieldName(field.field_name) === 'photos'),
    );
    const uploadedTokens = new Map<string, string>();

    for (const row of rows) {
      const recordFields = this.fieldsFromRow(row.values, sheet, fields, references);
      const roomCode = this.extractRoomCode(row.values) || `ROW-${row.excelRow}`;
      const photoCellText = this.extractPhotoCellText(row.values);

      if (photoField && uploadPhotos) {
        const roomPhotosDir =
          (photoSourceDir
            ? this.resolveRoomDirInBundle(photoSourceDir, roomCode, photoCellText)
            : null) ||
          this.resolveRoomPhotosDir(
            originalName,
            roomCode,
            photoCellText,
            bundleRelativePath,
          );

        const photos = roomPhotosDir ? this.getPhotoFilesInDir(roomPhotosDir) : [];
        if (photos.length) {
          const fileTokens: string[] = [];
          const concurrency = 3;
          for (let idx = 0; idx < photos.length; idx += concurrency) {
            const batch = photos.slice(idx, idx + concurrency);
            const settled = await Promise.all(
              batch.map(async (photo) => {
                try {
                  const cached = uploadedTokens.get(photo.path);
                  if (cached) return cached;
                  const token = await this.uploadImageToLarkDrive(
                    photo.path,
                    `${roomCode}_${photo.name}`,
                  );
                  uploadedTokens.set(photo.path, token);
                  return token;
                } catch (err) {
                  this.addLog(
                    job,
                    `❌ Phòng [${roomCode}]: Lỗi Lark Drive upload "${photo.name}" (${this.errorMessage(err)})`,
                  );
                  return null;
                }
              }),
            );
            for (const token of settled) {
              if (token) fileTokens.push(token);
            }
            if (idx + concurrency < photos.length) {
              await this.delay(150);
            }
          }

          if (fileTokens.length > 0) {
            recordFields[photoField.field_name] = fileTokens.map((token) => ({
              file_token: token,
            }));
          }
          this.addLog(
            job,
            `📸 Phòng [${roomCode}]: Upload thành công ${fileTokens.length}/${photos.length} ảnh${fileTokens.length ? ` (file_token: ${fileTokens.join(', ')})` : ''}.`,
          );
        } else {
          this.addLog(
            job,
            `ℹ️ Phòng [${roomCode}]: không tìm thấy thư mục ảnh vật lý; bỏ qua trường Photo.`,
          );
        }
      } else if (photoField && !uploadPhotos) {
        this.addLog(
          job,
          `⏭️ Phòng [${roomCode}]: Đã tắt tùy chọn kèm ảnh; bỏ qua trường Photo.`,
        );
      }

      const existingRecordId = this.findRoomExistingRecordId(row.values, fields, references);
      if (existingRecordId) {
        updates.push({ row, recordId: existingRecordId, fields: recordFields });
      } else {
        creates.push({ row, fields: recordFields });
      }
    }

    this.addLog(
      job,
      `🚀 ROOM INFOR: chuẩn bị ${creates.length} tạo mới, ${updates.length} cập nhật...`,
    );
    const created = await this.writeRecords(job, 'ROOM INFOR', tableId, creates, 'create');
    const updated = await this.writeRecords(job, 'ROOM INFOR', tableId, updates, 'update');
    return {
      created: created.success,
      updated: updated.success,
      failed: created.failed + updated.failed,
    };
  }

  private async writeRecords(
    job: SevenNightsJob,
    sheetName: SevenNightsSheetName,
    tableId: string,
    records: Array<{
      row: SevenNightsPreviewRow;
      fields: Record<string, unknown>;
      recordId?: string;
    }>,
    operation: 'create' | 'update',
    onRecordWritten?: (recordId: string, row: SevenNightsPreviewRow) => void,
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;
    for (let start = 0; start < records.length; start += MAX_BATCH_SIZE) {
      const batch = records.slice(start, start + MAX_BATCH_SIZE);
      const batchNumber = Math.floor(start / MAX_BATCH_SIZE) + 1;
      this.addLog(
        job,
        `🚀 ${sheetName}: Batch ${batchNumber} (${batch.length} records) ${operation === 'create' ? 'tạo mới' : 'cập nhật'}...`,
      );
      try {
        const path =
          operation === 'create'
            ? `/bitable/v1/apps/${encodeURIComponent(this.getConfig().appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_create`
            : `/bitable/v1/apps/${encodeURIComponent(this.getConfig().appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_update`;
        const response = await this.larkRequest<LarkWriteResponse>(path, {
          method: 'POST',
          body: JSON.stringify({
            records: batch.map((record) =>
              operation === 'create'
                ? { fields: record.fields }
                : { record_id: record.recordId, fields: record.fields },
            ),
          }),
        });
        for (let index = 0; index < batch.length; index += 1) {
          const recordId =
            response.records?.[index]?.record_id || batch[index].recordId;
          if (recordId) onRecordWritten?.(recordId, batch[index].row);
        }
        success += batch.length;
      } catch (error) {
        this.addLog(
          job,
          `⚠️ Batch ${batchNumber} bị từ chối (${this.errorMessage(error)}); chuyển sang xử lý từng dòng để xác định lỗi.`,
        );
        for (const record of batch) {
          try {
            const base = `/bitable/v1/apps/${encodeURIComponent(this.getConfig().appToken)}/tables/${encodeURIComponent(tableId)}/records`;
            const path =
              operation === 'create'
                ? base
                : `${base}/${encodeURIComponent(record.recordId || '')}`;
            const response = await this.larkRequest<LarkWriteResponse>(path, {
              method: operation === 'create' ? 'POST' : 'PUT',
              body: JSON.stringify({ fields: record.fields }),
            });
            const recordId =
              response.record?.record_id ||
              response.records?.[0]?.record_id ||
              record.recordId;
            if (recordId) onRecordWritten?.(recordId, record.row);
            success += 1;
          } catch (rowError) {
            failed += 1;
            this.addLog(
              job,
              `❌ Excel dòng ${record.row.excelRow} (${this.rowCode(record.row)}): ${this.errorMessage(rowError)}`,
            );
          }
        }
      }
    }
    return { success, failed };
  }

  private fieldsFromRow(
    values: Record<string, unknown>,
    sheet: ParsedSheet,
    fields: LarkField[],
    references: ReferenceMaps,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const fieldMap = new Map(
      fields.map((field) => [this.normalizeFieldName(field.field_name), field]),
    );
    for (const header of sheet.headers) {
      const field = fieldMap.get(this.normalizeFieldName(header));
      if (!field || this.shouldIgnoreField(sheet, field)) continue;
      const value = values[header];
      if (this.isBlank(value)) continue;
      if (field.type === 2) {
        result[field.field_name] = Number(String(value).trim());
      } else if (field.type === 4) {
        result[field.field_name] = this.parseMultiSelect(value);
      } else if ((field.type === 18 || field.type === 21) && sheet.name === 'ROOM INFOR') {
        const relationKind = this.roomRelationKind(field);
        if (!relationKind) continue;
        const isBuilding = relationKind === 'building';
        const map = isBuilding ? references.building : references.host;
        const recordId = map.get(this.normalizeKey(String(value).trim()));
        if (recordId) result[field.field_name] = [recordId];
      } else {
        result[field.field_name] = String(value).trim();
      }
    }
    return result;
  }

  private async logInvalidRows(
    job: SevenNightsJob,
    sheetName: SevenNightsSheetName,
    rows: SevenNightsPreviewRow[],
  ): Promise<number> {
    let count = 0;
    for (const row of rows) {
      if (!row.errors.length) continue;
      count += 1;
      this.addLog(
        job,
        `⚠️ ${sheetName} dòng Excel ${row.excelRow} (${this.rowCode(row)}): ${row.errors.join(' ')}`,
      );
    }
    return count;
  }

  private async getSchemas(): Promise<Record<SevenNightsSheetName, LarkField[]>> {
    const config = this.getConfig();
    return {
      'Building Infor': await this.getFields(config.tables['Building Infor']),
      'Host Infor': await this.getFields(config.tables['Host Infor']),
      'ROOM INFOR': await this.getFields(config.tables['ROOM INFOR']),
    };
  }

  private async getFields(tableId: string): Promise<LarkField[]> {
    const fields: LarkField[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ page_size: '100' });
      if (pageToken) query.set('page_token', pageToken);
      const page = await this.larkRequest<LarkPage<LarkField>>(
        `/bitable/v1/apps/${encodeURIComponent(this.getConfig().appToken)}/tables/${encodeURIComponent(tableId)}/fields?${query}`,
      );
      fields.push(...(page.items || []));
      pageToken = page.has_more ? page.page_token : undefined;
    } while (pageToken);
    return fields;
  }

  private findMissingOptions(
    sheets: ParsedSheet[],
    schemas: Record<SevenNightsSheetName, LarkField[]>,
  ): MissingOptions[] {
    const config = this.getConfig();
    const missingByField = new Map<string, MissingOptions>();
    for (const sheet of sheets) {
      const fields = schemas[sheet.name];
      const fieldMap = new Map(
        fields.map((field) => [this.normalizeFieldName(field.field_name), field]),
      );
      for (const row of sheet.rows) {
        for (const header of sheet.headers) {
          const field = fieldMap.get(this.normalizeFieldName(header));
          if (
            !field ||
            this.shouldIgnoreField(sheet, field) ||
            (field.type !== 3 && field.type !== 4)
          ) {
            continue;
          }
          const value = row.values[header];
          if (this.isBlank(value)) continue;
          const candidates =
            field.type === 3 ? [String(value).trim()] : this.parseMultiSelect(value);
          const existing = new Set(
            (field.property?.options || []).map((option) => option.name.trim()),
          );
          const key = `${sheet.name}:${field.field_id}`;
          const pending = missingByField.get(key) || {
            sheetName: sheet.name,
            tableId: config.tables[sheet.name],
            field,
            values: [],
          };
          for (const candidate of candidates) {
            const option = candidate.trim();
            if (
              option &&
              !existing.has(option) &&
              !pending.values.includes(option)
            ) {
              pending.values.push(option);
            }
          }
          if (pending.values.length) missingByField.set(key, pending);
        }
      }
    }
    return Array.from(missingByField.values()).filter((item) => item.values.length > 0);
  }

  private async addMissingOptions(
    updates: MissingOptions[],
    job: SevenNightsJob,
  ): Promise<void> {
    if (!updates.length) {
      this.addLog(job, '✅ Không có option SingleSelect/MultiSelect mới cần bổ sung.');
      return;
    }

    for (const update of updates) {
      if (!update.field.field_id) {
        throw new ServiceUnavailableException(
          `Không có field_id để cập nhật option cho "${update.field.field_name}".`,
        );
      }
      const oldOptions = update.field.property?.options || [];
      const existing = new Set(oldOptions.map((option) => option.name.trim()));
      const values = update.values.filter((value) => !existing.has(value));
      if (!values.length) continue;

      const property = {
        ...(update.field.property || {}),
        options: [...oldOptions, ...values.map((name) => ({ name }))],
      };
      const appToken = encodeURIComponent(this.getConfig().appToken);
      const tableId = encodeURIComponent(update.tableId);
      const fieldId = encodeURIComponent(update.field.field_id);
      await this.larkRequest(
        `/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            field_name: update.field.field_name,
            type: update.field.type,
            property,
          }),
        },
      );
      this.addLog(
        job,
        `⚙️ Đã tự động bổ sung ${values.length} tùy chọn mới vào cột [${update.field.field_name}] trên Lark: ${values.join(', ')}.`,
      );
    }
  }

  private addPreviewSystemActions(
    preview: SevenNightsPreview,
    sheets: ParsedSheet[],
    schemas: Record<SevenNightsSheetName, LarkField[]>,
    references: ReferenceMaps,
    originalName: string,
    photoSourceDir?: string,
    bundleRelativePath?: string,
  ): void {
    for (const previewSheet of preview.sheets) {
      const sourceSheet = sheets.find((sheet) => sheet.name === previewSheet.name);
      if (!sourceSheet) continue;
      const fields = schemas[previewSheet.name];
      const primary = previewSheet.name === 'ROOM INFOR'
        ? undefined
        : this.primaryField(fields, previewSheet.name);
      const photoField = fields.find(
        (field) =>
          field.type === 17 &&
          (this.normalizeFieldName(field.field_name) === 'photo' ||
            this.normalizeFieldName(field.field_name) === 'photos'),
      );

      if (previewSheet.name === 'ROOM INFOR') {
        const resolvedOutputDir = this.findProjectOutputDir();
        console.log(
          `[Lark7Nights Preview] outputDir=${resolvedOutputDir || 'NULL'} | originalName=${originalName} | bundleRelativePath=${bundleRelativePath || ''} | photoField=${photoField ? `${photoField.field_name}(type=${photoField.type})` : 'NOT_FOUND'}`,
        );
      }

      for (const row of previewSheet.rows) {
        const sourceRow = sourceSheet.rows.find((item) => item.excelRow === row.excelRow);
        if (!sourceRow) continue;

        if (primary && !row.errors.length) {
          const code = String(this.valueForField(row.values, primary) ?? '').trim();
          const map = previewSheet.name === 'Building Infor'
            ? references.building
            : references.host;
          const action = map.has(this.normalizeKey(code)) ? 'sẽ cập nhật' : 'sẽ tạo mới';
          row.systemActions.push(`${primary.field_name} "${code}" ${action} trước khi đồng bộ phòng.`);
        }

        if (previewSheet.name !== 'ROOM INFOR') continue;
        if (!row.errors.length) {
          for (const relation of this.roomRelations(fields)) {
            const kind = this.roomRelationKind(relation);
            if (!kind) continue;
            const code = String(this.valueForField(row.values, relation) ?? '').trim();
            const map = kind === 'building' ? references.building : references.host;
            if (!code) continue;
            row.systemActions.push(
              map.has(this.normalizeKey(code))
                ? `${relation.field_name}: sẽ dùng record_id hiện có.`
                : `${relation.field_name}: sẽ map record_id sau khi upsert bảng danh mục.`,
            );
          }
        }
        const existingRoomId = this.findRoomExistingRecordId(
          sourceRow.values,
          fields,
          references,
        );
        row.syncAction = existingRoomId ? 'update' : 'create';
        row.systemActions.push(
          existingRoomId
            ? `Upsert: sẽ CẬP NHẬT bản ghi hiện có (${existingRoomId}).`
            : 'Upsert: sẽ TẠO MỚI trên Lark Base.',
        );

        const roomCode = this.extractRoomCode(sourceRow.values);
        const photoCellText = this.extractPhotoCellText(sourceRow.values);
        const resolvedDir =
          (photoSourceDir
            ? this.resolveRoomDirInBundle(photoSourceDir, roomCode, photoCellText)
            : null) ||
          this.resolveRoomPhotosDir(
            originalName,
            roomCode,
            photoCellText,
            bundleRelativePath,
          );
        const photos = resolvedDir ? this.getPhotoFilesInDir(resolvedDir) : [];
        row.photoFound = Boolean(resolvedDir && photos.length > 0);
        row.photoCount = photos.length;

        if (photoField) {
          row.systemActions.push(
            photos.length
              ? `Photo: tìm thấy ${photos.length} ảnh local (${path.basename(path.dirname(path.dirname(resolvedDir!)))}/Photos/${path.basename(resolvedDir!)}).`
              : 'Photo: không tìm thấy thư mục ảnh local; trường sẽ để trống.',
          );
        } else if (photos.length > 0) {
          row.systemActions.push(
            `Photo: tìm thấy ${photos.length} ảnh local (lưu ý: cột Photo trên Lark chưa phải kiểu Attachment type=17).`,
          );
        }
      }
    }
  }

  private async getRecords(tableId: string): Promise<LarkRecord[]> {
    const records: LarkRecord[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ page_size: String(MAX_BATCH_SIZE) });
      if (pageToken) query.set('page_token', pageToken);
      const page = await this.larkRequest<LarkPage<LarkRecord>>(
        `/bitable/v1/apps/${encodeURIComponent(this.getConfig().appToken)}/tables/${encodeURIComponent(tableId)}/records/search?${query}`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      records.push(...(page.items || page.records || []));
      pageToken = page.has_more ? page.page_token : undefined;
    } while (pageToken);
    return records;
  }

  private findWorkbookBundleDir(
    originalName: string,
    workbook: Buffer,
  ): string | undefined {
    const outputDir = this.findProjectOutputDir();
    if (!outputDir || !fs.existsSync(outputDir)) return undefined;
    const workbookName = path.basename(originalName);
    const expectedHash = createHash('sha256').update(workbook).digest('hex');
    const candidates = [outputDir];
    for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(outputDir, entry.name));
    }

    for (const directory of candidates) {
      const workbookPath = path.resolve(directory, workbookName);
      if (!this.isPathInside(outputDir, workbookPath) || !fs.existsSync(workbookPath)) {
        continue;
      }
      const stat = fs.statSync(workbookPath);
      if (!stat.isFile() || stat.size !== workbook.length) continue;
      const fileHash = createHash('sha256').update(fs.readFileSync(workbookPath)).digest('hex');
      if (fileHash !== expectedHash) continue;
      const photosPath = path.join(directory, 'Photos');
      if (fs.existsSync(photosPath) && fs.statSync(photosPath).isDirectory()) {
        return directory;
      }
    }
    return undefined;
  }

  private findProjectOutputDir(): string | null {
    const rootsToProbe = [process.cwd(), __dirname];
    for (const startDir of rootsToProbe) {
      let current = path.resolve(startDir);
      for (let depth = 0; depth <= 4; depth++) {
        const hasRepoRootMarker =
          fs.existsSync(path.join(current, 'backend')) &&
          (fs.existsSync(path.join(current, 'frontend')) ||
            fs.existsSync(path.join(current, 'package.json')));
        const candidateOutput = path.join(current, 'output');
        if (
          hasRepoRootMarker &&
          fs.existsSync(candidateOutput) &&
          fs.statSync(candidateOutput).isDirectory()
        ) {
          return candidateOutput;
        }
        if (this.appConfig.outputDir && !path.isAbsolute(this.appConfig.outputDir)) {
          const configuredRel = path.resolve(current, this.appConfig.outputDir);
          if (
            hasRepoRootMarker &&
            fs.existsSync(configuredRel) &&
            fs.statSync(configuredRel).isDirectory()
          ) {
            return configuredRel;
          }
        }
        const parent = path.resolve(current, '..');
        if (parent === current) break;
        current = parent;
      }
    }

    if (this.appConfig.outputDir) {
      const fallback = path.resolve(this.appConfig.outputDir);
      if (fs.existsSync(fallback) && fs.statSync(fallback).isDirectory()) {
        return fallback;
      }
    }
    return null;
  }

  listOutputExcelFiles(): Array<{
    relativePath: string;
    fileName: string;
    bundleFolder: string;
    size: number;
    mtimeMs: number;
    updatedAt: string;
  }> {
    const outputDir = this.findProjectOutputDir();
    if (!outputDir) return [];

    const results: Array<{
      relativePath: string;
      fileName: string;
      bundleFolder: string;
      size: number;
      mtimeMs: number;
      updatedAt: string;
    }> = [];

    for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const bundleDir = path.join(outputDir, entry.name);
        for (const f of fs.readdirSync(bundleDir, { withFileTypes: true })) {
          if (f.isFile() && /\.(xlsx|xls)$/i.test(f.name) && /^7Nights_Global_/i.test(f.name)) {
            const fullPath = path.join(bundleDir, f.name);
            const stat = fs.statSync(fullPath);
            results.push({
              relativePath: `${entry.name}/${f.name}`,
              fileName: f.name,
              bundleFolder: entry.name,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              updatedAt: stat.mtime.toISOString(),
            });
          }
        }
      } else if (entry.isFile() && /\.(xlsx|xls)$/i.test(entry.name)) {
        const fullPath = path.join(outputDir, entry.name);
        const stat = fs.statSync(fullPath);
        results.push({
          relativePath: entry.name,
          fileName: entry.name,
          bundleFolder: '(output root)',
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    }

    return results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  readOutputExcelFile(relativePath: string): { fileName: string; buffer: Buffer } {
    const outputDir = this.findProjectOutputDir();
    if (!outputDir) {
      throw new BadRequestException('Không tìm thấy thư mục output/ của dự án.');
    }
    const cleanRel = String(relativePath || '').replace(/^[\\/]+/, '');
    const targetPath = path.resolve(outputDir, cleanRel);
    if (!this.isPathInside(outputDir, targetPath) || !fs.existsSync(targetPath)) {
      throw new BadRequestException('File Excel không tồn tại trong thư mục output/.');
    }
    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) {
      throw new BadRequestException('Đường dẫn không phải file hợp lệ.');
    }
    return {
      fileName: path.basename(targetPath),
      buffer: fs.readFileSync(targetPath),
    };
  }

  private extractRoomCode(values: Record<string, unknown>): string {
    const roomCodeEntry = Object.entries(values).find(
      ([header]) => this.normalizeFieldName(header) === 'roomcode',
    );
    return path.basename(String(roomCodeEntry?.[1] ?? '').trim());
  }

  private extractPhotoCellText(values: Record<string, unknown>): string {
    const photoEntry = Object.entries(values).find(
      ([header]) => this.normalizeFieldName(header) === 'photo',
    );
    return String(photoEntry?.[1] ?? '').trim();
  }

  private extractCleanRelPhotoPath(photoCellText?: string): string | null {
    const raw = String(photoCellText || '').trim();
    if (!raw) return null;
    const withoutParen = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const cleaned = withoutParen.replace(/^[\\/]+|[\\/]+$/g, '');
    if (!cleaned || cleaned.includes('..')) return null;
    const normalized = path.normalize(cleaned);
    if (!/(?:^|[\\/])Photos(?:[\\/]|$)/i.test(normalized) && !/^Photos/i.test(normalized)) {
      return null;
    }
    return normalized;
  }

  private resolveRoomDirInBundle(
    bundleDir: string,
    roomCode: string,
    photoCellText?: string,
  ): string | null {
    // 1. Thử ghép trực tiếp với relPhotoPath từ ô Photo (vd: Photos/ZIZELSUITE-001)
    const relPhotoPath = this.extractCleanRelPhotoPath(photoCellText);
    if (relPhotoPath) {
      const directRel = path.resolve(bundleDir, relPhotoPath);
      if (
        this.isPathInside(bundleDir, directRel) &&
        fs.existsSync(directRel) &&
        fs.statSync(directRel).isDirectory() &&
        this.getPhotoFilesInDir(directRel).length > 0
      ) {
        return directRel;
      }
    }

    // 2. Kiểm tra trong <bundleDir>/Photos/<roomCode> (khớp chính xác hoặc không phân biệt hoa/thường)
    const photosRoot = path.resolve(bundleDir, 'Photos');
    if (!fs.existsSync(photosRoot) || !fs.statSync(photosRoot).isDirectory()) return null;

    const cleanRoomCode = path.basename(String(roomCode || '').trim());
    if (!cleanRoomCode || cleanRoomCode === '.' || cleanRoomCode === path.sep) return null;

    const exactDir = path.resolve(photosRoot, cleanRoomCode);
    if (
      this.isPathInside(photosRoot, exactDir) &&
      fs.existsSync(exactDir) &&
      fs.statSync(exactDir).isDirectory() &&
      this.getPhotoFilesInDir(exactDir).length > 0
    ) {
      return exactDir;
    }

    const lowerTarget = cleanRoomCode.toLowerCase();
    for (const sub of fs.readdirSync(photosRoot, { withFileTypes: true })) {
      if (sub.isDirectory() && sub.name.toLowerCase() === lowerTarget) {
        const matched = path.join(photosRoot, sub.name);
        if (this.getPhotoFilesInDir(matched).length > 0) return matched;
      }
    }
    return null;
  }

  /**
   * Dò tìm thông minh thư mục ảnh của từng phòng theo đường dẫn tương đối từ <REPO_ROOT>/output:
   * - Bước A: Tách relPhotoPath sạch từ ô Photo (vd: "Photos/ZIZELSUITE-001/ (5 photos)" -> "Photos/ZIZELSUITE-001")
   * - Bước B: Chuẩn hóa tên file Excel (bỏ .xlsx/.xls, bỏ " (1)", bỏ "_HH-mm") & xếp hạng thư mục trong output/
   * - Bước C: Kiểm tra path.join(bundleDir, relPhotoPath) rồi path.join(bundleDir, 'Photos', roomCode)
   */
  resolveRoomPhotosDir(
    excelOriginalName: string,
    roomCode: string,
    photoCellText?: string,
    bundleRelativePath?: string,
  ): string | null {
    const outputDir = this.findProjectOutputDir();
    if (!outputDir) return null;

    // Ưu tiên 0: Nếu người dùng chọn trực tiếp từ dropdown output/ (có bundleRelativePath)
    if (bundleRelativePath && bundleRelativePath.trim()) {
      const parts = bundleRelativePath.trim().split(/[\\/]/).filter(Boolean);
      if (parts.length >= 2) {
        const explicitBundleDir = path.resolve(outputDir, parts[0]);
        if (
          this.isPathInside(outputDir, explicitBundleDir) &&
          fs.existsSync(explicitBundleDir) &&
          fs.statSync(explicitBundleDir).isDirectory()
        ) {
          const hit = this.resolveRoomDirInBundle(explicitBundleDir, roomCode, photoCellText);
          if (hit) return hit;
        }
      }
    }

    const baseName = path
      .basename(excelOriginalName || '')
      .replace(/\.(xlsx|xls)$/i, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/_\d{2}-\d{2}$/, '')
      .trim()
      .toLowerCase();

    const subDirs = fs
      .readdirSync(outputDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const fullPath = path.join(outputDir, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(fullPath).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        return { name: entry.name, fullPath, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const priorityMatched: typeof subDirs = [];
    const fallbackOthers: typeof subDirs = [];
    for (const d of subDirs) {
      const dn = d.name.toLowerCase();
      if (
        baseName &&
        (dn === baseName || dn.startsWith(baseName) || dn.includes(baseName) || baseName.startsWith(dn))
      ) {
        priorityMatched.push(d);
      } else {
        fallbackOthers.push(d);
      }
    }

    for (const dir of [...priorityMatched, ...fallbackOthers]) {
      const hit = this.resolveRoomDirInBundle(dir.fullPath, roomCode, photoCellText);
      if (hit) return hit;
    }

    // Dự phòng cuối: trường hợp giải nén phẳng trực tiếp dưới outputDir/Photos/<roomCode>
    return this.resolveRoomDirInBundle(outputDir, roomCode, photoCellText);
  }

  private getPhotoFilesInDir(roomDir: string): PhotoFile[] {
    if (!fs.existsSync(roomDir) || !fs.statSync(roomDir).isDirectory()) return [];
    return fs
      .readdirSync(roomDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name),
      )
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }),
      )
      .map((entry) => ({ path: path.join(roomDir, entry.name), name: entry.name }));
  }

  private isPathInside(parent: string, target: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(target));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }

  async uploadImageToLarkDrive(filePath: string, fileName: string): Promise<string> {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || !stat.size || stat.size > 20 * 1024 * 1024) {
      throw new BadRequestException(`Ảnh "${fileName}" rỗng hoặc vượt quá 20 MB.`);
    }
    const fileBuffer = fs.readFileSync(filePath);
    const config = this.getConfig();
    const form = new FormData();
    form.append('file_name', fileName);
    form.append('parent_type', 'bitable_file');
    form.append('parent_node', config.appToken);
    form.append('size', String(stat.size));
    form.append(
      'file',
      new Blob([Uint8Array.from(fileBuffer)], { type: this.photoMimeType(fileName) }),
      fileName,
    );

    const token = await this.getTenantAccessToken();
    const response = await fetch(`${LARK_API_BASE}/drive/v1/files/upload_all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const payload = await this.readJson<LarkEnvelope<{ file_token: string }>>(response);
    if (!response.ok || payload.code !== 0 || !payload.data?.file_token) {
      throw new LarkApiError(
        `code=${payload.code ?? response.status}, msg=${payload.msg || response.statusText}`,
        payload,
      );
    }
    return payload.data.file_token;
  }

  private photoMimeType(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.gif') return 'image/gif';
    if (extension === '.heic') return 'image/heic';
    return 'image/jpeg';
  }

  private async larkRequest<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = await this.getTenantAccessToken();
    const response = await fetch(`${LARK_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        ...init.headers,
      },
    });
    const payload = await this.readJson<LarkEnvelope<T>>(response);
    if (!response.ok || payload.code !== 0 || !payload.data) {
      throw new LarkApiError(
        `Lark API ${response.status}: ${payload.msg || response.statusText}`,
        payload,
      );
    }
    await this.delay(REQUEST_DELAY_MS);
    return payload.data;
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.tenantAccessToken;
    }
    const config = this.getConfig();
    const response = await fetch(
      `${LARK_API_BASE}/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          app_id: config.appId,
          app_secret: config.appSecret,
        }),
      },
    );
    const payload = await this.readJson<LarkTokenResponse>(response);
    if (payload.code !== 0 || !payload.tenant_access_token) {
      throw new LarkApiError(
        `Không lấy được Tenant Access Token: ${payload.msg || response.statusText}`,
        payload,
      );
    }
    this.tenantAccessToken = payload.tenant_access_token;
    this.tokenExpiresAt =
      Date.now() + Math.max(60, (payload.expire || 3600) - 60) * 1000;
    return this.tenantAccessToken;
  }

  private async readJson<T>(response: globalThis.Response): Promise<T> {
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new LarkApiError(
        `Lark trả phản hồi không phải JSON (HTTP ${response.status}): ${text.slice(0, 1000)}`,
        text,
      );
    }
  }

  private getConfig(): LarkConfig {
    const config: LarkConfig = {
      appId: this.configService.get<string>('LARK_APP_ID') || '',
      appSecret: this.configService.get<string>('LARK_APP_SECRET') || '',
      appToken: this.configService.get<string>('LARK_7NIGHTS_APP_TOKEN') || '',
      tables: {
        'Building Infor': this.configService.get<string>('LARK_TABLE_BUILDING') || '',
        'Host Infor': this.configService.get<string>('LARK_TABLE_HOST') || '',
        'ROOM INFOR': this.configService.get<string>('LARK_TABLE_ROOM') || '',
      },
    };
    const missing = [
      !config.appId && 'LARK_APP_ID',
      !config.appSecret && 'LARK_APP_SECRET',
      !config.appToken && 'LARK_7NIGHTS_APP_TOKEN',
      !config.tables['Building Infor'] && 'LARK_TABLE_BUILDING',
      !config.tables['Host Infor'] && 'LARK_TABLE_HOST',
      !config.tables['ROOM INFOR'] && 'LARK_TABLE_ROOM',
    ].filter(Boolean);
    if (missing.length) {
      throw new ServiceUnavailableException(
        `Thiếu cấu hình Lark: ${missing.join(', ')}. Hãy bổ sung vào file .env.`,
      );
    }
    return config;
  }

  private addLog(job: SevenNightsJob, message: string): void {
    const line = `[${new Date().toLocaleTimeString('vi-VN', { hour12: false })}] ${message}`;
    job.logs.push(line);
    this.broadcast(job, 'log', line);
  }

  private broadcast(job: SevenNightsJob, event: string, data: unknown): void {
    for (const client of job.clients) {
      if (!client.writableEnded) this.sendSse(client, event, data);
    }
  }

  private normalizeKey(value: string): string {
    return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private normalizeFieldName(value: string): string {
    const normalized = this.normalizeKey(value.trim());
    return normalized === 'buidingcode' ? 'buildingcode' : normalized;
  }

  private valueForField(
    values: Record<string, unknown>,
    field: LarkField,
  ): unknown {
    const key = Object.keys(values).find(
      (header) => this.normalizeFieldName(header) === this.normalizeFieldName(field.field_name),
    );
    return key ? values[key] : undefined;
  }

  private isBlank(value: unknown): boolean {
    return value === undefined || value === null || String(value).trim() === '';
  }

  private extractLarkCellText(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string' || typeof val === 'number') {
      return String(val).trim();
    }
    if (Array.isArray(val)) {
      return val.map((item) => this.extractLarkCellText(item)).filter(Boolean).join(',');
    }
    if (typeof val === 'object') {
      if ('text' in val && val.text !== null && val.text !== undefined) {
        return this.extractLarkCellText(val.text);
      }
      if ('value' in val) return this.extractLarkCellText(val.value);
    }
    const fallback = JSON.stringify(val);
    return typeof fallback === 'string' ? fallback.trim() : '';
  }

  private parseMultiSelect(value: unknown): string[] {
    const values = Array.isArray(value) ? value : String(value).split(/[;,]/);
    return values.map((item) => String(item).trim()).filter(Boolean);
  }

  private rowCode(row: SevenNightsPreviewRow): string {
    const entry = Object.entries(row.values).find(([header]) =>
      this.normalizeKey(header).includes('roomcode'),
    );
    if (entry?.[1]) return String(entry[1]);
    const fallback = Object.entries(row.values).find(([header]) =>
      /code/i.test(header),
    );
    return fallback?.[1] ? String(fallback[1]) : 'mã không xác định';
  }

  private errorMessage(error: unknown): string {
    if (error instanceof LarkApiError) {
      return `${error.message}; response.data=${JSON.stringify(error.responseData)}`;
    }
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
