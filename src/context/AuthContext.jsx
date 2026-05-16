/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import {
  decryptPrivateKeyWithPassword,
  encryptPrivateKeyWithPassword,
  getOrGenerateKeyPair,
} from '../utils/e2eCrypto';

const AuthContext = createContext();
const AUTH_USER_CACHE_KEY = 'auth_user_cache';

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load user from local storage or validate token on mount

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      const cachedUser = localStorage.getItem(AUTH_USER_CACHE_KEY);
      if (cachedUser) {
        try {
          const parsed = JSON.parse(cachedUser);
          // Normalize: ensure profile_picture is always set (API returns camelCase profilePicture)
          if (parsed.profilePicture && !parsed.profile_picture) {
            parsed.profile_picture = parsed.profilePicture;
          }
          setCurrentUser(parsed);
        } catch {
          localStorage.removeItem(AUTH_USER_CACHE_KEY);
        }
      }
      fetchUser(token);
    } else {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistUser = (user) => {
    setCurrentUser(user);
    localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user));
  };

  /**
   * Ensures the user has an RSA key pair for E2E messaging.
   *
   * When `password` is provided (i.e. at login time):
   *   1. Check localStorage first.
   *   2. If missing, fetch the encrypted blob from the server and decrypt it
   *      with PBKDF2(password) + AES-GCM. The server CANNOT read this blob.
   *   3. If the server has no blob yet, generate a fresh key pair.
   *   4. Re-encrypt the private key with the password and upload to server.
   *
   * When `password` is null (page refresh / token refresh without re-login):
   *   - Only use localStorage. If keys are there, great. If not, the user
   *     will see the encrypted placeholder until they log in again.
   */
  const ensureSecureMessagingKey = async (user, token, password = null) => {
    if (!user?.id || !token || token === 'demo-token' || window.location.hostname.includes('github.io')) {
      return user;
    }

    const storageKey = `e2e_keys_${user.id}`;

    try {
      // ── Step 1: Check localStorage ───────────────────────────────────────
      let localKeys = null;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed?.publicKeyJwk && parsed?.privateKeyJwk) {
            localKeys = parsed;
          }
        } catch {
          localStorage.removeItem(storageKey);
        }
      }

      // ── Step 2: Restore from server (only possible when password is known) ─
      if (!localKeys && password) {
        try {
          const res = await fetch('/api/auth/key-pair', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.private_key && data.public_key) {
              let privateKeyJwk = null;

              if (data.private_key.startsWith('pkenc:v1:')) {
                // ✅ New secure format — decrypt with user's password
                privateKeyJwk = await decryptPrivateKeyWithPassword(data.private_key, password);
              } else {
                // ⚠️  Legacy raw format (migration) — parse directly, will be
                //     re-encrypted with password and re-uploaded in Step 4.
                try { privateKeyJwk = JSON.parse(data.private_key); } catch { /* skip */ }
              }

              if (privateKeyJwk) {
                localKeys = {
                  publicKeyJwk: JSON.parse(data.public_key),
                  privateKeyJwk,
                };
                localStorage.setItem(storageKey, JSON.stringify(localKeys));
              }
            }
          }
        } catch (fetchErr) {
          console.warn('Could not restore keys from server:', fetchErr);
        }
      }

      // ── Step 3: Nothing anywhere — generate a fresh key pair ─────────────
      if (!localKeys) {
        if (!password) {
          // No password available on this call path (e.g. page refresh).
          // Keys are in localStorage on normal sessions; incognito users must
          // log in to get their password so we can decrypt the server blob.
          return user;
        }
        localKeys = await getOrGenerateKeyPair(user.id);
      }

      const { publicKeyJwk, privateKeyJwk } = localKeys;
      const publicKeyStr = JSON.stringify(publicKeyJwk);

      // ── Step 4: Upload password-encrypted private key to server ───────────
      // Only possible when password is known. Re-encrypts on every login so
      // the stored blob rotates (new salt + IV each time).
      if (password) {
        try {
          const encryptedPrivateKey = await encryptPrivateKeyWithPassword(privateKeyJwk, password);
          await fetch('/api/auth/key-pair', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              publicKey: publicKeyStr,
              privateKey: encryptedPrivateKey,   // opaque blob — server cannot read this
            }),
          });
        } catch (uploadErr) {
          console.warn('Key pair upload failed:', uploadErr);
        }
      }

      return { ...user, publicKey: publicKeyStr };
    } catch (error) {
      console.error('Secure messaging key setup failed:', error);
      return user;
    }
  };

  const clearSession = () => {
    localStorage.removeItem('token');
    localStorage.removeItem(AUTH_USER_CACHE_KEY);
    setCurrentUser(null);
  };

  const refreshSession = async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) return false;

    const data = await response.json();
    if (!data.token || !data.user) return false;

    localStorage.setItem('token', data.token);
    if (data.user.profilePicture && !data.user.profile_picture) {
      data.user.profile_picture = data.user.profilePicture;
    }
    persistUser(await ensureSecureMessagingKey(data.user, data.token));
    return true;
  };

  const fetchUser = async (token) => {
    // DEMO MODE FOR GITHUB PAGES
    if (window.location.hostname.includes('github.io') && token === 'demo-token') {
      const cached = localStorage.getItem('demo_user_cache');
      if (cached) {
        persistUser(JSON.parse(cached));
      } else {
        persistUser({ id: 'demo1', username: 'demo', role: 'student', firstName: 'Demo', lastName: 'User', batch: '2026' });
      }
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const userData = await response.json();
        // Normalize: the API returns camelCase 'profilePicture' but the app uses snake_case 'profile_picture'
        if (userData.profilePicture && !userData.profile_picture) {
          userData.profile_picture = userData.profilePicture;
        }

        persistUser(await ensureSecureMessagingKey(userData, token));
      } else {
        if (response.status === 401 || response.status === 403) {
          const refreshed = response.status === 401 ? await refreshSession() : false;
          if (!refreshed) clearSession();
        }
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
    } finally {
      setLoading(false);
    }
  };

  const login = async (username, password, type = 'student') => {
    // DEMO MODE FOR GITHUB PAGES (Since no backend runs here)
    if (window.location.hostname.includes('github.io')) {
      // In Demo Mode, we allow any username/password to let people preview the UI
      const isAdmin = type === 'admin';
      
      const entry = {
        user: {
          id: isAdmin ? 'demo-admin' : 'demo-student',
          username: username || 'demo',
          role: isAdmin ? 'admin' : 'student',
          firstName: isAdmin ? 'Admin' : 'Demo',
          lastName: isAdmin ? 'User' : 'Student',
          batch: '2026',
          profile_picture: isAdmin ? '/avatars/teacher_male.png' : '/avatars/male1.png'
        },
      };

      localStorage.setItem('token', 'demo-token');
      localStorage.setItem('demo_user_cache', JSON.stringify(entry.user));
      persistUser(entry.user);
      return { token: 'demo-token', user: entry.user };
    }

    try {
      let response;
      try {
        response = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password, type }),
        });
      } catch {
        throw new Error('Cannot connect to server. Please ensure the backend is running.');
      }

      // Safely parse JSON — guard against empty or HTML error responses
      const contentType = response.headers.get('content-type') || '';
      let data = {};
      if (contentType.includes('application/json')) {
        const text = await response.text();
        if (text) {
          data = JSON.parse(text);
        }
      }

      if (!response.ok) {
        throw new Error(data.error || `Server error (${response.status})`);
      }

      localStorage.setItem('token', data.token);
      // Normalize: the API returns camelCase 'profilePicture' but the app uses snake_case 'profile_picture'
      if (data.user.profilePicture && !data.user.profile_picture) {
        data.user.profile_picture = data.user.profilePicture;
      }

      // Pass the plain-text password so we can decrypt / re-encrypt the
      // server-side private key blob with PBKDF2. After this call the
      // password is no longer stored anywhere.
      const userWithKey = await ensureSecureMessagingKey(data.user, data.token, password);
      persistUser(userWithKey);
      return { ...data, user: userWithKey };
    } catch (error) {
      console.error(error);
      throw error;
    }
  };

  const logout = () => {
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    clearSession();
  };

  const updateUser = (fields) => {
    setCurrentUser((prev) => {
      if (!prev) return prev;
      const nextUser = { ...prev, ...fields };
      localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(nextUser));
      return nextUser;
    });
  };

  const value = {
    currentUser,
    loading,
    login,
    logout,
    updateUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
