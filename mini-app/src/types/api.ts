// Base API response interface
interface APIResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

// User management types
export interface UserData {
  id: string;
  username: string;
  role: 'admin' | 'user';
  created_at: string;
  last_active?: string;
  permissions: string[];
}

export type UserAPIResponse = APIResponse<UserData[]>;
export type SingleUserAPIResponse = APIResponse<UserData>;

// System configuration types
export interface ConfigData {
  key: string;
  value: string | number | boolean | null;
  type: 'string' | 'number' | 'boolean' | 'json';
  description?: string;
  updatedAt: string;
  updatedBy: string;
}

export type ConfigAPIResponse = APIResponse<ConfigData[]>;
