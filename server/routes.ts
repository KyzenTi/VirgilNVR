import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.ts';
import {
  encryptSecret,
  hashPassword,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
} from './crypto.ts';
import {
  addLog,
  bootstrapEnvAdminIfNeeded,
  db,
  getAuthorizedChannelIdsForUser,
  getSetting,
  setSetting,
  userCanAccessChannel,
  type AudioMode,
  type ChannelAccessMode,
  type ChannelRow,
  type RecordingRow,
  type ScheduleRow,
  type UserRole,
  type UserRow,
} from './db.ts';
import {
  getActiveCaptureIds,
  startCapture,
  stopCapture,
  testRtspStream,
  toMaskedChannelDto,
} from './ffmpegManager.ts';
import {
  deleteRecordingFromDiskAndDb,
  getStorageStats,
  isPathInsideStorage,
  reconcileRecordingFile,
  reconcileRecordingsList,
  runRetentionCleanup,
  timeToMinutes,
} from './scheduler.ts';

interface AuthenticatedRequest extends Request {
  user?: UserRow;
}

const COOKIE_NAME = 'vigil_nvr_session';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function detectHttpsRequest(req: Request): boolean {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const origin = req.get('origin') || '';
  return req.secure || forwardedProto === 'https' || origin.startsWith('https://');
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = detectHttpsRequest(req);
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'Max-Age=43200',
  ];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = detectHttpsRequest(req);
  const attrs = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
  ];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function toSafeUserDto(user: UserRow) {
  const permittedRows = db
    .prepare('SELECT channel_id FROM user_channel_permissions WHERE user_id = ?')
    .all(user.id) as { channel_id: number }[];
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    channel_access_mode: user.channel_access_mode,
    active: user.active === 1,
    allowed_channel_ids: permittedRows.map((r) => r.channel_id),
    created_at: user.created_at,
  };
}

function verifyMutationOrigin(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  // Custom header cannot be sent by cross-site HTML forms without CORS preflight
  if (req.get('x-requested-with') === 'VigilLocal') {
    next();
    return;
  }

  const origin = req.get('origin');
  const allowedHosts = new Set<string>();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = req.get('host')?.split(',')[0]?.trim();
  if (forwardedHost) allowedHosts.add(forwardedHost);
  if (host) allowedHosts.add(host);
  if (process.env.APP_URL) {
    try {
      allowedHosts.add(new URL(process.env.APP_URL).host);
    } catch {
      // ignore invalid APP_URL
    }
  }

  if (origin && allowedHosts.size > 0) {
    try {
      const parsedOrigin = new URL(origin);
      if (allowedHosts.has(parsedOrigin.host)) {
        next();
        return;
      }
      res.status(403).json({ error: 'Origem da requisição não autorizada.' });
      return;
    } catch {
      res.status(403).json({ error: 'Cabeçalho Origin inválido.' });
      return;
    }
  }

  res.status(403).json({ error: 'Cabeçalho de proteção CSRF ausente.' });
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : undefined;
  const token = cookies[COOKIE_NAME] || bearer;
  const payload = verifySessionToken(token);

  if (!payload) {
    res.status(401).json({ error: 'Sessão não autenticada ou expirada.' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.uid) as UserRow | undefined;
  if (!user) {
    res.status(401).json({ error: 'Usuário inativo ou não encontrado.' });
    return;
  }

  req.user = user;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito a administradores.' });
    return;
  }
  next();
}

function isValidTimeHHMM(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const h = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function createApiRouter(): express.Router {
  const router = express.Router();
  bootstrapEnvAdminIfNeeded();

  router.use(verifyMutationOrigin);

  // ---------------- AUTH ----------------
  router.get('/auth/status', (req: AuthenticatedRequest, res: Response) => {
    const adminCount = db
      .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND active = 1")
      .get() as { cnt: number };

    const needsSetup = adminCount.cnt === 0 && !config.adminInitialPassword;
    const cookies = parseCookies(req.headers.cookie);
    const payload = verifySessionToken(cookies[COOKIE_NAME]);
    let currentUser = null;

    if (payload) {
      const row = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.uid) as UserRow | undefined;
      if (row) {
        currentUser = toSafeUserDto(row);
      }
    }

    res.json({ needsSetup, user: currentUser });
  });

  router.post('/auth/setup', (req: Request, res: Response) => {
    if (config.adminInitialPassword) {
      res.status(403).json({ error: 'Setup desabilitado: senha inicial configurada via variável de ambiente.' });
      return;
    }

    const { username, email, password } = req.body as {
      username?: string;
      email?: string;
      password?: string;
    };

    const cleanUser = (username || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const rawPass = password || '';

    if (cleanUser.length < 3 || !cleanEmail.includes('@') || rawPass.length < 8) {
      res.status(400).json({ error: 'Informe usuário (mín. 3 caracteres), e-mail válido e senha (mín. 8 caracteres).' });
      return;
    }

    const setupTx = db.transaction(() => {
      const existing = db
        .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND active = 1")
        .get() as { cnt: number };
      if (existing.cnt > 0) {
        return null;
      }
      const passHash = hashPassword(rawPass);
      const info = db
        .prepare(
          `INSERT INTO users (username, email, password_hash, role, channel_access_mode, active)
           VALUES (?, ?, ?, 'admin', 'default', 1)`
        )
        .run(cleanUser, cleanEmail, passHash);
      return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
    });

    const created = setupTx();
    if (!created) {
      res.status(409).json({ error: 'Conta administrativa já foi configurada.' });
      return;
    }

    addLog('info', 'auth', null, `Conta administrativa inicial "${created.username}" configurada.`);
    const token = signSessionToken({ uid: created.id, role: created.role });
    setSessionCookie(req, res, token);
    res.status(201).json({ user: toSafeUserDto(created) });
  });

  router.post('/auth/login', (req: Request, res: Response) => {
    const { identifier, password } = req.body as { identifier?: string; password?: string };
    const cleanId = (identifier || '').trim();
    const rawPass = password || '';

    if (!cleanId || !rawPass) {
      res.status(400).json({ error: 'Informe usuário/e-mail e senha.' });
      return;
    }

    const user = db
      .prepare('SELECT * FROM users WHERE (username = ? OR email = ?) AND active = 1 LIMIT 1')
      .get(cleanId, cleanId.toLowerCase()) as UserRow | undefined;

    if (!user) {
      res.status(401).json({ error: 'Credenciais inválidas.' });
      return;
    }

    const envAdminOverride =
      Boolean(config.adminInitialPassword) &&
      user.role === 'admin' &&
      user.username === 'admin' &&
      rawPass === config.adminInitialPassword;

    if (!envAdminOverride && !verifyPassword(rawPass, user.password_hash)) {
      addLog('warn', 'auth', null, `Tentativa de login falhou para "${cleanId}".`);
      res.status(401).json({ error: 'Credenciais inválidas.' });
      return;
    }

    const token = signSessionToken({ uid: user.id, role: user.role });
    setSessionCookie(req, res, token);
    res.json({ user: toSafeUserDto(user) });
  });

  router.post('/auth/logout', (req: Request, res: Response) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // All routes below require authentication
  router.use(requireAuth);

  // ---------------- DASHBOARD ----------------
  router.get('/dashboard', (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const allowedIds = getAuthorizedChannelIdsForUser(user);

    let channelRows: ChannelRow[];
    if (allowedIds === null) {
      channelRows = db.prepare('SELECT * FROM channels ORDER BY id ASC').all() as ChannelRow[];
    } else if (allowedIds.length === 0) {
      channelRows = [];
    } else {
      const placeholders = allowedIds.map(() => '?').join(',');
      channelRows = db
        .prepare(`SELECT * FROM channels WHERE id IN (${placeholders}) ORDER BY id ASC`)
        .all(...allowedIds) as ChannelRow[];
    }

    const schedules = db.prepare('SELECT * FROM schedules WHERE active = 1').all() as ScheduleRow[];
    const schedulesByChannel = new Map<number, ScheduleRow[]>();
    for (const s of schedules) {
      const list = schedulesByChannel.get(s.channel_id) || [];
      list.push(s);
      schedulesByChannel.set(s.channel_id, list);
    }

    const channels = channelRows.map((ch) => ({
      ...toMaskedChannelDto(ch),
      schedule_count: (schedulesByChannel.get(ch.id) || []).length,
    }));

    let recentRaw: Array<RecordingRow & { channel_name: string }>;
    if (allowedIds === null) {
      recentRaw = db
        .prepare(
          `SELECT r.*, c.name as channel_name
           FROM recordings r
           INNER JOIN channels c ON c.id = r.channel_id
           WHERE r.status IN ('completed', 'interrupted', 'recording')
           ORDER BY r.start_time DESC
           LIMIT 25`
        )
        .all() as Array<RecordingRow & { channel_name: string }>;
    } else if (allowedIds.length === 0) {
      recentRaw = [];
    } else {
      const placeholders = allowedIds.map(() => '?').join(',');
      recentRaw = db
        .prepare(
          `SELECT r.*, c.name as channel_name
           FROM recordings r
           INNER JOIN channels c ON c.id = r.channel_id
           WHERE r.channel_id IN (${placeholders})
             AND r.status IN ('completed', 'interrupted', 'recording')
           ORDER BY r.start_time DESC
           LIMIT 25`
        )
        .all(...allowedIds) as Array<RecordingRow & { channel_name: string }>;
    }

    const recentRecordings = reconcileRecordingsList(recentRaw).slice(0, 12);
    const storage = getStorageStats();

    res.json({
      channels,
      recentRecordings,
      storage,
      activeCaptureCount: getActiveCaptureIds().length,
    });
  });

  // ---------------- CHANNELS ----------------
  router.get('/channels', (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const allowedIds = getAuthorizedChannelIdsForUser(user);

    let rows: ChannelRow[];
    if (allowedIds === null) {
      rows = db.prepare('SELECT * FROM channels ORDER BY id ASC').all() as ChannelRow[];
    } else if (allowedIds.length === 0) {
      rows = [];
    } else {
      const placeholders = allowedIds.map(() => '?').join(',');
      rows = db
        .prepare(`SELECT * FROM channels WHERE id IN (${placeholders}) ORDER BY id ASC`)
        .all(...allowedIds) as ChannelRow[];
    }

    res.json({ channels: rows.map(toMaskedChannelDto) });
  });

  router.post('/channels', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const {
      name,
      rtsp_uri_mode = 'structured',
      rtsp_host = '',
      rtsp_port = 554,
      rtsp_path = '',
      rtsp_user = '',
      rtsp_password = '',
      raw_uri = '',
      audio_mode = 'aac',
      active = true,
    } = req.body as {
      name?: string;
      rtsp_uri_mode?: 'structured' | 'raw';
      rtsp_host?: string;
      rtsp_port?: number;
      rtsp_path?: string;
      rtsp_user?: string;
      rtsp_password?: string;
      raw_uri?: string;
      audio_mode?: AudioMode;
      active?: boolean;
    };

    const cleanName = (name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'Nome do canal é obrigatório.' });
      return;
    }

    if (rtsp_uri_mode !== 'structured' && rtsp_uri_mode !== 'raw') {
      res.status(400).json({ error: 'Modo de URI RTSP inválido.' });
      return;
    }

    if (!['aac', 'copy', 'none'].includes(audio_mode)) {
      res.status(400).json({ error: 'Modo de áudio deve ser aac, copy ou none.' });
      return;
    }

    let passwordEnc = '';
    let rawUriEnc = '';

    if (rtsp_uri_mode === 'raw') {
      const trimmedRaw = raw_uri.trim();
      if (!/^rtsps?:\/\/.+/i.test(trimmedRaw)) {
        res.status(400).json({ error: 'URI RTSP direta deve iniciar com rtsp:// ou rtsps://.' });
        return;
      }
      rawUriEnc = encryptSecret(trimmedRaw);
    } else {
      if (!rtsp_host.trim()) {
        res.status(400).json({ error: 'Host/IP do DVR ou câmera é obrigatório.' });
        return;
      }
      const parsedPort = Number(rtsp_port) || 554;
      if (parsedPort < 1 || parsedPort > 65535) {
        res.status(400).json({ error: 'Porta RTSP inválida.' });
        return;
      }
      if (rtsp_password) {
        passwordEnc = encryptSecret(rtsp_password);
      }
    }

    const info = db
      .prepare(
        `INSERT INTO channels (
          name, rtsp_host, rtsp_port, rtsp_path, rtsp_user, rtsp_password_enc,
          rtsp_uri_mode, raw_uri_enc, audio_mode, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cleanName,
        rtsp_host.trim(),
        Number(rtsp_port) || 554,
        rtsp_path.trim(),
        rtsp_user.trim(),
        passwordEnc,
        rtsp_uri_mode,
        rawUriEnc,
        audio_mode,
        active ? 1 : 0
      );

    const created = db.prepare('SELECT * FROM channels WHERE id = ?').get(info.lastInsertRowid) as ChannelRow;
    addLog('info', 'system', created.id, `Canal "${created.name}" criado por ${req.user!.username}.`);
    res.status(201).json({ channel: toMaskedChannelDto(created) });
  });

  router.put('/channels/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const channelId = Number.parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as ChannelRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Canal não encontrado.' });
      return;
    }

    const {
      name,
      rtsp_uri_mode,
      rtsp_host,
      rtsp_port,
      rtsp_path,
      rtsp_user,
      rtsp_password,
      raw_uri,
      audio_mode,
      active,
    } = req.body as {
      name?: string;
      rtsp_uri_mode?: 'structured' | 'raw';
      rtsp_host?: string;
      rtsp_port?: number;
      rtsp_path?: string;
      rtsp_user?: string;
      rtsp_password?: string;
      raw_uri?: string;
      audio_mode?: AudioMode;
      active?: boolean;
    };

    const nextName = (name ?? existing.name).trim();
    if (!nextName) {
      res.status(400).json({ error: 'Nome do canal é obrigatório.' });
      return;
    }

    const nextMode = rtsp_uri_mode ?? existing.rtsp_uri_mode;
    const nextAudio = audio_mode ?? existing.audio_mode;
    if (!['aac', 'copy', 'none'].includes(nextAudio)) {
      res.status(400).json({ error: 'Modo de áudio inválido.' });
      return;
    }

    let nextPassEnc = existing.rtsp_password_enc;
    if (typeof rtsp_password === 'string' && rtsp_password.length > 0) {
      nextPassEnc = encryptSecret(rtsp_password);
    }

    let nextRawEnc = existing.raw_uri_enc;
    if (nextMode === 'raw' && typeof raw_uri === 'string' && raw_uri.trim().length > 0) {
      if (!/^rtsps?:\/\/.+/i.test(raw_uri.trim())) {
        res.status(400).json({ error: 'URI RTSP direta deve iniciar com rtsp:// ou rtsps://.' });
        return;
      }
      nextRawEnc = encryptSecret(raw_uri.trim());
    }

    const nextHost = (rtsp_host ?? existing.rtsp_host).trim();
    const nextPort = Number(rtsp_port ?? existing.rtsp_port) || 554;
    const nextPath = (rtsp_path ?? existing.rtsp_path).trim();
    const nextUser = (rtsp_user ?? existing.rtsp_user).trim();
    const nextActive = typeof active === 'boolean' ? (active ? 1 : 0) : existing.active;

    if (nextMode === 'structured' && !nextHost) {
      res.status(400).json({ error: 'Host/IP RTSP é obrigatório.' });
      return;
    }
    if (nextMode === 'raw' && !nextRawEnc) {
      res.status(400).json({ error: 'URI RTSP direta é obrigatória.' });
      return;
    }

    db.prepare(
      `UPDATE channels SET
        name = ?, rtsp_uri_mode = ?, rtsp_host = ?, rtsp_port = ?, rtsp_path = ?,
        rtsp_user = ?, rtsp_password_enc = ?, raw_uri_enc = ?, audio_mode = ?, active = ?
       WHERE id = ?`
    ).run(
      nextName,
      nextMode,
      nextHost,
      nextPort,
      nextPath,
      nextUser,
      nextPassEnc,
      nextRawEnc,
      nextAudio,
      nextActive,
      channelId
    );

    const updated = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as ChannelRow;
    addLog('info', 'system', channelId, `Canal "${updated.name}" atualizado por ${req.user!.username}.`);
    res.json({ channel: toMaskedChannelDto(updated) });
  });

  router.delete('/channels/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const channelId = Number.parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as ChannelRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Canal não encontrado.' });
      return;
    }

    stopCapture(channelId);
    db.prepare('DELETE FROM channels WHERE id = ?').run(channelId);
    addLog('info', 'system', null, `Canal "${existing.name}" (#${channelId}) excluído por ${req.user!.username}.`);
    res.json({ ok: true });
  });

  router.post('/channels/:id/test', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const channelId = Number.parseInt(req.params.id, 10);
    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as ChannelRow | undefined;
    if (!channel) {
      res.status(404).json({ error: 'Canal não encontrado.' });
      return;
    }

    const result = await testRtspStream(channel);
    if (!result.ok) {
      db.prepare("UPDATE channels SET last_error = ? WHERE id = ?").run(result.message, channelId);
      addLog('warn', 'ffmpeg', channelId, `Teste RTSP falhou em "${channel.name}": ${result.message}`);
    } else {
      db.prepare("UPDATE channels SET last_error = NULL WHERE id = ?").run(channelId);
    }

    res.json(result);
  });

  router.post('/channels/:id/capture/start', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const channelId = Number.parseInt(req.params.id, 10);
    const rawDur = Number((req.body as { duration_sec?: number })?.duration_sec ?? 900);
    const durationSec = Math.min(14400, Math.max(10, Math.round(Number.isFinite(rawDur) ? rawDur : 900)));

    const result = startCapture(channelId, durationSec, null, true);
    if (!result.ok) {
      res.status(result.conflict ? 409 : 400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, recordingId: result.recordingId, durationSec });
  });

  router.post('/channels/:id/capture/stop', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const channelId = Number.parseInt(req.params.id, 10);
    const result = stopCapture(channelId);
    if (!result.ok) {
      res.status(404).json({ error: result.message });
      return;
    }
    res.json(result);
  });

  // ---------------- SCHEDULES (ADMIN) ----------------
  router.get('/schedules', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT s.*, c.name as channel_name, c.active as channel_active
         FROM schedules s
         INNER JOIN channels c ON c.id = s.channel_id
         ORDER BY s.channel_id ASC, s.start_time ASC`
      )
      .all() as Array<ScheduleRow & { channel_name: string; channel_active: number }>;

    const activeIds = new Set(getActiveCaptureIds());
    const schedules = rows.map((row) => ({
      ...row,
      days_of_week: JSON.parse(row.days_of_week) as number[],
      active: row.active === 1,
      channel_active: row.channel_active === 1,
      channel_recording: activeIds.has(row.channel_id),
    }));

    res.json({ schedules });
  });

  router.post('/schedules', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as {
      channel_id?: number;
      channel_ids?: number[];
      label?: string;
      days_of_week?: number[];
      start_time?: string;
      end_time?: string;
      duration_sec?: number;
      active?: boolean;
    };

    const rawIds = Array.isArray(body.channel_ids) && body.channel_ids.length > 0
      ? body.channel_ids
      : body.channel_id !== undefined
      ? [body.channel_id]
      : [];

    const targetChannelIds = Array.from(
      new Set(rawIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))
    );

    if (targetChannelIds.length === 0) {
      res.status(400).json({ error: 'Selecione ao menos um canal para o agendamento.' });
      return;
    }

    const validatedList: Array<{
      channelId: number;
      label: string;
      daysOfWeek: number[];
      startTime: string;
      endTime: string;
      durationSec: number;
      active: boolean;
    }> = [];

    for (const chId of targetChannelIds) {
      const validation = validateSchedulePayload({ ...body, channel_id: chId }, null);
      if ('error' in validation) {
        const ch = db.prepare('SELECT name FROM channels WHERE id = ?').get(chId) as { name: string } | undefined;
        const prefix = ch ? `Canal "${ch.name}" (#${chId}): ` : '';
        res.status(validation.status).json({ error: `${prefix}${validation.error}` });
        return;
      }
      validatedList.push(validation);
    }

    const insertStmt = db.prepare(
      `INSERT INTO schedules (channel_id, label, days_of_week, start_time, end_time, duration_sec, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const createdRows = db.transaction(() => {
      const inserted: ScheduleRow[] = [];
      for (const v of validatedList) {
        const info = insertStmt.run(
          v.channelId,
          v.label,
          JSON.stringify(v.daysOfWeek),
          v.startTime,
          v.endTime,
          v.durationSec,
          v.active ? 1 : 0
        );
        const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(info.lastInsertRowid) as ScheduleRow;
        inserted.push(row);
        addLog(
          'info',
          'scheduler',
          v.channelId,
          `Agendamento "${v.label || v.startTime}" criado (${v.startTime}–${v.endTime}, ${v.durationSec}s).`
        );
      }
      return inserted;
    })();

    const formatted = createdRows.map((row) => ({
      ...row,
      days_of_week: JSON.parse(row.days_of_week) as number[],
      active: row.active === 1,
    }));

    res.status(201).json({
      schedule: formatted[0],
      schedules: formatted,
    });
  });

  router.put('/schedules/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const scheduleId = Number.parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as ScheduleRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Agendamento não encontrado.' });
      return;
    }

    const body = req.body as {
      channel_id?: number;
      channel_ids?: number[];
      label?: string;
      days_of_week?: number[];
      start_time?: string;
      end_time?: string;
      duration_sec?: number;
      active?: boolean;
    };

    const rawIds = Array.isArray(body.channel_ids) && body.channel_ids.length > 0
      ? body.channel_ids
      : [body.channel_id ?? existing.channel_id];

    const targetChannelIds = Array.from(
      new Set(rawIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))
    );

    if (targetChannelIds.length === 0) {
      res.status(400).json({ error: 'Selecione ao menos um canal para o agendamento.' });
      return;
    }

    // Keep existing.channel_id as the primary updated row if still checked, else move to first selected
    const primaryChannelId = targetChannelIds.includes(existing.channel_id)
      ? existing.channel_id
      : targetChannelIds[0];
    const extraChannelIds = targetChannelIds.filter((id) => id !== primaryChannelId);

    const baseMerged = {
      label: body.label ?? existing.label,
      days_of_week: body.days_of_week ?? (JSON.parse(existing.days_of_week) as number[]),
      start_time: body.start_time ?? existing.start_time,
      end_time: body.end_time ?? existing.end_time,
      duration_sec: body.duration_sec ?? existing.duration_sec,
      active: body.active ?? existing.active === 1,
    };

    const primaryValidation = validateSchedulePayload({ ...baseMerged, channel_id: primaryChannelId }, scheduleId);
    if ('error' in primaryValidation) {
      res.status(primaryValidation.status).json({ error: primaryValidation.error });
      return;
    }

    const extraValidations: Array<typeof primaryValidation> = [];
    for (const chId of extraChannelIds) {
      const val = validateSchedulePayload({ ...baseMerged, channel_id: chId }, null);
      if ('error' in val) {
        const ch = db.prepare('SELECT name FROM channels WHERE id = ?').get(chId) as { name: string } | undefined;
        const prefix = ch ? `Canal "${ch.name}" (#${chId}): ` : '';
        res.status(val.status).json({ error: `${prefix}${val.error}` });
        return;
      }
      extraValidations.push(val);
    }

    const updated = db.transaction(() => {
      db.prepare(
        `UPDATE schedules SET
          channel_id = ?, label = ?, days_of_week = ?, start_time = ?, end_time = ?, duration_sec = ?, active = ?
         WHERE id = ?`
      ).run(
        primaryValidation.channelId,
        primaryValidation.label,
        JSON.stringify(primaryValidation.daysOfWeek),
        primaryValidation.startTime,
        primaryValidation.endTime,
        primaryValidation.durationSec,
        primaryValidation.active ? 1 : 0,
        scheduleId
      );

      const insertStmt = db.prepare(
        `INSERT INTO schedules (channel_id, label, days_of_week, start_time, end_time, duration_sec, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const extra of extraValidations) {
        insertStmt.run(
          extra.channelId,
          extra.label,
          JSON.stringify(extra.daysOfWeek),
          extra.startTime,
          extra.endTime,
          extra.durationSec,
          extra.active ? 1 : 0
        );
        addLog(
          'info',
          'scheduler',
          extra.channelId,
          `Agendamento "${extra.label || extra.startTime}" replicado (${extra.startTime}–${extra.endTime}, ${extra.durationSec}s).`
        );
      }

      return db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as ScheduleRow;
    })();

    res.json({
      schedule: {
        ...updated,
        days_of_week: JSON.parse(updated.days_of_week) as number[],
        active: updated.active === 1,
      },
    });
  });

  router.delete('/schedules/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const scheduleId = Number.parseInt(req.params.id, 10);
    const resDel = db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
    if (resDel.changes === 0) {
      res.status(404).json({ error: 'Agendamento não encontrado.' });
      return;
    }
    res.json({ ok: true });
  });

  // ---------------- RECORDINGS & BYTE-RANGE STREAMING ----------------
  router.get('/recordings', (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const allowedIds = getAuthorizedChannelIdsForUser(user);

    const channelIdParam = req.query.channelId ? Number.parseInt(String(req.query.channelId), 10) : null;
    const dateParam = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const fromParam = typeof req.query.from === 'string' ? req.query.from.trim() : '';
    const toParam = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    const limitParam = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit || '200'), 10) || 200));

    if (channelIdParam !== null) {
      if (!Number.isFinite(channelIdParam)) {
        res.status(400).json({ error: 'channelId inválido.' });
        return;
      }
      if (!userCanAccessChannel(user, channelIdParam)) {
        res.status(403).json({ error: 'Sem permissão para visualizar gravações deste canal.' });
        return;
      }
    }

    const whereClauses: string[] = ["r.status IN ('completed', 'interrupted', 'recording')"];
    const params: Array<string | number> = [];

    if (channelIdParam !== null) {
      whereClauses.push('r.channel_id = ?');
      params.push(channelIdParam);
    } else if (allowedIds !== null) {
      if (allowedIds.length === 0) {
        res.json({ recordings: [] });
        return;
      }
      whereClauses.push(`r.channel_id IN (${allowedIds.map(() => '?').join(',')})`);
      params.push(...allowedIds);
    }

    if (dateParam) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        res.status(400).json({ error: 'Formato de data deve ser YYYY-MM-DD.' });
        return;
      }
      const startTimeStr = isValidTimeHHMM(fromParam) ? `${fromParam}:00` : '00:00:00';
      const endTimeStr = isValidTimeHHMM(toParam) ? `${toParam}:59.999` : '23:59:59.999';
      const fromDate = new Date(`${dateParam}T${startTimeStr}`);
      const toDate = new Date(`${dateParam}T${endTimeStr}`);

      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        res.status(400).json({ error: 'Faixa de data/hora inválida.' });
        return;
      }
      whereClauses.push('r.start_time >= ? AND r.start_time <= ?');
      params.push(fromDate.toISOString(), toDate.toISOString());
    }

    const sql = `
      SELECT r.*, c.name as channel_name
      FROM recordings r
      INNER JOIN channels c ON c.id = r.channel_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY r.start_time ASC
      LIMIT ?
    `;
    params.push(limitParam);

    const rows = db.prepare(sql).all(...params) as Array<RecordingRow & { channel_name: string }>;
    const valid = reconcileRecordingsList(rows);

    res.json({ recordings: valid });
  });

  router.get('/recordings/:id/stream', (req: AuthenticatedRequest, res: Response) => {
    const recId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(recId)) {
      res.status(400).json({ error: 'ID de gravação inválido.' });
      return;
    }

    const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(recId) as RecordingRow | undefined;
    if (!rec) {
      res.status(404).json({ error: 'Gravação não encontrada.' });
      return;
    }

    if (!userCanAccessChannel(req.user!, rec.channel_id)) {
      res.status(403).json({ error: 'Sem permissão para reproduzir gravações deste canal.' });
      return;
    }

    if (rec.status === 'recording') {
      res.status(409).json({ error: 'Gravação ainda em andamento; aguarde a conclusão para replay.' });
      return;
    }

    if (!reconcileRecordingFile(rec) || !isPathInsideStorage(rec.file_path)) {
      res.status(404).json({ error: 'Arquivo de gravação ausente no disco ou marcado como removido.' });
      return;
    }

    const resolvedPath = path.resolve(rec.file_path);
    const stat = fs.statSync(resolvedPath);
    const fileSize = stat.size;
    const fileName = path.basename(resolvedPath);

    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'private, max-age=60');

    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, { 'Content-Length': fileSize });
      const stream = fs.createReadStream(resolvedPath);
      req.on('close', () => stream.destroy());
      stream.pipe(res);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2] ? Math.min(fileSize - 1, Number.parseInt(match[2], 10)) : fileSize - 1;

    if (start >= fileSize || start > end || start < 0) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize,
    });

    const stream = fs.createReadStream(resolvedPath, { start, end });
    req.on('close', () => stream.destroy());
    stream.pipe(res);
  });

  router.delete('/recordings/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const recId = Number.parseInt(req.params.id, 10);
    const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(recId) as RecordingRow | undefined;
    if (!rec) {
      res.status(404).json({ error: 'Gravação não encontrada.' });
      return;
    }
    if (rec.status === 'recording') {
      res.status(409).json({ error: 'Interrompa a captura ativa antes de excluir o arquivo.' });
      return;
    }

    const freed = deleteRecordingFromDiskAndDb(rec);
    addLog('info', 'retention', rec.channel_id, `Gravação #${rec.id} removida manualmente por ${req.user!.username} (${Math.round(freed / 1024)} KB).`);
    res.json({ ok: true, freedBytes: freed });
  });

  // ---------------- SETTINGS & RETENTION (ADMIN) ----------------
  router.get('/settings', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    res.json({
      retention_days: Number.parseInt(getSetting('retention_days', String(config.defaultRetentionDays)), 10),
      max_disk_percent: Number.parseInt(getSetting('max_disk_percent', String(config.defaultMaxDiskPercent)), 10),
      viewer_default_all_channels: getSetting('viewer_default_all_channels', 'true') === 'true',
      storage: getStorageStats(),
    });
  });

  router.put('/settings', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const { retention_days, max_disk_percent, viewer_default_all_channels } = req.body as {
      retention_days?: number;
      max_disk_percent?: number;
      viewer_default_all_channels?: boolean;
    };

    if (retention_days !== undefined) {
      const days = Math.round(Number(retention_days));
      if (!Number.isFinite(days) || days < 1 || days > 3650) {
        res.status(400).json({ error: 'Retenção em dias deve estar entre 1 e 3650.' });
        return;
      }
      setSetting('retention_days', String(days));
    }

    if (max_disk_percent !== undefined) {
      const pct = Math.round(Number(max_disk_percent));
      if (!Number.isFinite(pct) || pct < 50 || pct > 98) {
        res.status(400).json({ error: 'Limite de disco (%) deve estar entre 50% e 98%.' });
        return;
      }
      setSetting('max_disk_percent', String(pct));
    }

    if (typeof viewer_default_all_channels === 'boolean') {
      setSetting('viewer_default_all_channels', viewer_default_all_channels ? 'true' : 'false');
    }

    addLog('info', 'system', null, `Configurações de retenção/permissão atualizadas por ${req.user!.username}.`);
    res.json({
      retention_days: Number.parseInt(getSetting('retention_days', String(config.defaultRetentionDays)), 10),
      max_disk_percent: Number.parseInt(getSetting('max_disk_percent', String(config.defaultMaxDiskPercent)), 10),
      viewer_default_all_channels: getSetting('viewer_default_all_channels', 'true') === 'true',
      storage: getStorageStats(),
    });
  });

  router.post('/retention/run', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const summary = runRetentionCleanup();
    res.json({ summary, storage: getStorageStats() });
  });

  // ---------------- USERS & VIEWER CHANNEL ACL (ADMIN) ----------------
  router.get('/users', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const users = db.prepare('SELECT * FROM users ORDER BY id ASC').all() as UserRow[];
    res.json({ users: users.map(toSafeUserDto) });
  });

  router.post('/users', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const {
      username,
      email,
      password,
      role = 'viewer',
      channel_access_mode = 'default',
      allowed_channel_ids = [],
      active = true,
    } = req.body as {
      username?: string;
      email?: string;
      password?: string;
      role?: UserRole;
      channel_access_mode?: ChannelAccessMode;
      allowed_channel_ids?: number[];
      active?: boolean;
    };

    const cleanUser = (username || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const rawPass = password || '';

    if (cleanUser.length < 3 || !cleanEmail.includes('@') || rawPass.length < 8) {
      res.status(400).json({ error: 'Informe usuário (mín. 3 caracteres), e-mail válido e senha (mín. 8 caracteres).' });
      return;
    }

    if (role !== 'admin' && role !== 'viewer') {
      res.status(400).json({ error: 'Perfil deve ser admin ou viewer.' });
      return;
    }

    if (channel_access_mode !== 'default' && channel_access_mode !== 'restricted') {
      res.status(400).json({ error: 'Modo de acesso inválido.' });
      return;
    }

    const exists = db
      .prepare('SELECT 1 FROM users WHERE username = ? OR email = ?')
      .get(cleanUser, cleanEmail);
    if (exists) {
      res.status(409).json({ error: 'Usuário ou e-mail já cadastrado.' });
      return;
    }

    const createTx = db.transaction(() => {
      const passHash = hashPassword(rawPass);
      const info = db
        .prepare(
          `INSERT INTO users (username, email, password_hash, role, channel_access_mode, active)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(cleanUser, cleanEmail, passHash, role, channel_access_mode, active ? 1 : 0);

      const userId = Number(info.lastInsertRowid);
      if (role === 'viewer' && Array.isArray(allowed_channel_ids)) {
        const insertPerm = db.prepare(
          'INSERT OR IGNORE INTO user_channel_permissions (user_id, channel_id) VALUES (?, ?)'
        );
        for (const chId of allowed_channel_ids) {
          if (Number.isInteger(chId)) {
            insertPerm.run(userId, chId);
          }
        }
      }
      return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
    });

    const created = createTx();
    addLog('info', 'auth', null, `Usuário "${created.username}" (${created.role}) criado por ${req.user!.username}.`);
    res.status(201).json({ user: toSafeUserDto(created) });
  });

  router.put('/users/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const userId = Number.parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    const {
      username,
      email,
      password,
      role,
      channel_access_mode,
      allowed_channel_ids,
      active,
    } = req.body as {
      username?: string;
      email?: string;
      password?: string;
      role?: UserRole;
      channel_access_mode?: ChannelAccessMode;
      allowed_channel_ids?: number[];
      active?: boolean;
    };

    const nextRole = role ?? existing.role;
    const nextActive = typeof active === 'boolean' ? (active ? 1 : 0) : existing.active;

    if (existing.role === 'admin' && (nextRole !== 'admin' || nextActive === 0)) {
      const otherAdmins = db
        .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND active = 1 AND id != ?")
        .get(userId) as { cnt: number };
      if (otherAdmins.cnt === 0) {
        res.status(400).json({ error: 'Não é possível remover ou desativar o último administrador ativo.' });
        return;
      }
    }

    const nextUser = (username ?? existing.username).trim();
    const nextEmail = (email ?? existing.email).trim().toLowerCase();
    const nextMode = channel_access_mode ?? existing.channel_access_mode;
    const nextHash = password && password.length >= 8 ? hashPassword(password) : existing.password_hash;

    if (password && password.length > 0 && password.length < 8) {
      res.status(400).json({ error: 'Nova senha deve ter no mínimo 8 caracteres.' });
      return;
    }

    const updateTx = db.transaction(() => {
      db.prepare(
        `UPDATE users SET username = ?, email = ?, password_hash = ?, role = ?, channel_access_mode = ?, active = ?
         WHERE id = ?`
      ).run(nextUser, nextEmail, nextHash, nextRole, nextMode, nextActive, userId);

      if (Array.isArray(allowed_channel_ids)) {
        db.prepare('DELETE FROM user_channel_permissions WHERE user_id = ?').run(userId);
        if (nextRole === 'viewer') {
          const insertPerm = db.prepare(
            'INSERT OR IGNORE INTO user_channel_permissions (user_id, channel_id) VALUES (?, ?)'
          );
          for (const chId of allowed_channel_ids) {
            if (Number.isInteger(chId)) {
              insertPerm.run(userId, chId);
            }
          }
        }
      }

      return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
    });

    const updated = updateTx();
    res.json({ user: toSafeUserDto(updated) });
  });

  router.delete('/users/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const userId = Number.parseInt(req.params.id, 10);
    if (req.user!.id === userId) {
      res.status(400).json({ error: 'Não é possível excluir sua própria conta logada.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    if (existing.role === 'admin') {
      const otherAdmins = db
        .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND active = 1 AND id != ?")
        .get(userId) as { cnt: number };
      if (otherAdmins.cnt === 0) {
        res.status(400).json({ error: 'Não é possível excluir o último administrador ativo.' });
        return;
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ ok: true });
  });

  // ---------------- EXECUTION LOGS (ADMIN) ----------------
  router.get('/logs', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const level = typeof req.query.level === 'string' ? req.query.level.trim() : '';
    const source = typeof req.query.source === 'string' ? req.query.source.trim() : '';

    const where: string[] = [];
    const params: string[] = [];

    if (['info', 'warn', 'error'].includes(level)) {
      where.push('l.level = ?');
      params.push(level);
    }
    if (['ffmpeg', 'scheduler', 'retention', 'auth', 'system'].includes(source)) {
      where.push('l.source = ?');
      params.push(source);
    }

    const sql = `
      SELECT l.*, c.name as channel_name
      FROM execution_logs l
      LEFT JOIN channels c ON c.id = l.channel_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.id DESC
      LIMIT 200
    `;

    const logs = db.prepare(sql).all(...params);
    res.json({ logs });
  });

  return router;
}

function validateSchedulePayload(
  body: {
    channel_id?: number;
    label?: string;
    days_of_week?: number[];
    start_time?: string;
    end_time?: string;
    duration_sec?: number;
    active?: boolean;
  },
  excludeScheduleId: number | null
):
  | {
      channelId: number;
      label: string;
      daysOfWeek: number[];
      startTime: string;
      endTime: string;
      durationSec: number;
      active: boolean;
    }
  | { status: number; error: string } {
  const channelId = Number(body.channel_id);
  if (!Number.isInteger(channelId)) {
    return { status: 400, error: 'Canal inválido.' };
  }
  const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
  if (!channel) {
    return { status: 404, error: 'Canal informado não existe.' };
  }

  if (!Array.isArray(body.days_of_week) || body.days_of_week.length === 0) {
    return { status: 400, error: 'Selecione ao menos um dia da semana.' };
  }
  const cleanDays = Array.from(
    new Set(body.days_of_week.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
  ).sort((a, b) => a - b);

  if (cleanDays.length === 0) {
    return { status: 400, error: 'Dias da semana inválidos.' };
  }

  if (!isValidTimeHHMM(body.start_time) || !isValidTimeHHMM(body.end_time)) {
    return { status: 400, error: 'Horário inicial e final devem estar no formato HH:MM.' };
  }

  const startMin = timeToMinutes(body.start_time);
  const endMin = timeToMinutes(body.end_time);
  if (endMin <= startMin) {
    return { status: 400, error: 'O horário final (end_time) deve ser maior que o horário inicial (start_time).' };
  }

  const windowSec = (endMin - startMin) * 60;
  const requestedDur = body.duration_sec !== undefined ? Math.round(Number(body.duration_sec)) : windowSec;
  if (!Number.isFinite(requestedDur) || requestedDur < 30) {
    return { status: 400, error: 'Duração da captura deve ser de no mínimo 30 segundos.' };
  }
  if (requestedDur > windowSec) {
    return {
      status: 400,
      error: `Duração (${requestedDur}s) excede a janela configurada (${windowSec}s entre ${body.start_time} e ${body.end_time}).`,
    };
  }

  // Prevent overlapping active/inactive schedules on the same channel & weekday
  const existingSchedules = db
    .prepare('SELECT * FROM schedules WHERE channel_id = ? AND (? IS NULL OR id != ?)')
    .all(channelId, excludeScheduleId, excludeScheduleId) as ScheduleRow[];

  for (const other of existingSchedules) {
    let otherDays: number[] = [];
    try {
      otherDays = JSON.parse(other.days_of_week) as number[];
    } catch {
      continue;
    }
    const sharesDay = cleanDays.some((d) => otherDays.includes(d));
    if (!sharesDay) continue;

    const otherStart = timeToMinutes(other.start_time);
    const otherEnd = timeToMinutes(other.end_time);
    if (startMin < otherEnd && otherStart < endMin) {
      return {
        status: 409,
        error: `Conflito de janela com agendamento "${other.label || other.start_time}" (${other.start_time}–${other.end_time}) no mesmo canal e dia da semana.`,
      };
    }
  }

  return {
    channelId,
    label: (body.label || '').trim(),
    daysOfWeek: cleanDays,
    startTime: body.start_time,
    endTime: body.end_time,
    durationSec: requestedDur,
    active: body.active ?? true,
  };
}
