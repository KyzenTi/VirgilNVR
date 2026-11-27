import React, { useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Activity,
  CheckCircle2,
  AlertCircle,
  X,
  Power,
} from 'lucide-react';
import { api } from '../api';
import type { AudioMode, ChannelDto, StreamTestResult } from '../types';

interface ChannelsViewProps {
  channels: ChannelDto[];
  onRefresh: () => void;
}

interface ChannelFormState {
  id: number | null;
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
}

const emptyForm: ChannelFormState = {
  id: null,
  name: '',
  rtsp_uri_mode: 'structured',
  rtsp_host: '',
  rtsp_port: 554,
  rtsp_path: '/cam/realmonitor?channel=1&subtype=0',
  rtsp_user: '',
  rtsp_password: '',
  raw_uri: '',
  audio_mode: 'aac',
  active: true,
};

export const ChannelsView: React.FC<ChannelsViewProps> = ({ channels, onRefresh }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ChannelFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, StreamTestResult>>({});

  const openCreate = () => {
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (ch: ChannelDto) => {
    setForm({
      id: ch.id,
      name: ch.name,
      rtsp_uri_mode: ch.rtsp_uri_mode,
      rtsp_host: ch.rtsp_host,
      rtsp_port: ch.rtsp_port,
      rtsp_path: ch.rtsp_path,
      rtsp_user: ch.rtsp_user,
      rtsp_password: '',
      raw_uri: '',
      audio_mode: ch.audio_mode,
      active: ch.active,
    });
    setError(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (form.id === null) {
        await api.createChannel({
          name: form.name,
          rtsp_uri_mode: form.rtsp_uri_mode,
          rtsp_host: form.rtsp_host,
          rtsp_port: form.rtsp_port,
          rtsp_path: form.rtsp_path,
          rtsp_user: form.rtsp_user,
          rtsp_password: form.rtsp_password,
          raw_uri: form.raw_uri,
          audio_mode: form.audio_mode,
          active: form.active,
        });
      } else {
        await api.updateChannel(form.id, {
          name: form.name,
          rtsp_uri_mode: form.rtsp_uri_mode,
          rtsp_host: form.rtsp_host,
          rtsp_port: form.rtsp_port,
          rtsp_path: form.rtsp_path,
          rtsp_user: form.rtsp_user,
          ...(form.rtsp_password ? { rtsp_password: form.rtsp_password } : {}),
          ...(form.raw_uri ? { raw_uri: form.raw_uri } : {}),
          audio_mode: form.audio_mode,
          active: form.active,
        });
      }
      setModalOpen(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar canal.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ch: ChannelDto) => {
    try {
      await api.deleteChannel(ch.id);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir canal.');
    }
  };

  const handleToggleActive = async (ch: ChannelDto) => {
    try {
      await api.updateChannel(ch.id, { active: !ch.active });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alternar status do canal.');
    }
  };

  const handleTest = async (ch: ChannelDto) => {
    setTestingId(ch.id);
    try {
      const result = await api.testChannel(ch.id);
      setTestResults((prev) => ({ ...prev, [ch.id]: result }));
      onRefresh();
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [ch.id]: { ok: false, message: err instanceof Error ? err.message : 'Erro ao testar stream.' },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const applyRecommendedAudio = async (ch: ChannelDto, mode: AudioMode) => {
    await api.updateChannel(ch.id, { audio_mode: mode });
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Editor de Canais RTSP</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Senhas RTSP são cifradas no servidor e mascaradas em todas as respostas da API.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Novo Canal
        </button>
      </div>

      <div className="bg-[#131B2E] border border-slate-800 rounded-lg overflow-hidden">
        {channels.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-300 mb-1">Nenhum canal RTSP configurado.</p>
            <p className="text-xs text-slate-500 mb-4">
              Adicione seus canais de DVR/NVR ou câmeras IP locais para iniciar as gravações.
            </p>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-4 py-2 rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Adicionar Canal
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400 bg-[#0F172A]/60">
                  <th className="py-3 px-5">Canal</th>
                  <th className="py-3 px-4">URI Mascarada</th>
                  <th className="py-3 px-4">Modo Áudio</th>
                  <th className="py-3 px-4">Diagnóstico</th>
                  <th className="py-3 px-5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-sm">
                {channels.map((ch) => {
                  const test = testResults[ch.id];
                  return (
                    <tr key={ch.id} className="hover:bg-slate-800/25">
                      <td className="py-3.5 px-5">
                        <div className="font-medium text-slate-100">{ch.name}</div>
                        <div className="text-xs text-slate-500 font-mono">
                          #{ch.id} · {ch.active ? 'Ativo' : 'Desativado'}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="text-xs font-mono text-slate-300 block max-w-sm truncate" title={ch.masked_uri}>
                          {ch.masked_uri}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-xs font-mono text-slate-300">
                        {ch.audio_mode === 'aac'
                          ? 'aac (-c:a aac + fallback)'
                          : ch.audio_mode === 'copy'
                          ? 'copy (-c:a copy)'
                          : 'none (-an)'}
                      </td>

                      <td className="py-3.5 px-4 text-xs">
                        {test ? (
                          <div className="space-y-1">
                            <div className={`flex items-center gap-1.5 ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                              {test.ok ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span className="max-w-xs truncate" title={test.message}>
                                {test.message}
                              </span>
                            </div>
                            {test.ok && test.recommendedAudioMode && test.recommendedAudioMode !== ch.audio_mode && (
                              <button
                                onClick={() => applyRecommendedAudio(ch, test.recommendedAudioMode!)}
                                className="text-[11px] text-amber-300 underline cursor-pointer"
                              >
                                Aplicar modo recomendado ({test.recommendedAudioMode})
                              </button>
                            )}
                          </div>
                        ) : ch.last_error ? (
                          <span className="text-red-400 block max-w-xs truncate" title={ch.last_error}>
                            {ch.last_error}
                          </span>
                        ) : (
                          <span className="text-slate-500">Não testado nesta sessão</span>
                        )}
                      </td>

                      <td className="py-3.5 px-5 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            disabled={testingId === ch.id}
                            onClick={() => handleTest(ch)}
                            title="Testar stream RTSP com ffprobe"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-[#090D16] hover:bg-slate-800 border border-slate-700 rounded-md text-slate-200 disabled:opacity-50 cursor-pointer"
                          >
                            <Activity className="w-3.5 h-3.5 text-blue-400" />
                            {testingId === ch.id ? 'Testando...' : 'Testar'}
                          </button>
                          <button
                            onClick={() => handleToggleActive(ch)}
                            title={ch.active ? 'Desativar canal' : 'Ativar canal'}
                            className="p-1.5 text-slate-400 hover:text-slate-100 bg-[#090D16] border border-slate-700 rounded-md cursor-pointer"
                          >
                            <Power className={`w-3.5 h-3.5 ${ch.active ? 'text-emerald-400' : 'text-slate-500'}`} />
                          </button>
                          <button
                            onClick={() => openEdit(ch)}
                            title="Editar canal"
                            className="p-1.5 text-slate-400 hover:text-slate-100 bg-[#090D16] border border-slate-700 rounded-md cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(ch)}
                            title="Excluir canal"
                            className="p-1.5 text-slate-400 hover:text-red-400 bg-[#090D16] border border-slate-700 rounded-md cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#131B2E] border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">
                {form.id === null ? 'Novo Canal RTSP' : `Editar Canal #${form.id}`}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {error && (
                <div className="p-3 rounded-lg bg-red-950/50 border border-red-800/70 text-xs text-red-200">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Nome do Canal</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex.: Linha Produção 01 - Câmera 18"
                  className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Modo de Configuração RTSP</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-[#090D16] border border-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, rtsp_uri_mode: 'structured' })}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      form.rtsp_uri_mode === 'structured'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Campos Estruturados
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, rtsp_uri_mode: 'raw' })}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      form.rtsp_uri_mode === 'raw'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    URI RTSP Direta
                  </button>
                </div>
              </div>

              {form.rtsp_uri_mode === 'structured' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-300 mb-1">IP / Host do DVR</label>
                      <input
                        type="text"
                        required
                        value={form.rtsp_host}
                        onChange={(e) => setForm({ ...form, rtsp_host: e.target.value })}
                        placeholder="192.168.1.50"
                        className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Porta</label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={65535}
                        value={form.rtsp_port}
                        onChange={(e) => setForm({ ...form, rtsp_port: Number(e.target.value) })}
                        className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Caminho do Stream</label>
                    <input
                      type="text"
                      required
                      value={form.rtsp_path}
                      onChange={(e) => setForm({ ...form, rtsp_path: e.target.value })}
                      placeholder="/cam/realmonitor?channel=18&subtype=0"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Usuário RTSP</label>
                      <input
                        type="text"
                        value={form.rtsp_user}
                        onChange={(e) => setForm({ ...form, rtsp_user: e.target.value })}
                        placeholder="admin"
                        className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Senha RTSP {form.id !== null && '(vazio mantém atual)'}
                      </label>
                      <input
                        type="password"
                        value={form.rtsp_password}
                        onChange={(e) => setForm({ ...form, rtsp_password: e.target.value })}
                        placeholder={form.id !== null ? '•••••• (inalterada)' : 'Senha do DVR'}
                        className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    URI RTSP Completa {form.id !== null && '(deixe em branco para manter a atual)'}
                  </label>
                  <input
                    type="text"
                    required={form.id === null}
                    value={form.raw_uri}
                    onChange={(e) => setForm({ ...form, raw_uri: e.target.value })}
                    placeholder="rtsp://usuario:senha@192.168.1.50:554/cam/realmonitor?channel=18&subtype=0"
                    className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Tratamento de Áudio</label>
                  <select
                    value={form.audio_mode}
                    onChange={(e) => setForm({ ...form, audio_mode: e.target.value as AudioMode })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="aac">AAC (-c:a aac + fallback -an)</option>
                    <option value="copy">Copy (-c:a copy)</option>
                    <option value="none">Sem áudio (-an)</option>
                  </select>
                </div>

                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => setForm({ ...form, active: e.target.checked })}
                      className="rounded border-slate-700 bg-[#090D16] text-blue-600"
                    />
                    Canal ativo para capturas
                  </label>
                </div>
              </div>

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
                  {saving ? 'Salvando...' : 'Salvar Canal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
