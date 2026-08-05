"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [userName, setUserName] = useState("Carregando...");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const getUserData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/");
        return;
      }
      setUserName(user.user_metadata?.name || user.email?.split("@")[0] || "Usuário");
    };
    getUserData();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // Limpar cookies de sessão no cliente para garantir que o middleware atualize o estado imediatamente
    document.cookie = "sb-access-token=; Max-Age=0; path=/;";
    // Excluir qualquer cookie que comece com sb- e termine com -auth-token
    const cookies = document.cookie.split(";");
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      const eqPos = cookie.indexOf("=");
      const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
      if (name.startsWith("sb-") && name.endsWith("-auth-token")) {
        document.cookie = name + "=; Max-Age=0; path=/;";
      }
    }
    router.push("/");
  };

  const isSearchActive = pathname === "/dashboard" || pathname.startsWith("/dashboard/search");
  const isFavoritesActive = pathname === "/dashboard/favorites";

  return (
    <div className="bg-background-ncm text-on-surface font-sans antialiased flex h-screen overflow-hidden selection:bg-primary-container selection:text-on-primary-container">
      
      {/* Mobile Top Navigation (Visible on lg-) */}
      <nav className="lg:hidden bg-surface-container-lowest flex justify-between items-center w-full px-margin-mobile h-16 fixed top-0 z-50 border-b border-outline-variant">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Lyncore Logo" className="w-7 h-7 object-contain" />
          <span className="font-sans text-sm font-bold text-primary">NCM Lyncore</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="p-2 text-primary hover:bg-surface-container rounded-full transition-colors">
            <span className="material-symbols-outlined text-xl">search</span>
          </Link>
          <Link href="/dashboard/favorites" className="p-2 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors">
            <span className="material-symbols-outlined text-xl">star</span>
          </Link>
          <button 
            onClick={handleLogout}
            className="p-2 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors"
            title="Sair"
          >
            <span className="material-symbols-outlined text-xl">logout</span>
          </button>
        </div>
      </nav>

      {/* Desktop Side Navigation (Visible on lg+) */}
      <aside className="hidden lg:flex flex-col h-screen w-64 fixed left-0 top-0 border-r border-outline-variant bg-surface-container-lowest z-50">
        {/* Header */}
        <div className="p-5 border-b border-outline-variant flex items-center gap-3">
          <div className="w-12 h-12 flex items-center justify-center">
            <img src="/logo.svg" alt="Lyncore Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="font-sans text-sm font-extrabold text-primary">NCM Lyncore</h1>
            <p className="font-sans text-[10px] text-on-surface-variant">Portal NCM Inteligente</p>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="flex flex-col gap-1 px-2">
            <Link 
              href="/dashboard"
              className={`flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-surface-container-low transition-all duration-150 ease-in-out font-sans text-sm font-semibold ${
                isSearchActive 
                  ? "bg-surface-container text-primary border-r-4 border-primary" 
                  : "text-on-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-xl">search</span>
              Pesquisa
            </Link>

            <Link 
              href="/dashboard/favorites"
              className={`flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-surface-container-low transition-all duration-150 ease-in-out font-sans text-sm font-semibold ${
                isFavoritesActive 
                  ? "bg-surface-container text-primary border-r-4 border-primary" 
                  : "text-on-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-xl">star</span>
              Favoritos
            </Link>
          </nav>
        </div>

        {/* Footer Actions / User Profile */}
        <div className="p-4 border-t border-outline-variant">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-8 h-8 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold text-sm">
              {userName.slice(0, 2).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="font-sans text-xs font-bold text-on-surface truncate">{userName}</p>
              <p className="font-sans text-[10px] text-on-surface-variant">Usuário Conectado</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full bg-primary-container text-on-primary-container font-sans text-xs font-bold py-3 rounded-lg hover:bg-primary hover:text-on-primary transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">logout</span>
            Sair do Portal
          </button>
        </div>
      </aside>

      {/* Main Content Canvas */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto w-full lg:ml-64 mt-16 lg:mt-0 bg-background-ncm relative">
        {/* Decorative subtle background pattern */}
        <div className="absolute inset-0 opacity-[0.015] pointer-events-none" style={{ backgroundImage: "radial-gradient(#001e40 1px, transparent 1px)", backgroundSize: "24px 24px" }}></div>
        <div className="flex-1 w-full max-w-container-max mx-auto relative z-10">
          {children}
        </div>
      </main>
    </div>
  );
}
