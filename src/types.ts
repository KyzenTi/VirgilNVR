export type UserRole = 'admin' | 'viewer';
export type ChannelAccessMode = 'default' | 'restricted';
export type AudioMode = 'aac' | 'copy' | 'none';
export type ChannelStatus = 'idle' | 'recording' | 'error';
export type RecordingStatus = 'recording' | 'completed' | 'failed' | 'interrupted' | 'deleted';

export interface SafeUser {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  channel_access_mode: ChannelAccessMode;
  active: boolean;
  allowed_channel_ids: number[];
  created_at: string;
}

export interface ChannelDto {
  id: number;
  name: string;
  rtsp_uri_mode: 'structured' | 'raw';
  rtsp_host: string;
  rtsp_port: number;
  rtsp_path: string;
  rtsp_user: string;
  has_password: boolean;
  masked_uri: string;
  audio_mode: AudioMode;
  active: boolean;
  last_status: ChannelStatus;
  last_error: string | null;
  created_at: string;
  is_recording: boolean;
  active_recording_started_at: string | null;
  schedule_count?: number;
}

export interface ScheduleDto {
  id: number;
  channel_id: number;
  channel_name?: string;
  channel_active?: boolean;
  channel_recording?: boolean;
  label: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  duration_sec: number;
  active: boolean;
  last_run_at: string | null;
  created_at: string;
}

export interface RecordingDto {
  id: number;
  channel_id: number;
  channel_name?: string;
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

export interface StorageStatsDto {
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

export interface StreamTestResult {
  ok: boolean;
  message: string;
  videoCodec?: string;
  resolution?: string;
  hasAudio?: boolean;
  audioCodec?: string;
  recommendedAudioMode?: AudioMode;
}

export interface ExecutionLogDto {
  id: number;
  level: 'info' | 'warn' | 'error';
  source: 'ffmpeg' | 'scheduler' | 'retention' | 'auth' | 'system';
  channel_id: number | null;
  channel_name?: string | null;
  message: string;
  created_at: string;
}

export interface SystemSettingsDto {
  retention_days: number;
  max_disk_percent: number;
  viewer_default_all_channels: boolean;
  storage: StorageStatsDto;
}
