"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export default function Login() {
  const [isRegistering, setIsRegistering] = useState(false);

  const [nome, setNome] = useState("");
  const [emailPrefix, setEmailPrefix] = useState("");
  const [senha, setSenha] = useState("");

  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [carregando, setCarregando] = useState(false);

  const router = useRouter();
  const DOMINIO_SENAI = "@estudante.sesisenai.org.br";

  // Criação do cliente SSR do Supabase no navegador
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    setSucesso("");
    setCarregando(true);

    try {
      const nomeDigitado = nome.trim();

      if (isRegistering) {
        // ── REGISTRO ─────────────────────────────────────────
        if (!emailPrefix.trim()) throw new Error("Preencha o prefixo do e-mail.");

        const emailCompleto = emailPrefix.trim().toLowerCase() + DOMINIO_SENAI;

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: emailCompleto,
          password: senha,
          options: { data: { name: nomeDigitado } },
        });

        if (signUpError) {
          if (signUpError.message.includes("already registered") || signUpError.message.includes("already exists")) {
            throw new Error("Este e-mail já está cadastrado! Clique em 'Entrar'.");
          }
          throw signUpError;
        }

        if (data.session) {
          router.push("/");
          router.refresh(); // Atualiza o cache do Next.js
        } else {
          setSucesso("Conta criada! Você já pode entrar.");
          setNome(""); setEmailPrefix(""); setSenha("");
          setIsRegistering(false);
        }

      } else {
        // ── LOGIN ─────────────────────────────────────────────
        // 1. Validamos se o prefixo do email foi preenchido
        if (!emailPrefix.trim()) throw new Error("Preencha o prefixo do seu e-mail.");
        
        // 2. Montamos o email completo
        const emailCompleto = emailPrefix.trim().toLowerCase() + DOMINIO_SENAI;

        // 3. Fazemos o login DIRETO pelo Supabase Auth (Isso ignora o bloqueio do RLS)
        const { data, error: erroLogin } = await supabase.auth.signInWithPassword({
          email: emailCompleto,
          password: senha,
        });

        if (erroLogin) {
          throw new Error("Credenciais inválidas! Verifique seu usuário e senha.");
        }

        // 4. Se deu tudo certo, redireciona o usuário
        if (data.session) {
          router.push("/");
          router.refresh();
        }
      }
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Ocorreu um erro inesperado.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col font-sans bg-[#F4F4F4]">
      {/* CABEÇALHO */}
      <header className="bg-[#00579D] text-white px-8 py-4 shadow-md flex justify-between items-center">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-senai.png" alt="Logo SENAI" className="h-8 sm:h-10 object-contain" onError={(e) => e.currentTarget.style.display = "none"} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-weg.png" alt="Logo WEG" className="h-8 sm:h-10 object-contain" onError={(e) => e.currentTarget.style.display = "none"} />
          <h1 className="text-xl font-bold tracking-wider uppercase hidden sm:block ml-4 border-l-2 border-white/30 pl-4">
            Controle de Acesso
          </h1>
        </div>
      </header>

      {/* FORMULÁRIO */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="bg-white border-t-8 border-[#00579D] shadow-xl p-8 w-full max-w-md">

          <div className="flex mb-8 border-b-2 border-gray-200">
            <button
              type="button"
              className={`flex-1 pb-3 font-bold uppercase tracking-widest transition-colors ${!isRegistering ? "text-[#00579D] border-b-4 border-[#00579D]" : "text-gray-400 hover:text-gray-600"}`}
              onClick={() => { setIsRegistering(false); setErro(""); setSucesso(""); }}
            >
              Entrar
            </button>
            <button
              type="button"
              className={`flex-1 pb-3 font-bold uppercase tracking-widest transition-colors ${isRegistering ? "text-[#00579D] border-b-4 border-[#00579D]" : "text-gray-400 hover:text-gray-600"}`}
              onClick={() => { setIsRegistering(true); setErro(""); setSucesso(""); }}
            >
              Cadastrar
            </button>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-2xl font-extrabold text-[#2B2B2B] uppercase tracking-wider">
              {isRegistering ? "Primeiro Acesso" : "Autenticação"}
            </h2>
            <p className="text-gray-500 font-medium mt-2 uppercase text-sm">
              {isRegistering ? "Registre seu e-mail de estudante" : "Insira suas credenciais institucionais"}
            </p>
          </div>

          {sucesso && (
            <div className="mb-6 p-4 bg-green-50 border-2 border-green-600">
              <p className="text-green-700 text-sm font-bold text-center uppercase tracking-wider">{sucesso}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* O campo NOME só aparece se for CADASTRO */}
            {isRegistering && (
              <div>
                <label className="block text-[#2B2B2B] text-xs font-bold mb-2 uppercase tracking-wider">
                  Nome Completo
                </label>
                <input
                  type="text"
                  placeholder="Ex: João Silva"
                  className="w-full px-4 py-3 bg-[#F4F4F4] border-2 border-[#2B2B2B] text-[#2B2B2B] font-bold focus:outline-none focus:border-[#00579D] focus:bg-white transition-all"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required={isRegistering}
                />
              </div>
            )}

            {/* O campo E-MAIL (Prefixo) aparece TANTO NO LOGIN QUANTO NO CADASTRO */}
            <div>
              <label className="block text-[#2B2B2B] text-xs font-bold mb-2 uppercase tracking-wider">
                {isRegistering ? "E-mail Institucional" : "Nome de Usuário (E-mail)"}
              </label>
              <div className="flex items-stretch border-2 border-[#2B2B2B] bg-[#F4F4F4] focus-within:border-[#00579D] focus-within:bg-white transition-all">
                <input
                  type="text"
                  placeholder="joao.silva"
                  className="w-full px-4 py-3 bg-transparent text-[#2B2B2B] font-bold focus:outline-none"
                  value={emailPrefix}
                  onChange={(e) => setEmailPrefix(e.target.value.replace(/\s+/g, ""))}
                  required
                />
                <div className="bg-[#2B2B2B] text-white px-3 flex items-center justify-center text-xs font-bold tracking-widest border-l-2 border-[#2B2B2B]">
                  {DOMINIO_SENAI}
                </div>
              </div>
            </div>

            {/* SENHA (Aparece em ambos) */}
            <div>
              <label className="block text-[#2B2B2B] text-xs font-bold mb-2 uppercase tracking-wider">
                Senha
              </label>
              <input
                type="password"
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-[#F4F4F4] border-2 border-[#2B2B2B] text-[#2B2B2B] font-bold focus:outline-none focus:border-[#00579D] focus:bg-white transition-all"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>

            {/* MENSAGEM DE ERRO */}
            {erro && (
              <div className="bg-white border-2 border-red-600 p-3">
                <p className="text-red-600 text-sm font-bold text-center uppercase tracking-wider">{erro}</p>
              </div>
            )}

            {/* BOTÃO DE ENVIAR */}
            <button
              type="submit"
              disabled={carregando}
              className="w-full py-4 mt-4 text-white font-bold tracking-widest uppercase transition-all disabled:opacity-50 bg-[#00579D] hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1"
            >
              {carregando ? "Processando..." : isRegistering ? "Criar Conta" : "Entrar no Sistema"}
            </button>
          </form>

        </div>
      </div>

      <footer className="bg-[#2B2B2B] text-white text-center text-xs py-4 font-bold tracking-widest uppercase border-t-2 border-gray-600">
        © {new Date().getFullYear()} WEG / SENAI • Sistema de Controle
      </footer>
    </main>
  );
}