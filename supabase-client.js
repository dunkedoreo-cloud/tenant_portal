const SUPABASE_URL = 'https://exfeacpgbrkgppzyvusk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_oBOO2fw63ksGEdxqgcDeSQ_T5vB7yor';

if (!window.supabase?.createClient) {
  throw new Error('Supabase library did not load.');
}

window.bordsSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
