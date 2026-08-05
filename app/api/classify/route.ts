import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { writeLog, writeErrorLog } from "@/lib/security";

const groqApiKey = process.env.GROQ_API_KEY;

// Função de busca inteligente nos NCMs oficiais do Supabase
async function searchNcmCandidates(queryText: string) {
  // Ignorar adjetivos genéricos (cores, preposições) para focar na essência
  const ignoredWords = new Set([
    "para", "com", "de", "do", "da", "em", "um", "uma", "o", "a", "os", "as",
    "azul", "vermelho", "vermelha", "preto", "preta", "amarelo", "amarela",
    "verde", "branco", "branca", "rosa", "roxo", "cinza", "marrom"
  ]);

  const words = queryText
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 2 && !ignoredWords.has(w));

  let dbQuery = supabaseAdmin
    .from("ncms")
    .select("code, description, full_description, chapter");

  if (words.length > 0) {
    // Busca flexível e abrangente pesquisando na descrição e na hierarquia inteira do NCM
    const conditions: string[] = [];
    words.forEach(w => {
      conditions.push(`description.ilike.%${w}%`);
      conditions.push(`full_description.ilike.%${w}%`);
    });
    dbQuery = dbQuery.or(conditions.join(","));
  } else {
    dbQuery = dbQuery.or(`description.ilike.%${queryText}%,full_description.ilike.%${queryText}%`);
  }

  let { data, error } = await dbQuery.limit(25);
  if (error) throw error;

  // FALLBACK: Se a busca de múltiplos termos não trouxer nada, buscar pelo termo principal na hierarquia
  if ((!data || data.length === 0) && words.length > 0) {
    const mainTerm = words[0];
    const fallbackQuery = await supabaseAdmin
      .from("ncms")
      .select("code, description, full_description, chapter")
      .or(`description.ilike.%${mainTerm}%,full_description.ilike.%${mainTerm}%`)
      .limit(25);
    
    if (fallbackQuery.error) throw fallbackQuery.error;
    data = fallbackQuery.data;
  }

  // Dar preferência lógica a posições principais do Capítulo 96 (ex: 9608 para canetas)
  if (data && data.length > 0) {
    const mainObj = words[0] || "";
    if (mainObj.includes("caneta")) {
      data.sort((a, b) => {
        if (a.code.startsWith("9608") && !b.code.startsWith("9608")) return -1;
        if (!a.code.startsWith("9608") && b.code.startsWith("9608")) return 1;
        return 0;
      });
    }
  }

  return data || [];
}

// Sistema de Failover/Fallback de Modelos da Groq para evitar estouro de Cota 429
async function createGroqCompletion(groq: Groq, options: { messages: any[]; max_tokens?: number }) {
  const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3.6-27b"];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const completion = await groq.chat.completions.create({
        model: model,
        messages: options.messages,
        max_tokens: options.max_tokens || 2048,
      });
      return completion;
    } catch (err: any) {
      console.warn(`[Groq Failover] Modelo ${model} falhou: ${err.message}. Tentando próximo modelo...`);
      if (i === models.length - 1) {
        throw err;
      }
    }
  }

  throw new Error("Todos os modelos falharam na resposta.");
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
          { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, forneça mais detalhes técnicos." },
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
Hierarquia oficial completa: "${ncmData.full_description}"

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

      const completion = await createGroqCompletion(groq, {
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

    // ─── PASSO 1: Triagem Inicial com Perguntas (Texto ou Imagem) ─────────────
    if (step === 1) {
      let searchQuery = query || "";

      // 1. Se for imagem, a IA de visão deduz o nome técnico primeiro
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
                text: "Identifique o produto desta imagem de forma concisa. Responda apenas com o nome técnico do produto em português (ex: 'caneta esferográfica' ou 'lápis de cor'). Não explique nem justifique."
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
          messages: visionMessages as any,
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

      // 2. BUSCA PRÉVIA DOS CANDIDATOS NO SUPABASE
      const ncmCandidates = await searchNcmCandidates(searchQuery);
      if (ncmCandidates.length === 0) {
        return NextResponse.json(
          { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, forneça mais detalhes técnicos." },
          { status: 422 }
        );
      }

      // 3. IA FORMULA AS PERGUNTAS DE TRIAGEM BASEADAS NA PLANILHA OFICIAL DO BANCO
      const systemPrompt = `Você é um especialista em classificação fiscal do Mercosul e análise de NCM (Nomenclatura Comum do Mercosul).
Sua tarefa é analisar o produto pesquisado pelo usuário ("${searchQuery}") e a lista de candidatos NCM reais extraídos exclusivamente do nosso banco de dados oficial.
Formule perguntas inteligentes de triagem com base nas diferenças reais da planilha oficial de NCMs para ajudar o usuário a selecionar o NCM exato.

Produto do Usuário: "${searchQuery}"

Lista de Candidatos NCM Reais da Planilha Oficial:
${ncmCandidates.map(n => `- Código: ${n.code} | Descrição: ${n.description} | Hierarquia Oficial: ${n.full_description}`).join("\n")}

Instruções Estritas:
1. Formule de 2 a 4 perguntas objetivas com opções excludentes específicas para diferenciar as opções acima da planilha oficial.
2. Suas perguntas e opções DEVEM ser baseadas única e exclusivamente nas características e distinções técnicas descritas nos candidatos acima.
3. Responda APENAS com JSON válido no formato:
{
  "productDescription": "${searchQuery}",
  "questions": [
    {
      "id": "pergunta_1",
      "text": "Texto da pergunta com base na planilha oficial?",
      "options": ["Opção A", "Opção B", "Opção C"]
    }
  ]
}`;

      const completion = await createGroqCompletion(groq, {
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
          entity: imageBase64 ? "Image Upload" : searchQuery,
          module_name: "Classificação NCM (Triagem)",
          description: `Triagem iniciada por ${imageBase64 ? "Imagem" : "Texto ('" + searchQuery + "')"}. Candidatos oficiais encontrados: ${ncmCandidates.length}.`
        });
      } catch (logErr) {}

      return NextResponse.json(result);
    }

    // ─── PASSO 2: Resultado Final com Seleção e Justificativa da IA ───────────
    if (step === 2) {
      if (!answers || !previousQuestions) {
        return NextResponse.json({ error: "Perguntas e respostas da triagem são necessárias." }, { status: 400 });
      }

      const answersSummary = Object.entries(answers)
        .map(([key, val]) => {
          const q = previousQuestions.find((pq: any) => pq.id === key);
          return `- Pergunta: "${q?.text || key}" -> Resposta Escolhida: "${val}"`;
        })
        .join("\n");

      // Buscar novamente a lista de candidatos do banco
      const ncmCandidates = await searchNcmCandidates(query);
      if (ncmCandidates.length === 0) {
        return NextResponse.json(
          { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, forneça mais detalhes técnicos." },
          { status: 422 }
        );
      }

      // IA atua como JUIZ para selecionar o NCM exato da lista do banco e gerar a justificativa
      const systemPrompt = `Você é um especialista em classificação fiscal do Mercosul, atuando como um validador estrito de NCM.
Sua tarefa é analisar o produto do usuário, as respostas fornecidas na triagem, e a lista de candidatos NCM reais da planilha oficial do banco de dados, escolhendo qual candidato da lista é a classificação correta.

Produto do Usuário: "${query}"

Respostas fornecidas na triagem:
${answersSummary}

Candidatos NCM Reais da Planilha Oficial:
${ncmCandidates.map(n => `- Código: ${n.code} | Descrição: ${n.description} | Hierarquia Oficial: ${n.full_description}`).join("\n")}

Regras de Seleção:
1. PESQUISA EXCLUSIVA NO BANCO DE DADOS: Você deve escolher OBRIGATORIAMENTE um código NCM que esteja presente na lista de Candidatos NCM Reais acima. É proibido inventar ou retornar um código que não esteja listado como candidato real.
2. BUSCA LITERAL E REGRAS GERAIS DE INTERPRETAÇÃO (RGI): Selecione a NCM que melhor se adequa ao produto e às respostas do usuário, fornecendo a justificativa técnica detalhada com base nas Regras Gerais de Interpretação (RGI).
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

      const completion = await createGroqCompletion(groq, {
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
      const matchedNcm = ncmCandidates.find(n => n.code === cleanCode) || ncmCandidates[0];

      try {
        await writeLog({
          user_id: activeUser.id,
          user_name: activeUser.user_metadata?.name || activeUser.email?.split("@")[0] || "Usuário",
          user_email: activeUser.email,
          action: "search",
          entity: matchedNcm.code,
          module_name: "Classificação NCM (Resultado)",
          description: `Classificação concluída. NCM: ${matchedNcm.code}.`
        });
      } catch (logErr) {}

      return NextResponse.json({
        ncmCode: matchedNcm.code,
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
