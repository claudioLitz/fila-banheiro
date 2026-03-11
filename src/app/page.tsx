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
      // 1. FILA ATIVA: Apenas os logs que estão rodando agora
      const ativos = data
        .filter((p) => ["pedido", "saida", "pausado"].includes(p.status))
        .reverse();
      setTodosLogsAtivos(ativos);

      // 2. DASHBOARD: Organiza os logs cronologicamente pelo momento exato da ação
      const getActionTime = (log: LogPedido) => {
        if (log.status.includes('saida')) return new Date(log.go_time || log.require_time).getTime();
        if (log.status === 'concluido') return new Date(log.back_time || log.require_time).getTime();
        return new Date(log.require_time).getTime();
      };
      
      const logsOrdenados = data.sort((a, b) => getActionTime(b) - getActionTime(a));

      // 3. REGRA DE VISUALIZAÇÃO DE REGISTROS
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

  // ==========================================
  // FUNÇÕES AUXILIARES DE ORDENAÇÃO VIRTUAL
  // ==========================================
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

  // ==========================================
  // AÇÕES DO ALUNO (SISTEMA DE 3 LINHAS HERDADAS)
  // ==========================================
  
  const requisitar = async () => {
    if (!currentUser) return; 
    // LINHA 1: Cria o registro inicial
    await supabase.from("logs").insert([{ 
      user_id: currentUser.user_id, 
      name: currentUser.name, 
      status: "pedido" 
    }]);
  };

  const registrarSaida = async (pedidoAntigo: LogPedido) => {
    const goTime = new Date().toISOString();
    
    // Arquiva a Linha 1 para não aparecer mais na fila ativa
    await supabase.from("logs").update({ status: "pedido_historico" }).eq("id", pedidoAntigo.id);
    
    // LINHA 2: Cria o novo registro copiando o anterior e adicionando a saída
    await supabase.from("logs").insert([{ 
      user_id: pedidoAntigo.user_id, 
      name: pedidoAntigo.name, 
      status: "saida", 
      require_time: pedidoAntigo.require_time, // Copia a hora da requisição
      go_time: goTime, // Adiciona a hora exata da saída
      description: pedidoAntigo.description // Mantém caso o professor o tenha movido
    }]);
  };

  const registrarChegada = async (pedidoAntigo: LogPedido) => {
    const backTime = new Date().toISOString();
    
    // Arquiva a Linha 2
    await supabase.from("logs").update({ status: "saida_historico" }).eq("id", pedidoAntigo.id);
    
    // LINHA 3: Cria o registro final perfeito com tudo preenchido
    await supabase.from("logs").insert([{ 
      user_id: pedidoAntigo.user_id, 
      name: pedidoAntigo.name, 
      status: "concluido", 
      require_time: pedidoAntigo.require_time, // Copia a requisição
      go_time: pedidoAntigo.go_time, // Copia a saída
      back_time: backTime, // Adiciona a volta
      description: pedidoAntigo.description 
    }]);
  };

  // ==========================================
  // AÇÕES DO PROFESSOR / ADMIN
  // ==========================================
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

  const getStatusDisplay = (status: string) => {
    switch(status) {
      case "pedido":
      case "pedido_historico": return { texto: "PEDIDO", cor: "bg-blue-100 text-blue-700" };
      case "saida":
      case "saida_historico": return { texto: "SAÍDA", cor: "bg-orange-100 text-orange-700" };
      case "concluido": return { texto: "CONCLUÍDO", cor: "bg-green-100 text-green-700" };
      case "auditoria": return { texto: "AUDITORIA", cor: "bg-purple-100 text-purple-700" };
      case "cancelado": return { texto: "CANCELADO", cor: "bg-red-100 text-red-700" };
      case "pausado": return { texto: "SISTEMA", cor: "bg-gray-800 text-white" };
      default: return { texto: status, cor: "bg-gray-100 text-gray-700" };
    }
  };

  const renderDetalhes = (log: LogPedido) => {
    const originalDesc = log.description ? log.description.replace(/\[OVERRIDE:.*?\]/g, "") : "";
    
    // Calcula o tempo que esteve ausente no registro final
    if (log.status === "concluido" && log.go_time && log.back_time) {
      const diffMin = Math.round((new Date(log.back_time).getTime() - new Date(log.go_time).getTime()) / 60000);
      const tempo = diffMin < 1 ? "Menos de 1 min" : `${diffMin} min`;
      return `${originalDesc ? originalDesc + " | " : ""}Demorou no total: ${tempo}`;
    }
    
    return originalDesc || "-";
  };

  if (!currentUser) return <div className="p-10 text-center font-medium text-gray-500">Carregando painel...</div>;

  const meuPedido = filaEsperaOrdenada.find((p) => p.user_id === currentUser.user_id) || todosLogsAtivos.find(p => p.user_id === currentUser.user_id && p.status === "saida");
  const souOPrimeiro = filaEsperaOrdenada.length > 0 && filaEsperaOrdenada[0].user_id === currentUser.user_id;
  const banheiroLivre = !noBanheiro;

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800 pb-10">
      
      {/* Cabeçalho */}
      <header className="text-white px-8 py-4 shadow flex justify-between items-center" style={{ background: "var(--weg-blue)" }}>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          Fila do Banheiro
          {isPrivileged && (
            <span className={`text-xs px-2 py-1 rounded-full ml-2 font-bold shadow-sm ${
              currentUser.acess_level === 'admin' ? 'bg-purple-600 text-white' : 'bg-red-500 text-white'
            }`}>
              Modo {currentUser.acess_level === 'admin' ? 'Admin' : 'Professor'}
            </span>
          )}
        </h1>
        <div className="flex items-center gap-4">
          <span>Olá, <strong>{currentUser.name}</strong></span>
          <button onClick={fazerLogout} className="flex items-center gap-1 hover:text-red-200 transition">
            <LogOut size={18} /> Sair
          </button>
        </div>
      </header>

      {/* Alerta de Fila Pausada Global */}
      {isPaused && (
        <div className="bg-orange-100 border-b-4 border-orange-500 text-orange-700 p-4 text-center font-bold flex justify-center items-center gap-2 shadow-sm">
          <PauseCircle size={24} /> A fila está PAUSADA pelo professor. Você pode entrar na fila, mas as saídas estão bloqueadas.
        </div>
      )}

      <div className="flex-1 max-w-4xl mx-auto w-full p-6 space-y-6 mt-2">
        
        {/* ====================================================
            PAINEL DE CONTROLES (Professor / Admin)
            ==================================================== */}
        {isPrivileged && (
          <div className="bg-white rounded-xl shadow-sm p-6 border-2 border-red-200">
            <h2 className="text-lg font-bold text-red-700 mb-4 flex items-center gap-2">
              <ShieldAlert size={20} /> Controles Rápidos
            </h2>
            <div className="flex gap-4">
              <button
                onClick={alternarPausa}
                className={`flex-1 flex justify-center items-center gap-2 py-3 px-4 rounded-lg font-bold text-white transition-colors shadow-md ${
                  isPaused ? "bg-green-600 hover:bg-green-700" : "bg-orange-500 hover:bg-orange-600"
                }`}
              >
                {isPaused ? <PlayCircle size={20} /> : <PauseCircle size={20} />}
                {isPaused ? "Liberar Saídas" : "Pausar Saídas"}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ====================================================
              PAINEL DO ALUNO (Minha Situação)
              ==================================================== */}
          <div className="bg-white rounded-xl shadow-sm p-6 text-center h-fit" style={{ border: "2px solid var(--weg-blue)" }}>
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

            {meuPedido?.status === "pedido" && (
              <div>
                {souOPrimeiro && banheiroLivre && !isPaused ? (
                  <div>
                    <p className="text-green-600 font-bold text-lg mb-4">É a sua vez! O banheiro está livre.</p>
                    <button
                      onClick={() => registrarSaida(meuPedido)}
                      className="bg-green-500 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-medium transition-colors shadow-md hover:bg-green-600 mx-auto"
                    >
                      <DoorOpen size={20} /> Registrar Saída
                    </button>
                  </div>
                ) : (
                  <div className="py-2">
                    <p className="text-orange-500 font-bold text-lg">
                      {isPaused && souOPrimeiro ? "Fila pausada. Você é o próximo assim que liberar!" : "Aguarde sua vez..."}
                    </p>
                    <p className="text-gray-500 mt-2 text-lg">
                      Sua posição na fila garantida: <strong>{filaEsperaOrdenada.findIndex(p => p.id === meuPedido.id) + 1}º</strong>
                    </p>
                  </div>
                )}
              </div>
            )}

            {meuPedido?.status === "saida" && (
              <div>
                <p className="text-blue-600 font-bold text-lg mb-4">Você está no banheiro.</p>
                <button
                  onClick={() => registrarChegada(meuPedido)}
                  className="bg-blue-500 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-medium transition-colors shadow-md hover:bg-blue-600 mx-auto"
                >
                  <CheckCircle2 size={20} /> Registrar Chegada (Voltei)
                </button>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* No Banheiro Agora */}
            <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid var(--weg-border)" }}>
              <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--weg-border)", background: "var(--weg-gray)" }}>
                <h2 className="font-semibold flex items-center gap-2" style={{ color: "var(--weg-blue)" }}>
                  <ArrowRight size={20} /> No Banheiro Agora
                </h2>
              </div>
              <div className="p-8 text-center">
                {noBanheiro ? (
                  <span className="text-3xl font-bold text-gray-800">{noBanheiro.name}</span>
                ) : (
                  <p className="text-gray-400 text-lg italic">Ninguém está usando o banheiro.</p>
                )}
              </div>
            </div>

            {/* Fila de Espera */}
            <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid var(--weg-border)" }}>
              <div className="px-6 py-4 border-b" style={{ borderColor: "var(--weg-border)", background: "var(--weg-gray)" }}>
                <h2 className="font-semibold text-gray-700">Fila de Espera ({filaEsperaOrdenada.length})</h2>
              </div>
              <ul className="divide-y max-h-64 overflow-y-auto" style={{ borderColor: "var(--weg-border)" }}>
                {filaEsperaOrdenada.length > 0 ? (
                  filaEsperaOrdenada.map((pedido, index) => (
                    <li key={pedido.id} className="px-4 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="font-bold rounded-full w-8 h-8 flex items-center justify-center shrink-0" style={{ background: "var(--weg-border)", color: "var(--weg-text)" }}>
                          {index + 1}
                        </span>
                        <span className={`text-base ${pedido.user_id === currentUser.user_id ? 'font-bold text-blue-600' : 'text-gray-700'}`}>
                          {pedido.name} {pedido.user_id === currentUser.user_id && "(Você)"}
                        </span>
                      </div>

                      {/* Botões do Professor / Admin */}
                      {isPrivileged && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => moverPosicao(index, "up")} disabled={index === 0} className="p-1.5 text-gray-400 hover:text-blue-600 disabled:opacity-30 transition">
                            <ArrowUp size={18} />
                          </button>
                          <button onClick={() => moverPosicao(index, "down")} disabled={index === filaEsperaOrdenada.length - 1} className="p-1.5 text-gray-400 hover:text-blue-600 disabled:opacity-30 transition">
                            <ArrowDown size={18} />
                          </button>
                          <div className="w-px h-5 bg-gray-300 mx-1"></div>
                          <button onClick={() => removerDaFila(pedido)} className="p-1.5 text-gray-400 hover:text-red-600 transition" title="Remover da fila">
                            <Trash2 size={18} />
                          </button>
                        </div>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="px-6 py-8 text-center text-gray-400 italic">Ninguém na fila de espera.</li>
                )}
              </ul>
            </div>
          </div>
        </div>

        {/* ====================================================
            DASHBOARD DE AUDITORIA (Só Professor/Admin vê)
            ==================================================== */}
        {isPrivileged && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 mt-8 overflow-hidden">
            <div className="bg-gray-800 px-6 py-4 flex items-center justify-between">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <ClipboardList size={20} /> Dashboard de Histórico
              </h2>
              <span className="text-gray-400 text-sm">
                {currentUser.acess_level === 'admin' ? 'Visão Geral (Todos)' : 'Visão Professor (Alunos)'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-600">
                <thead className="bg-gray-50 text-gray-700 font-semibold border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3">Hora da Ação</th>
                    <th className="px-6 py-3">Usuário</th>
                    <th className="px-6 py-3">Ação / Status</th>
                    <th className="px-6 py-3">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {historicoCompleto.length > 0 ? (
                    historicoCompleto.slice(0, 50).map((log) => {
                      const statusDisplay = getStatusDisplay(log.status);
                      return (
                        <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3 whitespace-nowrap font-mono text-xs text-gray-500">
                            {formatarHora(getEventTime(log))}
                          </td>
                          <td className="px-6 py-3 font-bold text-gray-800">
                            {log.name}
                          </td>
                          <td className="px-6 py-3">
                            <span className={`px-2 py-1 rounded-md text-[11px] font-bold ${statusDisplay.cor}`}>
                              {statusDisplay.texto}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-gray-600 italic max-w-xs truncate" title={log.description || ""}>
                            {renderDetalhes(log)}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-gray-400">
                        Nenhum registro encontrado no histórico.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}