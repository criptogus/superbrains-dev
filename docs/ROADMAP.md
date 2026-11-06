# SuperBrains — Product Improvements

Análise do que dá pra melhorar no produto, cruzando o estado atual com
open source relevantes (incluindo repos que o time segue no GitHub).

## Agora (demo → MVP)

1. **Insights gerados por LLM, não por template**
   Hoje o painel "What the engine sees" usa regras fixas (tendência, dia da
   semana, pico). Trocar por geração via LLM transforma o diferencial:
   narrativas tipo *"sua quinta é fraca — um combo de happy hour recoveraria
   ~12% da receita"*. Candidato: **BerriAI/litellm** (você segue) como gateway
   para qualquer provider, ou AI SDK da Vercel.

2. **Conectores reais com ferramentas de SMB**
   Em vez de upload manual, puxar dados direto: Shopify, Square, WooCommerce,
   Google Sheets. **Composio** (já usado no ecossistema ZeroAgency) tem auth
   gerenciada pra essas apps — elimina a maior fricção do funil.

3. **Dashboard multi-série**
   Hoje é 1 série por vez. SMBs têm dezenas de SKUs. Um painel com top-N
   produtos ranqueados por "risco de ruptura" é o aha moment. UI base:
   **satnaing/shadcn-admin** (você segue) como referência de dashboard.

4. **Forecast honesto com backtesting visível**
   Mostrar acurácia real (MAPE/MAE) calculada nos próprios dados do usuário —
   "nos últimos 30 dias erramos em média X%". Confiança vendida com prova.

## Médio prazo

5. **Voz / pergunta em linguagem natural** — "quanto vou vender no Natal?"
   **livekit/agents** (você segue) permitiria demo ao vivo impressionante.

6. **Alertas proativos** — cron que roda forecast diário e manda WhatsApp/
   e-mail quando detecta anomalia ou pico. Usa a mesma stack do cron de
   upstream que já criamos.

7. **Horizonte por vertical** — padaria (diário), restaurante (por turno),
   e-commerce (sessões). Templates de insight por segmento.

8. **Deploy** — front estático na Vercel/Netlify; backend em container
   (Railway/Fly) ou serverless com o modelo quantizado. **oblien/openship**
   (você segue) é opção pra deploy simplificado.

## Pesquisa / qualidade

9. **Avaliação contínua do modelo** — **google-research/harness2** e
   **google/ax** (você segue) como referência pra eval harness: medir drift
   de acurácia do TimesFM nos dados reais dos usuários (com consentimento).

10. **Experimentos automáticos** — **microsoft/RD-Agent** (você segue) pra
    testar variações de prompt/feature engineering dos insights.

## Não-objetivos (por enquanto)

- Multivariate covariates (preço, clima, promo) — TimesFM 3.0 suporta, mas
  complexidade de UX ainda não compensa
- White-label / API pública — depois do PMF
