import { create } from 'zustand';
import { apiService } from '../services/api';

interface User {
  id: string;
  username: string;
  role: 'user' | 'admin';
  permissions: string[];
  created_at?: string;
  last_active?: string;
}

interface NewUser {
  username: string;
  role: 'user' | 'admin';
  permissions: string[];
}

interface UserState {
  users: User[];
  loading: boolean;
  error: string | null;
  fetchUsers: () => Promise<void>;
  addUser: (userData: NewUser) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
  promoteUser: (userId: string) => Promise<void>;
}

export const useUserStore = create<UserState>((set) => ({
  users: [],
  loading: false,
  error: null,
  fetchUsers: async () => {
    set({ loading: true, error: null });
    try {
      const response = await apiService.users.getAll();
      if ('data' in response) {
        set({ users: response.data.data, loading: false });
      } else {
        throw new Error('Invalid API response format');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch users';
      set({ error: message, loading: false });
    }
  },
  addUser: async (userData) => {
    set({ loading: true, error: null });
    try {
      const response = await apiService.users.add(userData);
      if ('data' in response) {
        await useUserStore.getState().fetchUsers();
      } else {
        throw new Error('Invalid API response format');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add user';
      set({ error: message, loading: false });
    }
  },
  removeUser: async (userId) => {
    set({ loading: true, error: null });
    try {
      await apiService.users.remove(userId);
      // Update local state immediately for better UX
      set((state) => ({
        users: state.users.filter((user) => user.id !== userId),
        loading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove user';
      set({ error: message, loading: false });
    }
  },
  promoteUser: async (userId) => {
    set({ loading: true, error: null });
    try {
      const response = await apiService.users.promote(userId);
      if ('data' in response) {
        await useUserStore.getState().fetchUsers();
      } else {
        throw new Error('Invalid API response format');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to promote user';
      set({ error: message, loading: false });
    }
  },
}));

export default useUserStore;
