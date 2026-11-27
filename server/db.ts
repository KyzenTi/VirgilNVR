import path from 'node:path';
import Database from 'better-sqlite3';
import { config, ensureRuntimeDirectories } from './config.ts';
import { hashPassword } from './crypto.ts';

export type UserRole = 'admin' | 'viewer';
export type ChannelAccessMode = 'default' | 'restricted';
export type AudioMode = 'aac' | 'copy' | 'none';
export type ChannelStatus = 'idle' | 'recording' | 'error';
export type RecordingStatus = 'recording' | 'completed' | 'failed' | 'interrupted' | 'deleted';
export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'ffmpeg' | 'scheduler' | 'retention' | 'auth' | 'system';

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: UserRole;
  channel_access_mode: ChannelAccessMode;
  active: number;
  created_at: string;
}

export interface ChannelRow {
  id: number;
  name: string;
  rtsp_host: string;
  rtsp_port: number;
  rtsp_path: string;
  rtsp_user: string;
  rtsp_password_enc: string;
  rtsp_uri_mode: 'structured' | 'raw';
  raw_uri_enc: string;
  audio_mode: AudioMode;
  active: number;
  last_status: ChannelStatus;
  last_error: string | null;
  created_at: string;
}

export interface ScheduleRow {
  id: number;
  channel_id: number;
  label: string;
  days_of_week: string;
  start_time: string;
  end_time: string;
  duration_sec: number;
  active: number;
  last_run_at: string | null;
  created_at: string;
}

export interface RecordingRow {
  id: number;
  channel_id: number;
  schedule_id: number | null;
  start_time: string;
  end_time: string | null;
  duration_sec: number;
  file_path: string;
  file_size_bytes: number;
  status: RecordingStatus;
  error_message: string | null;
  created_at: string;
}

export interface ExecutionLogRow {
  id: number;
  level: LogLevel;
  source: LogSource;
  channel_id: number | null;
  message: string;
  created_at: string;
}

ensureRuntimeDirectories();
const dbPath = path.join(config.dataDir, 'nvr.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    channel_access_mode TEXT NOT NULL DEFAULT 'default' CHECK (channel_access_mode IN ('default', 'restricted')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rtsp_host TEXT NOT NULL DEFAULT '',
    rtsp_port INTEGER NOT NULL DEFAULT 554,
    rtsp_path TEXT NOT NULL DEFAULT '',
    rtsp_user TEXT NOT NULL DEFAULT '',
    rtsp_password_enc TEXT NOT NULL DEFAULT '',
    rtsp_uri_mode TEXT NOT NULL DEFAULT 'structured' CHECK (rtsp_uri_mode IN ('structured', 'raw')),
    raw_uri_enc TEXT NOT NULL DEFAULT '',
    audio_mode TEXT NOT NULL DEFAULT 'aac' CHECK (audio_mode IN ('aac', 'copy', 'none')),
    active INTEGER NOT NULL DEFAULT 1,
    last_status TEXT NOT NULL DEFAULT 'idle' CHECK (last_status IN ('idle', 'recording', 'error')),
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_channel_permissions (
    user_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, channel_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    days_of_week TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    schedule_id INTEGER,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration_sec INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('recording', 'completed', 'failed', 'interrupted', 'deleted')),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_recordings_channel_start
    ON recordings (channel_id, start_time);

  CREATE INDEX IF NOT EXISTS idx_recordings_status_start
    ON recordings (status, start_time);

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    source TEXT NOT NULL CHECK (source IN ('ffmpeg', 'scheduler', 'retention', 'auth', 'system')),
    channel_id INTEGER,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_created
    ON execution_logs (created_at DESC);
`);

function seedDefaultSettings(): void {
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run('retention_days', String(config.defaultRetentionDays));
  insertSetting.run('max_disk_percent', String(config.defaultMaxDiskPercent));
  insertSetting.run('viewer_default_all_channels', config.defaultViewerAllChannels ? 'true' : 'false');
}

seedDefaultSettings();

// Clean up interrupted recordings left open by an unexpected process stop
export function recoverInterruptedRecordings(): void {
  const stale = db
    .prepare("UPDATE recordings SET status = 'interrupted', end_time = COALESCE(end_time, datetime('now')) WHERE status = 'recording'")
    .run();
  db.prepare("UPDATE channels SET last_status = 'idle' WHERE last_status = 'recording'").run();
  if (stale.changes > 0) {
    addLog('warn', 'system', null, `${stale.changes} gravação(ões) em andamento foram marcadas como interrompidas após reinicialização do serviço.`);
  }
}

export function getSetting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function addLog(
  level: LogLevel,
  source: LogSource,
  channelId: number | null,
  message: string
): void {
  db.prepare(
    'INSERT INTO execution_logs (level, source, channel_id, message, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(level, source, channelId, message.slice(0, 1000), new Date().toISOString());
}

export function bootstrapEnvAdminIfNeeded(): void {
  if (!config.adminInitialPassword) return;
  const adminCount = db
    .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND active = 1")
    .get() as { cnt: number };

  if (adminCount.cnt === 0) {
    const hash = hashPassword(config.adminInitialPassword);
    db.prepare(
      `INSERT INTO users (username, email, password_hash, role, channel_access_mode, active)
       VALUES ('admin', 'admin@local.nvr', ?, 'admin', 'default', 1)`
    ).run(hash);
    addLog('info', 'auth', null, 'Administrador inicial provisionado via variável ADMIN_INITIAL_PASSWORD.');
  }
}

export function getAuthorizedChannelIdsForUser(user: UserRow): number[] | null {
  if (user.role === 'admin') {
    return null; // null means unrestricted access to all channels
  }

  const explicitRows = db
    .prepare(
      `SELECT p.channel_id
       FROM user_channel_permissions p
       INNER JOIN channels c ON c.id = p.channel_id
       WHERE p.user_id = ? AND c.active = 1`
    )
    .all(user.id) as { channel_id: number }[];

  const viewerDefaultAll = getSetting('viewer_default_all_channels', 'true') === 'true';

  if (user.channel_access_mode === 'restricted' || explicitRows.length > 0 || !viewerDefaultAll) {
    return explicitRows.map((r) => r.channel_id);
  }

  const allActive = db
    .prepare('SELECT id FROM channels WHERE active = 1')
    .all() as { id: number }[];
  return allActive.map((c) => c.id);
}

export function userCanAccessChannel(user: UserRow, channelId: number): boolean {
  if (user.role === 'admin') return true;
  const allowed = getAuthorizedChannelIdsForUser(user);
  return allowed === null || allowed.includes(channelId);
}
