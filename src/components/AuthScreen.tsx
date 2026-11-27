import React, { useState } from 'react';
import { Shield, Lock, User, Mail, AlertCircle } from 'lucide-react';
import { api } from '../api';
import type { SafeUser } from '../types';

interface AuthScreenProps {
  needsSetup: boolean;
  onAuthenticated: (user: SafeUser) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ needsSetup, onAuthenticated }) => {
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (needsSetup) {
      if (password.length < 8) {
        setError('A senha administrativa deve conter ao menos 8 caracteres.');
        return;
      }
      if (password !== confirmPassword) {
        setError('As senhas informadas não coincidem.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (needsSetup) {
        const res = await api.setupAdmin({ username, email, password });
        onAuthenticated(res.user);
      } else {
        const res = await api.login({ identifier, password });
        onAuthenticated(res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na autenticação.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-[#131B2E] border border-slate-800 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">VigilLocal NVR</h1>
            <p className="text-xs text-slate-400">
              {needsSetup ? 'Configuração inicial do servidor local' : 'Acesso ao console de gravação e replay'}
            </p>
          </div>
        </div>

        {needsSetup && (
          <div className="mb-6 p-3.5 rounded-lg bg-blue-950/40 border border-blue-900/60 text-xs text-blue-200 leading-relaxed">
            Nenhum administrador foi cadastrado ainda. Defina as credenciais iniciais para assumir o controle deste NVR local.
          </div>
        )}

        {error && (
          <div className="mb-5 p-3 rounded-lg bg-red-950/50 border border-red-800/70 flex items-start gap-2.5 text-sm text-red-200">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {needsSetup ? (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Usuário Administrador</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full bg-[#090D16] border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">E-mail</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@rede.local"
                    className="w-full bg-[#090D16] border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Usuário ou E-mail</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="admin ou operador@rede.local"
                  className="w-full bg-[#090D16] border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Senha</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={needsSetup ? 8 : 1}
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#090D16] border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {needsSetup && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Confirmar Senha</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#090D16] border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-sm py-2.5 px-4 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {submitting
              ? 'Autenticando...'
              : needsSetup
              ? 'Criar Administrador e Entrar'
              : 'Entrar no Console'}
          </button>
        </form>
      </div>
    </div>
  );
};
