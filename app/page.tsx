"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";


export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  // Modos: 'login' | 'register' | 'recovery'
  const [mode, setMode] = useState<"login" | "register" | "recovery">("login");
  
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Verificar se o usuário já está logado
  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.push("/dashboard");
      }
    };
    checkUser();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    // Verificar se o Supabase está configurado com variáveis de ambiente reais
    if (!isSupabaseConfigured()) {
      setMessage({
        text: "Erro de configuração: As variáveis de ambiente do Supabase (NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY) não estão configuradas no servidor. Por favor, adicione-as nas configurações de ambiente da Vercel.",
        type: "error"
      });
      setLoading(false);
      return;
    }

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        router.push("/dashboard");
      } else if (mode === "register") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: name || "Novo Usuário" }
          }
        });
        if (error) throw error;
        
        setMessage({ text: "Cadastro realizado! Verifique seu e-mail para confirmar a conta.", type: "success" });
        setMode("login");
      } else if (mode === "recovery") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;

        setMessage({ text: "Instruções de recuperação enviadas para o seu e-mail.", type: "success" });
        setMode("login");
      }
    } catch (err: any) {
      setMessage({ text: err.message || "Ocorreu um erro, tente novamente.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/dashboard`
        }
      });
      if (error) throw error;
    } catch (err: any) {
      setMessage({ text: err.message || "Erro ao conectar com o Google.", type: "error" });
    }
  };

  return (
    <div className="bg-background-ncm min-h-screen flex items-center justify-center p-margin-mobile md:p-margin-desktop antialiased relative selection:bg-primary-container selection:text-on-primary-container">
      {/* Container Principal */}
      <div className="w-full max-w-md bg-surface-container-lowest rounded-lg border border-outline-variant p-8 md:p-10 shadow-sm relative overflow-hidden z-10">
        {/* Subtle branding accent line */}
        <div className="absolute top-0 left-0 w-full h-1 bg-primary-container"></div>
        
        {/* Header / Logo Area */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 bg-surface-container flex items-center justify-center rounded-full mb-4 border border-outline-variant">
            <span className="material-symbols-outlined text-primary-container text-4xl">
              shield_person
            </span>
          </div>
          <h1 className="font-sans text-2xl font-bold text-primary text-center">NCM Compliant</h1>
          <p className="font-sans text-sm text-on-surface-variant text-center mt-1">
            {mode === "login" && "Acesse o portal de conformidade"}
            {mode === "register" && "Crie sua conta corporativa"}
            {mode === "recovery" && "Recuperação de acesso ao portal"}
          </p>
        </div>

        {/* Mensagens de Feedback */}
        {message && (
          <div className={`mb-6 p-4 rounded text-sm font-sans flex items-center gap-2 ${
            message.type === "success" 
              ? "bg-green-50 text-green-800 border border-green-200" 
              : "bg-error-container text-on-error-container border border-error/20"
          }`}>
            <span className="material-symbols-outlined text-lg">
              {message.type === "success" ? "check_circle" : "error"}
            </span>
            <span>{message.text}</span>
          </div>
        )}

        {/* Formulário Principal */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Nome completo (Apenas no Registro) */}
          {mode === "register" && (
            <div className="flex flex-col gap-2">
              <label className="font-sans text-xs font-semibold text-on-surface uppercase tracking-wider" htmlFor="name">
                Nome Completo
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">
                  person
                </span>
                <input 
                  className="w-full pl-10 pr-4 py-3 bg-surface-container-lowest border border-outline-variant rounded focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-colors text-sm text-on-surface placeholder-on-surface-variant/40"
                  id="name"
                  type="text"
                  placeholder="Seu nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {/* Email Input */}
          <div className="flex flex-col gap-2">
            <label className="font-sans text-xs font-semibold text-on-surface uppercase tracking-wider" htmlFor="email">
              E-mail Corporativo
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">
                mail
              </span>
              <input 
                className="w-full pl-10 pr-4 py-3 bg-surface-container-lowest border border-outline-variant rounded focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-colors text-sm text-on-surface placeholder-on-surface-variant/40"
                id="email"
                type="email"
                placeholder="usuario@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Password Input (Apenas Login / Registro) */}
          {mode !== "recovery" && (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <label className="font-sans text-xs font-semibold text-on-surface uppercase tracking-wider" htmlFor="password">
                  Senha
                </label>
                {mode === "login" && (
                  <button 
                    type="button"
                    onClick={() => setMode("recovery")}
                    className="font-sans text-xs font-semibold text-primary hover:underline transition-colors"
                  >
                    Esqueceu sua senha?
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">
                  lock
                </span>
                <input 
                  className="w-full pl-10 pr-10 py-3 bg-surface-container-lowest border border-outline-variant rounded focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-colors text-sm text-on-surface placeholder-on-surface-variant/40"
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface transition-colors focus:outline-none"
                  onClick={() => setShowPassword(!showPassword)}
                  type="button"
                >
                  <span className="material-symbols-outlined text-lg">
                    {showPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Botão de Envio */}
          <button 
            className="w-full py-3 px-4 bg-primary text-on-primary font-sans text-xs font-bold uppercase tracking-wider rounded hover:bg-primary-container transition-colors duration-200 mt-2 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 flex justify-center items-center gap-2 cursor-pointer disabled:opacity-50"
            type="submit"
            disabled={loading}
          >
            {loading ? "Processando..." : (
              mode === "login" ? "Entrar" : mode === "register" ? "Cadastrar" : "Enviar Recuperação"
            )}
            <span className="material-symbols-outlined text-sm">
              {mode === "login" ? "login" : mode === "register" ? "app_registration" : "send"}
            </span>
          </button>
        </form>

        {/* Login Social (Google) - Apenas se não estiver no modo de recuperação */}
        {mode !== "recovery" && (
          <div className="mt-6">
            <div className="relative flex items-center justify-center my-4">
              <div className="border-t border-outline-variant w-full"></div>
              <span className="absolute bg-surface-container-lowest px-3 font-sans text-xs text-on-surface-variant uppercase tracking-wider">ou continue com</span>
            </div>
            <button 
              onClick={handleGoogleLogin}
              className="w-full py-3 px-4 bg-surface-container-low border border-outline-variant hover:bg-surface-container text-on-surface font-sans text-sm font-semibold rounded transition-colors flex items-center justify-center gap-2 cursor-pointer"
              type="button"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google Workspace
            </button>
          </div>
        )}

        {/* Alternar Modos */}
        <div className="mt-6 text-center font-sans text-sm">
          {mode === "login" && (
            <p className="text-on-surface-variant">
              Não tem uma conta corporativa?{" "}
              <button onClick={() => setMode("register")} className="text-primary font-bold hover:underline">
                Cadastre-se
              </button>
            </p>
          )}
          {mode === "register" && (
            <p className="text-on-surface-variant">
              Já possui uma conta?{" "}
              <button onClick={() => setMode("login")} className="text-primary font-bold hover:underline">
                Faça Login
              </button>
            </p>
          )}
          {mode === "recovery" && (
            <button onClick={() => setMode("login")} className="text-primary font-bold hover:underline">
              Voltar para o Login
            </button>
          )}
        </div>
      </div>

      {/* Background texture/image for visual interest (low contrast) */}
      <div className="fixed inset-0 z-[-1] opacity-[0.02] pointer-events-none" style={{ backgroundImage: "radial-gradient(#001e40 1.5px, transparent 1.5px)", backgroundSize: "24px 24px" }}></div>
    </div>
  );
}
