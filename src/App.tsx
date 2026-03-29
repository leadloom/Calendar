/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  User, 
  Mail, 
  FileText, 
  CheckCircle2, 
  ChevronRight, 
  ChevronLeft,
  LayoutDashboard,
  LogOut,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Phone,
  Target,
  Copy,
  Check,
  XCircle,
  RefreshCw,
  Share2,
  MessageSquare,
  TrendingUp
} from 'lucide-react';
import { format, addDays, startOfDay, isSameDay, parseISO, addMinutes, isBefore, isAfter } from 'date-fns';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import { cn } from './lib/utils';

const HOST_TIMEZONE = 'America/Los_Angeles'; // Default host timezone

interface Slot {
  start: Date;
  end: Date;
}

interface BookingData {
  name: string;
  email: string;
  phone: string;
  interest: string;
  projectDetails: string;
  startTime: string;
  endTime: string;
}

const Logo = () => (
  <div className="relative w-10 h-10 flex items-center justify-center">
    <div className="absolute inset-0 bg-cyan-neon/20 blur-lg rounded-full animate-pulse" />
    <svg viewBox="0 0 100 100" className="w-full h-full text-cyan-neon relative z-10">
      <rect x="25" y="25" width="50" height="50" rx="8" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M50 35 L50 45 M50 55 L50 65 M35 50 L45 50 M55 50 L65 50" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <circle cx="50" cy="50" r="10" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M25 40 H15 M25 60 H15 M75 40 H85 M75 60 H85 M40 25 V15 M60 25 V15 M40 75 V85 M60 75 V85" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  </div>
);

export default function App() {
  const [authStatus, setAuthStatus] = useState<{ connected: boolean; isAdmin: boolean }>({ connected: false, isAdmin: false });
  console.log("App rendering, authStatus:", authStatus);
  const [busySlots, setBusySlots] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarStartDate, setCalendarStartDate] = useState(startOfDay(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState<{ meetLink: string } | null>(null);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [view, setView] = useState<'user' | 'admin'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'admin' ? 'admin' : 'user';
  });
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [clientTimezone, setClientTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [showInHostTime, setShowInHostTime] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [debugStatus, setDebugStatus] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error("Global error:", event.error);
      setDebugStatus("Global Error: " + event.message);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  const forceAdmin = async () => {
    console.log("Force Admin button clicked");
    try {
      setDebugStatus("Forcing admin...");
      const res = await fetch('/api/debug/force-admin', { credentials: 'include' });
      console.log("Force Admin response status:", res.status);
      const data = await res.json();
      console.log("Force Admin response data:", data);
      if (data.success) {
        setDebugStatus("Success! REFRESH PAGE NOW.");
        await fetchAuthStatus();
        await fetchDebugInfo();
      } else {
        setDebugStatus("Failed: " + data.message);
      }
    } catch (err) {
      console.error("Force Admin error:", err);
      setDebugStatus("Error: " + (err as Error).message);
    }
  };

  const testSession = async () => {
    console.log("Test Session button clicked");
    try {
      setDebugStatus("Testing session...");
      const res = await fetch('/api/debug/test-session', { credentials: 'include' });
      const data = await res.json();
      setDebugStatus(`Session Test: ${data.message}`);
      await fetchDebugInfo();
    } catch (err) {
      setDebugStatus("Error: " + (err as Error).message);
    }
  };

  const fetchDebugInfo = async () => {
    try {
      const res = await fetch('/api/debug/session', { credentials: 'include' });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Debug info fetch failed with status ${res.status}: ${text.substring(0, 100)}`);
        return;
      }
      const data = await res.json();
      setDebugInfo(data);
    } catch (err) {
      console.error('Failed to fetch debug info', err);
    }
  };

  useEffect(() => {
    if (showDebug) {
      fetchDebugInfo();
      const interval = setInterval(fetchDebugInfo, 3000);
      return () => clearInterval(interval);
    }
  }, [showDebug]);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status', { credentials: 'include' });
      const data = await res.json();
      console.log('App: Auth status updated:', data);
      setAuthStatus(data);
    } catch (err) {
      console.error('Failed to fetch auth status', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAvailability = useCallback(async () => {
    if (!authStatus.connected) return;
    try {
      const res = await fetch('/api/availability', { credentials: 'include' });
      const data = await res.json();
      setBusySlots(data);
    } catch (err) {
      console.error('Failed to fetch availability', err);
    }
  }, [authStatus.connected]);

  const fetchAdminStats = useCallback(async () => {
    if (!authStatus.isAdmin) return;
    try {
      const res = await fetch('/api/admin/stats', { credentials: 'include' });
      const data = await res.json();
      setAdminStats(data);
    } catch (err) {
      console.error('Failed to fetch admin stats', err);
    }
  }, [authStatus.isAdmin]);

  useEffect(() => {
    fetchAuthStatus();
  }, [fetchAuthStatus]);

  useEffect(() => {
    if (authStatus.connected) {
      fetchAvailability();
    }
    if (authStatus.isAdmin) {
      fetchAdminStats();
    }
  }, [authStatus, fetchAvailability, fetchAdminStats]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      console.log('App: Received postMessage', event.data);
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        console.log('App: Auth success message received, refreshing status...');
        fetchAuthStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchAuthStatus]);

  const handleConnect = async () => {
    try {
      const origin = window.location.origin;
      const res = await fetch(`/api/auth/url?origin=${encodeURIComponent(origin)}`, { credentials: 'include' });
      const { url } = await res.json();
      const popup = window.open(url, 'oauth_popup', 'width=600,height=700');
      
      // Polling fallback in case postMessage fails
      if (popup) {
        const checkPopup = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopup);
            console.log('App: Popup closed, checking status...');
            fetchAuthStatus();
          }
        }, 1000);
      }
    } catch (err) {
      console.error('Failed to get auth URL', err);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { 
        method: 'POST',
        credentials: 'include'
      });
      fetchAuthStatus();
      setView('user');
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  const generateSlots = (date: Date) => {
    const slots: Slot[] = [];
    
    // Define business hours in HOST timezone
    const hostDate = toZonedTime(date, HOST_TIMEZONE);
    const start = startOfDay(hostDate);
    start.setHours(10, 0, 0, 0); // 10 AM Host Time
    const end = new Date(start);
    end.setHours(22, 0, 0, 0); // 10 PM Host Time

    let currentHost = new Date(start);
    while (isBefore(currentHost, end) && slots.length < 12) {
      const slotEndHost = addMinutes(currentHost, 30);
      
      // Convert host slot to UTC for comparison with busy slots
      const currentUTC = fromZonedTime(currentHost, HOST_TIMEZONE);
      const slotEndUTC = fromZonedTime(slotEndHost, HOST_TIMEZONE);

      const isBusy = busySlots.some(busy => {
        const bStart = parseISO(busy.start);
        const bEnd = parseISO(busy.end);
        return (isAfter(slotEndUTC, bStart) && isBefore(currentUTC, bEnd));
      });

      // Artificial "Busy" look: Hide some slots randomly but deterministically
      // to ensure we still get 12 if possible, we can use a more sparse check
      const slotHash = (currentUTC.getTime() / (1000 * 60 * 30)) % 10;
      const isArtificiallyBusy = slotHash < 2; // Reduced from 4 to 2 to ensure we find 12 slots

      if (!isBusy && !isArtificiallyBusy && isAfter(currentUTC, new Date())) {
        slots.push({ 
          start: fromZonedTime(currentHost, HOST_TIMEZONE), 
          end: fromZonedTime(slotEndHost, HOST_TIMEZONE) 
        });
      }
      currentHost = slotEndHost;
    }
    return slots;
  };

  const handleBooking = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedSlot) return;

    setBookingLoading(true);
    const formData = new FormData(e.currentTarget);
    const bookingData: BookingData = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      phone: formData.get('phone') as string,
      interest: formData.get('interest') as string,
      projectDetails: formData.get('projectDetails') as string,
      startTime: selectedSlot.start.toISOString(),
      endTime: selectedSlot.end.toISOString(),
    };

    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingData),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        setBookingSuccess({ meetLink: data.meetLink });
        fetchAvailability();
      }
    } catch (err) {
      console.error('Booking failed', err);
    } finally {
      setBookingLoading(false);
    }
  };

  const copyShareLink = () => {
    const url = window.location.origin;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-neon animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Debug Panel */}
      {showDebug && (
        <div className="fixed bottom-4 right-4 z-[100] bg-slate-900 border border-white/10 p-4 rounded-xl shadow-2xl max-w-xs text-[10px] font-mono">
          <div className="flex justify-between items-center mb-2">
            <span className="text-cyan-neon uppercase tracking-wider">Debug Info</span>
            <button onClick={() => setShowDebug(false)} className="opacity-50 hover:opacity-100">✕</button>
          </div>
          <div className="mb-2 p-2 bg-white/5 rounded border border-white/5">
            <p className="text-cyan-neon">Auth Status:</p>
            <p>Connected: {authStatus.connected ? 'YES' : 'NO'}</p>
            <p>Is Admin: {authStatus.isAdmin ? 'YES' : 'NO'}</p>
          </div>
          {debugStatus && (
            <div className="mb-2 p-2 bg-pink-neon/10 text-pink-neon rounded border border-pink-neon/20 animate-pulse">
              {debugStatus}
            </div>
          )}
          <pre className="overflow-auto max-h-40 text-white/70 bg-black/30 p-2 rounded">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
          <div className="mt-2 pt-2 border-t border-white/5 grid grid-cols-2 gap-2">
            <button onClick={() => window.open(window.location.href, '_blank')} className="text-cyan-neon hover:underline text-left">Open in New Tab</button>
            <button onClick={() => setDebugStatus(null)} className="text-white/50 hover:underline text-left">Clear Status</button>
            <button onClick={fetchDebugInfo} className="text-cyan-neon hover:underline text-left">Refresh Info</button>
            <button onClick={fetchAuthStatus} className="text-cyan-neon hover:underline text-left">Check Auth</button>
            <button 
              onClick={async () => {
                try {
                  console.log("Ping button clicked");
                  setDebugStatus("Pinging server...");
                  const res = await fetch('/api/ping');
                  const data = await res.json();
                  setDebugStatus(`Ping: ${data.message} (${data.time})`);
                  console.log("Ping success:", data);
                } catch (err) {
                  console.error("Ping error:", err);
                  setDebugStatus("Ping Error: " + (err as Error).message);
                }
              }} 
              className="text-cyan-neon hover:underline text-left"
            >
              Ping Server
            </button>
            <button 
              onClick={forceAdmin} 
              className="text-pink-neon hover:underline text-left"
            >
              Force Admin
            </button>
            <button 
              onClick={testSession} 
              className="text-cyan-neon hover:underline text-left"
            >
              Test Session
            </button>
            <button 
              onClick={handleConnect} 
              className="text-purple-neon hover:underline text-left"
            >
              Retry Login
            </button>
            <button 
              onClick={async () => {
                try {
                  setDebugStatus("Setting test cookie...");
                  const res = await fetch('/api/debug/set-cookie', { credentials: 'include' });
                  const data = await res.json();
                  setDebugStatus(data.message);
                } catch (err) {
                  setDebugStatus("Error: " + (err as Error).message);
                }
              }} 
              className="text-cyan-neon hover:underline text-left"
            >
              Set Test Cookie
            </button>
            <button 
              onClick={async () => {
                try {
                  setDebugStatus("Checking cookies...");
                  const res = await fetch('/api/debug/check-cookie', { credentials: 'include' });
                  const data = await res.json();
                  setDebugStatus(`Test Cookie: ${data.testCookie}`);
                  console.log("Cookie Check:", data);
                } catch (err) {
                  setDebugStatus("Error: " + (err as Error).message);
                }
              }} 
              className="text-cyan-neon hover:underline text-left"
            >
              Check Cookie
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 w-full glass-card rounded-none border-x-0 border-t-0 border-b-white/5 px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 sm:gap-3 cursor-pointer" onClick={() => setShowDebug(!showDebug)}>
          <Logo />
          <div>
            <h1 className="text-lg sm:text-xl leading-none">LEAD LOOM</h1>
            <p className="hidden sm:block text-[10px] uppercase tracking-widest opacity-50 font-display">Elite Engineering</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <button 
            onClick={copyShareLink}
            className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-[10px] font-display uppercase tracking-wider"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Share2 className="w-3 h-3" />}
            <span className="hidden xs:inline">{copied ? 'COPIED' : 'SHARE'}</span>
          </button>

          {authStatus.isAdmin && (
            <button 
              onClick={() => setView(view === 'user' ? 'admin' : 'user')}
              className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors text-[10px] sm:text-xs font-display"
            >
              {view === 'user' ? <LayoutDashboard className="w-4 h-4" /> : <CalendarIcon className="w-4 h-4" />}
              <span className="hidden sm:inline">{view === 'user' ? 'ADMIN PANEL' : 'BOOKING VIEW'}</span>
            </button>
          )}
          
          {!authStatus.isAdmin ? (
            <div className="flex items-center gap-2">
              <button 
                onClick={fetchAuthStatus}
                className="p-1.5 rounded-md hover:bg-white/5 transition-colors opacity-30 hover:opacity-100"
                title="Refresh Status"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <button onClick={handleConnect} className="btn-primary text-[10px] sm:text-xs py-1.5 px-3">
                {authStatus.connected ? 'ADMIN LOGIN' : 'CONNECT'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs opacity-50">
                <ShieldCheck className="w-3 h-3 sm:w-4 h-4 text-cyan-neon" />
                <span className="hidden xs:inline">ADMIN CONNECTED</span>
              </div>
              <button 
                onClick={handleLogout}
                className="p-1.5 rounded-md hover:bg-white/5 transition-colors text-pink-neon opacity-50 hover:opacity-100"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-12">
        {view === 'admin' ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="glass-card p-6 neon-border-cyan">
                <p className="text-xs opacity-50 uppercase tracking-wider mb-1">Total Bookings</p>
                <h2 className="text-4xl font-display">{adminStats?.total || 0}</h2>
              </div>
              <div className="glass-card p-6 neon-border-purple">
                <p className="text-xs opacity-50 uppercase tracking-wider mb-1">Cancellations</p>
                <h2 className="text-4xl font-display text-pink-neon">{adminStats?.cancelled || 0}</h2>
              </div>
              <div className="glass-card p-6 neon-border-pink">
                <p className="text-xs opacity-50 uppercase tracking-wider mb-1">Rescheduled</p>
                <h2 className="text-4xl font-display text-purple-neon">{adminStats?.rescheduled || 0}</h2>
              </div>
              <div className="glass-card p-6 neon-border-cyan">
                <p className="text-xs opacity-50 uppercase tracking-wider mb-1">Active Projects</p>
                <h2 className="text-4xl font-display">{adminStats?.recent?.filter((b: any) => b.status === 'confirmed').length || 0}</h2>
              </div>
            </div>

            <div className="glass-card overflow-hidden">
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-lg">Detailed Booking Log</h3>
                <div className="flex gap-2">
                   <button onClick={fetchAdminStats} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
                     <RefreshCw className="w-4 h-4 opacity-50" />
                   </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-[10px] uppercase tracking-widest opacity-50 bg-white/5">
                    <tr>
                      <th className="px-6 py-3 font-medium">Client Info</th>
                      <th className="px-6 py-3 font-medium">Interest</th>
                      <th className="px-6 py-3 font-medium">Project Details</th>
                      <th className="px-6 py-3 font-medium">Scheduled</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {adminStats?.recent?.map((booking: any) => (
                      <tr key={booking.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-medium text-white">{booking.name}</div>
                          <div className="text-xs opacity-50">{booking.email}</div>
                          <div className="text-[10px] opacity-30">{booking.phone}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                            booking.interest === 'Lead Loom' ? 'bg-cyan-neon/10 text-cyan-neon' :
                            booking.interest === 'Prepmate' ? 'bg-purple-neon/10 text-purple-neon' :
                            booking.interest === 'Hiwar' ? 'bg-pink-neon/10 text-pink-neon' :
                            'bg-white/10 text-white'
                          )}>
                            {booking.interest}
                          </span>
                        </td>
                        <td className="px-6 py-4 max-w-xs">
                          <p className="text-xs line-clamp-2 opacity-70">{booking.project_details}</p>
                        </td>
                        <td className="px-6 py-4 text-xs">
                          <div className="font-medium">{format(parseISO(booking.start_time), 'MMM d, yyyy')}</div>
                          <div className="opacity-50">{format(parseISO(booking.start_time), 'h:mm a')}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                            booking.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-500' :
                            booking.status === 'cancelled' ? 'bg-pink-neon/10 text-pink-neon' :
                            'bg-purple-neon/10 text-purple-neon'
                          )}>
                            {booking.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-12">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              {/* Left: Intro */}
              <div className="lg:col-span-5 space-y-6 sm:space-y-8">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <h2 className="text-3xl sm:text-5xl font-display leading-[1.1] mb-4 sm:mb-6">
                    LET'S <span className="text-cyan-neon">CONNECT</span> & COLLABORATE
                  </h2>
                  <p className="text-base sm:text-lg opacity-70 leading-relaxed mb-6 sm:mb-8">
                    I'm excited to hear about what you're working on. Whether it's a new product, a service improvement, or just a technical challenge, let's dive in together.
                  </p>
                  
                  <div className="glass-card p-4 sm:p-6 border-white/10 bg-white/5 space-y-4">
                    <h4 className="text-cyan-neon font-display text-sm uppercase tracking-widest">How to prepare</h4>
                    <ul className="space-y-3 text-sm opacity-80">
                      <li className="flex gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-neon mt-1.5 shrink-0" />
                        <span>Have a clear goal or question in mind for our session.</span>
                      </li>
                      <li className="flex gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-neon mt-1.5 shrink-0" />
                        <span>Bring any relevant documents or links you'd like to share.</span>
                      </li>
                      <li className="flex gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-neon mt-1.5 shrink-0" />
                        <span>Find a quiet space with a stable internet connection.</span>
                      </li>
                      <li className="flex gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-neon mt-1.5 shrink-0" />
                        <span>Most importantly, come ready to explore new possibilities!</span>
                      </li>
                    </ul>
                  </div>
                </motion.div>
              </div>

              {/* Right: Calendar */}
              <div className="lg:col-span-7">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="glass-card p-4 sm:p-8 neon-border-cyan"
                >
                  <div className="flex items-center justify-between mb-6 sm:mb-8">
                    <h3 className="text-lg sm:text-xl flex items-center gap-2">
                      <CalendarIcon className="w-5 h-5 text-cyan-neon" />
                      {format(calendarStartDate, 'MMMM yyyy')}
                    </h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          const newStart = addDays(calendarStartDate, -7);
                          setCalendarStartDate(newStart);
                          setSelectedDate(newStart);
                        }}
                        disabled={isBefore(addDays(calendarStartDate, -1), startOfDay(new Date()))}
                        className="p-1.5 sm:p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => {
                          const newStart = addDays(calendarStartDate, 7);
                          setCalendarStartDate(newStart);
                          setSelectedDate(newStart);
                        }}
                        className="p-1.5 sm:p-2 rounded-lg hover:bg-white/10 transition-colors"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-6 sm:mb-8">
                    {Array.from({ length: 7 }).map((_, i) => {
                      const date = addDays(calendarStartDate, i);
                      const isSelected = isSameDay(date, selectedDate);
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedDate(date)}
                          className={cn(
                            "flex flex-col items-center p-2 sm:p-3 rounded-lg sm:rounded-xl transition-all",
                            isSelected ? "bg-cyan-neon text-midnight shadow-[0_0_15px_rgba(0,207,255,0.4)]" : "hover:bg-white/5"
                          )}
                        >
                          <span className="text-[8px] sm:text-[10px] uppercase font-bold opacity-60">{format(date, 'EEE')}</span>
                          <span className="text-sm sm:text-lg font-display">{format(date, 'd')}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                      <p className="text-[10px] uppercase tracking-widest opacity-40">Available Time Slots</p>
                      <div className="flex items-center justify-between sm:justify-end gap-4">
                        <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] opacity-60">
                          <Clock className="w-3 h-3" />
                          <span>{showInHostTime ? `Host: ${HOST_TIMEZONE}` : `Local: ${clientTimezone}`}</span>
                        </div>
                        <button 
                          onClick={() => setShowInHostTime(!showInHostTime)}
                          className="text-[9px] sm:text-[10px] text-cyan-neon hover:underline uppercase tracking-wider"
                        >
                          Switch
                        </button>
                      </div>
                    </div>
                    {!authStatus.connected ? (
                      <div className="py-12 text-center space-y-4">
                        <p className="opacity-50">Connect Google Calendar to view availability.</p>
                        <button onClick={handleConnect} className="btn-primary">CONNECT NOW</button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {generateSlots(selectedDate).map((slot, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setSelectedSlot(slot);
                              setIsBookingModalOpen(true);
                            }}
                            className="flex items-center justify-center gap-2 p-3 rounded-xl border border-white/5 bg-white/5 hover:border-cyan-neon/50 hover:bg-cyan-neon/5 transition-all group"
                          >
                            <Clock className="w-4 h-4 opacity-40 group-hover:text-cyan-neon" />
                            <span className="font-display">
                              {showInHostTime 
                                ? formatInTimeZone(slot.start, HOST_TIMEZONE, 'h:mm a')
                                : format(slot.start, 'h:mm a')
                              }
                            </span>
                          </button>
                        ))}
                        {generateSlots(selectedDate).length === 0 && (
                          <div className="col-span-full py-8 text-center opacity-40 italic">
                            No slots available for this date.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Product Boxes: Wide Reaching */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { 
                  name: "Lead Loom", 
                  icon: Target,
                  desc: "Global Engineering Power House. We architect scalable, secure, and high-velocity software and hardware solutions that transform industries.",
                  color: "border-cyan-neon/30",
                  iconColor: "text-cyan-neon",
                  url: "https://leadloom.io"
                },
                { 
                  name: "PrepMate", 
                  icon: MessageSquare,
                  desc: "Your AI-powered communication coach, specifically designed to bridge the gap between traditional training and real-world performance.",
                  color: "border-purple-neon/30",
                  iconColor: "text-purple-neon",
                  url: "https://prepmate.co"
                },
                { 
                  name: "Hiwar", 
                  icon: TrendingUp,
                  desc: "AI-powered B2B growth platform designed to automate LinkedIn outreach with human-like precision and intelligent campaigns.",
                  color: "border-pink-neon/30",
                  iconColor: "text-pink-neon",
                  url: "https://hiwar.co"
                },
              ].map((item, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * i }}
                  className={cn(
                    "flex flex-col items-start text-left gap-4 p-6 rounded-2xl border bg-white/5 transition-all hover:bg-white/10 hover:scale-[1.02] duration-300",
                    item.color
                  )}
                >
                  <div className={cn("w-12 h-12 shrink-0 rounded-xl bg-midnight flex items-center justify-center border border-white/10 shadow-lg", item.iconColor)}>
                    <item.icon className="w-6 h-6" />
                  </div>
                  <div className="space-y-4 flex-1 flex flex-col">
                    <div className="space-y-2 flex-1">
                      <h4 className="text-sm font-display uppercase tracking-widest text-white">{item.name}</h4>
                      <p className="text-xs opacity-70 leading-relaxed">{item.desc}</p>
                    </div>
                    <a 
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "inline-flex items-center gap-2 text-[10px] font-display uppercase tracking-widest py-2 px-4 rounded-lg border border-white/10 hover:bg-white/10 transition-colors mt-auto",
                        item.iconColor
                      )}
                    >
                      Learn More <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Booking Modal */}
      <AnimatePresence>
        {isBookingModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !bookingLoading && setIsBookingModalOpen(false)}
              className="absolute inset-0 bg-midnight/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-xl glass-card p-5 sm:p-8 neon-border-purple overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              {/* Circuit Pattern Background */}
              <svg className="absolute top-0 right-0 w-32 h-32 opacity-10 pointer-events-none" viewBox="0 0 100 100">
                <path d="M0 20 H40 V60 H100" fill="none" stroke="currentColor" strokeWidth="1" />
                <circle cx="40" cy="20" r="2" fill="currentColor" />
                <circle cx="100" cy="60" r="2" fill="currentColor" />
              </svg>

              {bookingSuccess ? (
                <div className="text-center py-8 space-y-6">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  </div>
                  <h3 className="text-2xl">BOOKING CONFIRMED</h3>
                  <p className="opacity-70">
                    Your session is locked in. A confirmation email with the meeting details has been dispatched to you and Omar.
                  </p>
                  <div className="p-4 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between">
                    <div className="text-left">
                      <p className="text-[10px] uppercase opacity-50">Google Meet Link</p>
                      <p className="text-sm truncate max-w-[200px]">{bookingSuccess.meetLink}</p>
                    </div>
                    <a 
                      href={bookingSuccess.meetLink} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-cyan-neon text-midnight hover:scale-110 transition-transform"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 pt-4">
                    <button 
                      onClick={() => {
                        setIsBookingModalOpen(false);
                        setBookingSuccess(null);
                      }}
                      className="btn-primary flex-1"
                    >
                      CLOSE
                    </button>
                    <button 
                      onClick={copyShareLink}
                      className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all active:scale-[0.98] relative"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Share2 className="w-4 h-4" />}
                      <span className="text-xs font-display uppercase tracking-wider">
                        {copied ? 'COPIED' : 'SHARE LINK'}
                      </span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-8">
                    <h3 className="text-2xl mb-2">FINALIZE BOOKING</h3>
                    <div className="flex flex-col gap-2 text-sm opacity-60">
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4 text-purple-neon" />
                        {selectedSlot && format(selectedSlot.start, 'EEEE, MMMM d')}
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-purple-neon" />
                        <span>
                          {selectedSlot && (
                            showInHostTime 
                              ? `${formatInTimeZone(selectedSlot.start, HOST_TIMEZONE, 'h:mm a')} (${HOST_TIMEZONE})`
                              : `${format(selectedSlot.start, 'h:mm a')} (Local)`
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleBooking} className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest opacity-50 ml-1">Full Name</label>
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
                        <input 
                          required
                          name="name"
                          type="text" 
                          placeholder="John Doe"
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-purple-neon/50 transition-colors"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest opacity-50 ml-1">Email Address</label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
                        <input 
                          required
                          name="email"
                          type="email" 
                          placeholder="john@example.com"
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-purple-neon/50 transition-colors"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest opacity-50 ml-1">Phone Number</label>
                      <div className="relative">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
                        <input 
                          required
                          name="phone"
                          type="tel" 
                          placeholder="+1 (555) 000-0000"
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-purple-neon/50 transition-colors"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest opacity-50 ml-1">Interested In</label>
                      <div className="relative">
                        <Target className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
                        <select 
                          required
                          name="interest"
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-purple-neon/50 transition-colors appearance-none"
                        >
                          <option value="Lead Loom" className="bg-midnight">Lead Loom</option>
                          <option value="Prepmate" className="bg-midnight">Prepmate</option>
                          <option value="Hiwar" className="bg-midnight">Hiwar</option>
                          <option value="Consultation" className="bg-midnight">Consultation</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] uppercase tracking-widest opacity-50 ml-1">Project Details</label>
                      <div className="relative">
                        <FileText className="absolute left-4 top-4 w-4 h-4 opacity-30" />
                        <textarea 
                          required
                          name="projectDetails"
                          rows={3}
                          placeholder="Briefly describe your requirements..."
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-purple-neon/50 transition-colors resize-none"
                        />
                      </div>
                    </div>

                    <button 
                      disabled={bookingLoading}
                      type="submit" 
                      className="btn-primary md:col-span-2 py-4 mt-2 flex items-center justify-center gap-2"
                    >
                      {bookingLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>CONFIRM BOOKING <ChevronRight className="w-4 h-4" /></>
                      )}
                    </button>
                  </form>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
