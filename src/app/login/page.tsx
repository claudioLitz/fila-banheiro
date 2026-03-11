"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function Login() {
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const router = useRouter();

  const fazerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    setCarregando(true);

    try {
      const nomeDigitado = nome.trim();
      console.log("Procurando por:", nomeDigitado);

      const { data: usuarios, error: erroBusca } = await supabase
        .from("users")
        .select("name, email");

      if (erroBusca || !usuarios) {
        console.error("Erro na busca:", erroBusca);
        setErro("Erro ao acessar o banco de dados.");
        setCarregando(false);
        return;
      }

      const usuarioDados = usuarios.find(
        (u) => u.name.trim().localeCompare(nomeDigitado, 'pt-BR', { sensitivity: 'base' }) === 0
      );

      if (!usuarioDados) {
        setErro("Usuário não encontrado.");
        setCarregando(false);
        return;
      }

      console.log("Encontrado o e-mail:", usuarioDados.email);

      const { data, error: erroAuth } = await supabase.auth.signInWithPassword({
        email: usuarioDados.email,
        password: senha,
      });

      if (erroAuth) {
        setErro("Senha incorreta.");
      } else {
        router.push("/");
      }
    } catch (err) {
      console.error("Erro geral:", err);
      setErro("Ocorreu um erro ao tentar logar.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col bg-[#F4F4F4] font-sans text-[#2B2B2B]">
      
      {/* 1. CABEÇALHO */}
      <header className="bg-[#00579D] text-white px-8 py-4 shadow-md flex justify-between items-center border-b-0">
        <div className="flex items-center gap-6">
          <img src="/logo-senai.png" alt="Logo SENAI" className="h-14 sm:h-16 object-contain" />
          <img src="/logo-weg.png" alt="Logo WEG" className="h-14 sm:h-16 object-contain" />
          
          <h1 className="text-xl sm:text-2xl font-bold tracking-wider uppercase hidden sm:block border-l-2 border-white/30 pl-6 ml-2">
            Controle de Acesso
          </h1>
        </div>
      </header>

      {/* 2. ÁREA CENTRAL DO LOGIN */}
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="bg-white shadow-xl p-8 w-full max-w-md border-t-8 border-[#00579D] border-b-8 border-[#2B2B2B]">
          
          <div className="text-center mb-8">
            <h2 className="text-3xl font-extrabold text-[#00579D] uppercase tracking-wide">
              Bem-vindo
            </h2>
            <p className="text-[#2B2B2B] text-sm mt-2 font-bold uppercase tracking-widest">
              Acesso Restrito
            </p>
          </div>

          <form onSubmit={fazerLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-[#2B2B2B] mb-2 uppercase tracking-wider">
                Usuário
              </label>
              <input
                type="text"
                placeholder="EX: JOÃO SILVA"
                className="w-full px-4 py-3 bg-[#F4F4F4] border-2 border-[#2B2B2B] text-[#2B2B2B] font-bold focus:outline-none focus:border-[#00579D] focus:bg-white transition-all uppercase"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-[#2B2B2B] mb-2 uppercase tracking-wider">
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
              <div className="bg-white border-2 border-[#2B2B2B] p-3">
                <p className="text-[#2B2B2B] text-sm font-bold text-center uppercase tracking-wider">{erro}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={carregando}
              className="w-full py-4 mt-2 text-white font-bold tracking-widest uppercase transition-all disabled:opacity-50 bg-[#00579D] hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 flex items-center justify-center gap-2"
            >
              {carregando ? "Autenticando..." : "Entrar no Sistema"}
            </button>
          </form>
        </div>
      </div>

      {/* 3. RODAPÉ */}
      <footer className="bg-[#2B2B2B] text-white text-center text-xs py-4 font-bold tracking-widest uppercase border-t-2 border-gray-600">
        © {new Date().getFullYear()} WEG / SENAI • Sistema de Controle
      </footer>
    </main>
  );
}