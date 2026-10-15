// Evvo House Finance — conexão com o Supabase.
// A biblioteca é carregada no HTML com verificação de integridade (SRI): se o arquivo
// do CDN for alterado por alguém, o navegador se recusa a executar.
const { createClient } = window.supabase;
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Endereço do app (funciona no GitHub Pages e no localhost), usado nos links de e-mail.
export function enderecoDoApp() {
  return window.location.origin + window.location.pathname.replace(/index\.html$/, '');
}
