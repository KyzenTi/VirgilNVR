import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

const ephemeralSessionSecret = crypto.randomBytes(32).toString('hex');
const ephemeralRtspKey = crypto.randomBytes(32);

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = Number.parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveRtspKey(): Buffer {
  const raw = process.env.RTSP_ENCRYPTION_KEY?.trim();
  if (raw && raw.length > 0) {
    return crypto.createHash('sha256').update(raw).digest();
  }
  const fallbackSecret = process.env.SESSION_SECRET?.trim();
  if (fallbackSecret && fallbackSecret.length > 0) {
    return crypto.createHash('sha256').update(`rtsp:${fallbackSecret}`).digest();
  }
  return ephemeralRtspKey;
}

export const config = {
  port: parsePositiveInt(process.env.PORT, 3000),
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR || './data'),
  storageRoot: path.resolve(process.cwd(), process.env.STORAGE_ROOT || './recordings'),
  defaultRetentionDays: parsePositiveInt(process.env.RETENTION_DAYS, 90),
  defaultMaxDiskPercent: Math.min(98, Math.max(50, parsePositiveInt(process.env.MAX_DISK_PERCENT, 85))),
  defaultViewerAllChannels: (process.env.VIEWER_DEFAULT_ALL_CHANNELS ?? 'true').toLowerCase() !== 'false',
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH?.trim() || 'ffprobe',
  sessionSecret: process.env.SESSION_SECRET?.trim() || ephemeralSessionSecret,
  rtspKey: resolveRtspKey(),
  adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD?.trim() || '',
  isProd: process.env.NODE_ENV === 'production',
};

export function ensureRuntimeDirectories(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.storageRoot, { recursive: true });
}
