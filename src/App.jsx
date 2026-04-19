import React, { useState, useEffect, lazy, Suspense } from 'react';
import { supabase } from './services/supabase';
import { AppModeProvider } from './context/AppModeContext';
import { OrgProvider } from './context/OrgContext';
import { CalendarDays, Loader2 } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import EventLanding from './components/EventLanding';
import EventRegistrationForm from './components/EventRegistrationForm';

// Lazy-load admin components to keep public bundle small
const AdminLogin = lazy(() => import('./components/AdminLogin'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const CancelRegistration = lazy(() => import('./components/CancelRegistration'));

function AppContent() {
  const [view, setView] = useState('loading');
  const [eventId, setEventId] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [orgName, setOrgName] = useState('');
  const [cancelToken, setCancelToken] = useState(null);

  // Parse URL and determine initial view
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;

    // Check embed mode first
    const rootEl = document.getElementById('root');
    const embedMode = rootEl?.getAttribute('data-mode') === 'embed';
    const embedEventId = rootEl?.getAttribute('data-event-id');
    const embedOrgId = rootEl?.getAttribute('data-org-id');

    if (embedMode && embedEventId && embedOrgId) {
      setOrgId(embedOrgId);
      setEventId(embedEventId);
      setView('form');
      return;
    }

    // Cancel page
    if (path === '/cancel' || params.get('cancel') === 'true') {
      const token = params.get('token');
      if (token) {
        setCancelToken(token);
        setView('cancel');
        return;
      }
    }

    // Admin mode — /admin path OR ?admin=true query param
    if (path === '/admin' || path.startsWith('/admin/') || params.get('admin') === 'true') {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setView('admin-dashboard');
        } else {
          setView('admin-login');
        }
      });
      return;
    }

    // Public: org + event
    const urlOrg = params.get('org');
    const urlEvent = params.get('event');

    // Fall back to the default org when none is in the URL
    const defaultOrg = import.meta.env.VITE_DEFAULT_ORG;
    const effectiveOrg = urlOrg || defaultOrg || null;

    if (effectiveOrg) {
      resolveOrg(effectiveOrg).then(async (resolvedOrg) => {
        if (resolvedOrg) {
          setOrgId(resolvedOrg.id);
          setOrgName(resolvedOrg.name);
          if (urlEvent) {
            const resolvedEventId = await resolveEvent(resolvedOrg.id, urlEvent);
            if (resolvedEventId) {
              setEventId(resolvedEventId);
              setView('form');
            } else {
              setView('not-found');
            }
          } else {
            setView('landing');
          }
        } else {
          setView('not-found');
        }
      });
      return;
    }

    // No org specified and no default configured — show generic landing
    setView('no-org');
  }, []);

  // Listen for auth state changes (handles OAuth redirect return)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const params = new URLSearchParams(window.location.search);
        if (params.get('admin') === 'true') {
          setView('admin-dashboard');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const resolveOrg = async (slug) => {
    try {
      // Try by slug first
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        return data;
      }

      // Try by ID
      const { data: orgById, error: idError } = await supabase
        .from('organizations')
        .select('id, name, slug')
        .eq('id', slug)
        .maybeSingle();

      if (idError) throw idError;

      return orgById || null;
    } catch (err) {
      console.error('Error resolving org:', err);
      return null;
    }
  };

  const resolveEvent = async (orgId, slugOrId) => {
    try {
      // Try by slug first
      const { data: bySlug } = await supabase
        .from('events')
        .select('id')
        .eq('org_id', orgId)
        .eq('slug', slugOrId)
        .maybeSingle();

      if (bySlug) return bySlug.id;

      // Fall back to UUID
      const { data: byId } = await supabase
        .from('events')
        .select('id')
        .eq('org_id', orgId)
        .eq('id', slugOrId)
        .maybeSingle();

      return byId?.id || null;
    } catch (err) {
      console.error('Error resolving event:', err);
      return null;
    }
  };

  const handleSelectEvent = (event) => {
    setEventId(event.id);
    setView('form');
    // Update URL without reload
    const params = new URLSearchParams(window.location.search);
    params.set('event', event.id);
    window.history.pushState({}, '', `?${params.toString()}`);
  };

  const handleBackToLanding = () => {
    setEventId(null);
    setView('landing');
    const params = new URLSearchParams(window.location.search);
    params.delete('event');
    window.history.pushState({}, '', `?${params.toString()}`);
  };

  const renderContent = () => {
    switch (view) {
      case 'loading':
        return (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        );

      case 'landing':
        return (
          <EventLanding
            orgId={orgId}
            orgName={orgName}
            onSelectEvent={handleSelectEvent}
          />
        );

      case 'form':
        return (
          <div>
            {orgId && !document.getElementById('root')?.getAttribute('data-mode') && (
              <button
                onClick={handleBackToLanding}
                className="text-sm text-primary hover:text-primary-dark mb-4 inline-flex items-center gap-1 cursor-pointer"
              >
                ← All Events
              </button>
            )}
            <EventRegistrationForm eventId={eventId} orgId={orgId} />
          </div>
        );

      case 'cancel':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <CancelRegistration token={cancelToken} />
          </Suspense>
        );

      case 'admin-login':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <AdminLogin onAuthenticated={() => setView('admin-dashboard')} />
          </Suspense>
        );

      case 'admin-dashboard':
        return (
          <Suspense fallback={<LoadingFallback />}>
            <AdminDashboard />
          </Suspense>
        );

      case 'not-found':
        return (
          <div className="max-w-lg mx-auto text-center py-20">
            <p className="text-xl font-bold text-slate-900 mb-2">Organization Not Found</p>
            <p className="text-slate-500">The organization you're looking for doesn't exist.</p>
          </div>
        );

      case 'no-org':
        return (
          <div className="max-w-lg mx-auto text-center py-20">
            <div className="inline-flex bg-primary/10 p-3 rounded-full mb-4">
              <CalendarDays className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Event Registration System</h1>
            <p className="text-slate-500 mb-4">
              Please use a link provided by an event organizer to access their events.
            </p>
            <p className="text-sm text-slate-400">
              Organizers: <a href="/?admin=true" className="text-primary underline">Sign in to manage events</a>
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return renderContent();
}

function LoadingFallback() {
  return (
    <div className="flex justify-center items-center py-20">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function Header() {
  return (
    <header className="bg-white border-b border-slate-200 no-print">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-primary" />
        <span className="font-bold text-slate-900">Event Registration</span>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 mt-auto no-print">
      <div className="max-w-6xl mx-auto px-4 py-4 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} Event Registration System
      </div>
    </footer>
  );
}

export default function App() {
  // Detect embed mode
  const rootEl = document.getElementById('root');
  const isEmbed = rootEl?.getAttribute('data-mode') === 'embed';

  return (
    <ErrorBoundary>
      <AppModeProvider>
        <OrgProvider>
          {isEmbed ? (
            <div className="app-embed">
              <AppContent />
            </div>
          ) : (
            <div className="app-standalone min-h-screen flex flex-col">
              <Header />
              <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
                <AppContent />
              </main>
              <Footer />
            </div>
          )}
        </OrgProvider>
      </AppModeProvider>
    </ErrorBoundary>
  );
}
