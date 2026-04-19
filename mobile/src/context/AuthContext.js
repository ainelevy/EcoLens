import React, { createContext, useState, useEffect, useContext } from 'react';
import * as SecureStore from 'expo-secure-store';
import { authAPI } from '../services/api';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const token = await SecureStore.getItemAsync('token');
      if (token) {
        const res = await authAPI.getProfile();
        setUser(res.data.user);
        setBalance(res.data.balance);
      }
    } catch {
      await SecureStore.deleteItemAsync('token');
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const res = await authAPI.login({ email, password });
    await SecureStore.setItemAsync('token', res.data.token);
    setUser(res.data.user);
    await refreshBalance();
    return res.data;
  };

  const register = async (data) => {
    const res = await authAPI.register(data);
    await SecureStore.setItemAsync('token', res.data.token);
    setUser(res.data.user);
    await refreshBalance();
    return res.data;
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('token');
    setUser(null);
    setBalance(null);
  };

  const refreshBalance = async () => {
    try {
      const res = await authAPI.getProfile();
      setUser(res.data.user);
      setBalance(res.data.balance);
    } catch {}
  };

  return (
    <AuthContext.Provider value={{ user, balance, loading, login, register, logout, refreshBalance }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
