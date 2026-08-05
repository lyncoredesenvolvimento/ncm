"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface FavoriteNCM {
  id: number;
  ncm_code: string;
  created_at: string;
  ncms: {
    description: string;
    full_description: string;
    chapter: string;
  } | null;
}

export default function FavoritesPage() {
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavoriteNCM[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Carregar os favoritos
  const loadFavorites = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/");
        return;
      }
      setUserId(user.id);

      // 1. Carregar os favoritos do usuário
      const { data: favsData, error: fetchErr } = await supabase
        .from("favorites")
        .select("id, ncm_code, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (fetchErr) throw fetchErr;

      if (favsData && favsData.length > 0) {
        // 2. Coletar os códigos de NCM para buscar as descrições na tabela local
        const codes = favsData.map(f => f.ncm_code);
        
        const { data: ncmData, error: ncmErr } = await supabase
          .from("ncms")
          .select("code, description, full_description, chapter")
          .in("code", codes);

        // Mesmo se houver erro ao buscar descrições, mostramos os favoritos
        const mapped = favsData.map(fav => {
          const matched = ncmData?.find(n => n.code === fav.ncm_code) || null;
          return {
            id: fav.id,
            ncm_code: fav.ncm_code,
            created_at: fav.created_at,
            ncms: matched ? {
              description: matched.description,
              full_description: matched.full_description,
              chapter: matched.chapter
            } : null
          };
        });

        setFavorites(mapped);
      } else {
        setFavorites([]);
      }
    } catch (err: any) {
      setError(err.message || "Erro ao carregar favoritos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFavorites();
  }, [router]);

  // Remover dos favoritos
  const handleRemoveFavorite = async (favId: number, ncmCode: string) => {
    if (deletingId) return;
    setDeletingId(favId);

    try {
      const { error: delErr } = await supabase
        .from("favorites")
        .delete()
        .eq("id", favId);

      if (delErr) throw delErr;

      // Registrar o log de auditoria da remoção no banco (opcional, mas recomendado no manual)
      // Como o writeLog é do servidor, chamamos o banco do supabase direto no cliente (que segue as regras RLS) ou deixamos para registrar
      setFavorites(favorites.filter(fav => fav.id !== favId));
    } catch (err: any) {
      alert("Erro ao remover favorito: " + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  // Filtragem local
  const filteredFavorites = favorites.filter(fav => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    
    const code = fav.ncm_code.toLowerCase();
    const desc = fav.ncms?.description.toLowerCase() || "";
    const fullDesc = fav.ncms?.full_description.toLowerCase() || "";
    const chapter = fav.ncms?.chapter.toLowerCase() || "";

    return code.includes(q) || desc.includes(q) || fullDesc.includes(q) || chapter.includes(q);
  });

  return (
    <div className="flex-1 w-full max-w-container-max mx-auto px-margin-mobile lg:px-margin-desktop py-8 lg:py-12 selection:bg-primary-container selection:text-on-primary-container">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-8">
        <div>
          <h2 className="font-sans text-2xl font-bold text-primary flex items-center gap-2">
            <span className="material-symbols-outlined icon-filled text-yellow-500">star</span>
            Meus NCMs Favoritos
          </h2>
          <p className="font-sans text-xs text-on-surface-variant mt-1">
            Gerencie e filtre seus códigos NCM salvos para consultas rápidas.
          </p>
        </div>
      </div>

      {/* Barra de Busca e Filtros */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 mb-6 flex items-center gap-4 shadow-2xs">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
            search
          </span>
          <input 
            className="w-full h-11 pl-10 pr-4 rounded bg-surface-bright border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none text-sm font-sans"
            placeholder="Buscar nos meus favoritos..."
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="text-xs font-semibold text-on-surface-variant font-sans shrink-0 hidden md:block">
          {filteredFavorites.length} {filteredFavorites.length === 1 ? "registro encontrado" : "registros encontrados"}
        </div>
      </section>

      {/* Estado de Carregamento */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="font-sans text-sm text-on-surface-variant">Buscando favoritos...</p>
        </div>
      )}

      {/* Erro */}
      {error && !loading && (
        <div className="text-center py-20 bg-error-container text-on-error-container rounded-lg border border-error/10">
          <span className="material-symbols-outlined text-error text-4xl mb-2">error</span>
          <p className="font-sans text-sm font-semibold">{error}</p>
        </div>
      )}

      {/* Lista de Favoritos */}
      {!loading && !error && (
        <>
          {filteredFavorites.length === 0 ? (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-12 text-center shadow-2xs">
              <span className="material-symbols-outlined text-outline text-5xl mb-3">star_half</span>
              <h3 className="font-sans text-base font-bold text-on-surface mb-1">Nenhum favorito encontrado</h3>
              <p className="font-sans text-xs text-on-surface-variant max-w-sm mx-auto mb-6">
                {searchQuery ? "Nenhum dos seus favoritos atende à sua busca atual." : "Você ainda não favoritou nenhum NCM. Comece pesquisando no dashboard principal."}
              </p>
              <Link href="/dashboard" className="px-6 py-3 bg-primary text-on-primary font-sans text-xs font-bold uppercase rounded-lg hover:bg-primary-container transition-colors">
                Pesquisar NCMs
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredFavorites.map((fav) => (
                <article 
                  key={fav.id}
                  onClick={(e) => {
                    // Se clicar no botão de desfavoritar (ou dentro dele), não navega
                    if ((e.target as HTMLElement).closest("button")) return;
                    router.push(`/dashboard/search?q=${fav.ncm_code}`);
                  }}
                  className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col justify-between gap-4 shadow-2xs hover:shadow-sm hover:border-primary/50 hover:bg-surface-container-lowest transition-all relative cursor-pointer group"
                >
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <p className="font-sans text-[10px] text-on-surface-variant font-bold flex items-center gap-1 uppercase tracking-wider">
                        Capítulo {fav.ncms?.chapter}
                      </p>
                      <h2 className="font-sans text-xl font-extrabold text-primary tracking-wide mt-1">
                        {fav.ncm_code.slice(0, 4)}.{fav.ncm_code.slice(4, 6)}.{fav.ncm_code.slice(6, 8)}
                      </h2>
                    </div>

                    <button
                      onClick={() => handleRemoveFavorite(fav.id, fav.ncm_code)}
                      disabled={deletingId === fav.id}
                      className="text-yellow-500 hover:text-outline transition-colors focus:outline-none cursor-pointer disabled:opacity-50"
                      title="Remover dos favoritos"
                    >
                      <span className="material-symbols-outlined icon-filled text-2xl">
                        star
                      </span>
                    </button>
                  </div>

                  <p className="font-sans text-xs text-on-surface leading-relaxed line-clamp-3 bg-surface-bright p-3 rounded border border-outline-variant/40">
                    {fav.ncms?.description || "Descrição não cadastrada."}
                  </p>

                  {fav.ncms?.full_description && (
                    <div className="text-[10px] text-outline font-sans truncate" title={fav.ncms.full_description}>
                      {fav.ncms.full_description.split(" > ").slice(0, -1).join(" > ")}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
