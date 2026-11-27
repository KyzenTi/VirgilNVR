import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { db, addLog, getSetting, type RecordingRow, type ScheduleRow } from './db.ts';
import { isChannelRecording, startCapture } from './ffmpegManager.ts';

export interface StorageStats {
  storageRoot: string;
  diskTotalBytes: number;
  diskUsedBytes: number;
  diskFreeBytes: number;
  diskUsedPercent: number;
  nvrUsedBytes: number;
  nvrRecordingCount: number;
  retentionDays: number;
  maxDiskPercent: number;
}

export interface RetentionRunSummary {
  deletedByAge: number;
  deletedByDiskLimit: number;
  freedBytes: number;
  diskUsedPercentAfter: number;
}

let schedulerInterval: NodeJS.Timeout | null = null;
let retentionInterval: NodeJS.Timeout | null = null;

export function isPathInsideStorage(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(config.storageRoot + path.sep);
}

export function reconcileRecordingFile(rec: RecordingRow): boolean {
  if (rec.status === 'deleted' || rec.status === 'failed') {
    return false;
  }
  if (rec.status === 'recording') {
    return true;
  }

  if (!isPathInsideStorage(rec.file_path)) {
    db.prepare("UPDATE recordings SET status = 'deleted', file_size_bytes = 0 WHERE id = ?").run(rec.id);
    return false;
  }

  try {
    const stat = fs.statSync(rec.file_path);
    if (!stat.isFile() || stat.size <= 0) {
      db.prepare("UPDATE recordings SET status = 'deleted', file_size_bytes = 0 WHERE id = ?").run(rec.id);
      return false;
    }
    if (stat.size !== rec.file_size_bytes) {
      db.prepare('UPDATE recordings SET file_size_bytes = ? WHERE id = ?').run(stat.size, rec.id);
      rec.file_size_bytes = stat.size;
    }
    return true;
  } catch {
    db.prepare("UPDATE recordings SET status = 'deleted', file_size_bytes = 0 WHERE id = ?").run(rec.id);
    return false;
  }
}

export function reconcileRecordingsList(rows: RecordingRow[]): RecordingRow[] {
  return rows.filter((rec) => reconcileRecordingFile(rec));
}

export function getStorageStats(): StorageStats {
  let diskTotalBytes = 0;
  let diskFreeBytes = 0;
  let diskUsedBytes = 0;
  let diskUsedPercent = 0;

  try {
    fs.mkdirSync(config.storageRoot, { recursive: true });
    const stats = fs.statfsSync(config.storageRoot);
    const bsize = Number(stats.bsize);
    diskTotalBytes = Number(stats.blocks) * bsize;
    const availBytes = Number(stats.bavail) * bsize;
    const freeBytes = Number(stats.bfree) * bsize;
    diskFreeBytes = availBytes;
    diskUsedBytes = Math.max(0, diskTotalBytes - freeBytes);
    diskUsedPercent = diskTotalBytes > 0 ? Math.round((diskUsedBytes / diskTotalBytes) * 1000) / 10 : 0;
  } catch {
    // Fallback gracefully if statfs fails
  }

  const agg = db
    .prepare(
      "SELECT COUNT(*) as cnt, COALESCE(SUM(file_size_bytes), 0) as total_bytes FROM recordings WHERE status IN ('completed', 'interrupted', 'recording')"
    )
    .get() as { cnt: number; total_bytes: number };

  const retentionDays = Number.parseInt(getSetting('retention_days', String(config.defaultRetentionDays)), 10) || config.defaultRetentionDays;
  const maxDiskPercent = Number.parseInt(getSetting('max_disk_percent', String(config.defaultMaxDiskPercent)), 10) || config.defaultMaxDiskPercent;

  return {
    storageRoot: config.storageRoot,
    diskTotalBytes,
    diskUsedBytes,
    diskFreeBytes,
    diskUsedPercent,
    nvrUsedBytes: agg.total_bytes,
    nvrRecordingCount: agg.cnt,
    retentionDays,
    maxDiskPercent,
  };
}

function removeEmptyParentDirs(filePath: string): void {
  try {
    let dir = path.dirname(filePath);
    while (dir.startsWith(config.storageRoot + path.sep)) {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      } else {
        break;
      }
    }
  } catch {
    // ignore cleanup error
  }
}

export function deleteRecordingFromDiskAndDb(rec: RecordingRow): number {
  let freed = 0;
  if (isPathInsideStorage(rec.file_path)) {
    try {
      const stat = fs.statSync(rec.file_path);
      if (stat.isFile()) {
        freed = stat.size;
        fs.unlinkSync(rec.file_path);
        removeEmptyParentDirs(rec.file_path);
      }
    } catch {
      // already absent
    }
  }
  db.prepare("UPDATE recordings SET status = 'deleted', file_size_bytes = 0 WHERE id = ?").run(rec.id);
  return freed;
}

export function runRetentionCleanup(): RetentionRunSummary {
  const retentionDays = Math.max(1, Number.parseInt(getSetting('retention_days', String(config.defaultRetentionDays)), 10) || config.defaultRetentionDays);
  const maxDiskPercent = Math.min(98, Math.max(50, Number.parseInt(getSetting('max_disk_percent', String(config.defaultMaxDiskPercent)), 10) || config.defaultMaxDiskPercent));

  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const expiredRows = db
    .prepare(
      "SELECT * FROM recordings WHERE status IN ('completed', 'interrupted') AND start_time < ? ORDER BY start_time ASC"
    )
    .all(cutoffIso) as RecordingRow[];

  let deletedByAge = 0;
  let freedBytes = 0;

  for (const row of expiredRows) {
    freedBytes += deleteRecordingFromDiskAndDb(row);
    deletedByAge++;
  }

  let deletedByDiskLimit = 0;
  let stats = getStorageStats();

  // Safety guard: prune oldest recordings in small batches while local volume exceeds maxDiskPercent
  while (stats.diskTotalBytes > 0 && stats.diskUsedPercent >= maxDiskPercent) {
    const oldestBatch = db
      .prepare(
        "SELECT * FROM recordings WHERE status IN ('completed', 'interrupted') ORDER BY start_time ASC LIMIT 10"
      )
      .all() as RecordingRow[];

    if (oldestBatch.length === 0) break;

    for (const row of oldestBatch) {
      freedBytes += deleteRecordingFromDiskAndDb(row);
      deletedByDiskLimit++;
    }
    stats = getStorageStats();
  }

  if (deletedByAge > 0 || deletedByDiskLimit > 0) {
    addLog(
      'info',
      'retention',
      null,
      `Retenção executada: ${deletedByAge} por idade (> ${retentionDays}d), ${deletedByDiskLimit} por trava de disco (>= ${maxDiskPercent}%). Liberados ${Math.round(freedBytes / (1024 * 1024))} MB.`
    );
  }

  return {
    deletedByAge,
    deletedByDiskLimit,
    freedBytes,
    diskUsedPercentAfter: stats.diskUsedPercent,
  };
}

function formatLocalHHMM(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatLocalMinuteKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d} ${formatLocalHHMM(date)}`;
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((v) => Number.parseInt(v, 10));
  return h * 60 + m;
}

export function evaluateSchedulesTick(): void {
  const now = new Date();
  const currentDay = now.getDay(); // 0=Sun..6=Sat
  const currentHHMM = formatLocalHHMM(now);
  const currentMinKey = formatLocalMinuteKey(now);

  const schedules = db
    .prepare(
      `SELECT s.*, c.name as channel_name
       FROM schedules s
       INNER JOIN channels c ON c.id = s.channel_id
       WHERE s.active = 1 AND c.active = 1`
    )
    .all() as Array<ScheduleRow & { channel_name: string }>;

  for (const sched of schedules) {
    let days: number[] = [];
    try {
      days = JSON.parse(sched.days_of_week) as number[];
    } catch {
      continue;
    }

    if (!days.includes(currentDay)) continue;
    if (sched.start_time !== currentHHMM) continue;
    if (sched.last_run_at === currentMinKey) continue;

    // Prevent launching a second process if channel is already recording
    if (isChannelRecording(sched.channel_id)) {
      db.prepare('UPDATE schedules SET last_run_at = ? WHERE id = ?').run(currentMinKey, sched.id);
      addLog(
        'warn',
        'scheduler',
        sched.channel_id,
        `Agendamento "${sched.label || sched.start_time}" ignorado: canal "${sched.channel_name}" já possui gravação ativa em curso.`
      );
      continue;
    }

    const windowSec = Math.max(60, (timeToMinutes(sched.end_time) - timeToMinutes(sched.start_time)) * 60);
    const effectiveDuration = Math.min(sched.duration_sec, windowSec);

    db.prepare('UPDATE schedules SET last_run_at = ? WHERE id = ?').run(currentMinKey, sched.id);
    startCapture(sched.channel_id, effectiveDuration, sched.id, false);
  }
}

export function startBackgroundWorkers(): void {
  if (!schedulerInterval) {
    evaluateSchedulesTick();
    schedulerInterval = setInterval(evaluateSchedulesTick, 15 * 1000);
  }
  if (!retentionInterval) {
    runRetentionCleanup();
    retentionInterval = setInterval(runRetentionCleanup, 15 * 60 * 1000);
  }
}

export function stopBackgroundWorkers(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (retentionInterval) {
    clearInterval(retentionInterval);
    retentionInterval = null;
  }
}
