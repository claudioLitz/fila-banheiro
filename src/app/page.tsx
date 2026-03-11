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

  // 1. Efeito para verificar o login ao abrir a página
  useEffect(() => {
    verificarLogin();
  }, []);

  // 2. CORREÇÃO DO TEMPO REAL: Agora o "ouvido" do Supabase sabe quem está logado
  useEffect(() => {
    if (!currentUser) return; // Só liga o tempo real DEPOIS que souber quem é o usuário

    const channel = supabase.channel("realtime_logs").on(
      "postgres_changes", { event: "*", schema: "public", table: "logs" },
      () => {
        carregarDados(currentUser); // Puxa os dados com as permissões corretas
      }
    ).subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]); // <-- O segredo que consertou o tempo real está aqui!

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
      .select("*, users(acess_level)")
      .order("require_time", { ascending: false });

    if (data) {
      // FILA ATIVA: Pega só o que o sistema precisa para a lógica funcionar
      const ativos = data
        .filter((p) => ["esperando", "no_banheiro", "pausado"].includes(p.status))
        .reverse(); 
      setTodosLogsAtivos(ativos);

      // DASHBOARD DE AUDITORIA: Filtra para mostrar APENAS os 3 eventos separados e auditorias
      let logsDashboard = data.filter(log => 
        ["log_pedido", "log_saida", "log_volta", "auditoria", "cancelado"].includes(log.status)
      );

      // REGRA DE PERMISSÃO DE VISUALIZAÇÃO
      if (usuario.acess_level === "admin") {
        // Admin vê todas as trilhas
        setHistoricoCompleto(logsDashboard);
      } else if (usuario.acess_level === "Teacher") {
        // Professor vê apenas as 3 trilhas geradas pelos alunos
        const apenasAlunos = logsDashboard.filter(
          (log) => log.users?.acess_level === "aluno" || log.users?.acess_level === "Student"
        );
        setHistoricoCompleto(apenasAlunos);
      } else {
        // Aluno não vê a tabela
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
    .filter((p) => p.status === "esperando")
    .sort((a, b) => new Date(getEffectiveTime(a)).getTime() - new Date(getEffectiveTime(b)).getTime());

  const noBanheiro = todosLogsAtivos.find((p) => p.status === "no_banheiro");
  const isPaused = todosLogsAtivos.some((p) => p.status === "pausado");
  const isPrivileged = currentUser?.acess_level === "Teacher" || currentUser?.acess_level === "admin";

  // ==========================================
  // AÇÕES DO ALUNO (COM 3 LOGS SEPARADOS AGORA!)
  // ==========================================
  const requisitar = async () => {
    if (!currentUser) return; 
    
    // 1. Entra na fila ativa
    await supabase.from("logs").insert([{ user_id: currentUser.user_id, name: currentUser.name, status: "esperando" }]);
    
    // 2. Grava a linha exclusiva do PEDIDO para o Dashboard
    await supabase.from("logs").insert([{ 
      user_id: currentUser.user_id, name: currentUser.name, status: "log_pedido", description: "Fez o pedido para ir ao banheiro" 
    }]);
  };

  const registrarSaida = async (id: string) => {
    // 1. Atualiza a fila ativa
    await supabase.from("logs").update({ status: "no_banheiro", go_time: new Date().toISOString() }).eq("id", id);
    
    // 2. Grava a linha exclusiva da SAÍDA para o Dashboard
    await supabase.from("logs").insert([{ 
      user_id: currentUser.user_id, name: currentUser.name, status: "log_saida", description: "Saiu para o banheiro" 
    }]);
  };

  const registrarChegada = async (id: string) => {
    // 1. Tira da fila ativa
    await supabase.from("logs").update({ status: "concluido", back_time: new Date().toISOString() }).eq("id", id);
    
    // 2. Grava a linha exclusiva da VOLTA para o Dashboard
    await supabase.from("logs").insert([{ 
      user_id: currentUser.user_id, name: currentUser.name, status: "log_volta", description: "Retornou à sala" 
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

  const formatarHora = (isoDate: string | null) => {
    if (!isoDate) return "-";
    return new Date(isoDate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  if (!currentUser) return <div className="p-10 text-center font-medium text-gray-500">Carregando painel...</div>;

  const meuPedido = filaEsperaOrdenada.find((p) => p.user_id === currentUser.user_id) || todosLogsAtivos.find(p => p.user_id === currentUser.user_id && p.status === "no_banheiro");
  const souOPrimeiro = filaEsperaOrdenada.length > 0 && filaEsperaOrdenada[0].user_id === currentUser.user_id;
  const banheiroLivre = !noBanheiro;

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800 pb-10">
      
      {/* Header Logado */}
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

            {meuPedido?.status === "esperando" && (
              <div>
                {souOPrimeiro && banheiroLivre && !isPaused ? (
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
                    <th className="px-6 py-3">Hora</th>
                    <th className="px-6 py-3">Usuário</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {historicoCompleto.length > 0 ? (
                    historicoCompleto.slice(0, 50).map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3 whitespace-nowrap font-mono text-xs text-gray-500">
                          {formatarHora(log.require_time)}
                        </td>
                        <td className="px-6 py-3 font-bold text-gray-800">
                          {log.name}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase
                            ${
                              log.status === 'log_pedido' ? 'bg-blue-100 text-blue-700' :
                              log.status === 'log_saida' ? 'bg-orange-100 text-orange-700' :
                              log.status === 'log_volta' ? 'bg-green-100 text-green-700' :
                              log.status === 'auditoria' ? 'bg-purple-100 text-purple-700' :
                              log.status === 'cancelado' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {/* Limpa o texto do status para ficar bonito na tela (ex: LOG_PEDIDO -> PEDIDO) */}
                            {log.status.replace('log_', '')} 
                          </span>
                        </td>
                        <td className="px-6 py-3 text-gray-600 italic max-w-xs truncate" title={log.description || ""}>
                          {log.description || "-"}
                        </td>
                      </tr>
                    ))
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