// Função serverless do Vercel — roda no servidor, nunca no navegador do usuário.
// Usa a API do Google Gemini, que tem camada GRATUITA (sem cartão de crédito) pra uso
// como esse. A chave fica guardada em segurança (variável de ambiente GEMINI_API_KEY),
// nunca exposta no index.html.
//
// Como conseguir a chave grátis:
// 1. Acesse https://aistudio.google.com/apikey (entra com sua conta Google, sem precisar
//    cadastrar cartão de crédito)
// 2. Clique em "Create API key" e copie a chave gerada
//
// Como publicar:
// 1. Coloque este arquivo em /api/analisar-ia.js na raiz do repositório (mesmo nível da pasta
//    onde está o index.html), respeitando esse caminho exato.
// 2. No painel do Vercel: Settings → Environment Variables → adicione
//      GEMINI_API_KEY = a chave copiada no passo acima
// 3. Faça o redeploy do projeto (qualquer novo commit já dispara isso automaticamente).

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY não configurada no Vercel (Settings → Environment Variables). Pegue uma chave grátis em aistudio.google.com/apikey.' });
    return;
  }

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
  }
  const resumo = (body && body.resumo) ? String(body.resumo).slice(0, 6000) : '';
  if (!resumo) {
    res.status(400).json({ error: 'Nenhum resumo de território foi enviado.' });
    return;
  }

  try {
    const prompt = `Você ajuda um superintendente de território de uma congregação a organizar o trabalho de campo semanal. ` +
      `Analise os dados abaixo sobre o território dele e escreva recomendações práticas, diretas e priorizadas, em português do Brasil, em formato de lista curta (use quebras de linha, sem markdown de asterisco). ` +
      `Aponte quais quadras merecem atenção primeiro e por quê, alertas relevantes (quadras sem grupo, atrasadas), e um resumo geral do progresso do ciclo. ` +
      `Não invente números que não foram fornecidos — use só os dados abaixo.\n\nDADOS DO TERRITÓRIO:\n${resumo}`;

    const model = 'gemini-2.0-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : 'Erro na API do Gemini';
      res.status(response.status).json({ error: msg });
      return;
    }

    const text = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts)
      ? data.candidates[0].content.parts.map((p) => p.text || '').join('\n')
      : '';

    res.status(200).json({ text: text || 'A IA não retornou nenhum texto.' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Erro ao chamar a IA.' });
  }
};
