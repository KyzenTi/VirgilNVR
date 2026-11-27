import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  SkipBack,
  SkipForward,
  Download,
  Trash2,
  Search,
  AlertCircle,
  Film,
  Repeat,
} from 'lucide-react';
import {
  api,
  formatBytes,
  formatDuration,
  formatLocalDateTime,
  formatLocalTimeOnly,
  getTodayLocalDate,
} from '../api';
import type { ChannelDto, RecordingDto, SafeUser } from '../types';

interface ReplayViewProps {
  user: SafeUser;
  channels: ChannelDto[];
  initialChannelId?: number | null;
  initialRecordingId?: number | null;
  initialDate?: string | null;
}

export const ReplayView: React.FC<ReplayViewProps> = ({
  user,
  channels,
  initialChannelId,
  initialRecordingId,
  initialDate,
}) => {
  const [selectedChannelId, setSelectedChannelId] = useState<number>(
    initialChannelId ?? channels[0]?.id ?? 0
  );
  const [date, setDate] = useState<string>(initialDate || getTodayLocalDate());
  const [fromTime, setFromTime] = useState<string>('00:00');
  const [toTime, setToTime] = useState<string>('23:59');

  const [recordings, setRecordings] = useState<RecordingDto[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [continuousPlay, setContinuousPlay] = useState<boolean>(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isAdmin = user.role === 'admin';

  useEffect(() => {
    if (initialChannelId) {
      setSelectedChannelId(initialChannelId);
    } else if (!selectedChannelId && channels.length > 0) {
      setSelectedChannelId(channels[0].id);
    }
  }, [initialChannelId, channels, selectedChannelId]);

  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);

  const loadRecordings = async (targetRecId?: number | null) => {
    if (!selectedChannelId) {
      setRecordings([]);
      setActiveIndex(-1);
      return;
    }
    setLoading(true);
    setError(null);
    setVideoError(null);

    try {
      const res = await api.getRecordings({
        channelId: selectedChannelId,
        date,
        from: fromTime,
        to: toTime,
      });

      const playable = res.recordings.filter((r) => r.status !== 'recording');
      setRecordings(playable);

      if (playable.length === 0) {
        setActiveIndex(-1);
      } else if (targetRecId) {
        const foundIdx = playable.findIndex((r) => r.id === targetRecId);
        setActiveIndex(foundIdx >= 0 ? foundIdx : 0);
      } else {
        setActiveIndex(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao consultar gravações.');
      setRecordings([]);
      setActiveIndex(-1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedChannelId) {
      loadRecordings(initialRecordingId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannelId, date]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, activeIndex]);

  const currentClip = activeIndex >= 0 && activeIndex < recordings.length ? recordings[activeIndex] : null;

  const handleVideoEnded = () => {
    if (continuousPlay && activeIndex >= 0 && activeIndex < recordings.length - 1) {
      setVideoError(null);
      setActiveIndex((prev) => prev + 1);
    }
  };

  const handleDeleteClip = async (rec: RecordingDto) => {
    try {
      await api.deleteRecording(rec.id);
      const nextList = recordings.filter((item) => item.id !== rec.id);
      setRecordings(nextList);
      if (nextList.length === 0) {
        setActiveIndex(-1);
      } else if (activeIndex >= nextList.length) {
        setActiveIndex(nextList.length - 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir gravação.');
    }
  };

  const applyPreset = (from: string, to: string) => {
    setFromTime(from);
    setToTime(to);
  };

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadRecordings(null);
        }}
        className="bg-[#131B2E] border border-slate-800 rounded-lg p-4 flex flex-wrap items-end gap-4"
      >
        <div className="min-w-[200px] flex-1">
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Canal</label>
          <select
            value={selectedChannelId}
            onChange={(e) => setSelectedChannelId(Number(e.target.value))}
            className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          >
            {channels.length === 0 && <option value={0}>Nenhum canal liberado</option>}
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                #{ch.id} — {ch.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Data</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Hora Inicial</label>
          <input
            type="time"
            value={fromTime}
            onChange={(e) => setFromTime(e.target.value)}
            className="bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Hora Final</label>
          <input
            type="time"
            value={toTime}
            onChange={(e) => setToTime(e.target.value)}
            className="bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !selectedChannelId}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <Search className="w-4 h-4" />
          Consultar
        </button>

        <div className="w-full pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 mr-1">Janelas rápidas:</span>
            <button
              type="button"
              onClick={() => applyPreset('06:00', '12:00')}
              className="px-2.5 py-1 rounded bg-[#090D16] hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
            >
              06:00 – 12:00
            </button>
            <button
              type="button"
              onClick={() => applyPreset('12:00', '18:00')}
              className="px-2.5 py-1 rounded bg-[#090D16] hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
            >
              12:00 – 18:00
            </button>
            <button
              type="button"
              onClick={() => applyPreset('00:00', '23:59')}
              className="px-2.5 py-1 rounded bg-[#090D16] hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
            >
              Dia inteiro
            </button>
          </div>

          <button
            type="button"
            onClick={() => setContinuousPlay((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded border transition-colors cursor-pointer ${
              continuousPlay
                ? 'bg-blue-600/15 border-blue-500/40 text-blue-300'
                : 'bg-[#090D16] border-slate-800 text-slate-400'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            Reprodução contínua: {continuousPlay ? 'Ligada' : 'Desligada'}
          </button>
        </div>
      </form>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-950/50 border border-red-800/70 flex items-center gap-2.5 text-sm text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main split: Video Player + Segment Playlist */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 bg-[#131B2E] border border-slate-800 rounded-lg overflow-hidden">
          {currentClip ? (
            <>
              <div className="bg-black aspect-video relative flex items-center justify-center">
                <video
                  key={currentClip.id}
                  ref={videoRef}
                  src={`/api/recordings/${currentClip.id}/stream`}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  onEnded={handleVideoEnded}
                  onError={() =>
                    setVideoError(
                      'Não foi possível carregar este segmento de vídeo. O arquivo pode ter sido removido ou está em formato incompatível.'
                    )
                  }
                  className="w-full h-full object-contain"
                />
              </div>

              {videoError && (
                <div className="px-4 py-2.5 bg-red-950/60 border-t border-red-800/70 text-xs text-red-200 flex items-center justify-between gap-3">
                  <span>{videoError}</span>
                  {activeIndex < recordings.length - 1 && (
                    <button
                      onClick={() => {
                        setVideoError(null);
                        setActiveIndex((i) => i + 1);
                      }}
                      className="underline text-red-100 whitespace-nowrap cursor-pointer"
                    >
                      Pular para o próximo
                    </button>
                  )}
                </div>
              )}

              <div className="p-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-100">
                    {currentClip.channel_name || `Canal #${currentClip.channel_id}`}
                  </div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                    {formatLocalDateTime(currentClip.start_time)} · {formatDuration(currentClip.duration_sec)} ·{' '}
                    {formatBytes(currentClip.file_size_bytes)} · Segmento {activeIndex + 1}/{recordings.length}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={activeIndex <= 0}
                    onClick={() => {
                      setVideoError(null);
                      setActiveIndex((i) => Math.max(0, i - 1));
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-[#090D16] hover:bg-slate-800 disabled:opacity-40 border border-slate-700 rounded-md text-slate-200 cursor-pointer"
                  >
                    <SkipBack className="w-3.5 h-3.5" />
                    Anterior
                  </button>

                  <button
                    type="button"
                    disabled={activeIndex >= recordings.length - 1}
                    onClick={() => {
                      setVideoError(null);
                      setActiveIndex((i) => Math.min(recordings.length - 1, i + 1));
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-[#090D16] hover:bg-slate-800 disabled:opacity-40 border border-slate-700 rounded-md text-slate-200 cursor-pointer"
                  >
                    Próximo
                    <SkipForward className="w-3.5 h-3.5" />
                  </button>

                  <select
                    aria-label="Velocidade de reprodução"
                    value={playbackRate}
                    onChange={(e) => setPlaybackRate(Number(e.target.value))}
                    className="bg-[#090D16] border border-slate-700 rounded-md px-2 py-1.5 text-xs font-mono text-slate-200"
                  >
                    <option value={1}>1.0x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2}>2.0x</option>
                  </select>

                  <a
                    href={`/api/recordings/${currentClip.id}/stream?download=1`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar MP4
                  </a>
                </div>
              </div>
            </>
          ) : (
            <div className="aspect-video flex flex-col items-center justify-center p-8 text-center bg-[#090D16]/60">
              <Film className="w-10 h-10 text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-300">
                {loading ? 'Consultando segmentos gravados...' : 'Nenhum segmento disponível neste intervalo'}
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                Selecione outro canal, data ou amplie a faixa horária para listar as gravações armazenadas localmente.
              </p>
            </div>
          )}
        </div>

        {/* Chronological playlist */}
        <div className="lg:col-span-4 bg-[#131B2E] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Segmentos no Período</h3>
            <span className="text-xs font-mono tabular-nums text-slate-400">{recordings.length} clipes</span>
          </div>

          <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-800/80">
            {recordings.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Sem clipes encontrados para o filtro atual.
              </div>
            ) : (
              recordings.map((rec, idx) => {
                const isSelected = idx === activeIndex;
                return (
                  <div
                    key={rec.id}
                    className={`px-4 py-3 flex items-center justify-between gap-3 transition-colors ${
                      isSelected ? 'bg-blue-600/15' : 'hover:bg-slate-800/35'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setVideoError(null);
                        setActiveIndex(idx);
                      }}
                      className="flex-1 text-left cursor-pointer min-w-0"
                    >
                      <div className="flex items-center gap-2">
                        <Play
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected ? 'text-blue-400 fill-blue-400' : 'text-slate-500'
                          }`}
                        />
                        <span className="text-xs font-mono tabular-nums font-medium text-slate-100">
                          {formatLocalTimeOnly(rec.start_time)}
                        </span>
                        <span className="text-xs text-slate-500 font-mono tabular-nums">
                          · {formatDuration(rec.duration_sec)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums pl-5 mt-0.5 truncate">
                        {formatBytes(rec.file_size_bytes)} ·{' '}
                        {rec.status === 'interrupted' ? 'Parcial/Interrompida' : 'Completa'}
                      </div>
                    </button>

                    {isAdmin && (
                      <button
                        type="button"
                        title="Excluir gravação do disco"
                        onClick={() => handleDeleteClip(rec)}
                        className="p-1.5 text-slate-500 hover:text-red-400 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
