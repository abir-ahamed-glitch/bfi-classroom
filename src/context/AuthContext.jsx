import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

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
      fetchUser(token);
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async (token) => {
    // DEMO MODE FOR GITHUB PAGES
    if (window.location.hostname.includes('github.io') && token === 'demo-token') {
      const cached = localStorage.getItem('demo_user_cache');
      if (cached) {
        setCurrentUser(JSON.parse(cached));
      } else {
        setCurrentUser({ id: 'demo1', username: 'demo', role: 'student', firstName: 'Demo', lastName: 'User', batch: '2026' });
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
        setCurrentUser(userData);
      } else {
        localStorage.removeItem('token');
        setCurrentUser(null);
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
      localStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  };

  const login = async (username, password, type = 'student') => {
    // DEMO MODE FOR GITHUB PAGES (Since no backend runs here)
    if (window.location.hostname.includes('github.io')) {
      // Map local test accounts so GitHub reflects real UI logic
      const localUsers = {
        'admin': { id: 1, username: 'admin', role: 'admin', firstName: 'Abir', lastName: 'Ahmad' },
        'admin2': { id: 7, username: 'admin2', role: 'admin', firstName: 'BFI', lastName: 'Admin' },
        'eathsharajsharon.26ph': { id: 8, username: 'eathsharajsharon.26ph', role: 'student', firstName: 'Eath Sharaj', lastName: 'Sharon', batch: '2026' },
        'mdalasad.7orv': { id: 9, username: 'mdalasad.7orv', role: 'student', firstName: 'MD. Al', lastName: 'Asad', batch: '2026' },
        'mdzafrulhasan.8x6x': { id: 10, username: 'mdzafrulhasan.8x6x', role: 'student', firstName: 'MD. ZAFRUL', lastName: 'HASAN', batch: '2026' },
        'mahfojorrahmanabir.hc1d': { id: 11, username: 'mahfojorrahmanabir.hc1d', role: 'student', firstName: 'Mahfojor Rahman', lastName: 'Abir', batch: '2026' },
        'mohammedsajidulhaque.3oj1': { id: 12, username: 'mohammedsajidulhaque.3oj1', role: 'student', firstName: 'Mohammed Sajidul', lastName: 'Haque', batch: '2026' },
        'bayazidahmed.9o28': { id: 13, username: 'bayazidahmed.9o28', role: 'student', firstName: 'Bayazid', lastName: 'Ahmed', batch: '2026' }
      };

      const matchedUser = localUsers[username];
      const demoUser = matchedUser || (type === 'admin' 
        ? { id: 'admin1', username: 'admin', role: 'admin', firstName: 'BFI', lastName: 'Admin Demo' }
        : { id: 'student1', username: 'student', role: 'student', firstName: 'General Demo', lastName: 'Student', batch: '2026' });
      
      localStorage.setItem('token', 'demo-token');
      // Store the literal user JSON as a custom demo variable so refresh works exactly as that user
      localStorage.setItem('demo_user_cache', JSON.stringify(demoUser));
      setCurrentUser(demoUser);
      return { token: 'demo-token', user: demoUser };
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, type }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      localStorage.setItem('token', data.token);
      setCurrentUser(data.user);
      return data;
    } catch (error) {
      console.error(error);
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setCurrentUser(null);
  };

  const updateUser = (fields) => {
    setCurrentUser(prev => prev ? { ...prev, ...fields } : prev);
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
