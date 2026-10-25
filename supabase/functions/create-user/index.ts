import { serve } from 'https://deno.land/std@0.178.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

// Role yang boleh dibuat lewat endpoint ini.
// Sumber: dropdown halaman Pengaturan (src/routes/pengaturan/+page.svelte)
// dan default role di migration 001_init.sql.
const ALLOWED_ROLES = ['administrator', 'admin', 'leader'];

// Origin default: GitHub Pages (https://dccikupa2021.github.io/barcode-receiving).
// Bisa dioverride lewat env ALLOWED_ORIGINS (dipisah koma, untuk dev lokal dsb).
const DEFAULT_ALLOWED_ORIGINS = 'https://dccikupa2021.github.io';

function getAllowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  const source = raw && raw.trim() !== '' ? raw : DEFAULT_ALLOWED_ORIGINS;
  return source
    .split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter((origin) => origin !== '');
}

function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.get('Origin');
  if (!origin) return false;
  return getAllowedOrigins().includes(origin.trim().toLowerCase());
}

function buildCorsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const origin = req.headers.get('Origin');
  if (origin && isOriginAllowed(req)) {
    headers['Access-Control-Allow-Origin'] = origin.trim();
  }
  return headers;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const originAllowed = 'Access-Control-Allow-Origin' in corsHeaders;

  // Preflight: layani hanya untuk origin yang diizinkan
  if (req.method === 'OPTIONS') {
    if (!originAllowed) {
      return new Response('Forbidden', { status: 403 });
    }
    return new Response('ok', { headers: corsHeaders });
  }

  // Tolak request dari origin di luar allowlist (tanpa header CORS)
  if (!originAllowed) {
    return new Response(JSON.stringify({ error: 'Origin tidak diizinkan' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 1) Autentikasi pemanggil: verifikasi JWT dari header Authorization
    const token = (req.headers.get('Authorization') ?? '')
      .replace(/^Bearer\s+/i, '')
      .trim();

    if (token === '') {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: auth, error: getUserError } = await supabase.auth.getUser(token);
    const caller = auth?.user;

    if (getUserError || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2) Otorisasi: hanya pemanggil dengan role administrator yang boleh
    const { data: callerProfile, error: callerProfileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (callerProfileError || callerProfile?.role !== 'administrator') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3) Validasi input
    let payload: { email?: string; password?: string; role?: string };
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Format request tidak valid' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email, password, role } = payload;

    if (!email || !password || !role) {
      return new Response(
        JSON.stringify({ error: 'email, password, dan role wajib diisi' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return new Response(
        JSON.stringify({ error: 'Role tidak diizinkan' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buat auth user (auto-confirmed agar tidak butuh verifikasi email)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role },
    });

    if (authError) {
      console.error('create-user: gagal membuat auth user:', authError.message);
      return new Response(
        JSON.stringify({ error: authError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Simpan ke tabel profiles
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: authData.user!.id, email, role });

    if (profileError) {
      // Rollback hapus auth user jika gagal simpan profil
      await supabase.auth.admin.deleteUser(authData.user!.id);
      console.error('create-user: gagal simpan profil:', profileError.message);
      return new Response(
        JSON.stringify({ error: 'Gagal menyimpan profil pengguna' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, user: { id: authData.user!.id, email, role } }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('create-user: unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Terjadi kesalahan pada server' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
