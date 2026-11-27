import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, HardDrive, Users, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { api, formatBytes } from '../api';
import type { ChannelAccessMode, ChannelDto, SafeUser, SystemSettingsDto, UserRole } from '../types';

interface AdminSettingsViewProps {
  currentUser: SafeUser;
  channels: ChannelDto[];
}

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({ currentUser, channels }) => {
  const [settings, setSettings] = useState<SystemSettingsDto | null>(null);
  const [retentionDays, setRetentionDays] = useState(90);
  const [maxDiskPercent, setMaxDiskPercent] = useState(85);
  const [viewerDefaultAll, setViewerDefaultAll] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [runningRetention, setRunningRetention] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [users, setUsers] = useState<SafeUser[]>([]);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uPass, setUPass] = useState('');
  const [uRole, setURole] = useState<UserRole>('viewer');
  const [uAccessMode, setUAccessMode] = useState<ChannelAccessMode>('default');
  const [uAllowedIds, setUAllowedIds] = useState<number[]>([]);
  const [uActive, setUActive] = useState(true);
  const [userError, setUserError] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState(false);

  const loadAll = async () => {
    try {
      const [sRes, uRes] = await Promise.all([api.getSettings(), api.getUsers()]);
      setSettings(sRes);
      setRetentionDays(sRes.retention_days);
      setMaxDiskPercent(sRes.max_disk_percent);
      setViewerDefaultAll(sRes.viewer_default_all_channels);
      setUsers(uRes.users);
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao carregar configurações.' });
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setFeedback(null);
    try {
      const updated = await api.updateSettings({
        retention_days: retentionDays,
        max_disk_percent: maxDiskPercent,
        viewer_default_all_channels: viewerDefaultAll,
      });
      setSettings(updated);
      setFeedback({ type: 'ok', text: 'Política de retenção e permissões padrão salvas.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao salvar configurações.' });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRunRetention = async () => {
    setRunningRetention(true);
    setFeedback(null);
    try {
      const res = await api.runRetention();
      setSettings((prev) => (prev ? { ...prev, storage: res.storage } : prev));
      setFeedback({
        type: 'ok',
        text: `Limpeza concluída: ${res.summary.deletedByAge} removidos por idade, ${res.summary.deletedByDiskLimit} por limite de disco (${formatBytes(res.summary.freedBytes)} liberados).`,
      });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao executar limpeza.' });
    } finally {
      setRunningRetention(false);
    }
  };

  const openCreateUser = () => {
    setEditUserId(null);
    setUName('');
    setUEmail('');
    setUPass('');
    setURole('viewer');
    setUAccessMode('default');
    setUAllowedIds([]);
    setUActive(true);
    setUserError(null);
    setUserModalOpen(true);
  };

  const openEditUser = (u: SafeUser) => {
    setEditUserId(u.id);
    setUName(u.username);
    setUEmail(u.email);
    setUPass('');
    setURole(u.role);
    setUAccessMode(u.channel_access_mode);
    setUAllowedIds(u.allowed_channel_ids);
    setUActive(u.active);
    setUserError(null);
    setUserModalOpen(true);
  };

  const toggleAllowedChannel = (chId: number) => {
    setUAllowedIds((prev) => (prev.includes(chId) ? prev.filter((id) => id !== chId) : [...prev, chId]));
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError(null);
    setSavingUser(true);

    try {
      if (editUserId === null) {
        await api.createUser({
          username: uName,
          email: uEmail,
          password: uPass,
          role: uRole,
          channel_access_mode: uAccessMode,
          allowed_channel_ids: uAllowedIds,
          active: uActive,
        });
      } else {
        await api.updateUser(editUserId, {
          username: uName,
          email: uEmail,
          ...(uPass ? { password: uPass } : {}),
          role: uRole,
          channel_access_mode: uAccessMode,
          allowed_channel_ids: uAllowedIds,
          active: uActive,
        });
      }
      setUserModalOpen(false);
      loadAll();
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'Erro ao salvar usuário.');
    } finally {
      setSavingUser(false);
    }
  };

  const handleDeleteUser = async (u: SafeUser) => {
    try {
      await api.deleteUser(u.id);
      loadAll();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao excluir usuário.' });
    }
  };

  return (
    <div className="space-y-8">
      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-sm flex items-center gap-2.5 ${
            feedback.type === 'ok'
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : 'bg-red-950/40 border-red-800/60 text-red-200'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Retention & Global Viewer Policy */}
      <section className="bg-[#131B2E] border border-slate-800 rounded-lg p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">Retenção de Disco e Regra Padrão</h2>
              <p className="text-xs text-slate-400">
                Volume monitorado: <span className="font-mono text-slate-300">{settings?.storage.storageRoot ?? '—'}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={runningRetention}
            onClick={handleRunRetention}
            className="px-3.5 py-2 text-xs font-medium bg-[#090D16] hover:bg-slate-800 border border-slate-700 rounded-lg text-slate-200 disabled:opacity-50 cursor-pointer"
          >
            {runningRetention ? 'Executando limpeza...' : 'Executar Limpeza Agora'}
          </button>
        </div>

        <form onSubmit={handleSaveSettings} className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-5 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Retenção Máxima (dias)</label>
            <input
              type="number"
              min={1}
              max={3650}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
              className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Trava de Uso do Disco (%)</label>
            <input
              type="number"
              min={50}
              max={98}
              value={maxDiskPercent}
              onChange={(e) => setMaxDiskPercent(Number(e.target.value))}
              className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={viewerDefaultAll}
                onChange={(e) => setViewerDefaultAll(e.target.checked)}
                className="rounded border-slate-700 bg-[#090D16] text-blue-600"
              />
              <span>
                Liberar todos os canais ativos para <span className="font-mono">viewers</span> sem restrição explícita
              </span>
            </label>

            <button
              type="submit"
              disabled={savingSettings}
              className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg whitespace-nowrap disabled:opacity-50 cursor-pointer"
            >
              {savingSettings ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </section>

      {/* Users & Viewer Channel ACL */}
      <section className="bg-[#131B2E] border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">Usuários e Permissões por Canal</h2>
              <p className="text-xs text-slate-400">
                Controle aplicado no back-end em /api/channels, /api/recordings e streaming de vídeo.
              </p>
            </div>
          </div>

          <button
            onClick={openCreateUser}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3.5 py-2 rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Novo Usuário
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-medium text-slate-400 bg-[#0F172A]/60">
                <th className="py-3 px-5">Usuário</th>
                <th className="py-3 px-4">Perfil</th>
                <th className="py-3 px-4">Escopo de Canais</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-sm">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/25">
                  <td className="py-3 px-5">
                    <div className="font-medium text-slate-100">{u.username}</div>
                    <div className="text-xs text-slate-400 font-mono">{u.email}</div>
                  </td>

                  <td className="py-3 px-4 text-xs font-mono text-slate-200">{u.role}</td>

                  <td className="py-3 px-4 text-xs text-slate-300">
                    {u.role === 'admin'
                      ? 'Acesso total administrativo'
                      : u.channel_access_mode === 'restricted' || u.allowed_channel_ids.length > 0
                      ? `Restrito a ${u.allowed_channel_ids.length} canal(is)`
                      : viewerDefaultAll
                      ? 'Padrão global (todos os canais ativos)'
                      : 'Nenhum canal atribuído'}
                  </td>

                  <td className="py-3 px-4 text-xs">
                    <span className={u.active ? 'text-emerald-400' : 'text-slate-500'}>
                      {u.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>

                  <td className="py-3 px-5 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        onClick={() => openEditUser(u)}
                        className="p-1.5 text-slate-400 hover:text-slate-100 bg-[#090D16] border border-slate-700 rounded-md cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {u.id !== currentUser.id && (
                        <button
                          onClick={() => handleDeleteUser(u)}
                          className="p-1.5 text-slate-400 hover:text-red-400 bg-[#090D16] border border-slate-700 rounded-md cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {userModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#131B2E] border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">
                {editUserId === null ? 'Novo Usuário' : 'Editar Usuário'}
              </h3>
              <button
                onClick={() => setUserModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
              {userError && (
                <div className="p-3 rounded-lg bg-red-950/50 border border-red-800/70 text-xs text-red-200">
                  {userError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Usuário</label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={uName}
                    onChange={(e) => setUName(e.target.value)}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Perfil</label>
                  <select
                    value={uRole}
                    onChange={(e) => setURole(e.target.value as UserRole)}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="viewer">viewer (somente leitura)</option>
                    <option value="admin">admin (controle total)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">E-mail</label>
                <input
                  type="email"
                  required
                  value={uEmail}
                  onChange={(e) => setUEmail(e.target.value)}
                  className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Senha {editUserId !== null && '(vazio mantém a atual)'}
                </label>
                <input
                  type="password"
                  required={editUserId === null}
                  minLength={editUserId === null ? 8 : undefined}
                  value={uPass}
                  onChange={(e) => setUPass(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                />
              </div>

              {uRole === 'viewer' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Política de Canais deste Viewer</label>
                    <select
                      value={uAccessMode}
                      onChange={(e) => setUAccessMode(e.target.value as ChannelAccessMode)}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100"
                    >
                      <option value="default">Seguir padrão global (viewer_default_all_channels)</option>
                      <option value="restricted">Restringir estritamente aos canais marcados abaixo</option>
                    </select>
                  </div>

                  {channels.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs text-slate-400">Canais autorizados (user_channel_permissions):</div>
                      <div className="max-h-36 overflow-y-auto space-y-1 bg-[#090D16] border border-slate-800 rounded-lg p-2.5">
                        {channels.map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer py-0.5">
                            <input
                              type="checkbox"
                              checked={uAllowedIds.includes(c.id)}
                              onChange={() => toggleAllowedChannel(c.id)}
                              className="rounded border-slate-700 bg-[#131B2E] text-blue-600"
                            />
                            <span>
                              #{c.id} — {c.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <label className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={uActive}
                  onChange={(e) => setUActive(e.target.checked)}
                  className="rounded border-slate-700 bg-[#090D16] text-blue-600"
                />
                Conta ativa
              </label>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-300 hover:text-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {savingUser ? 'Salvando...' : 'Salvar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
