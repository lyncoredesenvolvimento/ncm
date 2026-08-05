"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function DashboardSearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    // Limpar qualquer busca por imagem anterior
    sessionStorage.removeItem("search_image_base64");
    router.push(`/dashboard/search?q=${encodeURIComponent(query.trim())}`);
  };

  const handleImageButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageLoading(true);
    // Limpar busca de texto da query
    sessionStorage.removeItem("search_image_base64");

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Salvar a imagem base64 no sessionStorage para a rota /dashboard/search ler
      sessionStorage.setItem("search_image_base64", base64String);
      setImageLoading(false);
      router.push(`/dashboard/search?mode=image`);
    };
    reader.onerror = () => {
      setImageLoading(false);
      alert("Erro ao ler o arquivo de imagem.");
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex-1 w-full max-w-container-max mx-auto px-margin-mobile lg:px-margin-desktop py-12 lg:py-24 flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] lg:min-h-screen relative z-10 selection:bg-primary-container selection:text-on-primary-container">
      
      {/* Contextual Header */}
      <div className="text-center mb-10 max-w-2xl">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-fixed rounded-2xl mb-6 shadow-sm border border-primary-fixed-dim">
          <span className="material-symbols-outlined text-primary text-3xl">manage_search</span>
        </div>
        <h2 className="font-sans text-2xl lg:text-3xl font-extrabold text-on-background mb-4">
          Classificação Fiscal de Mercadorias
        </h2>
        <p className="font-sans text-sm lg:text-base text-on-surface-variant max-w-lg mx-auto">
          Insira a descrição técnica do produto ou faça o upload de uma foto do produto para iniciar a classificação dinâmica com Inteligência Artificial.
        </p>
      </div>

      {/* Primary Search Component */}
      <div className="w-full max-w-3xl bg-surface-container-lowest border border-outline-variant rounded-xl p-2 flex flex-col md:flex-row items-center gap-2 shadow-sm focus-within:border-primary transition-colors relative">
        <form onSubmit={handleSearchSubmit} className="flex-1 flex items-center w-full bg-surface-bright rounded-lg px-4 py-1">
          <span className="material-symbols-outlined text-on-surface-variant mr-3">search</span>
          <input 
            autoComplete="off"
            className="w-full bg-transparent border-none outline-none font-sans text-base lg:text-lg text-on-surface placeholder:text-on-surface-variant/50 focus:ring-0 p-0 h-12"
            placeholder="Digite o código ou a descrição do produto..."
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>

        {/* Action Controls */}
        <div className="flex items-center gap-2 w-full md:w-auto px-2 md:px-0">
          <div className="h-8 w-px bg-outline-variant hidden md:block mx-1"></div>
          
          {/* Image Search Input Hidden */}
          <input 
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Image Search Feature */}
          <button 
            type="button"
            onClick={handleImageButtonClick}
            disabled={imageLoading}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-primary hover:bg-primary-fixed transition-all border border-transparent hover:border-primary-fixed-dim group cursor-pointer disabled:opacity-50"
            title="Pesquisa por Imagem"
          >
            <span className="material-symbols-outlined group-hover:scale-110 transition-transform">
              {imageLoading ? "sync" : "document_scanner"}
            </span>
            <span className="font-sans text-xs font-semibold md:hidden">Por Imagem</span>
          </button>

          {/* Search Action Button */}
          <button 
            type="button"
            onClick={handleSearchSubmit}
            className="flex-1 md:flex-none py-3 px-6 bg-primary text-on-primary font-sans text-xs font-bold uppercase tracking-wider rounded hover:bg-primary-container transition-colors shadow-sm cursor-pointer"
          >
            BUSCAR
          </button>
        </div>
      </div>

      {/* Guidelines/Footer inside card */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-3xl">
        <div className="bg-surface-container-lowest border border-outline-variant p-5 rounded-lg shadow-2xs">
          <div className="text-primary-container mb-3">
            <span className="material-symbols-outlined text-3xl">psychology</span>
          </div>
          <h4 className="font-sans text-sm font-bold text-primary mb-1">Triagem por IA</h4>
          <p className="font-sans text-xs text-on-surface-variant">O Gemini analisa o contexto do produto e faz perguntas de refinamento.</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant p-5 rounded-lg shadow-2xs">
          <div className="text-primary-container mb-3">
            <span className="material-symbols-outlined text-3xl">database</span>
          </div>
          <h4 className="font-sans text-sm font-bold text-primary mb-1">Tabela NCM 2026</h4>
          <p className="font-sans text-xs text-on-surface-variant">Classificação integrada à base oficial de Nomenclatura Comum do Mercosul.</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant p-5 rounded-lg shadow-2xs">
          <div className="text-primary-container mb-3">
            <span className="material-symbols-outlined text-3xl">verified_user</span>
          </div>
          <h4 className="font-sans text-sm font-bold text-primary mb-1">Conformidade Legal</h4>
          <p className="font-sans text-xs text-on-surface-variant">Obtenha justificativas e estimativas de alíquotas com base no manual lido.</p>
        </div>
      </div>
    </div>
  );
}
