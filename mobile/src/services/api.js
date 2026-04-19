import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Change this to your backend URL
// For Android emulator: http://10.0.2.2:3000
// For physical device: use your computer's local IP
const API_BASE = 'http://10.0.2.2:3000';

const api = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach token to every request
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Auth ───
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  getProfile: () => api.get('/auth/profile'),
  updatePhone: (phone) => api.put('/auth/phone', { phone }),
};

// ─── Disposal ───
export const disposalAPI = {
  getHistory: (page = 1) => api.get(`/disposal/history?page=${page}`),
  getStats: () => api.get('/disposal/stats'),
};

// ─── Airtime ───
export const airtimeAPI = {
  redeem: (points) => api.post('/airtime/redeem', { points }),
  getHistory: () => api.get('/airtime/history'),
};

export default api;
