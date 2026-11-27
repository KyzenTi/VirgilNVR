import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Film,
  Video,
  CalendarClock,
  SlidersHorizontal,
  Terminal,
  LogOut,
  RefreshCw,
  Menu,
  X,
  Shield,
} from 'lucide-react';
import { api } from './api';
import { AuthScreen } from './components/AuthScreen';
import { DashboardView } from './components/DashboardView';
import { ReplayView } from './components/ReplayView';
import { ChannelsView } from './components/ChannelsView';
import { SchedulesView } from './components/SchedulesView';
import { AdminSettingsView } from './components/AdminSettingsView';
import { LogsAndDeployView } from './components/LogsAndDeployView';
import type { ChannelDto, RecordingDto, SafeUser, StorageStatsDto } from './types';

type ActiveTab = 'dashboard' | 'replay' | 'channels' | 'schedules' | 'settings' | 'logs';

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<SafeUser | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [recentRecordings, setRecentRecordings] = useState<RecordingDto[]>([]);
  const [storage, setStorage] = useState<StorageStatsDto | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);

  const [replayContext, setReplayContext] = useState<{
    channelId: number | null;
    recordingId: number | null;
    date: string | null;
  }>({ channelId: null, recordingId: null, date: null });

  const checkAuth = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setNeedsSetup(status.needsSetup);
      setUser(status.user);
    } catch {
      setUser(null);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loadDashboardData = useCallback(async () => {
    if (!user) return;
    setLoadingDash(true);
    try {
      const dash = await api.getDashboard();
      setChannels(dash.channels);
      setRecentRecordings(dash.recentRecordings);
      setStorage(dash.storage);
    } catch {
      // If session expired, refresh auth state
      await checkAuth();
    } finally {
      setLoadingDash(false);
    }
  }, [user, checkAuth]);

  useEffect(() => {
    if (!user) return;
    loadDashboardData();
    const timer = setInterval(loadDashboardData, 10000);
    return () => clearInterval(timer);
  }, [user, loadDashboardData]);

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setActiveTab('dashboard');
  };

  const handleOpenReplay = (channelId: number, recordingId?: number, dateStr?: string) => {
    setReplayContext({
      channelId,
      recordingId: recordingId ?? null,
      date: dateStr ?? null,
    });
    setActiveTab('replay');
    setMobileMenuOpen(false);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#090D16] flex items-center justify-center text-sm text-slate-400">
        Inicializando VigilLocal NVR...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        needsSetup={needsSetup}
        onAuthenticated={(loggedUser) => {
          setNeedsSetup(false);
          setUser(loggedUser);
        }}
      />
    );
  }

  const isAdmin = user.role === 'admin';

  const navItems: Array<{ id: ActiveTab; label: string; icon: React.ReactNode; adminOnly?: boolean }> = [
    { id: 'dashboard', label: 'Painel Principal', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'replay', label: 'Replay Temporal', icon: <Film className="w-4 h-4" /> },
    { id: 'channels', label: 'Canais RTSP', icon: <Video className="w-4 h-4" />, adminOnly: true },
    { id: 'schedules', label: 'Agendamentos', icon: <CalendarClock className="w-4 h-4" />, adminOnly: true },
    { id: 'settings', label: 'Usuários e Retenção', icon: <SlidersHorizontal className="w-4 h-4" />, adminOnly: true },
    { id: 'logs', label: 'Logs e LXC', icon: <Terminal className="w-4 h-4" />, adminOnly: true },
  ];

  const visibleNav = navItems.filter((item) => !item.adminOnly || isAdmin);
  const currentTabLabel = visibleNav.find((n) => n.id === activeTab)?.label || 'Painel Principal';

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0F172A] border-r border-slate-800">
        <div className="h-16 px-5 flex items-center gap-2.5 border-b border-slate-800">
          <Shield className="w-5 h-5 text-blue-500 shrink-0" />
          <span className="font-semibold text-base tracking-tight text-slate-100 whitespace-nowrap">
            VigilLocal NVR
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {visibleNav.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-blue-600/15 text-blue-300 border border-blue-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-200 truncate">{user.username}</div>
            <div className="text-xs text-slate-500 font-mono">
              {user.role === 'admin' ? 'Administrador' : 'Visualizador'}
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Encerrar sessão"
            className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/70" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-64 max-w-[80vw] bg-[#0F172A] border-r border-slate-800 flex flex-col z-10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-500" />
                <span className="font-semibold text-base text-slate-100">VigilLocal NVR</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="text-slate-400 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {visibleNav.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    activeTab === item.id ? 'bg-blue-600/15 text-blue-300' : 'text-slate-400'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="p-4 border-t border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-200">{user.username}</div>
                <div className="text-xs text-slate-500 font-mono">{user.role}</div>
              </div>
              <button onClick={handleLogout} className="text-xs text-slate-300 underline">
                Sair
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="h-16 bg-[#0F172A] border-b border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-400 hover:text-slate-100 rounded-lg"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-500 hidden sm:inline">VigilLocal NVR</span>
              <span className="text-slate-600 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-100 truncate">{currentTabLabel}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={loadDashboardData}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#090D16] hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingDash ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              user={user}
              channels={channels}
              recentRecordings={recentRecordings}
              storage={storage}
              loading={loadingDash}
              onRefresh={loadDashboardData}
              onOpenReplay={handleOpenReplay}
              onGoToChannels={() => setActiveTab('channels')}
            />
          )}

          {activeTab === 'replay' && (
            <ReplayView
              user={user}
              channels={channels}
              initialChannelId={replayContext.channelId}
              initialRecordingId={replayContext.recordingId}
              initialDate={replayContext.date}
            />
          )}

          {activeTab === 'channels' && isAdmin && (
            <ChannelsView channels={channels} onRefresh={loadDashboardData} />
          )}

          {activeTab === 'schedules' && isAdmin && <SchedulesView channels={channels} />}

          {activeTab === 'settings' && isAdmin && (
            <AdminSettingsView currentUser={user} channels={channels} />
          )}

          {activeTab === 'logs' && isAdmin && <LogsAndDeployView />}
        </main>
      </div>
    </div>
  );
}
