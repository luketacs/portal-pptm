import { environment } from './environments/environment';

export const supabaseConfig = {
  url: environment.supabaseUrl,
  key: environment.supabaseAnonKey,
};
