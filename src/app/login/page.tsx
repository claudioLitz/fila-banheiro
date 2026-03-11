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
      // 1. Procura o e-mail do usuário pelo NOME na sua tabela pública
      const { data: usuarioDados, error: erroBusca } = await supabase
        .from("users")
        .select("email")
        .eq("name", nome)
        .single();

      if (erroBusca || !usuarioDados) {
        setErro("Usuário não encontrado.");
        setCarregando(false);
        return;
      }

      // 2. Faz o login seguro no Auth nativo do Supabase usando o email encontrado e a senha
      const { data, error: erroAuth } = await supabase.auth.signInWithPassword({
        email: usuarioDados.email,
        password: senha,
      });

      if (erroAuth) {
        setErro("Senha incorreta.");
      } else {
        // Sucesso! O Supabase já salvou a sessão no navegador automaticamente
        router.push("/");
      }
    } catch (err) {
      setErro("Ocorreu um erro ao tentar logar.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      {/* Barra superior estilo WEG/SENAI */}
      <header
        className="text-white px-8 py-4 shadow"
        style={{ background: "var(--weg-blue)" }}
      >
        <h1 className="text-lg font-semibold">Sistema de Controle de Acesso</h1>
      </header>

      <div
        className="flex flex-1 items-center justify-center px-6"
        style={{ background: "var(--weg-gray)" }}
      >
        <div
          className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md"
          style={{ border: "1px solid var(--weg-border)" }}
        >
          <div className="text-center mb-6">
            <h2
              className="text-2xl font-bold"
              style={{ color: "var(--weg-blue)" }}
            >
              Acesso ao Sistema
            </h2>
            <p className="text-gray-500 text-sm mt-1">
              Insira seu usuário e senha
            </p>
          </div>

          <form onSubmit={fazerLogin} className="space-y-4">
            <input
              type="text"
              placeholder="Nome de usuário (Ex: João Silva)"
              className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:border-blue-500"
              style={{ border: "1px solid var(--weg-border)" }}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Senha"
              className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:border-blue-500"
              style={{ border: "1px solid var(--weg-border)" }}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />

            {erro && <p className="text-red-500 text-sm font-medium">{erro}</p>}

            <button
              disabled={carregando}
              className="w-full py-2 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
              style={{ background: "var(--weg-blue)" }}
            >
              {carregando ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>

      <footer className="text-center text-sm py-4 text-gray-500">
        Sistema interno • Controle de fila de banheiro
      </footer>
    </main>
  );
}