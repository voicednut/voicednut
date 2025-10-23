import axios from 'axios';
import {
  type UserData,
  type ConfigData,
  type UserAPIResponse,
  type SingleUserAPIResponse,
  type ConfigAPIResponse,
} from '../types/api';

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000') as string;

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const apiService = {
  // User management endpoints
  users: {
    getAll: () => api.get<UserAPIResponse>('/users'),
    add: (userData: Omit<UserData, 'id' | 'created_at'>) =>
      api.post<SingleUserAPIResponse>('/users', userData),
    remove: (userId: string) => api.delete<void>(`/users/${userId}`),
    promote: (userId: string) => api.post<SingleUserAPIResponse>(`/users/${userId}/promote`),
  },

  // System configuration endpoints
  config: {
    get: () => api.get<ConfigAPIResponse>('/config'),
    update: (configData: Partial<ConfigData>[]) =>
      api.put<ConfigAPIResponse>('/config', configData),
  },
};

export default apiService;
