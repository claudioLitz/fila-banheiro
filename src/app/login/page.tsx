"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    setSucesso("");
    setCarregando(true);

    try {
      const nomeDigitado = nome.trim();

      if (isRegistering) {
        // ==========================
        // FLUXO DE REGISTRO
        // ==========================
        if (!emailPrefix.trim()) throw new Error("Preencha o prefixo do e-mail.");
        
        const emailCompleto = emailPrefix.trim().toLowerCase() + DOMINIO_SENAI;
        
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: emailCompleto,
          password: senha,
          options: {
            data: { name: nomeDigitado } 
          }
        });

        if (signUpError) {
          if (signUpError.message.includes("already registered") || signUpError.message.includes("already exists")) {
            throw new Error("Este e-mail já está cadastrado! Clique na aba 'Entrar' acima.");
          }
          throw signUpError; 
        }
        
        // NOVIDADE: Verifica se o Supabase já logou a pessoa automaticamente (Confirmação desligada)
        if (data.session) {
          router.push("/");
        } else {
          // Se não logou, é porque a confirmação de e-mail está ligada
          setSucesso("Conta criada com sucesso! Você já pode entrar.");
          setNome("");
          setEmailPrefix("");
          setSenha("");
          setIsRegistering(false); // Muda a aba para "Entrar"
        }

      } else {
        // ==========================
        // FLUXO DE LOGIN (Entrar)
        // ==========================
        const { data: usuarios, error: erroBusca } = await supabase
          .from("users")
          .select("name, email");

        if (erroBusca || !usuarios) {
          throw new Error("Erro ao acessar o banco de dados.");
        }

        const usuarioDados = usuarios.find(
          (u) => u.name.trim().localeCompare(nomeDigitado, 'pt-BR', { sensitivity: 'base' }) === 0
        );

        if (!usuarioDados) {
          throw new Error("Usuário não encontrado. Verifique a ortografia do seu nome.");
        }

        const { error: erroAuth } = await supabase.auth.signInWithPassword({
          email: usuarioDados.email,
          password: senha,
        });

        if (erroAuth) {
          if (erroAuth.message.includes("Email not confirmed")) {
            throw new Error("Você ainda não confirmou seu e-mail. Olhe sua caixa de entrada!");
          }
          if (erroAuth.message.includes("Invalid login credentials")) {
            throw new Error("Senha incorreta.");
          }
          throw erroAuth;
        }
        
        router.push("/");
      }
    } catch (error) {
      if (error instanceof Error) {
        setErro(error.message);
      } else {
        setErro("Ocorreu um erro inesperado.");
      }
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
          <img src="/logo-senai.png" alt="Logo SENAI" className="h-14 sm:h-16 object-contain" onError={(e) => e.currentTarget.style.display = 'none'} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-weg.png" alt="Logo WEG" className="h-14 sm:h-16 object-contain" onError={(e) => e.currentTarget.style.display = 'none'} />
          <h1 className="text-xl font-bold tracking-wider uppercase hidden sm:block ml-4 border-l-2 border-white/30 pl-4">
            Controle de Acesso
          </h1>
        </div>
      </header>

      {/* CONTEÚDO CENTRAL */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="bg-white border-t-8 border-[#00579D] shadow-xl p-8 w-full max-w-md">
          
          <div className="flex mb-8 border-b-2 border-gray-200">
            <button 
              type="button"
              className={`flex-1 pb-3 font-bold uppercase tracking-widest transition-colors ${!isRegistering ? 'text-[#00579D] border-b-4 border-[#00579D]' : 'text-gray-400 hover:text-gray-600'}`}
              onClick={() => { setIsRegistering(false); setErro(""); setSucesso(""); }}
            >
              Entrar
            </button>
            <button 
              type="button"
              className={`flex-1 pb-3 font-bold uppercase tracking-widest transition-colors ${isRegistering ? 'text-[#00579D] border-b-4 border-[#00579D]' : 'text-gray-400 hover:text-gray-600'}`}
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
            <div>
              <label className="block text-[#2B2B2B] text-xs font-bold mb-2 uppercase tracking-wider">
                {isRegistering ? "Nome Completo" : "Nome de Usuário"}
              </label>
              <input
                type="text"
                placeholder={isRegistering ? "Ex: João Silva" : "Seu nome"}
                className="w-full px-4 py-3 bg-[#F4F4F4] border-2 border-[#2B2B2B] text-[#2B2B2B] font-bold focus:outline-none focus:border-[#00579D] focus:bg-white transition-all"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
              />
            </div>

            {isRegistering && (
              <div>
                <label className="block text-[#2B2B2B] text-xs font-bold mb-2 uppercase tracking-wider">
                  E-mail Institucional
                </label>
                <div className="flex items-stretch border-2 border-[#2B2B2B] bg-[#F4F4F4] focus-within:border-[#00579D] focus-within:bg-white transition-all">
                  <input
                    type="text"
                    placeholder="joao.silva"
                    className="w-full px-4 py-3 bg-transparent text-[#2B2B2B] font-bold focus:outline-none"
                    value={emailPrefix}
                    onChange={(e) => setEmailPrefix(e.target.value.replace(/\s+/g, ''))}
                    required={isRegistering}
                  />
                  <div className="bg-[#2B2B2B] text-white px-3 flex items-center justify-center text-xs font-bold tracking-widest border-l-2 border-[#2B2B2B]">
                    {DOMINIO_SENAI}
                  </div>
                </div>
              </div>
            )}

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

            {erro && (
              <div className="bg-white border-2 border-red-600 p-3">
                <p className="text-red-600 text-sm font-bold text-center uppercase tracking-wider">{erro}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={carregando}
              className="w-full py-4 mt-4 text-white font-bold tracking-widest uppercase transition-all disabled:opacity-50 bg-[#00579D] hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 flex items-center justify-center gap-2"
            >
              {carregando ? "Processando..." : (isRegistering ? "Criar Conta" : "Entrar no Sistema")}
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