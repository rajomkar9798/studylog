import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface StudySession {
  id: string;
  entry_date: string;
  day_number: number;
  subject: string;
  hours: number;
  topic: string;
  created_at: string;
  updated_at: string;
}

export interface AppSubject {
  id: string;
  name: string;
  created_at: string;
}
