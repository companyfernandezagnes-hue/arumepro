import React, { useState } from 'react';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';

const CLIENT_ID = '616578412778-ihhjq8dd4gdbqd03i44ere0mmb8aqokn.apps.googleusercontent.com';
const ALLOWED_EMAILS = ['arumesakebar@gmail.com', 'companyfernandezagnes@gmail.com'];
const SESSION_KEY = 'arume_google_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

interface SessionData {
  email: string;
  name: string;
  picture: string;
  expiry: number;
}

function isSessionValid(): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const data: SessionData = JSON.parse(raw);
    return data.expiry > Date.now() && ALLOWED_EMAILS.includes(data.email);
  } catch {
    return false;
  }
}

function LoginButton({ onSuccess }: { onSuccess: (data: SessionData) => void }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        });
        const info = await res.json();
        if (!ALLOWED_EMAILS.includes(info.email)) {
          setError('Acceso no autorizado para ' + info.email);
          setLoading(false);
          return;
        }
        const session: SessionData = {
          email: info.email,
          name: info.name || info.email,
          picture: info.picture || '',
          expiry: Date.now() + SESSION_TTL_MS,
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        onSuccess(session);
      } catch (e) {
        setError('Error al verificar cuenta. Inténtalo de nuevo.');
        setLoading(false);
      }
    },
    onError: () => {
      setError('Error en el inicio de sesión con Google.');
      setLoading(false);
    },
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={() => { setLoading(true); login(); }}
        disabled={loading}
        className="flex items-center gap-3 px-6 py-3 bg-white text-gray-700 border border-gray-300 rounded-lg shadow hover:shadow-md transition-all font-medium disabled:opacity-60"
      >
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
          <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
          <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
          <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
        </svg>
        {loading ? 'Verificando...' : 'Iniciar sesión con Google'}
      </button>
      {error && <p className="text-red-500 text-sm text-center">{error}</p>}
    </div>
  );
}

// ── Dev bypass: en localhost creamos sesión automática (el cliente OAuth
//    de Google solo permite el dominio de producción, así que no podemos
//    hacer login real en dev) ───────────────────────────────────────────
const IS_LOCAL_DEV =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1' ||
   window.location.hostname === '0.0.0.0');

function getOrCreateDevSession(): SessionData {
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as SessionData;
      if (parsed.expiry > Date.now()) return parsed;
    } catch {}
  }
  const dev: SessionData = {
    email: 'arumesakebar@gmail.com',
    name: 'Dev local (Agnès)',
    picture: '',
    expiry: Date.now() + SESSION_TTL_MS,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(dev));
  return dev;
}

function AuthScreenInner({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<SessionData | null>(() => {
    if (IS_LOCAL_DEV) return getOrCreateDevSession();
    return isSessionValid() ? JSON.parse(sessionStorage.getItem(SESSION_KEY)!) : null;
  });

  if (session) return <>{children}</>;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 shadow-2xl flex flex-col items-center gap-6 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-white">Arume Sake Bar</h1>
        <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest">Celoso de Palma SL</p>
        <p className="text-gray-400 text-sm text-center">Accede con tu cuenta de Google autorizada</p>
        <LoginButton onSuccess={setSession} />
      </div>
    </div>
  );
}

export default function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <AuthScreenInner>{children}</AuthScreenInner>
    </GoogleOAuthProvider>
  );
}
