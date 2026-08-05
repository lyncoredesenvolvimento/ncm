import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { writeLog, writeErrorLog } from "@/lib/security";

const apiKey = process.env.GEMINI_API_KEY;

export async function POST(request: NextRequest) {
  let activeUser: any = null;
  
  try {
    const body = await request.json();
    const { query, imageBase64, previousQuestions, answers, step } = body;

    if (!apiKey || apiKey === "INSIRA_SUA_CHAVE_GEMINI_AQUI") {
      return NextResponse.json(
        { error: "A chave da API do Gemini (GEMINI_API_KEY) não está configurada no servidor." },
        { status: 500 }
      );
    }

    // 1. Identificar o usuário no servidor via token ou cookies (Segurança)
    // Ler token do cabeçalho Authorization
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
      if (user) {
        activeUser = user;
      }
    }

    // Se for rota privada e não estiver logado
    if (!activeUser) {
      return NextResponse.json(
        { error: "Sessão inválida ou não autenticada." },
        { status: 401 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // Se for o Passo 1 (Busca Inicial por Texto ou Imagem)
    if (step === 1) {
      let prompt = `Você é um especialista em classificação fiscal do Mercosul e análise de NCM (Nomenclatura Comum do Mercosul).
Seu objetivo é analisar as informações do produto fornecidas e gerar perguntas inteligentes para refinamento e triagem dinâmica do NCM correto.

Instruções:
1. Identifique o tipo de produto e sua provável categoria.
2. Formule até 4 perguntas sequenciais e objetivas que ajudem a diferenciar as subposições do NCM deste produto.
3. Para cada pergunta, forneça entre 2 a 5 opções de respostas claras e excludentes.
4. Responda estritamente no formato JSON abaixo:
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

      let contents: any[] = [{ text: prompt }];

      if (imageBase64) {
        const match = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) {
          return NextResponse.json({ error: "Formato de imagem inválido." }, { status: 400 });
        }
        const mimeType = match[1];
        const data = match[2];

        contents.push({
          inlineData: {
            mimeType,
            data
          }
        });
        contents[0].text += "\nAnalise a imagem do produto anexado e use-a como contexto principal.";
      } else if (query) {
        contents[0].text += `\nO produto informado pelo usuário é: "${query}"`;
      } else {
        return NextResponse.json({ error: "Descrição do produto ou imagem é necessária." }, { status: 400 });
      }

      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents,
        config: {
          responseMimeType: "application/json",
        }
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error("Resposta vazia da API do Gemini.");
      }

      const result = JSON.parse(resultText);
      
      // Registrar log — isolado para não quebrar o fluxo principal
      try {
        await writeLog({
          user_id: activeUser.id,
          user_name: activeUser.user_metadata?.name || activeUser.email?.split("@")[0] || "Usuário",
          user_email: activeUser.email,
          action: "search",
          entity: imageBase64 ? "Image Upload" : query,
          module_name: "Classificação NCM (Triagem)",
          description: `Busca iniciada por ${imageBase64 ? "Imagem" : "Texto ('" + query + "')"}. Descrição identificada pela IA: "${result.productDescription}".`
        });
      } catch (logErr) {
        console.warn("[writeLog] Falha ao registrar log (não crítico):", logErr);
      }

      return NextResponse.json(result);
    }

    // Se for o Passo 2 (Processar as Respostas do usuário e chegar ao NCM final)
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

      let prompt = `Você é um especialista em classificação fiscal do Mercosul e análise de NCM (Nomenclatura Comum do Mercosul).
Com base nas informações do produto e nas respostas de triagem respondidas pelo usuário, determine o código NCM correto de 8 dígitos.

Dados do Produto:
${query ? `Descrição inicial: "${query}"` : "Produto enviado por imagem."}

Respostas fornecidas na triagem:
${answersSummary}

Instruções:
1. Determine o código NCM de 8 dígitos correto para o produto. O código deve ser composto estritamente por 8 caracteres numéricos (ex: "84713012" ou "85176259", sem pontos).
2. Forneça uma justificativa técnica da classificação fiscal com base nas Regras Gerais de Interpretação do Sistema Harmonizado (RGI).
3. Estime as alíquotas nacionais de impostos (IPI, PIS, COFINS) aplicáveis.
4. Responda estritamente no formato JSON abaixo:
{
  "ncmCode": "8DIGITOS",
  "justification": "Sua justificativa detalhada e técnica aqui...",
  "taxes": {
    "ipi": "Alíquota % ou Isento",
    "pis": "Alíquota %",
    "cofins": "Alíquota %"
  }
}`;

      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [{ text: prompt }],
        config: {
          responseMimeType: "application/json",
        }
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error("Resposta vazia da API do Gemini.");
      }

      const result = JSON.parse(resultText);
      const cleanCode = String(result.ncmCode).replace(/[^0-9]/g, "");

      // Buscar a descrição oficial do NCM no nosso banco de dados do Supabase
      const { data: ncmData } = await supabaseAdmin
        .from("ncms")
        .select("code, description, full_description")
        .eq("code", cleanCode)
        .single();

      // Registrar log — isolado para não quebrar o fluxo principal
      try {
        await writeLog({
          user_id: activeUser.id,
          user_name: activeUser.user_metadata?.name || activeUser.email?.split("@")[0] || "Usuário",
          user_email: activeUser.email,
          action: "search",
          entity: cleanCode,
          module_name: "Classificação NCM (Resultado)",
          description: `Classificação concluída. NCM gerado: ${cleanCode}. Alíquotas estimadas - IPI: ${result.taxes?.ipi || "0%"}, PIS: ${result.taxes?.pis || "0%"}, COFINS: ${result.taxes?.cofins || "0%"}.`
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
    
    // Gravar log de erro — isolado para não causar erro secundário
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

    // Retornar mensagem de erro com detalhes para debug
    const errMsg = error?.message || String(error) || "Erro desconhecido";
    return NextResponse.json(
      { error: `Erro interno: ${errMsg}` },
      { status: 500 }
    );
  }
}
