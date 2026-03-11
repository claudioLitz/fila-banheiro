"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { 
  UserPlus, ArrowRight, CheckCircle2, LogOut, 
  DoorOpen, PauseCircle, PlayCircle, Trash2, ArrowUp, ArrowDown, ShieldAlert,
  ClipboardList
} from "lucide-react";
import { useRouter } from "next/navigation";

type LogPedido = {
  id: string;
  user_id: string;
  name: string;
  status: string;
  require_time: string;
  go_time: string | null;
  back_time: string | null;
  description: string | null;
  users?: {
    acess_level: string;
  };
};

export default function Home() {
  const [todosLogsAtivos, setTodosLogsAtivos] = useState<LogPedido[]>([]);
  const [historicoCompleto, setHistoricoCompleto] = useState<LogPedido[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    verificarLogin();
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    const channel = supabase.channel("realtime_logs").on(
      "postgres_changes", { event: "*", schema: "public", table: "logs" },
      () => {
        carregarDados(currentUser);
      }
    ).subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  const verificarLogin = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push("/login");
      return;
    }

    const { data: usuarioDB } = await supabase
      .from("users")
      .select("*")
      .eq("user_id", session.user.id)
      .single();

    if (usuarioDB) {
      setCurrentUser(usuarioDB);
      carregarDados(usuarioDB);
    } else {
      fazerLogout();
    }
  };

  const carregarDados = async (usuario = currentUser) => {
    if (!usuario) return;

    const { data } = await supabase
      .from("logs")
      .select("*, users(acess_level)");

    if (data) {
      const ativos = data
        .filter((p) => ["pedido", "saida", "pausado"].includes(p.status))
        .reverse();
      setTodosLogsAtivos(ativos);

      const getActionTime = (log: LogPedido) => {
        if (log.status.includes('saida')) return new Date(log.go_time || log.require_time).getTime();
        if (log.status === 'concluido') return new Date(log.back_time || log.require_time).getTime();
        return new Date(log.require_time).getTime();
      };
      
      const logsOrdenados = data.sort((a, b) => getActionTime(b) - getActionTime(a));

      if (usuario.acess_level === "admin") {
        setHistoricoCompleto(logsOrdenados);
      } else if (usuario.acess_level === "Teacher") {
        const apenasAlunos = logsOrdenados.filter(
          (log) => log.users?.acess_level === "aluno" || log.users?.acess_level === "Student"
        );
        setHistoricoCompleto(apenasAlunos);
      } else {
        setHistoricoCompleto([]);
      }
    }
  };

  const getEffectiveTime = (log: LogPedido) => {
    const match = log.description?.match(/\[OVERRIDE:(.*?)\]/);
    return match ? match[1] : log.require_time;
  };

  const filaEsperaOrdenada = todosLogsAtivos
    .filter((p) => p.status === "pedido")
    .sort((a, b) => new Date(getEffectiveTime(a)).getTime() - new Date(getEffectiveTime(b)).getTime());

  const noBanheiro = todosLogsAtivos.find((p) => p.status === "saida");
  const isPaused = todosLogsAtivos.some((p) => p.status === "pausado");
  const isPrivileged = currentUser?.acess_level === "Teacher" || currentUser?.acess_level === "admin";

  const requisitar = async () => {
    if (!currentUser) return; 
    await supabase.from("logs").insert([{ 
      user_id: currentUser.user_id, 
      name: currentUser.name, 
      status: "pedido" 
    }]);
  };

  const registrarSaida = async (pedidoAntigo: LogPedido) => {
    const goTime = new Date().toISOString();
    await supabase.from("logs").update({ status: "pedido_historico" }).eq("id", pedidoAntigo.id);
    await supabase.from("logs").insert([{ 
      user_id: pedidoAntigo.user_id, 
      name: pedidoAntigo.name, 
      status: "saida", 
      require_time: pedidoAntigo.require_time,
      go_time: goTime,
      description: pedidoAntigo.description
    }]);
  };

  const registrarChegada = async (pedidoAntigo: LogPedido) => {
    const backTime = new Date().toISOString();
    await supabase.from("logs").update({ status: "saida_historico" }).eq("id", pedidoAntigo.id);
    await supabase.from("logs").insert([{ 
      user_id: pedidoAntigo.user_id, 
      name: pedidoAntigo.name, 
      status: "concluido", 
      require_time: pedidoAntigo.require_time,
      go_time: pedidoAntigo.go_time,
      back_time: backTime,
      description: pedidoAntigo.description 
    }]);
  };

  const criarLogAuditoria = async (acao: string) => {
    await supabase.from("logs").insert([{
      user_id: currentUser.user_id,
      name: currentUser.name,
      status: "auditoria",
      description: acao
    }]);
  };

  const alternarPausa = async () => {
    if (isPaused) {
      await supabase.from("logs").update({ status: "concluido" }).eq("status", "pausado");
      criarLogAuditoria(`Professor ${currentUser.name} liberou a fila.`);
    } else {
      await supabase.from("logs").insert([{ user_id: currentUser.user_id, name: "SISTEMA", status: "pausado", description: `Fila pausada por ${currentUser.name}` }]);
      criarLogAuditoria(`Professor ${currentUser.name} pausou a fila.`);
    }
  };

  const removerDaFila = async (aluno: LogPedido) => {
    await supabase.from("logs").update({ 
      status: "cancelado", 
      description: `(Removido por ${currentUser.name}) ` + (aluno.description || "") 
    }).eq("id", aluno.id);
    criarLogAuditoria(`Professor ${currentUser.name} removeu o aluno ${aluno.name} da fila.`);
  };

  const moverPosicao = async (index: number, direcao: "up" | "down") => {
    const atual = filaEsperaOrdenada[index];
    const outro = filaEsperaOrdenada[direcao === "up" ? index - 1 : index + 1];

    if (!atual || !outro) return;

    const tAtual = getEffectiveTime(atual);
    const tOutro = getEffectiveTime(outro);

    const newDescAtual = (atual.description || "").replace(/\[OVERRIDE:.*?\]/g, "") + ` [OVERRIDE:${tOutro}]`;
    const newDescOutro = (outro.description || "").replace(/\[OVERRIDE:.*?\]/g, "") + ` [OVERRIDE:${tAtual}]`;

    await supabase.from("logs").update({ description: newDescAtual.trim() }).eq("id", atual.id);
    await supabase.from("logs").update({ description: newDescOutro.trim() }).eq("id", outro.id);

    criarLogAuditoria(`Professor ${currentUser.name} trocou as posições de ${atual.name} e ${outro.name} na fila.`);
  };

  const fazerLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const getEventTime = (log: LogPedido) => {
    if (log.status.includes('saida')) return log.go_time;
    if (log.status === 'concluido') return log.back_time;
    return log.require_time;
  };

  const formatarHora = (isoDate: string | null) => {
    if (!isoDate) return "-";
    return new Date(isoDate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  // 🔴 ETIQUETAS DE STATUS TOTALMENTE INDUSTRIAIS (Sem cores além de Azul e Grafite)
  const getStatusDisplay = (status: string) => {
    switch(status) {
      case "pedido":
      case "pedido_historico": 
        return { texto: "PEDIDO", cor: "bg-white border-2 border-[#00579D] text-[#00579D]" };
      case "saida":
      case "saida_historico": 
        return { texto: "NO BANHEIRO", cor: "bg-[#00579D] text-white border-2 border-[#00579D]" };
      case "concluido": 
        return { texto: "CONCLUÍDO", cor: "bg-[#2B2B2B] text-white border-2 border-[#2B2B2B]" };
      case "cancelado": 
        return { texto: "CANCELADO", cor: "bg-gray-200 border-2 border-[#2B2B2B] text-[#2B2B2B] line-through" };
      case "auditoria": 
      case "pausado": 
        return { texto: "SISTEMA", cor: "bg-gray-800 text-white border-2 border-gray-800" };
      default: 
        return { texto: status.toUpperCase(), cor: "bg-gray-100 border-2 border-gray-300 text-gray-600" };
    }
  };

  const renderDetalhes = (log: LogPedido) => {
    const originalDesc = log.description ? log.description.replace(/\[OVERRIDE:.*?\]/g, "") : "";
    if (log.status === "concluido" && log.go_time && log.back_time) {
      const diffMin = Math.round((new Date(log.back_time).getTime() - new Date(log.go_time).getTime()) / 60000);
      const tempo = diffMin < 1 ? "Menos de 1 min" : `${diffMin} min`;
      return `${originalDesc ? originalDesc + " | " : ""}Tempo fora: ${tempo}`;
    }
    return originalDesc || "-";
  };

  if (!currentUser) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
      <div className="text-xl font-bold text-[#00579D] uppercase tracking-widest animate-pulse">
        Carregando Sistema...
      </div>
    </div>
  );

  const meuPedido = filaEsperaOrdenada.find((p) => p.user_id === currentUser.user_id) || todosLogsAtivos.find(p => p.user_id === currentUser.user_id && p.status === "saida");
  const souOPrimeiro = filaEsperaOrdenada.length > 0 && filaEsperaOrdenada[0].user_id === currentUser.user_id;
  const banheiroLivre = !noBanheiro;

  return (
    <main className="min-h-screen flex flex-col bg-[#F4F4F4] font-sans text-[#2B2B2B]">
      
      {/* 1. CABEÇALHO */}
      <header className="bg-[#00579D] text-white px-8 py-4 shadow-md flex justify-between items-center">
        <div className="flex items-center gap-4">
          <img src="/logo-senai.png" alt="Logo SENAI" className="h-14 sm:h-16 object-contain" />
          <img src="/logo-weg.png" alt="Logo WEG" className="h-14 sm:h-16 object-contain" />
          <h1 className="text-xl font-bold tracking-wider uppercase hidden sm:block ml-4 border-l-2 border-white/30 pl-4">
            Controle de Acesso
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-sm tracking-wide">
            Operador: <strong className="font-bold uppercase">{currentUser.name}</strong>
          </span>
          <button
            onClick={fazerLogout}
            className="flex items-center gap-2 bg-white text-[#00579D] px-4 py-2 font-bold uppercase tracking-wider hover:bg-gray-200 transition-colors duration-300 border-b-4 border-gray-400 active:border-b-0 active:translate-y-1"
          >
            <LogOut size={18} /> Sair
          </button>
        </div>
      </header>

      {/* 2. CONTEÚDO PRINCIPAL */}
      <div className="flex-1 p-8 max-w-6xl mx-auto w-full space-y-8">

        {/* CONTROLES RÁPIDOS (Exclusivo Admin) */}
        {isPrivileged && (
          <section className="bg-white border-2 border-[#2B2B2B] shadow-md p-6 flex flex-col sm:flex-row justify-between items-center gap-4">
            <h3 className="text-[#2B2B2B] font-bold uppercase tracking-widest flex items-center gap-2">
              <ShieldAlert size={20} /> Painel de Controle
            </h3>
            <button 
              onClick={alternarPausa}
              className={`w-full sm:w-auto text-white font-bold uppercase tracking-widest py-3 px-8 border-b-4 active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center gap-2 ${
                isPaused 
                  ? "bg-[#00579D] hover:bg-[#003865] border-[#003865]" 
                  : "bg-[#2B2B2B] hover:bg-[#1A1A1A] border-black"
              }`}
            >
              {isPaused ? <PlayCircle size={20} /> : <PauseCircle size={20} />}
              {isPaused ? "Liberar Acessos" : "Bloquear Acessos"}
            </button>
          </section>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* MINHA SITUAÇÃO (Ação Principal) */}
          <section className="bg-white shadow-xl border-t-8 border-[#00579D] p-8 flex flex-col items-center justify-center text-center">
            <h2 className="text-2xl font-extrabold text-[#00579D] uppercase tracking-wide mb-2">Painel do Operador</h2>
            
            {isPaused ? (
              <div className="text-[#2B2B2B] font-bold mt-4 uppercase border-2 border-[#2B2B2B] p-4 bg-gray-100 flex items-center gap-2">
                <ShieldAlert size={20} /> Sistema Bloqueado pelo Administrador
              </div>
            ) : !meuPedido ? (
              <>
                <p className="text-[#2B2B2B] font-medium mb-6 uppercase">Acesso Liberado para Requisição</p>
                <button
                  onClick={requisitar}
                  className="bg-[#00579D] text-white font-bold uppercase tracking-widest py-4 px-10 hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 transition-all flex items-center gap-2"
                >
                  <UserPlus size={20} /> Requisitar Acesso
                </button>
              </>
            ) : meuPedido.status === "pedido" ? (
              souOPrimeiro && banheiroLivre ? (
                <>
                  <p className="text-[#00579D] font-bold mb-6 uppercase text-lg">Sua vez! O acesso está livre.</p>
                  <button
                    onClick={() => registrarSaida(meuPedido)}
                    className="bg-[#00579D] text-white font-bold uppercase tracking-widest py-4 px-10 hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 transition-all flex items-center gap-2"
                  >
                    <DoorOpen size={20} /> Confirmar Saída
                  </button>
                </>
              ) : (
                <p className="text-[#2B2B2B] font-bold uppercase border-2 border-[#2B2B2B] p-4">
                  Aguardando liberação...
                </p>
              )
            ) : meuPedido.status === "saida" ? (
              <>
                <p className="text-[#00579D] font-bold mb-6 uppercase text-lg">Você está fora da sala.</p>
                <button
                  onClick={() => registrarChegada(meuPedido)}
                  className="bg-[#2B2B2B] text-white font-bold uppercase tracking-widest py-4 px-10 hover:bg-black border-b-4 border-black active:border-b-0 active:translate-y-1 transition-all flex items-center gap-2"
                >
                  <CheckCircle2 size={20} /> Confirmar Retorno
                </button>
              </>
            ) : null}
          </section>

          {/* PAINÉIS DE FILA */}
          <div className="space-y-6">
            
            {/* NO BANHEIRO AGORA */}
            <section className="bg-white border-2 border-[#00579D] shadow-md">
              <div className="bg-[#00579D] text-white px-4 py-3 font-bold uppercase tracking-widest flex items-center justify-between">
                <span>Acesso Ativo</span>
                <DoorOpen size={18} />
              </div>
              <div className="p-6">
                {noBanheiro ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-extrabold text-xl text-[#00579D] uppercase">{noBanheiro.name}</p>
                      <p className="text-sm font-bold text-gray-500 uppercase mt-1">
                        Saída: {formatarHora(noBanheiro.go_time)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-[#2B2B2B] font-medium italic uppercase text-sm">Nenhum operador ativo</p>
                )}
              </div>
            </section>

            {/* FILA DE ESPERA */}
            <section className="bg-white border-2 border-[#2B2B2B] shadow-md">
              <div className="bg-[#2B2B2B] text-white px-4 py-3 font-bold uppercase tracking-widest flex justify-between items-center">
                <span>Fila de Espera ({filaEsperaOrdenada.length})</span>
                <ClipboardList size={18} />
              </div>
              <div className="p-0 max-h-48 overflow-y-auto">
                {filaEsperaOrdenada.length === 0 ? (
                  <p className="text-center text-[#2B2B2B] font-medium italic uppercase text-sm p-6">Fila vazia</p>
                ) : (
                  <ul className="divide-y divide-gray-200">
                    {filaEsperaOrdenada.map((aluno, index) => (
                      <li key={aluno.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                        <div className="flex items-center gap-4">
                          <span className="text-[#00579D] font-black text-xl w-6">{index + 1}º</span>
                          <div>
                            <p className="font-bold text-[#2B2B2B] uppercase">{aluno.name}</p>
                            <p className="text-xs font-bold text-gray-500 uppercase">Req: {formatarHora(aluno.require_time)}</p>
                          </div>
                        </div>
                        
                        {isPrivileged && (
                          <div className="flex items-center gap-2">
                            {index > 0 && (
                              <button onClick={() => moverPosicao(index, "up")} className="p-2 text-[#2B2B2B] hover:bg-gray-200 border-2 border-transparent hover:border-[#2B2B2B] transition-all">
                                <ArrowUp size={16} />
                              </button>
                            )}
                            {index < filaEsperaOrdenada.length - 1 && (
                              <button onClick={() => moverPosicao(index, "down")} className="p-2 text-[#2B2B2B] hover:bg-gray-200 border-2 border-transparent hover:border-[#2B2B2B] transition-all">
                                <ArrowDown size={16} />
                              </button>
                            )}
                            <button onClick={() => removerDaFila(aluno)} className="p-2 text-white bg-[#2B2B2B] hover:bg-black transition-all">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* 3. DASHBOARD / TABELA */}
        {isPrivileged && historicoCompleto.length > 0 && (
          <section className="bg-white shadow-md border-t-8 border-[#2B2B2B] mt-8">
            <div className="bg-[#2B2B2B] text-white px-6 py-4 flex justify-between items-center">
              <h3 className="font-bold uppercase tracking-widest flex items-center gap-2">
                Histórico de Operações
              </h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F4F4F4] border-b-2 border-[#2B2B2B] text-[#2B2B2B] uppercase text-sm tracking-wider">
                    <th className="p-4 font-bold">Hora</th>
                    <th className="p-4 font-bold">Operador</th>
                    <th className="p-4 font-bold">Status</th>
                    <th className="p-4 font-bold hidden sm:table-cell">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {historicoCompleto.map((log) => {
                    const badge = getStatusDisplay(log.status);
                    return (
                      <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                        <td className="p-4 font-mono text-sm font-bold text-gray-600">
                          {formatarHora(getEventTime(log))}
                        </td>
                        <td className="p-4 font-extrabold text-[#2B2B2B] uppercase">
                          {log.name}
                        </td>
                        <td className="p-4">
                          <span className={`px-3 py-1 font-bold text-xs uppercase tracking-wider ${badge.cor}`}>
                            {badge.texto}
                          </span>
                        </td>
                        <td className="p-4 text-sm font-bold text-gray-500 hidden sm:table-cell uppercase">
                          {renderDetalhes(log)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      {/* 3. RODAPÉ */}
      <footer className="bg-[#2B2B2B] text-white text-center text-xs py-4 font-bold tracking-widest uppercase border-t-2 border-gray-600">
        © {new Date().getFullYear()} WEG / SENAI • Sistema de Controle
      </footer>
    </main>
  );
}