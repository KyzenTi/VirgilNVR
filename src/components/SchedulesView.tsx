import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Power, Clock, AlertCircle, X, Radio } from 'lucide-react';
import { api, formatDuration } from '../api';
import type { ChannelDto, ScheduleDto } from '../types';

interface SchedulesViewProps {
  channels: ChannelDto[];
}

const WEEKDAYS = [
  { id: 1, label: 'Seg' },
  { id: 2, label: 'Ter' },
  { id: 3, label: 'Qua' },
  { id: 4, label: 'Qui' },
  { id: 5, label: 'Sex' },
  { id: 6, label: 'Sáb' },
  { id: 0, label: 'Dom' },
];

function computeWindowSeconds(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return 0;
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) * 60);
}

export const SchedulesView: React.FC<SchedulesViewProps> = ({ channels }) => {
  const [schedules, setSchedules] = useState<ScheduleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [channelId, setChannelId] = useState<number>(channels[0]?.id ?? 0);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('08:15');
  const [durationMin, setDurationMin] = useState(15);
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSchedules = async () => {
    try {
      const res = await api.getSchedules();
      setSchedules(res.schedules);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar agendamentos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchedules();
  }, []);

  const openCreate = () => {
    setEditId(null);
    setChannelId(channels[0]?.id ?? 0);
    setLabel('');
    setDays([1, 2, 3, 4, 5, 6]);
    setStartTime('08:00');
    setEndTime('08:15');
    setDurationMin(15);
    setActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (s: ScheduleDto) => {
    setEditId(s.id);
    setChannelId(s.channel_id);
    setLabel(s.label);
    setDays(s.days_of_week);
    setStartTime(s.start_time);
    setEndTime(s.end_time);
    setDurationMin(Math.max(1, Math.round(s.duration_sec / 60)));
    setActive(s.active);
    setFormError(null);
    setModalOpen(true);
  };

  const toggleDay = (dayId: number) => {
    setDays((prev) => (prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId]));
  };

  const handleTimeChange = (nextStart: string, nextEnd: string) => {
    setStartTime(nextStart);
    setEndTime(nextEnd);
    const winSec = computeWindowSeconds(nextStart, nextEnd);
    if (winSec > 0) {
      setDurationMin(Math.max(1, Math.floor(winSec / 60)));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const winSec = computeWindowSeconds(startTime, endTime);
    if (winSec <= 0) {
      setFormError('O horário final deve ser maior que o horário inicial.');
      return;
    }

    const durationSec = Math.round(durationMin * 60);
    if (durationSec > winSec) {
      setFormError(`A duração (${durationMin} min) excede a janela de ${Math.floor(winSec / 60)} min.`);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        channel_id: channelId,
        label,
        days_of_week: days,
        start_time: startTime,
        end_time: endTime,
        duration_sec: durationSec,
        active,
      };
      if (editId === null) {
        await api.createSchedule(payload);
      } else {
        await api.updateSchedule(editId, payload);
      }
      setModalOpen(false);
      loadSchedules();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar agendamento.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (s: ScheduleDto) => {
    try {
      await api.updateSchedule(s.id, { active: !s.active });
      loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar estado.');
    }
  };

  const handleDelete = async (s: ScheduleDto) => {
    try {
      await api.deleteSchedule(s.id);
      loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir agendamento.');
    }
  };

  const formatDaysText = (dList: number[]) =>
    WEEKDAYS.filter((w) => dList.includes(w.id))
      .map((w) => w.label)
      .join(', ');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Custom Scheduler</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Janelas recorrentes por canal sem sobreposição de processos simultâneos.
          </p>
        </div>
        <button
          disabled={channels.length === 0}
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Novo Agendamento
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-950/50 border border-red-800/70 flex items-center gap-2 text-sm text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-[#131B2E] border border-slate-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Carregando agendamentos...</div>
        ) : schedules.length === 0 ? (
          <div className="p-10 text-center">
            <Clock className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-300 mb-1">Nenhuma regra de agendamento configurada.</p>
            <p className="text-xs text-slate-500 mb-4">
              Crie janelas de 10 a 15 minutos (ex.: segunda a sábado) para captura automática via FFmpeg.
            </p>
            {channels.length > 0 && (
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-4 py-2 rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Criar Primeiro Agendamento
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400 bg-[#0F172A]/60">
                  <th className="py-3 px-5">Canal / Rótulo</th>
                  <th className="py-3 px-4">Dias da Semana</th>
                  <th className="py-3 px-4">Janela</th>
                  <th className="py-3 px-4">Duração</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-sm">
                {schedules.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/25">
                    <td className="py-3.5 px-5">
                      <div className="font-medium text-slate-100">
                        {s.channel_name || `Canal #${s.channel_id}`}
                      </div>
                      <div className="text-xs text-slate-400">
                        {s.label || 'Janela programada'}
                        {s.last_run_at ? ` · Última execução: ${s.last_run_at}` : ''}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-xs text-slate-300">
                      {formatDaysText(s.days_of_week)}
                    </td>

                    <td className="py-3.5 px-4 text-xs font-mono tabular-nums text-slate-200">
                      {s.start_time} – {s.end_time}
                    </td>

                    <td className="py-3.5 px-4 text-xs font-mono tabular-nums text-slate-300">
                      {formatDuration(s.duration_sec)}
                    </td>

                    <td className="py-3.5 px-4 text-xs">
                      {s.channel_recording ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                          <Radio className="w-3.5 h-3.5" />
                          Canal gravando
                        </span>
                      ) : s.active ? (
                        <span className="text-slate-200">Ativo</span>
                      ) : (
                        <span className="text-slate-500">Pausado</span>
                      )}
                    </td>

                    <td className="py-3.5 px-5 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleToggleActive(s)}
                          title={s.active ? 'Pausar agendamento' : 'Ativar agendamento'}
                          className="p-1.5 text-slate-400 hover:text-slate-100 bg-[#090D16] border border-slate-700 rounded-md cursor-pointer"
                        >
                          <Power className={`w-3.5 h-3.5 ${s.active ? 'text-emerald-400' : 'text-slate-500'}`} />
                        </button>
                        <button
                          onClick={() => openEdit(s)}
                          title="Editar agendamento"
                          className="p-1.5 text-slate-400 hover:text-slate-100 bg-[#090D16] border border-slate-700 rounded-md cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(s)}
                          title="Excluir agendamento"
                          className="p-1.5 text-slate-400 hover:text-red-400 bg-[#090D16] border border-slate-700 rounded-md cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#131B2E] border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">
                {editId === null ? 'Novo Agendamento' : 'Editar Agendamento'}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-red-950/50 border border-red-800/70 text-xs text-red-200">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Canal</label>
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(Number(e.target.value))}
                  className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.id} — {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Identificação / Turno</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex.: Inspeção Manhã 08h"
                  className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-300">Dias da Semana</label>
                  <button
                    type="button"
                    onClick={() => setDays([1, 2, 3, 4, 5, 6])}
                    className="text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer"
                  >
                    Seg–Sáb
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((w) => {
                    const selected = days.includes(w.id);
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => toggleDay(w.id)}
                        className={`py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                          selected
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-[#090D16] border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Início</label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => handleTimeChange(e.target.value, endTime)}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-2.5 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Fim</label>
                  <input
                    type="time"
                    required
                    value={endTime}
                    onChange={(e) => handleTimeChange(startTime, e.target.value)}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-2.5 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Duração (min)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={240}
                    value={durationMin}
                    onChange={(e) => setDurationMin(Number(e.target.value))}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-2.5 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="rounded border-slate-700 bg-[#090D16] text-blue-600"
                />
                Regra ativa no scheduler
              </label>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-300 hover:text-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg cursor-pointer"
                >
                  {saving ? 'Salvando...' : 'Salvar Regra'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
