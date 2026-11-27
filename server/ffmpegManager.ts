import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { config } from './config.ts';
import { decryptSecret, maskRtspUri, scrubSecretsFromText } from './crypto.ts';
import { db, addLog, type AudioMode, type ChannelRow } from './db.ts';

export interface ActiveCapture {
  channelId: number;
  recordingId: number;
  process: ChildProcess;
  startedAt: string;
  durationSec: number;
  isManual: boolean;
  stopping: boolean;
  fallbackAttempted: boolean;
  filePath: string;
  watchdogTimer: NodeJS.Timeout;
}

export interface MaskedChannelDto {
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
  last_status: 'idle' | 'recording' | 'error';
  last_error: string | null;
  created_at: string;
  is_recording: boolean;
  active_recording_started_at: string | null;
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

const activeCaptures = new Map<number, ActiveCapture>();

function formatTimestampParts(date: Date): { dateDir: string; fileStamp: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return {
    dateDir: `${y}-${m}-${d}`,
    fileStamp: `${y}${m}${d}_${hh}${mm}${ss}`,
  };
}

export function buildRtspUrl(channel: ChannelRow): { url: string | null; error?: string } {
  if (channel.rtsp_uri_mode === 'raw') {
    const raw = decryptSecret(channel.raw_uri_enc);
    if (raw === null || !raw) {
      return { url: null, error: 'URI RTSP indisponível (reconfigure a credencial do canal).' };
    }
    if (!/^rtsps?:\/\//i.test(raw.trim())) {
      return { url: null, error: 'URI RTSP inválida: esquema deve ser rtsp:// ou rtsps://.' };
    }
    return { url: raw.trim() };
  }

  const host = channel.rtsp_host.trim();
  if (!host) {
    return { url: null, error: 'Host RTSP não configurado.' };
  }

  const port = channel.rtsp_port || 554;
  const cleanPath = channel.rtsp_path.trim().startsWith('/')
    ? channel.rtsp_path.trim()
    : `/${channel.rtsp_path.trim()}`;

  let authPart = '';
  if (channel.rtsp_user.trim()) {
    const userEnc = encodeURIComponent(channel.rtsp_user.trim());
    const pass = channel.rtsp_password_enc ? decryptSecret(channel.rtsp_password_enc) : '';
    if (pass === null) {
      return { url: null, error: 'Senha RTSP indisponível (reconfigure a senha do canal).' };
    }
    authPart = pass ? `${userEnc}:${encodeURIComponent(pass)}@` : `${userEnc}@`;
  }

  return { url: `rtsp://${authPart}${host}:${port}${cleanPath}` };
}

export function toMaskedChannelDto(channel: ChannelRow): MaskedChannelDto {
  let maskedUri = '';
  if (channel.rtsp_uri_mode === 'raw') {
    const raw = decryptSecret(channel.raw_uri_enc);
    maskedUri = raw ? maskRtspUri(raw) : 'rtsp://****@configurado';
  } else {
    const port = channel.rtsp_port || 554;
    const cleanPath = channel.rtsp_path.trim().startsWith('/')
      ? channel.rtsp_path.trim()
      : `/${channel.rtsp_path.trim()}`;
    const userPart = channel.rtsp_user.trim()
      ? channel.rtsp_password_enc
        ? `${channel.rtsp_user.trim()}:****@`
        : `${channel.rtsp_user.trim()}@`
      : '';
    maskedUri = `rtsp://${userPart}${channel.rtsp_host.trim()}:${port}${cleanPath}`;
  }

  const activeCap = activeCaptures.get(channel.id);
  const isRecording = Boolean(activeCap) || channel.last_status === 'recording';

  return {
    id: channel.id,
    name: channel.name,
    rtsp_uri_mode: channel.rtsp_uri_mode,
    rtsp_host: channel.rtsp_host,
    rtsp_port: channel.rtsp_port,
    rtsp_path: channel.rtsp_path,
    rtsp_user: channel.rtsp_user,
    has_password: Boolean(channel.rtsp_password_enc || channel.raw_uri_enc),
    masked_uri: maskedUri,
    audio_mode: channel.audio_mode,
    active: channel.active === 1,
    last_status: isRecording ? 'recording' : channel.last_status,
    last_error: channel.last_error,
    created_at: channel.created_at,
    is_recording: isRecording,
    active_recording_started_at: activeCap?.startedAt ?? null,
  };
}

export function isChannelRecording(channelId: number): boolean {
  if (activeCaptures.has(channelId)) {
    return true;
  }
  const dbRow = db
    .prepare("SELECT 1 FROM recordings WHERE channel_id = ? AND status = 'recording' LIMIT 1")
    .get(channelId);
  return Boolean(dbRow);
}

export function getActiveCaptureIds(): number[] {
  return Array.from(activeCaptures.keys());
}

function getAudioFlags(mode: AudioMode): string[] {
  if (mode === 'none') return ['-an'];
  if (mode === 'copy') return ['-c:a', 'copy'];
  return ['-c:a', 'aac'];
}

function isAudioRelatedFailure(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes('audio') ||
    lower.includes('aac') ||
    lower.includes('stream map') ||
    lower.includes('does not contain any stream') ||
    lower.includes('could not find tag for codec') ||
    lower.includes('conversion failed') ||
    lower.includes('codec not currently supported in container')
  );
}

function spawnFfmpegProcess(
  channel: ChannelRow,
  rtspUrl: string,
  durationSec: number,
  recordingId: number,
  filePath: string,
  startedAtIso: string,
  isManual: boolean,
  audioModeOverride: AudioMode | null,
  fallbackAttempted: boolean
): void {
  const effectiveAudioMode = audioModeOverride ?? channel.audio_mode;
  const audioFlags = getAudioFlags(effectiveAudioMode);

  const args = [
    '-y',
    '-loglevel',
    'error',
    '-rtsp_transport',
    'tcp',
    '-i',
    rtspUrl,
    '-t',
    String(durationSec),
    '-c:v',
    'copy',
    ...audioFlags,
    '-movflags',
    '+faststart',
    filePath,
  ];

  const child = spawn(config.ffmpegPath, args, {
    shell: false,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderrBuffer = '';
  child.stderr.on('data', (chunk: Buffer) => {
    if (stderrBuffer.length < 4096) {
      stderrBuffer += chunk.toString('utf8');
    }
  });

  const watchdogMs = (durationSec + 30) * 1000;
  const watchdogTimer = setTimeout(() => {
    const cap = activeCaptures.get(channel.id);
    if (cap && cap.process === child) {
      addLog('warn', 'ffmpeg', channel.id, `Watchdog encerrou processo FFmpeg excedendo ${durationSec + 30}s.`);
      cap.stopping = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 4000);
    }
  }, watchdogMs);

  const captureState: ActiveCapture = {
    channelId: channel.id,
    recordingId,
    process: child,
    startedAt: startedAtIso,
    durationSec,
    isManual,
    stopping: false,
    fallbackAttempted,
    filePath,
    watchdogTimer,
  };

  activeCaptures.set(channel.id, captureState);

  child.on('error', (err) => {
    clearTimeout(watchdogTimer);
    activeCaptures.delete(channel.id);
    const msg = scrubSecretsFromText(`Falha ao iniciar FFmpeg: ${err.message}`);
    db.prepare("UPDATE recordings SET status = 'failed', end_time = ?, error_message = ? WHERE id = ?")
      .run(new Date().toISOString(), msg, recordingId);
    db.prepare("UPDATE channels SET last_status = 'error', last_error = ? WHERE id = ?")
      .run(msg, channel.id);
    addLog('error', 'ffmpeg', channel.id, msg);
  });

  child.on('close', (code) => {
    clearTimeout(watchdogTimer);
    const current = activeCaptures.get(channel.id);
    const wasManualStop = current?.stopping ?? false;
    activeCaptures.delete(channel.id);

    const elapsedMs = Date.now() - new Date(startedAtIso).getTime();
    const cleanedStderr = scrubSecretsFromText(stderrBuffer.trim());

    // Automatic fallback from 'aac' to '-an' when audio stream is missing or incompatible
    if (
      !wasManualStop &&
      code !== 0 &&
      channel.audio_mode === 'aac' &&
      !fallbackAttempted &&
      elapsedMs < 20000 &&
      isAudioRelatedFailure(cleanedStderr)
    ) {
      addLog(
        'warn',
        'ffmpeg',
        channel.id,
        `Canal "${channel.name}": erro de áudio no modo 'aac' (${cleanedStderr || 'stream incompatível'}). Reexecutando automaticamente sem áudio (-an).`
      );
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore cleanup error
      }
      spawnFfmpegProcess(
        channel,
        rtspUrl,
        durationSec,
        recordingId,
        filePath,
        startedAtIso,
        isManual,
        'none',
        true
      );
      return;
    }

    const finishedIso = new Date().toISOString();
    let fileSize = 0;
    let fileValid = false;
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.size > 0) {
        fileSize = stat.size;
        fileValid = true;
      } else {
        fs.unlinkSync(filePath);
      }
    } catch {
      fileValid = false;
    }

    if (wasManualStop) {
      const actualSec = Math.max(1, Math.round(elapsedMs / 1000));
      if (fileValid) {
        db.prepare(
          "UPDATE recordings SET status = 'interrupted', end_time = ?, duration_sec = ?, file_size_bytes = ?, error_message = ? WHERE id = ?"
        ).run(finishedIso, actualSec, fileSize, 'Captura interrompida manualmente.', recordingId);
      } else {
        db.prepare(
          "UPDATE recordings SET status = 'failed', end_time = ?, file_size_bytes = 0, error_message = ? WHERE id = ?"
        ).run(finishedIso, 'Captura interrompida antes de gerar dados válidos.', recordingId);
      }
      db.prepare("UPDATE channels SET last_status = 'idle', last_error = NULL WHERE id = ?").run(channel.id);
      addLog('info', 'ffmpeg', channel.id, `Captura manual do canal "${channel.name}" interrompida (${fileValid ? `${fileSize} bytes salvos` : 'sem mídia'}).`);
      return;
    }

    if (code === 0 && fileValid) {
      db.prepare(
        "UPDATE recordings SET status = 'completed', end_time = ?, file_size_bytes = ?, error_message = NULL WHERE id = ?"
      ).run(finishedIso, fileSize, recordingId);
      db.prepare("UPDATE channels SET last_status = 'idle', last_error = NULL WHERE id = ?").run(channel.id);
      addLog(
        'info',
        'ffmpeg',
        channel.id,
        `Captura concluída para "${channel.name}" (${Math.round(fileSize / 1024)} KB${fallbackAttempted ? ', fallback sem áudio' : ''}).`
      );
    } else {
      const errMsg = cleanedStderr || `FFmpeg encerrou com código ${code ?? 'desconhecido'}.`;
      db.prepare(
        "UPDATE recordings SET status = 'failed', end_time = ?, file_size_bytes = 0, error_message = ? WHERE id = ?"
      ).run(finishedIso, errMsg, recordingId);
      db.prepare("UPDATE channels SET last_status = 'error', last_error = ? WHERE id = ?")
        .run(errMsg, channel.id);
      addLog('error', 'ffmpeg', channel.id, `Falha na captura de "${channel.name}": ${errMsg}`);
    }
  });
}

export function startCapture(
  channelId: number,
  durationSec: number,
  scheduleId: number | null,
  isManual: boolean
): { ok: boolean; recordingId?: number; error?: string; conflict?: boolean } {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as ChannelRow | undefined;
  if (!channel) {
    return { ok: false, error: 'Canal não encontrado.' };
  }
  if (!channel.active && !isManual) {
    return { ok: false, error: 'Canal está desativado.' };
  }
  if (isChannelRecording(channelId)) {
    return { ok: false, conflict: true, error: `Canal "${channel.name}" já possui uma gravação em andamento.` };
  }

  const rtspResult = buildRtspUrl(channel);
  if (!rtspResult.url) {
    const err = rtspResult.error || 'URI RTSP inválida.';
    db.prepare("UPDATE channels SET last_status = 'error', last_error = ? WHERE id = ?").run(err, channelId);
    addLog('error', 'ffmpeg', channelId, err);
    return { ok: false, error: err };
  }

  const now = new Date();
  const startedAtIso = now.toISOString();
  const { dateDir, fileStamp } = formatTimestampParts(now);

  const channelDir = path.resolve(config.storageRoot, String(channelId), dateDir);
  if (!channelDir.startsWith(config.storageRoot + path.sep)) {
    return { ok: false, error: 'Caminho de armazenamento inválido.' };
  }
  fs.mkdirSync(channelDir, { recursive: true });

  const fileName = `ch${channelId}_${fileStamp}_${durationSec}s.mp4`;
  const filePath = path.resolve(channelDir, fileName);
  if (!filePath.startsWith(config.storageRoot + path.sep)) {
    return { ok: false, error: 'Caminho de arquivo fora do diretório permitido.' };
  }

  const insertRes = db
    .prepare(
      `INSERT INTO recordings (channel_id, schedule_id, start_time, duration_sec, file_path, file_size_bytes, status)
       VALUES (?, ?, ?, ?, ?, 0, 'recording')`
    )
    .run(channelId, scheduleId, startedAtIso, durationSec, filePath);

  const recordingId = Number(insertRes.lastInsertRowid);
  db.prepare("UPDATE channels SET last_status = 'recording', last_error = NULL WHERE id = ?").run(channelId);

  addLog(
    'info',
    isManual ? 'ffmpeg' : 'scheduler',
    channelId,
    `Iniciando captura ${isManual ? 'manual' : 'agendada'} de "${channel.name}" (${durationSec}s, áudio=${channel.audio_mode}).`
  );

  spawnFfmpegProcess(
    channel,
    rtspResult.url,
    durationSec,
    recordingId,
    filePath,
    startedAtIso,
    isManual,
    null,
    false
  );

  return { ok: true, recordingId };
}

export function stopCapture(channelId: number): { ok: boolean; message: string } {
  const capture = activeCaptures.get(channelId);
  if (!capture) {
    // Also reconcile stale DB status if process is not in memory
    const updated = db
      .prepare("UPDATE recordings SET status = 'interrupted', end_time = ? WHERE channel_id = ? AND status = 'recording'")
      .run(new Date().toISOString(), channelId);
    db.prepare("UPDATE channels SET last_status = 'idle' WHERE id = ? AND last_status = 'recording'").run(channelId);
    if (updated.changes > 0) {
      return { ok: true, message: 'Registro de gravação órfã encerrado.' };
    }
    return { ok: false, message: 'Nenhuma gravação ativa encontrada para este canal.' };
  }

  capture.stopping = true;
  capture.process.kill('SIGTERM');
  setTimeout(() => {
    if (!capture.process.killed) {
      capture.process.kill('SIGKILL');
    }
  }, 4000);

  return { ok: true, message: 'Sinal de parada enviado ao processo FFmpeg.' };
}

export function stopAllCaptures(): void {
  for (const capture of activeCaptures.values()) {
    capture.stopping = true;
    clearTimeout(capture.watchdogTimer);
    try {
      capture.process.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
}

export function testRtspStream(channel: ChannelRow): Promise<StreamTestResult> {
  return new Promise((resolve) => {
    const rtspResult = buildRtspUrl(channel);
    if (!rtspResult.url) {
      resolve({ ok: false, message: rtspResult.error || 'URI RTSP inválida.' });
      return;
    }

    const args = [
      '-v',
      'error',
      '-rtsp_transport',
      'tcp',
      '-show_entries',
      'stream=codec_type,codec_name,width,height',
      '-of',
      'json',
      rtspResult.url,
    ];

    const child = spawn(config.ffprobePath, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve({
          ok: false,
          message: 'Tempo esgotado (8s) ao conectar ao stream RTSP. Verifique IP, porta 554 e credenciais.',
        });
      }
    }, 8000);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, message: `Erro ao executar ffprobe: ${err.message}` });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        const cleanErr = scrubSecretsFromText(stderr.trim()) || `ffprobe retornou código ${code}`;
        resolve({ ok: false, message: `Falha na conexão RTSP: ${cleanErr}` });
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as {
          streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
        };
        const streams = parsed.streams || [];
        const video = streams.find((s) => s.codec_type === 'video');
        const audio = streams.find((s) => s.codec_type === 'audio');

        if (!video) {
          resolve({ ok: false, message: 'Stream acessível, mas nenhuma trilha de vídeo foi detectada.' });
          return;
        }

        const resolution = video.width && video.height ? `${video.width}x${video.height}` : undefined;
        resolve({
          ok: true,
          message: audio
            ? `Stream ativo (${video.codec_name ?? 'video'}${resolution ? ` · ${resolution}` : ''} + áudio ${audio.codec_name ?? ''}).`
            : `Stream de vídeo ativo (${video.codec_name ?? 'video'}${resolution ? ` · ${resolution}` : ''}), sem trilha de áudio detectada.`,
          videoCodec: video.codec_name,
          resolution,
          hasAudio: Boolean(audio),
          audioCodec: audio?.codec_name,
          recommendedAudioMode: audio ? 'aac' : 'none',
        });
      } catch {
        resolve({ ok: false, message: 'Resposta inesperada do ffprobe ao inspecionar o stream.' });
      }
    });
  });
}
