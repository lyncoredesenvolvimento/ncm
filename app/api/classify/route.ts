import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { writeLog, writeErrorLog } from "@/lib/security";

const groqApiKey = process.env.GROQ_API_KEY;

// Função auxiliar para buscar candidatos NCM na base local do Supabase
async function searchNcmCandidates(queryText: string) {
  const words = queryText
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 2 && !["para", "com", "de", "do", "da", "em", "um", "uma", "o", "a", "os", "as"].includes(w));

  let dbQuery = supabaseAdmin
    .from("ncms")
    .select("code, description, full_description, chapter");

  if (words.length > 0) {
    // Aplica múltiplos filtros .ilike() consecutivos para criar uma condição AND estrita
    words.forEach(w => {
      dbQuery = dbQuery.ilike("description", `%${w}%`);
    });
  } else {
    dbQuery = dbQuery.ilike("description", `%${queryText}%`);
  }

  let { data, error } = await dbQuery.limit(15);
  if (error) throw error;

  // FALLBACK: Se a busca estrita com todas as palavras combinadas não trouxer nada,
  // fazemos uma nova busca focando exclusivamente na PRIMEIRA palavra (que é o objeto principal, ex: "caneta")
  if ((!data || data.length === 0) && words.length > 1) {
    const fallbackQuery = supabaseAdmin
      .from("ncms")
      .select("code, description, full_description, chapter")
      .ilike("description", `%${words[0]}%`)
      .limit(15);
    
    const fallbackResult = await fallbackQuery;
    if (fallbackResult.error) throw fallbackResult.error;
    data = fallbackResult.data;
  }

  return data || [];
}

export async function POST(request: NextRequest) {
  let activeUser: any = null;

  try {
    const body = await request.json();
    const { query, imageBase64, previousQuestions, answers, step, ncmCode } = body;

    if (!groqApiKey) {
      return NextResponse.json(
        { error: "A chave da API do Groq (GROQ_API_KEY) não está configurada no servidor." },
        { status: 500 }
      );
    }

    // 1. Identificar o usuário via Bearer token
    const authHeader = request.headers.get("authorization") ?? "";
    let token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      const cookieNames = request.cookies.getAll().map(c => c.name);
      const authCookieName = cookieNames.find(name => name.startsWith("sb-") && name.endsWith("-auth-token"));
      if (authCookieName) {
        const authCookie = request.cookies.get(authCookieName)?.value;
        if (authCookie) {
          try {
            const parsed = JSON.parse(authCookie);
            token = parsed?.access_token || "";
          } catch (e) {}
        }
      }
    }

    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) activeUser = user;
    }

    if (!activeUser) {
      return NextResponse.json(
        { error: "Sessão inválida ou não autenticada." },
        { status: 401 }
      );
    }

    const groq = new Groq({ apiKey: groqApiKey });

    // ─── PASSO DIRETO: Busca direta por NCM existente ─────────────────────────
    if (step === "direct" || step === 3) {
      if (!ncmCode || ncmCode.length !== 8) {
        return NextResponse.json({ error: "Código NCM inválido." }, { status: 400 });
      }

      const { data: ncmData } = await supabaseAdmin
        .from("ncms")
        .select("code, description, full_description")
        .eq("code", ncmCode)
        .single();

      if (!ncmData) {
        return NextResponse.json(
          { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, fornece mais detalhes técnicos." },
          { status: 422 }
        );
      }

      const systemPrompt = `Você é um especialista em classificação fiscal do Mercosul, atuando como um validador estrito de NCM (Nomenclatura Comum do Mercosul).
Sua tarefa é analisar o código NCM fornecido e gerar uma justificativa técnica da sua classificação e estimar as alíquotas nacionais aplicáveis.

Regras Estritas de Classificação:
1. PESQUISA EXCLUSIVA NO BANCO DE DADOS: A classificação deve se ater ao código NCM fornecido: "${ncmCode}" e à descrição oficial da planilha: "${ncmData.description}".
2. BUSCA LITERAL E REGRAS GERAIS DE INTERPRETAÇÃO (RGI): Justifique a classificação de acordo com a estrutura da Nomenclatura (Capítulo -> Posição -> Subposição -> Item) e aplique as Regras Gerais de Interpretação do SH (RGI).
3. PROIBIÇÃO DE ALUCINAÇÕES (VETO DE IA): Não mude nem invente códigos. Justifique estritamente o código fornecido.

Código NCM: "${ncmCode}"
Descrição oficial cadastrada: "${ncmData.description}"

Instruções adicionais:
1. Forneça uma justificativa técnica detalhada e profissional com base nas Regras Gerais de Interpretação do SH (RGI).
2. Estime as alíquotas nacionais de impostos (IPI, PIS, COFINS) típicas para este tipo de produto.
3. Responda APENAS com JSON válido, sem texto adicional:
{
  "justification": "Sua justificativa detalhada e técnica aqui...",
  "taxes": {
    "ipi": "Alíquota % ou Isento",
    "pis": "Alíquota %",
    "cofins": "Alíquota %"
  }
}`;

      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: systemPrompt }],
        max_tokens: 2048,
      });

      let rawText = completion.choices[0]?.message?.content || "";
      if (!rawText) throw new Error("Resposta vazia da API Groq (busca direta).");

      rawText = rawText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Resposta da IA na busca direta não contém JSON válido.");
      const result = JSON.parse(jsonMatch[0]);

      try {
        await writeLog({
          user_id: activeUser.id,
          user_name: activeUser.user_metadata?.name || activeUser.email?.split("@")[0] || "Usuário",
          user_email: activeUser.email,
          action: "search",
          entity: ncmCode,
          module_name: "Classificação NCM (Direta)",
          description: `Pesquisa direta do código NCM: ${ncmCode}.`
        });
      } catch (logErr) {}

      return NextResponse.json({
        ncmCode: ncmCode,
        officialDescription: ncmData.description,
        fullHierarchy: ncmData.full_description,
        justification: result.justification,
        taxes: result.taxes
      });
    }

    // ─── PASSO 1: Triagem Inicial (Texto ou Imagem) ───────────────────────────
    if (step === 1) {
      let searchQuery = query || "";

      // Se for por imagem, usar a IA de visão para deduzir a descrição do produto primeiro
      if (imageBase64) {
        const match = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) {
          return NextResponse.json({ error: "Formato de imagem inválido." }, { status: 400 });
        }

        const visionMessages = [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Identifique o produto desta imagem de forma concisa. Responda apenas com o nome técnico ou descrição curta do produto em português (ex: 'caneta esferográfica' ou 'lápis de cor'). Não explique, não dê NCM nem justifique."
              },
              {
                type: "image_url",
                image_url: { url: imageBase64 }
              }
            ]
          }
        ];

        const visionCompletion = await groq.chat.completions.create({
          model: "qwen/qwen3.6-27b",
          messages: visionMessages,
          max_tokens: 128,
        });

        let visionText = visionCompletion.choices[0]?.message?.content || "";
        visionText = visionText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        if (!visionText) throw new Error("A IA de visão não conseguiu descrever o produto.");
        
        searchQuery = visionText;
      }

      if (!searchQuery) {
        return NextResponse.json({ error: "Descrição do produto ou imagem é necessária." }, { status: 400 });
      }

      // CONSULTA PRÉVIA AO SUPABASE (Mecanismo de Busca candidatos reais)
      const ncmCandidates = await searchNcmCandidates(searchQuery);

      if (ncmCandidates.length === 0) {
        return NextResponse.json(
          { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, forneça mais detalhes técnicos." },
          { status: 422 }
        );
      }

      // INJEÇÃO DE CONTEXTO REAL NO PROMPT DA IA
      const systemPrompt = `Você é um especialista em classificação fiscal do Mercosul e análise de NCM (Nomenclatura Comum do Mercosul).
Sua tarefa é analisar a descrição do produto do usuário e a lista de candidatos NCM reais extraídos do nosso banco de dados. Com base nisso, formule perguntas inteligentes e excludentes para triagem dinâmica do NCM correto.

Produto do Usuário: "${searchQuery}"

Lista de Candidatos NCM Reais do Banco de Dados:
${ncmCandidates.map(n => `- Código: ${n.code} | Descrição: ${n.description}`).join("\n")}

Instruções:
1. Analise as descrições dos candidatos reais na lista acima.
2. Formule até 4 perguntas sequenciais e objetivas cujas respostas ajudem a diferenciar entre esses candidatos NCM reais específicos.
3. Para cada pergunta, forneça entre 2 a 5 opções de respostas claras e excludentes.
4. Responda APENAS com JSON válido no formato abaixo, sem nenhum texto adicional:
{
  "productDescription": "${searchQuery}",
  "questions": [
    {
      "id": "identificador_unico_da_pergunta",
      "text": "Texto da pergunta em português?",
      "options": ["Opção A", "Opção B", "Opção C"]
    }
  ]
}`;

      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: systemPrompt }],
        max_tokens: 2048,
      });

      let rawText = completion.choices[0]?.message?.content || "";
      if (!rawText) throw new Error("Resposta vazia da API Groq (triagem).");

      rawText = rawText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Resposta da IA na triagem não contém JSON válido.");
      const result = JSON.parse(jsonMatch[0]);

      try {
        await writeLog({
          user_id: activeUser.id,
          user_name: activeUser.user_metadata?.name || activeUser.email?.split("@")[0] || "Usuário",
          user_email: activeUser.email,
          action: "search",
          entity: imageBase64 ? "Image Upload" : query,
          module_name: "Classificação NCM (Triagem)",
          description: `Busca iniciada por ${imageBase64 ? "Imagem" : "Texto ('" + query + "')"}. Candidatos NCM encontrados: ${ncmCandidates.length}.`
        });
      } catch (logErr) {}

      return NextResponse.json(result);
    }

    // ─── PASSO 2: Resultado Final (NCM + Justificativa + Alíquotas) ──────────
    if (step === 2) {
      if (!answers || !previousQuestions) {
        return NextResponse.json({ error: "Perguntas anteriores e respostas são necessárias." }, { status: 400 });
      }

      const answersSummary = Object.entries(answers)
        .map(([key, val]) => {
          const q = previousQuestions.find((pq: any) => pq.id === key);
          return `- Pergunta: "${q?.text || key}" -> Resposta Escolhida: "${val}"`;
        })
        .join("\n");

      // CONSULTA PRÉVIA AO SUPABASE (Candidatos reais no passo final)
      const ncmCandidates = await searchNcmCandidates(query);

      if (ncmCandidates.length === 0) {
        return NextResponse.json(
          { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, forneça mais detalhes técnicos." },
          { status: 422 }
        );
      }

      // INJEÇÃO DE CONTEXTO REAL NO PROMPT DA IA (IA como selecionadora/juiz)
      const systemPrompt = `Você é um especialista em classificação fiscal do Mercosul, atuando como um validador estrito de NCM.
Sua tarefa é analisar o produto do usuário, as respostas fornecidas na triagem, e a lista de candidatos NCM reais do banco de dados, escolhendo qual candidato da lista é a classificação correta.

Produto do Usuário: "${query}"

Respostas fornecidas na triagem:
${answersSummary}

Candidatos NCM Reais da Planilha Oficial:
${ncmCandidates.map(n => `- Código: ${n.code} | Descrição: ${n.description}`).join("\n")}

Regras de Seleção:
1. PESQUISA EXCLUSIVA NO BANCO DE DADOS: Você deve escolher OBRIGATORIAMENTE um código NCM que esteja presente na lista de Candidatos NCM Reais acima. É proibido inventar ou retornar um código que não esteja listado como candidato real.
2. BUSCA LITERAL E REGRAS GERAIS DE INTERPRETAÇÃO (RGI): Selecione a NCM que melhor se adequa ao produto e às respostas do usuário, fornecendo a justificativa técnica com base nas Regras Gerais de Interpretação (RGI).
3. Responda APENAS com JSON válido, sem texto adicional:
{
  "ncmCode": "CÓDIGO_ESCOLHIDO_DA_LISTA",
  "justification": "Sua justificativa detalhada e técnica aqui...",
  "taxes": {
    "ipi": "Alíquota % ou Isento",
    "pis": "Alíquota %",
    "cofins": "Alíquota %"
  }
}`;

      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: systemPrompt }],
        max_tokens: 2048,
      });

      let rawText = completion.choices[0]?.message?.content || "";
      if (!rawText) throw new Error("Resposta vazia da API Groq (resultado final).");

      rawText = rawText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Resposta da IA no Passo 2 não contém JSON válido: " + rawText.slice(0, 500));
      const result = JSON.parse(jsonMatch[0]);
      
      const cleanCode = String(result.ncmCode).replace(/[^0-9]/g, "");

      // Garantir que a IA escolheu um candidato válido da lista de candidatos reais
      const matchedNcm = ncmCandidates.find(n => n.code === cleanCode);

      if (!matchedNcm) {
        return NextResponse.json(
          { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, forneça mais detalhes técnicos." },
          { status: 422 }
        );
      }

      try {
        await writeLog({
          user_id: activeUser.id,
          user_name: activeUser.user_metadata?.name || activeUser.email?.split("@")[0] || "Usuário",
          user_email: activeUser.email,
          action: "search",
          entity: cleanCode,
          module_name: "Classificação NCM (Resultado)",
          description: `Classificação concluída. NCM: ${cleanCode}. IPI: ${result.taxes?.ipi || "0%"}, PIS: ${result.taxes?.pis || "0%"}, COFINS: ${result.taxes?.cofins || "0%"}.`
        });
      } catch (logErr) {}

      return NextResponse.json({
        ncmCode: cleanCode,
        officialDescription: matchedNcm.description,
        fullHierarchy: matchedNcm.full_description,
        justification: result.justification,
        taxes: result.taxes
      });
    }

    return NextResponse.json({ error: "Passo de classificação inválido." }, { status: 400 });

  } catch (error: any) {
    console.error("Erro na API Route /api/classify:", error);

    try {
      await writeErrorLog({
        user_id: activeUser?.id || null,
        user_name: activeUser?.user_metadata?.name || "Desconhecido",
        user_email: activeUser?.email || "desconhecido@ncm.local",
        route: "/api/classify",
        message: error.message || "Erro desconhecido na classificação fiscal.",
        stack: error.stack || null,
        status_code: 500
      });
    } catch (logErr) {}

    const errMsg = error?.message || String(error) || "Erro desconhecido";
    return NextResponse.json(
      { error: `Erro interno: ${errMsg}` },
      { status: 500 }
    );
  }
}
