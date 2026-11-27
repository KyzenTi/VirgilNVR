import React, { useEffect, useState } from 'react';
import { RefreshCw, Server, FileText } from 'lucide-react';
import { api, formatLocalDateTime } from '../api';
import type { ExecutionLogDto } from '../types';

export const LogsAndDeployView: React.FC = () => {
  const [logs, setLogs] = useState<ExecutionLogDto[]>([]);
  const [levelFilter, setLevelFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await api.getLogs({ level: levelFilter, source: sourceFilter });
      setLogs(res.logs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelFilter, sourceFilter]);

  return (
    <div className="space-y-8">
      {/* Execution logs */}
      <section className="bg-[#131B2E] border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">Logs de Execução</h2>
              <p className="text-xs text-slate-400">
                Eventos do FFmpeg (-loglevel error), scheduler, retenção de disco e autenticação.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="bg-[#090D16] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="">Todos níveis</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-[#090D16] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="">Todas origens</option>
              <option value="ffmpeg">ffmpeg</option>
              <option value="scheduler">scheduler</option>
              <option value="retention">retention</option>
              <option value="auth">auth</option>
              <option value="system">system</option>
            </select>

            <button
              onClick={loadLogs}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#090D16] hover:bg-slate-800 border border-slate-700 rounded-md text-slate-200 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Atualizar
            </button>
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500">Carregando logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">Nenhum evento registrado para o filtro atual.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400 bg-[#0F172A]/60">
                  <th className="py-2.5 px-4">Data/Hora</th>
                  <th className="py-2.5 px-3">Nível</th>
                  <th className="py-2.5 px-3">Origem</th>
                  <th className="py-2.5 px-3">Canal</th>
                  <th className="py-2.5 px-4">Mensagem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-xs">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/25">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {formatLocalDateTime(log.created_at)}
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <span
                        className={
                          log.level === 'error'
                            ? 'text-red-400'
                            : log.level === 'warn'
                            ? 'text-amber-400'
                            : 'text-slate-300'
                        }
                      >
                        {log.level}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">{log.source}</td>
                    <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                      {log.channel_name || (log.channel_id ? `#${log.channel_id}` : '—')}
                    </td>
                    <td className="py-2.5 px-4 text-slate-200 font-mono break-all">{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Debian 13 LXC Operations Guide */}
      <section className="bg-[#131B2E] border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
          <Server className="w-5 h-5 text-blue-400" />
          <div>
            <h2 className="text-base font-semibold text-slate-100">Guia Rápido de Operação em LXC Debian 13</h2>
            <p className="text-xs text-slate-400">
              Serviço systemd dedicado (Restart=always) armazenando dados em /var/lib/vigilnvr e vídeos em /var/lib/vigilnvr/recordings.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          <div className="bg-[#090D16] border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="font-semibold text-slate-200">1. Provisionamento automatizado (Debian 13)</div>
            <pre className="font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`cd /opt/vigilnvr
chmod +x setup_lxc.sh
./setup_lxc.sh
journalctl -u vigilnvr -f`}
            </pre>
          </div>

          <div className="bg-[#090D16] border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="font-semibold text-slate-200">2. Unidade systemd (/etc/systemd/system/vigilnvr.service)</div>
            <pre className="font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`[Service]
User=vigilnvr
WorkingDirectory=/opt/vigilnvr
EnvironmentFile=/opt/vigilnvr/.env
ExecStart=/usr/bin/node /opt/vigilnvr/server.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
ReadWritePaths=/var/lib/vigilnvr /var/lib/vigilnvr/recordings`}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
};
