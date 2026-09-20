// Módulo compartilhado — NÃO é uma rota (Vercel ignora arquivos com "_" na frente em
// api/). Resolve "Bearer token -> usuário autenticado -> role em profiles" —
// reimplementado quase idêntico em 3 functions serverless (export-materials.js,
// export-requests.js, import-almox.js), extraído aqui (mesmo padrão de _sigma-shared.js /
// _sigma-material-shared.js / _rate-limit-shared.js). Só resolve QUEM é e qual o role —
// cada function continua decidindo sozinha quais roles ela permite pra cada ação.
//
// Antes da extração, export-materials.js e import-almox.js tratavam "perfil não
// encontrado" caindo direto na mensagem genérica de "sem permissão"; export-requests.js
// já tinha uma mensagem própria ("Perfil não encontrado."). Padronizado aqui nessa —
// mudança só de texto do erro nesse caso raro (usuário existe no auth mas não tem linha
// em profiles), o status 403 e o bloqueio em si continuam iguais.
export async function resolverUsuarioAutenticado(req, supabase) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { ok: false, status: 401, error: 'Token não fornecido.' };

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return { ok: false, status: 401, error: 'Token inválido.' };

  const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profileError || !profile) return { ok: false, status: 403, error: 'Perfil não encontrado.' };

  return { ok: true, user, role: profile.role };
}
