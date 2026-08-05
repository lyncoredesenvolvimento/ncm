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
      // 1. FLUXO POR FOTO (Com IA): Analisar imagem primeiro
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
          messages: visionMessages as any,
          max_tokens: 128,
        });

        let visionText = visionCompletion.choices[0]?.message?.content || "";
        visionText = visionText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        if (!visionText) throw new Error("A IA de visão não conseguiu descrever o produto.");

        // Buscar candidatos na base com base no texto obtido pela imagem
        const ncmCandidates = await searchNcmCandidates(visionText);
        if (ncmCandidates.length === 0) {
          return NextResponse.json(
            { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, forneça mais detalhes técnicos." },
            { status: 422 }
          );
        }

        // Formular as perguntas de triagem para a imagem
        const systemPrompt = `Você é um especialista em classificação fiscal do Mercosul e análise de NCM.
Sua tarefa é analisar a descrição do produto e a lista de candidatos NCM reais. Formule perguntas de triagem inteligentes para encontrar o código correto.

Produto do Usuário: "${visionText}"

Candidatos NCM Reais:
${ncmCandidates.map(n => `- Código: ${n.code} | Descrição: ${n.description}`).join("\n")}

Instruções:
1. Crie até 4 perguntas objetivas com opções excludentes específicas para diferenciar estes candidatos.
2. Responda apenas no formato JSON:
{
  "productDescription": "${visionText}",
  "questions": [
    {
      "id": "pergunta_id",
      "text": "Texto da pergunta?",
      "options": ["Opção A", "Opção B"]
    }
  ]
}`;

        const completion = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: systemPrompt }],
          max_tokens: 2048,
        });

        let rawText = completion.choices[0]?.message?.content || "";
        rawText = rawText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("JSON inválido gerado na triagem de imagem.");
        const result = JSON.parse(jsonMatch[0]);

        return NextResponse.json(result);
      }

      // 2. FLUXO POR TEXTO (Sem IA): Consulta direta no banco, sem perguntas
      if (!query) {
        return NextResponse.json({ error: "Descrição do produto é necessária." }, { status: 400 });
      }

      const ncmCandidates = await searchNcmCandidates(query);
      if (ncmCandidates.length === 0) {
        return NextResponse.json(
          { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, forneça mais detalhes técnicos." },
          { status: 422 }
        );
      }

      // Retorna diretamente o candidato mais relevante como a descrição e pula as perguntas (questions vazio)
      return NextResponse.json({
        productDescription: query,
        questions: []
      });
    }

    // ─── PASSO 2: Resultado Final (NCM + Justificativa + Alíquotas) ──────────
    if (step === 2) {
      // 1. FLUXO POR TEXTO (Sem IA): Se não houver perguntas de triagem anteriores
      if (!previousQuestions || previousQuestions.length === 0) {
        const ncmCandidates = await searchNcmCandidates(query);
        if (ncmCandidates.length === 0) {
          return NextResponse.json(
            { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, forneça mais detalhes técnicos." },
            { status: 422 }
          );
        }

        const candidate = ncmCandidates[0];

        try {
          await writeLog({
            user_id: activeUser.id,
            user_name: activeUser.user_metadata?.name || activeUser.email?.split("@")[0] || "Usuário",
            user_email: activeUser.email,
            action: "search",
            entity: candidate.code,
            module_name: "Classificação NCM (Texto Sem IA)",
            description: `Busca textual sem IA concluída diretamente na base. NCM: ${candidate.code}.`
          });
        } catch (logErr) {}

        // Resposta direta sem IA com valores padrão
        return NextResponse.json({
          ncmCode: candidate.code,
          officialDescription: candidate.description,
          fullHierarchy: candidate.full_description,
          justification: "Classificação gerada via busca exata na planilha oficial de NCMs.",
          taxes: {
            ipi: "0% (Isento)",
            pis: "1.65%",
            cofins: "7.6%"
          }
        });
      }

      // 2. FLUXO POR FOTO (Com IA): Processa as respostas das perguntas geradas da imagem
      if (!answers) {
        return NextResponse.json({ error: "Respostas são necessárias para o refinamento." }, { status: 400 });
      }

      const answersSummary = Object.entries(answers)
        .map(([key, val]) => {
          const q = previousQuestions.find((pq: any) => pq.id === key);
          return `- Pergunta: "${q?.text || key}" -> Resposta Escolhida: "${val}"`;
        })
        .join("\n");

      const ncmCandidates = await searchNcmCandidates(query);
      if (ncmCandidates.length === 0) {
        return NextResponse.json(
          { error: "Erro de correspondência: Não foi possível localizar uma classificação 100% segura para este produto na planilha oficial. Por favor, forneça mais detalhes técnicos." },
          { status: 422 }
        );
      }

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
          module_name: "Classificação NCM (Resultado Imagem)",
          description: `Classificação de foto concluída. NCM: ${cleanCode}.`
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
