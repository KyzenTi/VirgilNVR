import type {
  AudioMode,
  ChannelAccessMode,
  ChannelDto,
  ExecutionLogDto,
  RecordingDto,
  SafeUser,
  ScheduleDto,
  StorageStatsDto,
  StreamTestResult,
  SystemSettingsDto,
  UserRole,
} from './types';

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'VigilLocal');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }

  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : `Erro HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }

  return data as T;
}

export const api = {
  // Auth
  getAuthStatus: () => request<{ needsSetup: boolean; user: SafeUser | null }>('/api/auth/status'),
  setupAdmin: (payload: { username: string; email: string; password: string }) =>
    request<{ user: SafeUser }>('/api/auth/setup', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { identifier: string; password: string }) =>
    request<{ user: SafeUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Dashboard
  getDashboard: () =>
    request<{
      channels: ChannelDto[];
      recentRecordings: RecordingDto[];
      storage: StorageStatsDto;
      activeCaptureCount: number;
    }>('/api/dashboard'),

  // Channels
  getChannels: () => request<{ channels: ChannelDto[] }>('/api/channels'),
  createChannel: (payload: {
    name: string;
    rtsp_uri_mode: 'structured' | 'raw';
    rtsp_host?: string;
    rtsp_port?: number;
    rtsp_path?: string;
    rtsp_user?: string;
    rtsp_password?: string;
    raw_uri?: string;
    audio_mode: AudioMode;
    active: boolean;
  }) => request<{ channel: ChannelDto }>('/api/channels', { method: 'POST', body: JSON.stringify(payload) }),
  updateChannel: (
    id: number,
    payload: Partial<{
      name: string;
      rtsp_uri_mode: 'structured' | 'raw';
      rtsp_host: string;
      rtsp_port: number;
      rtsp_path: string;
      rtsp_user: string;
      rtsp_password: string;
      raw_uri: string;
      audio_mode: AudioMode;
      active: boolean;
    }>
  ) => request<{ channel: ChannelDto }>(`/api/channels/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteChannel: (id: number) => request<{ ok: boolean }>(`/api/channels/${id}`, { method: 'DELETE' }),
  testChannel: (id: number) => request<StreamTestResult>(`/api/channels/${id}/test`, { method: 'POST' }),
  startCapture: (id: number, duration_sec: number) =>
    request<{ ok: boolean; recordingId: number; durationSec: number }>(`/api/channels/${id}/capture/start`, {
      method: 'POST',
      body: JSON.stringify({ duration_sec }),
    }),
  stopCapture: (id: number) =>
    request<{ ok: boolean; message: string }>(`/api/channels/${id}/capture/stop`, { method: 'POST' }),

  // Schedules
  getSchedules: () => request<{ schedules: ScheduleDto[] }>('/api/schedules'),
  createSchedule: (payload: {
    channel_id: number;
    label: string;
    days_of_week: number[];
    start_time: string;
    end_time: string;
    duration_sec: number;
    active: boolean;
  }) => request<{ schedule: ScheduleDto }>('/api/schedules', { method: 'POST', body: JSON.stringify(payload) }),
  updateSchedule: (
    id: number,
    payload: Partial<{
      channel_id: number;
      label: string;
      days_of_week: number[];
      start_time: string;
      end_time: string;
      duration_sec: number;
      active: boolean;
    }>
  ) => request<{ schedule: ScheduleDto }>(`/api/schedules/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSchedule: (id: number) => request<{ ok: boolean }>(`/api/schedules/${id}`, { method: 'DELETE' }),

  // Recordings
  getRecordings: (params: { channelId?: number; date?: string; from?: string; to?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.channelId !== undefined) q.set('channelId', String(params.channelId));
    if (params.date) q.set('date', params.date);
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.limit) q.set('limit', String(params.limit));
    return request<{ recordings: RecordingDto[] }>(`/api/recordings?${q.toString()}`);
  },
  deleteRecording: (id: number) => request<{ ok: boolean; freedBytes: number }>(`/api/recordings/${id}`, { method: 'DELETE' }),

  // Settings & Retention
  getSettings: () => request<SystemSettingsDto>('/api/settings'),
  updateSettings: (payload: {
    retention_days?: number;
    max_disk_percent?: number;
    viewer_default_all_channels?: boolean;
  }) => request<SystemSettingsDto>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  runRetention: () =>
    request<{
      summary: { deletedByAge: number; deletedByDiskLimit: number; freedBytes: number; diskUsedPercentAfter: number };
      storage: StorageStatsDto;
    }>('/api/retention/run', { method: 'POST' }),

  // Users
  getUsers: () => request<{ users: SafeUser[] }>('/api/users'),
  createUser: (payload: {
    username: string;
    email: string;
    password: string;
    role: UserRole;
    channel_access_mode: ChannelAccessMode;
    allowed_channel_ids: number[];
    active: boolean;
  }) => request<{ user: SafeUser }>('/api/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (
    id: number,
    payload: Partial<{
      username: string;
      email: string;
      password: string;
      role: UserRole;
      channel_access_mode: ChannelAccessMode;
      allowed_channel_ids: number[];
      active: boolean;
    }>
  ) => request<{ user: SafeUser }>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteUser: (id: number) => request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),

  // Logs
  getLogs: (params?: { level?: string; source?: string }) => {
    const q = new URLSearchParams();
    if (params?.level) q.set('level', params.level);
    if (params?.source) q.set('source', params.source);
    return request<{ logs: ExecutionLogDto[] }>(`/api/logs?${q.toString()}`);
  },
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function formatLocalDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatLocalTimeOnly(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function getTodayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
