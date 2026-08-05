import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { writeLog, writeErrorLog } from "@/lib/security";

const groqApiKey = process.env.GROQ_API_KEY;

export async function POST(request: NextRequest) {
  let activeUser: any = null;

  try {
    const body = await request.json();
    const { query, imageBase64, previousQuestions, answers, step } = body;

    if (!groqApiKey) {
      return NextResponse.json(
        { error: "A chave da API do Groq (GROQ_API_KEY) não está configurada no servidor." },
        { status: 500 }
      );
    }

    // 1. Identificar o usuário via Bearer token
    const authHeader = request.headers.get("authorization") ?? "";
    let token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    // Se não estiver no Authorization, tenta ler do cookie do Supabase
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

    // Validar token no Supabase Auth
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

    // ─── PASSO 1: Triagem Inicial (Texto ou Imagem) ───────────────────────────
    if (step === 1) {
      const systemPrompt = `Você é um especialista em classificação fiscal do Mercosul e análise de NCM (Nomenclatura Comum do Mercosul).
Seu objetivo é analisar as informações do produto fornecidas e gerar perguntas inteligentes para refinamento e triagem dinâmica do NCM correto.

Instruções:
1. Identifique o tipo de produto e sua provável categoria NCM.
2. Formule até 4 perguntas sequenciais e objetivas que ajudem a diferenciar as subposições do NCM deste produto.
3. Para cada pergunta, forneça entre 2 a 5 opções de respostas claras e excludentes.
4. Responda APENAS com JSON válido no formato abaixo, sem nenhum texto adicional:
{
  "productDescription": "Nome/Descrição técnica do produto deduzida",
  "questions": [
    {
      "id": "identificador_unico_da_pergunta",
      "text": "Texto da pergunta em português?",
      "options": ["Opção A", "Opção B", "Opção C"]
    }
  ]
}`;

      let messages: any[];

      if (imageBase64) {
        // Modo imagem — usar modelo de visão do Groq (Llama 3.2 Vision)
        const match = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) {
          return NextResponse.json({ error: "Formato de imagem inválido." }, { status: 400 });
        }

        messages = [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: systemPrompt + "\n\nAnalise a imagem do produto abaixo e identifique o produto para classificação NCM."
              },
              {
                type: "image_url",
                image_url: { url: imageBase64 }
              }
            ]
          }
        ];

        const completion = await groq.chat.completions.create({
          model: "llama-3.2-11b-vision-preview",
          messages,
          response_format: { type: "json_object" },
          max_tokens: 1024,
        });

        const resultText = completion.choices[0]?.message?.content;
        if (!resultText) throw new Error("Resposta vazia da API Groq (imagem).");
        const result = JSON.parse(resultText);

        try {
          await writeLog({
            user_id: activeUser.id,
            user_name: activeUser.user_metadata?.name || activeUser.email?.split("@")[0] || "Usuário",
            user_email: activeUser.email,
            action: "search",
            entity: "Image Upload",
            module_name: "Classificação NCM (Triagem)",
            description: `Busca por imagem iniciada. Produto identificado: "${result.productDescription}".`
          });
        } catch (logErr) {
          console.warn("[writeLog] Falha ao registrar log (não crítico):", logErr);
        }

        return NextResponse.json(result);

      } else if (query) {
        // Modo texto
        messages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `O produto informado pelo usuário é: "${query}"` }
        ];

        const completion = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages,
          response_format: { type: "json_object" },
          max_tokens: 1024,
        });

        const resultText = completion.choices[0]?.message?.content;
        if (!resultText) throw new Error("Resposta vazia da API Groq (texto).");
        const result = JSON.parse(resultText);

        try {
          await writeLog({
            user_id: activeUser.id,
            user_name: activeUser.user_metadata?.name || activeUser.email?.split("@")[0] || "Usuário",
            user_email: activeUser.email,
            action: "search",
            entity: query,
            module_name: "Classificação NCM (Triagem)",
            description: `Busca por texto '${query}' iniciada. Produto identificado: "${result.productDescription}".`
          });
        } catch (logErr) {
          console.warn("[writeLog] Falha ao registrar log (não crítico):", logErr);
        }

        return NextResponse.json(result);

      } else {
        return NextResponse.json({ error: "Descrição do produto ou imagem é necessária." }, { status: 400 });
      }
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

      const systemPrompt = `Você é um especialista em classificação fiscal do Mercosul e análise de NCM.
Com base nas informações do produto e nas respostas de triagem, determine o código NCM correto de 8 dígitos.

Instruções:
1. Determine o código NCM de 8 dígitos (ex: "84713012", sem pontos).
2. Forneça justificativa técnica com base nas Regras Gerais de Interpretação do SH (RGI).
3. Estime alíquotas nacionais de IPI, PIS, COFINS.
4. Responda APENAS com JSON válido, sem texto adicional:
{
  "ncmCode": "8DIGITOS",
  "justification": "Justificativa detalhada e técnica aqui...",
  "taxes": {
    "ipi": "Alíquota % ou Isento",
    "pis": "Alíquota %",
    "cofins": "Alíquota %"
  }
}`;

      const userContent = `Dados do Produto:
${query ? `Descrição inicial: "${query}"` : "Produto enviado por imagem."}

Respostas fornecidas na triagem:
${answersSummary}`;

      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" },
        max_tokens: 1024,
      });

      const resultText = completion.choices[0]?.message?.content;
      if (!resultText) throw new Error("Resposta vazia da API Groq (resultado final).");

      const result = JSON.parse(resultText);
      const cleanCode = String(result.ncmCode).replace(/[^0-9]/g, "");

      // Buscar descrição oficial do NCM no banco Supabase
      const { data: ncmData } = await supabaseAdmin
        .from("ncms")
        .select("code, description, full_description")
        .eq("code", cleanCode)
        .single();

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
      } catch (logErr) {
        console.warn("[writeLog] Falha ao registrar log (não crítico):", logErr);
      }

      return NextResponse.json({
        ncmCode: cleanCode,
        officialDescription: ncmData?.description || "Descrição oficial não encontrada na base local.",
        fullHierarchy: ncmData?.full_description || null,
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
    } catch (logErr) {
      console.warn("[writeErrorLog] Falha ao registrar log de erro:", logErr);
    }

    const errMsg = error?.message || String(error) || "Erro desconhecido";
    return NextResponse.json(
      { error: `Erro interno: ${errMsg}` },
      { status: 500 }
    );
  }
}
