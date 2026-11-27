import React, { useState } from 'react';
import {
  Play,
  Square,
  Film,
  HardDrive,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Radio,
  PauseCircle,
  Plus,
} from 'lucide-react';
import { api, formatBytes, formatDuration, formatLocalDateTime } from '../api';
import type { ChannelDto, RecordingDto, SafeUser, StorageStatsDto } from '../types';

interface DashboardViewProps {
  user: SafeUser;
  channels: ChannelDto[];
  recentRecordings: RecordingDto[];
  storage: StorageStatsDto | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenReplay: (channelId: number, recordingId?: number, dateStr?: string) => void;
  onGoToChannels: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  user,
  channels,
  recentRecordings,
  storage,
  loading,
  onRefresh,
  onOpenReplay,
  onGoToChannels,
}) => {
  const [busyChannelId, setBusyChannelId] = useState<number | null>(null);
  const [manualDurationMin, setManualDurationMin] = useState<number>(10);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const isAdmin = user.role === 'admin';
  const recordingCount = channels.filter((c) => c.is_recording).length;
  const activeChannels = channels.filter((c) => c.active).length;

  const handleStartManual = async (ch: ChannelDto) => {
    setBusyChannelId(ch.id);
    setFeedback(null);
    try {
      const sec = Math.max(10, Math.round(manualDurationMin * 60));
      await api.startCapture(ch.id, sec);
      setFeedback({ type: 'ok', text: `Captura manual iniciada em "${ch.name}" (${manualDurationMin} min).` });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao iniciar captura.' });
    } finally {
      setBusyChannelId(null);
    }
  };

  const handleStopManual = async (ch: ChannelDto) => {
    setBusyChannelId(ch.id);
    setFeedback(null);
    try {
      await api.stopCapture(ch.id);
      setFeedback({ type: 'ok', text: `Sinal de parada enviado para "${ch.name}".` });
      setTimeout(onRefresh, 600);
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao parar captura.' });
    } finally {
      setBusyChannelId(null);
    }
  };

  if (loading && !storage) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-[#131B2E] border border-slate-800 animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-[#131B2E] border border-slate-800 animate-pulse" />
      </div>
    );
  }

  const diskPercent = storage?.diskUsedPercent ?? 0;
  const maxPercent = storage?.maxDiskPercent ?? 85;
  const diskHigh = diskPercent >= maxPercent;
  const diskWarn = !diskHigh && diskPercent >= maxPercent - 10;

  return (
    <div className="space-y-8">
      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-sm flex items-center justify-between gap-3 ${
            feedback.type === 'ok'
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : 'bg-red-950/40 border-red-800/60 text-red-200'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs text-slate-400 hover:text-slate-200 whitespace-nowrap cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {/* 4-column summary strip */}
      <section aria-label="Resumo operacional" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#131B2E] border border-slate-800 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-400 mb-2">Canais Autorizados</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-100 font-mono tabular-nums">
              {activeChannels}
            </span>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              / {channels.length} cadastrados
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
            <Radio className={`w-3.5 h-3.5 ${recordingCount > 0 ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className="font-mono tabular-nums">
              {recordingCount} gravando agora
            </span>
          </div>
        </div>

        <div className="bg-[#131B2E] border border-slate-800 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-400 mb-2">Disco Local</div>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-semibold font-mono tabular-nums ${
                diskHigh ? 'text-red-400' : diskWarn ? 'text-amber-400' : 'text-slate-100'
              }`}
            >
              {diskPercent.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              de {formatBytes(storage?.diskTotalBytes ?? 0)}
            </span>
          </div>
          <div className="mt-2 w-full bg-[#090D16] h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                diskHigh ? 'bg-red-500' : diskWarn ? 'bg-amber-500' : 'bg-blue-500'
              }`}
              style={{ width: `${Math.min(100, diskPercent)}%` }}
            />
          </div>
        </div>

        <div className="bg-[#131B2E] border border-slate-800 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-400 mb-2">Mídia Indexada (NVR)</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-100 font-mono tabular-nums">
              {formatBytes(storage?.nvrUsedBytes ?? 0)}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-400 font-mono tabular-nums flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-slate-500" />
            <span>{storage?.nvrRecordingCount ?? 0} arquivos válidos</span>
          </div>
        </div>

        <div className="bg-[#131B2E] border border-slate-800 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-400 mb-2">Política de Retenção</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-100 font-mono tabular-nums">
              {storage?.retentionDays ?? 90}d
            </span>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              · trava {maxPercent}%
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-400 truncate font-mono" title={storage?.storageRoot}>
            {storage?.storageRoot ?? './recordings'}
          </div>
        </div>
      </section>

      {/* Channels operational table */}
      <section className="bg-[#131B2E] border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Estado dos Canais</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Monitoramento de capturas ativas, agendamentos e acesso rápido ao replay temporal
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <label htmlFor="manual-dur" className="text-slate-400 whitespace-nowrap">
                Captura manual:
              </label>
              <select
                id="manual-dur"
                value={manualDurationMin}
                onChange={(e) => setManualDurationMin(Number(e.target.value))}
                className="bg-[#090D16] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value={1}>1 min</option>
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
              </select>
            </div>
          )}
        </div>

        {channels.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-300 mb-1">Nenhum canal disponível para visualização.</p>
            <p className="text-xs text-slate-500 mb-4">
              {isAdmin
                ? 'Cadastre um canal RTSP para iniciar as capturas agendadas ou manuais.'
                : 'Solicite ao administrador a liberação de acesso aos canais desejados.'}
            </p>
            {isAdmin && (
              <button
                onClick={onGoToChannels}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Cadastrar Primeiro Canal
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400 bg-[#0F172A]/60">
                  <th className="py-3 px-5">Canal</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4">Áudio / Janelas</th>
                  <th className="py-3 px-4">Origem RTSP</th>
                  <th className="py-3 px-5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-sm">
                {channels.map((ch) => {
                  const isRec = ch.is_recording;
                  const isErr = !isRec && ch.last_status === 'error';
                  const isScheduled = !isRec && !isErr && ch.active && (ch.schedule_count ?? 0) > 0;
                  const isBusy = busyChannelId === ch.id;

                  return (
                    <tr key={ch.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-100">{ch.name}</div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          Canal #{ch.id} {!ch.active ? '· Desativado' : ''}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        {isRec ? (
                          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                            <Radio className="w-3.5 h-3.5" />
                            <span>Gravando agora</span>
                          </div>
                        ) : isErr ? (
                          <div>
                            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Erro / Offline</span>
                            </div>
                            {ch.last_error && (
                              <div className="text-xs text-red-300/80 max-w-xs truncate mt-0.5" title={ch.last_error}>
                                {ch.last_error}
                              </div>
                            )}
                          </div>
                        ) : isScheduled ? (
                          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Agendado</span>
                          </div>
                        ) : ch.active ? (
                          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
                            <span>Ocioso</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                            <PauseCircle className="w-3.5 h-3.5" />
                            <span>Inativo</span>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs text-slate-300 font-mono tabular-nums">
                        <span>{ch.audio_mode}</span>
                        <span className="text-slate-600 mx-1.5">·</span>
                        <span>{ch.schedule_count ?? 0} regra(s)</span>
                      </td>

                      <td className="py-3 px-4">
                        <span className="text-xs font-mono text-slate-400 block max-w-xs truncate" title={ch.masked_uri}>
                          {ch.masked_uri}
                        </span>
                      </td>

                      <td className="py-3 px-5 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            onClick={() => onOpenReplay(ch.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#090D16] hover:bg-slate-800 border border-slate-700 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <Film className="w-3.5 h-3.5 text-blue-400" />
                            Replay
                          </button>

                          {isAdmin &&
                            (isRec ? (
                              <button
                                disabled={isBusy}
                                onClick={() => handleStopManual(ch)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-200 bg-red-950/60 hover:bg-red-900/70 border border-red-800/70 rounded-md transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
                              >
                                <Square className="w-3 h-3 fill-current" />
                                Parar
                              </button>
                            ) : (
                              <button
                                disabled={isBusy || !ch.active}
                                onClick={() => handleStartManual(ch)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap disabled:opacity-40 cursor-pointer"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                Capturar
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent recordings */}
      <section className="bg-[#131B2E] border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Gravações Recentes</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Clipes verificados no armazenamento local prontos para inspeção
            </p>
          </div>
        </div>

        {recentRecordings.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Nenhuma gravação indexada até o momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400 bg-[#0F172A]/60">
                  <th className="py-2.5 px-5">Início</th>
                  <th className="py-2.5 px-4">Canal</th>
                  <th className="py-2.5 px-4">Duração</th>
                  <th className="py-2.5 px-4">Tamanho</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-xs">
                {recentRecordings.map((rec) => {
                  const datePart = rec.start_time.slice(0, 10);
                  return (
                    <tr key={rec.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-5 font-mono tabular-nums text-slate-200 whitespace-nowrap">
                        {formatLocalDateTime(rec.start_time)}
                      </td>
                      <td className="py-2.5 px-4 text-slate-200 font-medium">
                        {rec.channel_name || `Canal #${rec.channel_id}`}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-300">
                        {formatDuration(rec.duration_sec)}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-300">
                        {formatBytes(rec.file_size_bytes)}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={
                            rec.status === 'completed'
                              ? 'text-emerald-400'
                              : rec.status === 'recording'
                              ? 'text-blue-400'
                              : 'text-amber-400'
                          }
                        >
                          {rec.status === 'completed'
                            ? 'Concluída'
                            : rec.status === 'recording'
                            ? 'Gravando'
                            : 'Interrompida'}
                        </span>
                      </td>
                      <td className="py-2.5 px-5 text-right">
                        {rec.status !== 'recording' ? (
                          <button
                            onClick={() => onOpenReplay(rec.channel_id, rec.id, datePart)}
                            className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                            Reproduzir
                          </button>
                        ) : (
                          <span className="text-slate-500">Em gravação</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
