"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get("q") || "";
  const isImageMode = searchParams.get("mode") === "image";

  // Estados do fluxo
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Fase 1: Perguntas de Refinamento
  const [productName, setProductName] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<{ [key: string]: string }>({});

  // Fase 2: Resultado Final
  const [finished, setFinished] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [savingFavorite, setSavingFavorite] = useState(false);

  // Carregar dados do usuário e iniciar busca
  useEffect(() => {
    const init = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!user || userError) {
        router.push("/");
        return;
      }
      setUserId(user.id);

      // Obter o token de acesso atual para enviar na API
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token || "";

      // Iniciar classificação inicial ou busca direta
      try {
        setLoading(true);
        setError(null);

        // Verificar se é uma busca direta por código NCM (8 dígitos após limpar pontuações)
        const cleanCode = query.replace(/[^0-9]/g, "");
        if (cleanCode.length === 8 && !isImageMode) {
          const res = await fetch("/api/classify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`
            },
            body: JSON.stringify({
              step: "direct",
              ncmCode: cleanCode
            })
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Erro na busca direta do código NCM.");
          }

          setResult(data);
          setFinished(true);

          if (user.id) {
            const { data: fav } = await supabase
              .from("favorites")
              .select("id")
              .eq("user_id", user.id)
              .eq("ncm_code", data.ncmCode)
              .maybeSingle();
            
            setIsFavorited(!!fav);
          }
          setLoading(false);
          return;
        }

        let imageBase64 = null;
        if (isImageMode) {
          imageBase64 = sessionStorage.getItem("search_image_base64");
          if (!imageBase64) {
            throw new Error("Imagem de busca não encontrada. Por favor, tente novamente.");
          }
        }

        const res = await fetch("/api/classify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            step: 1,
            query: isImageMode ? "" : query,
            imageBase64,
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Erro na classificação inicial.");
        }

        setProductName(data.productDescription || "Produto Identificado");
        setQuestions(data.questions || []);
        
        // Se a IA não gerar nenhuma pergunta, pula direto para o resultado final (improvável, mas seguro)
        if (!data.questions || data.questions.length === 0) {
          await getFinalClassification(data.productDescription, [], {});
        }
      } catch (err: any) {
        setError(err.message || "Erro de conexão com o servidor.");
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [query, isImageMode, router]);

  // Enviar respostas e obter o NCM final
  const getFinalClassification = async (prodName: string, prevQs: any[], finalAnswers: any) => {
    try {
      setLoading(true);
      setError(null);

      // Obter o token atualizado antes de cada chamada
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token || "";

      const res = await fetch("/api/classify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          step: 2,
          query: prodName,
          previousQuestions: prevQs,
          answers: finalAnswers
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao gerar classificação final.");
      }

      setResult(data);
      setFinished(true);

      // Verificar se esse NCM já está nos favoritos do usuário
      if (userId) {
        const { data: fav } = await supabase
          .from("favorites")
          .select("id")
          .eq("user_id", userId)
          .eq("ncm_code", data.ncmCode)
          .maybeSingle();
        
        setIsFavorited(!!fav);
      }

    } catch (err: any) {
      setError(err.message || "Erro no refinamento da classificação.");
    } finally {
      setLoading(false);
    }
  };

  // Responder a pergunta atual
  const handleAnswerSelect = (option: string) => {
    const currentQuestion = questions[currentQuestionIndex];
    const newAnswers = { ...answers, [currentQuestion.id]: option };
    setAnswers(newAnswers);

    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      // Respondidas todas as perguntas, buscar resultado final
      getFinalClassification(productName, questions, newAnswers);
    }
  };

  // Voltar uma pergunta
  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  // Favoritar / Desfavoritar NCM
  const handleToggleFavorite = async () => {
    if (!result || !userId || savingFavorite) return;
    setSavingFavorite(true);

    try {
      if (isFavorited) {
        // Remover
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", userId)
          .eq("ncm_code", result.ncmCode);
        
        if (error) throw error;
        setIsFavorited(false);
      } else {
        // Inserir
        const { error } = await supabase
          .from("favorites")
          .insert({
            user_id: userId,
            ncm_code: result.ncmCode
          });
        
        if (error) throw error;
        setIsFavorited(true);
      }
    } catch (err: any) {
      alert("Erro ao salvar favorito: " + err.message);
    } finally {
      setSavingFavorite(false);
    }
  };

  if (loading && !finished) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] lg:min-h-screen p-6">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-sans text-sm text-on-surface-variant font-semibold">
          {questions.length === 0 ? "A IA está analisando seu produto..." : "A IA está processando suas respostas..."}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] lg:min-h-screen p-6 text-center">
        <span className="material-symbols-outlined text-error text-5xl mb-4">error_outline</span>
        <h3 className="font-sans text-lg font-bold text-on-background mb-2">Erro na Classificação</h3>
        <p className="font-sans text-sm text-on-surface-variant max-w-md mb-6">{error}</p>
        <Link href="/dashboard" className="px-6 py-3 bg-primary text-on-primary font-sans text-xs font-bold uppercase rounded hover:bg-primary-container transition-colors">
          Nova Pesquisa
        </Link>
      </div>
    );
  }

  // Visualização de Refinamento (Triagem de perguntas)
  if (!finished && questions.length > 0) {
    const currentQuestion = questions[currentQuestionIndex];
    const progressPercent = Math.round(((currentQuestionIndex) / questions.length) * 100);

    return (
      <div className="min-h-[calc(100vh-4rem)] lg:min-h-screen p-margin-mobile lg:p-margin-desktop flex items-center justify-center">
        <div className="w-full max-w-xl bg-surface-container-lowest border border-outline-variant rounded-xl p-8 shadow-sm">
          {/* Indicador de Progresso */}
          <div className="mb-8">
            <div className="flex justify-between items-center text-xs text-on-surface-variant font-bold font-sans mb-2">
              <span>TRIAGEM DO PRODUTO ({productName})</span>
              <span>{currentQuestionIndex + 1} de {questions.length}</span>
            </div>
            <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary-container transition-all duration-300"
                style={{ width: `${progressPercent || 10}%` }}
              ></div>
            </div>
          </div>

          {/* Pergunta */}
          <div className="mb-8">
            <span className="text-xs font-bold text-primary bg-primary-fixed border border-primary-fixed-dim px-3 py-1 rounded font-sans uppercase tracking-wider">
              Pergunta {currentQuestionIndex + 1}
            </span>
            <h3 className="font-sans text-lg lg:text-xl font-bold text-on-surface mt-4 leading-relaxed">
              {currentQuestion.text}
            </h3>
          </div>

          {/* Opções */}
          <div className="flex flex-col gap-3">
            {currentQuestion.options.map((option: string, idx: number) => (
              <button
                key={idx}
                onClick={() => handleAnswerSelect(option)}
                className="w-full text-left p-4 rounded-lg border border-outline-variant hover:border-primary hover:bg-surface-container transition-all cursor-pointer font-sans text-sm font-semibold flex justify-between items-center group"
              >
                <span>{option}</span>
                <span className="material-symbols-outlined text-outline group-hover:text-primary transition-colors text-lg">
                  chevron_right
                </span>
              </button>
            ))}
          </div>

          {/* Controle Inferior */}
          {currentQuestionIndex > 0 && (
            <div className="mt-8 pt-6 border-t border-outline-variant flex">
              <button
                onClick={handlePreviousQuestion}
                className="flex items-center gap-2 text-on-surface-variant hover:text-primary font-sans text-xs font-bold uppercase transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                Voltar Pergunta
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Visualização do Resultado Final
  if (finished && result) {
    return (
      <div className="min-h-[calc(100vh-4rem)] lg:min-h-screen p-margin-mobile lg:p-margin-desktop py-12 flex items-center justify-center">
        <div className="w-full max-w-3xl bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden shadow-sm">
          {/* Header do Resultado */}
          <div className="bg-primary p-6 lg:p-8 text-on-primary flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-b border-primary-container">
            <div>
              <p className="font-sans text-xs uppercase tracking-widest text-on-primary-container font-semibold">
                Classificação Fiscal Recomendada
              </p>
              <h2 className="font-sans text-3xl font-extrabold tracking-wide mt-1">
                {result.ncmCode.slice(0, 4)}.{result.ncmCode.slice(4, 6)}.{result.ncmCode.slice(6, 8)}
              </h2>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={handleToggleFavorite}
                disabled={savingFavorite}
                className={`p-3 rounded-lg border flex items-center justify-center gap-2 text-sm font-sans font-bold cursor-pointer transition-all ${
                  isFavorited
                    ? "bg-yellow-400 border-yellow-500 text-yellow-950 hover:bg-yellow-300"
                    : "bg-primary-container border-primary-fixed-dim text-on-primary-container hover:bg-primary-fixed"
                }`}
                title={isFavorited ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}
              >
                <span className={`material-symbols-outlined text-lg ${isFavorited ? "icon-filled" : ""}`}>
                  star
                </span>
                {isFavorited ? "FAVORITADO" : "FAVORITAR"}
              </button>

              <Link
                href="/dashboard"
                className="px-5 py-3 bg-primary-fixed border border-primary-fixed-dim text-primary font-sans text-xs font-bold uppercase rounded-lg hover:bg-primary-fixed-dim transition-colors flex items-center justify-center gap-2"
              >
                NOVA BUSCA
              </Link>
            </div>
          </div>

          <div className="p-6 lg:p-8 flex flex-col gap-6">
            {/* Hierarquia NCM */}
            {result.fullHierarchy && (
              <div>
                <h4 className="font-sans text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                  Estrutura Hierárquica
                </h4>
                <div className="bg-surface-container-low border border-outline-variant p-4 rounded text-xs leading-relaxed text-on-surface-variant font-sans flex flex-col gap-1">
                  {result.fullHierarchy.split(" > ").map((stepText: string, idx: number) => (
                    <div key={idx} className="flex items-start gap-2">
                      {idx > 0 && <span className="text-outline">└</span>}
                      <span>{stepText}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Descrição do NCM */}
            <div>
              <h4 className="font-sans text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                Descrição Oficial do Código
              </h4>
              <p className="font-sans text-base text-on-surface leading-relaxed bg-surface-bright border border-outline-variant p-4 rounded font-semibold">
                {result.officialDescription}
              </p>
            </div>

            {/* Impostos Estimados */}
            <div>
              <h4 className="font-sans text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-3">
                Estimativa de Alíquotas Federais
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-lg shadow-2xs flex justify-between items-center">
                  <div>
                    <h5 className="font-sans text-xs text-on-surface-variant uppercase font-bold">IPI</h5>
                    <p className="font-sans text-[10px] text-outline">Imp. s/ Prod. Ind.</p>
                  </div>
                  <span className="font-sans text-base font-extrabold text-primary bg-primary-fixed border border-primary-fixed-dim px-3 py-1 rounded">
                    {result.taxes?.ipi || "0%"}
                  </span>
                </div>
                <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-lg shadow-2xs flex justify-between items-center">
                  <div>
                    <h5 className="font-sans text-xs text-on-surface-variant uppercase font-bold">PIS</h5>
                    <p className="font-sans text-[10px] text-outline">Int. Social</p>
                  </div>
                  <span className="font-sans text-base font-extrabold text-primary bg-primary-fixed border border-primary-fixed-dim px-3 py-1 rounded">
                    {result.taxes?.pis || "1.65%"}
                  </span>
                </div>
                <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-lg shadow-2xs flex justify-between items-center">
                  <div>
                    <h5 className="font-sans text-xs text-on-surface-variant uppercase font-bold">COFINS</h5>
                    <p className="font-sans text-[10px] text-outline">Fin. Seguridade</p>
                  </div>
                  <span className="font-sans text-base font-extrabold text-primary bg-primary-fixed border border-primary-fixed-dim px-3 py-1 rounded">
                    {result.taxes?.cofins || "7.6%"}
                  </span>
                </div>
              </div>
            </div>

            {/* Justificativa Fiscal */}
            <div className="border-t border-outline-variant pt-6">
              <h4 className="font-sans text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                Justificativa da Classificação Fiscal
              </h4>
              <div className="font-sans text-sm text-on-surface-variant leading-relaxed bg-surface-container-low border border-outline-variant p-4 rounded whitespace-pre-line">
                {result.justification}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] lg:min-h-screen p-6">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-sans text-sm text-on-surface-variant font-semibold">Carregando fluxo de busca...</p>
      </div>
    }>
      <SearchContent />
    </Suspense>
  );
}
