import { createClient, type SupabaseClient, type Session, type User } from '@supabase/supabase-js';

const supabaseUrl =
  (import.meta.env as { VITE_SUPABASE_URL?: string })?.VITE_SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  (import.meta.env as { VITE_SUPABASE_ANON_KEY?: string })?.VITE_SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables'
  );
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

/** Ambil session saat ini */
export const getSession = async (): Promise<Session | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
};

/** Ambil user saat ini */
export const getUser = async (): Promise<User | null> => {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
};

/** Login dengan email + password */
export const signIn = async (email: string, password: string) => {
  return await supabase.auth.signInWithPassword({ email, password });
};

/** Logout */
export const signOut = async () => {
  return await supabase.auth.signOut();
};

/** Listen perubahan status auth */
export const onAuthStateChange = (callback: (event: string, session: Session | null) => void) => {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return data.subscription;
};