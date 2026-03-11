"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { UserPlus, ArrowRight, CheckCircle2, LogOut, DoorOpen } from "lucide-react";
import { useRouter } from "next/navigation";

type LogPedido = {
  id: string;
  user_id: string;
  name: string;
  status: string;
  require_time: string;
};

export default function Home() {
  const [fila, setFila] = useState<LogPedido[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    verificarLogin();

    const channel = supabase
      .channel("realtime_logs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "logs" },
        () => carregarFila()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // NOVA FUNÇÃO: Verifica o login direto no cofre do Supabase
  const verificarLogin = async () => {
    // 1. Pergunta pro Supabase se tem alguém logado
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      router.push("/login");
      return;
    }

    // 2. Se está logado, busca os dados da pessoa na sua tabela 'users'
    const { data: usuarioDB } = await supabase
      .from("users")
      .select("*")
      .eq("user_id", session.user.id)
      .single();

    if (usuarioDB) {
      setCurrentUser(usuarioDB);
      carregarFila();
    } else {
      // Se não achou o usuário no banco, desloga por segurança
      fazerLogout();
    }
  };

  const carregarFila = async () => {
    const { data } = await supabase
      .from("logs")
      .select("*")
      .neq("status", "concluido")
      .order("require_time", { ascending: true });

    if (data) setFila(data);
  };

  const requisitar = async () => {
    if (!currentUser) return;
    await supabase.from("logs").insert([
      {
        user_id: currentUser.user_id,
        name: currentUser.name,
        status: "esperando",
      },
    ]);
  };

  const registrarSaida = async (id: string) => {
    await supabase
      .from("logs")
      .update({ status: "no_banheiro", go_time: new Date().toISOString() })
      .eq("id", id);
  };

  const registrarChegada = async (id: string) => {
    await supabase
      .from("logs")
      .update({ status: "concluido", back_time: new Date().toISOString() })
      .eq("id", id);
  };

  // ATUALIZADO: Agora faz o logout de verdade no Supabase
  const fazerLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (!currentUser) return <div className="p-10 text-center font-medium text-gray-500">Carregando painel...</div>;

  const noBanheiro = fila.find((p) => p.status === "no_banheiro");
  const esperando = fila.filter((p) => p.status === "esperando");
  
  const meuPedido = fila.find((p) => p.user_id === currentUser.user_id);
  const souOPrimeiro = esperando.length > 0 && esperando[0].user_id === currentUser.user_id;
  const banheiroLivre = !noBanheiro;

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      
      {/* Header Logado */}
      <header className="text-white px-8 py-4 shadow flex justify-between items-center" style={{ background: "var(--weg-blue)" }}>
        <h1 className="text-lg font-semibold">Fila do Banheiro</h1>
        <div className="flex items-center gap-4">
          <span>Olá, <strong>{currentUser.name}</strong></span>
          <button onClick={fazerLogout} className="flex items-center gap-1 hover:text-red-200 transition">
            <LogOut size={18} /> Sair
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full p-6 space-y-8 mt-6">
        
        {/* MEU PAINEL DE AÇÕES */}
        <div className="bg-white rounded-xl shadow-sm p-6 text-center" style={{ border: "2px solid var(--weg-blue)" }}>
          <h2 className="text-xl font-bold mb-4" style={{ color: "var(--weg-blue)" }}>Minha Situação</h2>
          
          {!meuPedido && (
            <div>
              <p className="text-gray-500 mb-4">Você está na sala. Deseja ir ao banheiro?</p>
              <button
                onClick={requisitar}
                className="text-white px-6 py-3 rounded-lg flex items-center gap-2 font-medium transition-colors shadow-md hover:opacity-90 mx-auto"
                style={{ background: "var(--weg-blue)" }}
              >
                <UserPlus size={20} /> Requisitar
              </button>
            </div>
          )}

          {meuPedido?.status === "esperando" && (
            <div>
              {souOPrimeiro && banheiroLivre ? (
                <div>
                  <p className="text-green-600 font-bold text-lg mb-4">É a sua vez! O banheiro está livre.</p>
                  <button
                    onClick={() => registrarSaida(meuPedido.id)}
                    className="bg-green-500 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-medium transition-colors shadow-md hover:bg-green-600 mx-auto"
                  >
                    <DoorOpen size={20} /> Registrar Saída
                  </button>
                </div>
              ) : (
                <div className="py-2">
                  <p className="text-orange-500 font-bold text-lg">Aguarde sua vez...</p>
                  <p className="text-gray-500 mt-1">Sua posição na fila: {esperando.findIndex(p => p.id === meuPedido.id) + 1}º</p>
                </div>
              )}
            </div>
          )}

          {meuPedido?.status === "no_banheiro" && (
            <div>
              <p className="text-blue-600 font-bold text-lg mb-4">Você está no banheiro.</p>
              <button
                onClick={() => registrarChegada(meuPedido.id)}
                className="bg-blue-500 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-medium transition-colors shadow-md hover:bg-blue-600 mx-auto"
              >
                <CheckCircle2 size={20} /> Registrar Chegada (Voltei)
              </button>
            </div>
          )}
        </div>

        {/* No Banheiro Agora */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid var(--weg-border)" }}>
          <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--weg-border)", background: "var(--weg-gray)" }}>
            <h2 className="font-semibold flex items-center gap-2" style={{ color: "var(--weg-blue)" }}>
              <ArrowRight size={20} /> No Banheiro Agora
            </h2>
          </div>
          <div className="p-8">
            {noBanheiro ? (
              <div className="text-center">
                <span className="text-3xl font-bold text-gray-800">{noBanheiro.name}</span>
              </div>
            ) : (
              <p className="text-gray-400 text-center text-lg italic">Ninguém está usando o banheiro.</p>
            )}
          </div>
        </div>

        {/* Fila de Espera */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid var(--weg-border)" }}>
          <div className="px-6 py-4 border-b" style={{ borderColor: "var(--weg-border)", background: "var(--weg-gray)" }}>
            <h2 className="font-semibold text-gray-700">Fila de Espera ({esperando.length})</h2>
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--weg-border)" }}>
            {esperando.length > 0 ? (
              esperando.map((pedido, index) => (
                <li key={pedido.id} className="px-6 py-4 flex items-center gap-4">
                  <span className="font-bold rounded-full w-8 h-8 flex items-center justify-center" style={{ background: "var(--weg-border)", color: "var(--weg-text)" }}>
                    {index + 1}
                  </span>
                  <span className={`text-lg ${pedido.user_id === currentUser.user_id ? 'font-bold text-blue-600' : 'text-gray-700'}`}>
                    {pedido.name} {pedido.user_id === currentUser.user_id && "(Você)"}
                  </span>
                </li>
              ))
            ) : (
              <li className="px-6 py-8 text-center text-gray-400 italic">Ninguém na fila de espera.</li>
            )}
          </ul>
        </div>
      </div>
    </main>
  );
}