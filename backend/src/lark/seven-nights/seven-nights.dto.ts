export type SevenNightsSheetName = 'Building Infor' | 'Host Infor' | 'ROOM INFOR';

export interface SevenNightsPreviewRow {
  excelRow: number;
  values: Record<string, unknown>;
  errors: string[];
  systemActions: string[];
  photoCount?: number;
  photoFound?: boolean;
  syncAction?: 'create' | 'update';
}

export interface SevenNightsPreviewSheet {
  name: SevenNightsSheetName;
  headers: string[];
  rows: SevenNightsPreviewRow[];
}

export interface SevenNightsPreview {
  sheets: SevenNightsPreviewSheet[];
  errorCount: number;
  systemActions: string[];
}

export interface SevenNightsSyncStarted {
  jobId: string;
  status: 'running';
}
