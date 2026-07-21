// Proxy para download do arquivo SIGMA — contorna CORS no browser
export default async function handler(req, res) {
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://portalpptm.com').split(',');
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const SIGMA_URL = 'https://utepecem.com.br/sigma/export/?dados=apontamentos&empresa=PTPC';

  try {
    const upstream = await fetch(SIGMA_URL, {
      headers: { 'User-Agent': 'Portal-PPTM/1.0' },
      signal: AbortSignal.timeout(55000), // 55s — próximo ao limite Vercel (60s)
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: `SIGMA retornou HTTP ${upstream.status}` });
    }

    const buffer = await upstream.arrayBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="apontamentos.xlsx"');
    res.setHeader('Content-Length', buffer.byteLength);
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    const msg = err?.name === 'TimeoutError'
      ? 'Tempo limite ao baixar arquivo do SIGMA (>55s).'
      : `Erro ao acessar SIGMA: ${err?.message}`;
    return res.status(502).json({ error: msg });
  }
}
