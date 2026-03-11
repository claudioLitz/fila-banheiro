"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function Login() {

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  // Verifica se já existe sessão ativa
  useEffect(() => {
    const verificarSessao = async () => {
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        window.location.href = "/";
      }
    };

    verificarSessao();
  }, []);

  const fazerLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    setErro("");
    setCarregando(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: senha
    });

    if (error) {
      setErro("Email ou senha inválidos");
      setCarregando(false);
      return;
    }

    window.location.href = "/";
  };

  return (
    <main className="min-h-screen flex flex-col">

      {/* Barra superior institucional */}
      <header
        className="text-white px-8 py-4 shadow"
        style={{ background: "var(--weg-blue)" }}
      >
        <h1 className="text-lg font-semibold">
          Sistema de Controle de Acesso
        </h1>
      </header>

      {/* Área central */}
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
              Utilize suas credenciais institucionais
            </p>
          </div>

          <form onSubmit={fazerLogin} className="space-y-4">

            <input
              type="email"
              placeholder="Email institucional"
              className="w-full px-4 py-2 rounded-lg border focus:outline-none"
              style={{ border: "1px solid var(--weg-border)" }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Senha"
              className="w-full px-4 py-2 rounded-lg border focus:outline-none"
              style={{ border: "1px solid var(--weg-border)" }}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />

            <button
              type="submit"
              disabled={carregando}
              className="w-full py-2 rounded-lg text-white font-medium transition-colors"
              style={{ background: "var(--weg-blue)" }}
            >
              {carregando ? "Entrando..." : "Entrar"}
            </button>

            {erro && (
              <p className="text-red-500 text-sm text-center">
                {erro}
              </p>
            )}
          </form>
        </div>
      </div>

      {/* Rodapé institucional */}
      <footer className="text-center text-sm py-4 text-gray-500">
        Sistema interno • Controle de fila de banheiro
      </footer>
    </main>
  );
}