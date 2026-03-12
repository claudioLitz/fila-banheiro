"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { 
  UserPlus, CheckCircle2, LogOut, 
  DoorOpen, PauseCircle, PlayCircle, Trash2, ArrowUp, ArrowDown, ShieldAlert,
  ClipboardList, XCircle, BookOpen, Users, Plus, ArrowLeft, Settings, LayoutGrid, BarChart3
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
  users?: { acess_level: string };
};

type UserDB = {
  user_id: string;
  name: string;
  acess_level: string;
  email?: string;
};

type Classroom = {
  id: string;
  name: string;
  student_count?: number;
};

export default function Home() {
  const [todosLogsAtivos, setTodosLogsAtivos] = useState<LogPedido[]>([]);
  const [historicoCompleto, setHistoricoCompleto] = useState<LogPedido[]>([]);
  const [currentUser, setCurrentUser] = useState<UserDB | null>(null);
  const [isProcessing, setIsProcessing] = useState(false); 
  
  const processingRef = useRef(false);

  const router = useRouter();

  type ViewMode = "dashboard" | "settings" | "queue" | "no_class";
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [turmas, setTurmas] = useState<Classroom[]>([]);
  const [novaTurmaNome, setNovaTurmaNome] = useState("");
  const [turmaAtiva, setTurmaAtiva] = useState<Classroom | null>(null);
  
  const [alunosSemTurma, setAlunosSemTurma] = useState<UserDB[]>([]);
  const [alunosNaTurmaAtual, setAlunosNaTurmaAtual] = useState<UserDB[]>([]);
  const [alunoParaAdicionar, setAlunoParaAdicionar] = useState("");
  const [alunoSelecionadoFila, setAlunoSelecionadoFila] = useState("");
  
  const [isStatsExpanded, setIsStatsExpanded] = useState(false);

  const isPrivileged = currentUser?.acess_level === "Teacher" || currentUser?.acess_level === "admin";
  const isAdmin = currentUser?.acess_level === "admin";

  useEffect(() => { verificarLogin(); }, []);

  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase.channel("realtime_logs").on(
      "postgres_changes", { event: "*", schema: "public", table: "logs" },
      () => carregarDados(currentUser)
    ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser]);

  // ====================================================
  // SISTEMA DE LOGIN E ROTEAMENTO INICIAL
  // ====================================================
  const verificarLogin = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.push("/login");

    const { data: usuarioDB } = await supabase.from("users").select("*").eq("user_id", session.user.id).single();

    if (usuarioDB) {
      setCurrentUser(usuarioDB as UserDB);
      carregarDados(usuarioDB as UserDB);
      
      if (usuarioDB.acess_level === "admin" || usuarioDB.acess_level === "Teacher") {
        await carregarDashboard();
        setViewMode("dashboard");
      } else {
        const { data: vinculo } = await supabase.from("user_classrooms").select("classroom_id").eq("user_id", usuarioDB.user_id).maybeSingle();
        if (vinculo) {
          const { data: turma } = await supabase.from("classrooms").select("*").eq("id", vinculo.classroom_id).single();
          const { data: membros } = await supabase.from("user_classrooms").select("user_id").eq("classroom_id", turma.id);
          if (membros) {
            // CORREÇÃO: TypeScript deduz o tipo sozinho aqui
            const ids = membros.map((m) => m.user_id);
            const { data: alunosData } = await supabase.from("users").select("*").in("user_id", ids);
            setAlunosNaTurmaAtual(alunosData || []);
          }
          setTurmaAtiva(turma);
          setViewMode("queue");
        } else {
          setViewMode("no_class");
        }
      }
    } else {
      fazerLogout();
    }
  };

  // ====================================================
  // FUNÇÕES DO DASHBOARD DE TURMAS
  // ====================================================
  const carregarDashboard = async () => {
    const { data: turmasData } = await supabase.from("classrooms").select("*").order("created_at", { ascending: true });
    const { data: vinculos } = await supabase.from("user_classrooms").select("classroom_id");
    if (turmasData) {
      const turmasComContagem = turmasData.map(t => ({
        ...t, 
        // CORREÇÃO: TypeScript deduz o tipo do "v" sozinho aqui também
        student_count: vinculos ? vinculos.filter((v) => v.classroom_id === t.id).length : 0
      }));
      setTurmas(turmasComContagem);
    }
  };

  const criarTurma = async () => {
    if (!novaTurmaNome.trim() || isProcessing) return;
    setIsProcessing(true);
    try {
      await supabase.from("classrooms").insert([{ name: novaTurmaNome.trim() }]);
      setNovaTurmaNome("");
      await carregarDashboard();
    } finally { setIsProcessing(false); }
  };

  const abrirConfiguracoes = async (turma: Classroom) => {
    setTurmaAtiva(turma);
    setIsProcessing(true);
    try {
      const { data: todosAlunos } = await supabase.from("users").select("*").in("acess_level", ["aluno", "Student"]);
      const { data: vinculos } = await supabase.from("user_classrooms").select("user_id, classroom_id");

      if (todosAlunos && vinculos) {
        // CORREÇÃO: Deixando o TypeScript inferir os tipos
        const vinculadosIds = vinculos.map((v) => v.user_id);
        const alunosDestaTurmaIds = vinculos.filter((v) => v.classroom_id === turma.id).map((v) => v.user_id);
        setAlunosSemTurma(todosAlunos.filter((a) => !vinculadosIds.includes(a.user_id)));
        setAlunosNaTurmaAtual(todosAlunos.filter((a) => alunosDestaTurmaIds.includes(a.user_id)));
      }
      setViewMode("settings");
    } finally { setIsProcessing(false); }
  };

  const abrirFila = async (turma: Classroom) => {
    setTurmaAtiva(turma);
    setIsProcessing(true);
    try {
      const { data: vinculos } = await supabase.from("user_classrooms").select("user_id").eq("classroom_id", turma.id);
      if (vinculos && vinculos.length > 0) {
        const ids = vinculos.map((v) => v.user_id);
        const { data: alunosData } = await supabase.from("users").select("*").in("user_id", ids);
        setAlunosNaTurmaAtual(alunosData || []);
      } else setAlunosNaTurmaAtual([]);
      setViewMode("queue");
    } finally { setIsProcessing(false); }
  };

  const puxarAlunoParaTurma = async () => {
    if (!alunoParaAdicionar || !turmaAtiva || isProcessing) return;
    setIsProcessing(true);
    try {
      await supabase.from("user_classrooms").insert([{ classroom_id: turmaAtiva.id, user_id: alunoParaAdicionar }]);
      await abrirConfiguracoes(turmaAtiva); 
      setAlunoParaAdicionar("");
    } finally { setIsProcessing(false); }
  };

  const removerAlunoDaTurma = async (userId: string) => {
    if (!turmaAtiva || isProcessing) return;
    setIsProcessing(true);
    try {
      await supabase.from("user_classrooms").delete().eq("user_id", userId);
      await abrirConfiguracoes(turmaAtiva);
    } finally { setIsProcessing(false); }
  };

  const excluirTurma = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta turma? Todos os alunos perderão o vínculo.") || isProcessing) return;
    setIsProcessing(true);
    try {
      await supabase.from("classrooms").delete().eq("id", id);
      await carregarDashboard();
    } finally { setIsProcessing(false); }
  };

  // ====================================================
  // FUNÇÕES DA FILA E HISTÓRICO
  // ====================================================
  const carregarDados = async (usuario: UserDB | null = currentUser) => {
    if (!usuario) return;
    const { data } = await supabase.from("logs").select("*, users(acess_level)");
    if (data) {
      setTodosLogsAtivos(data.filter((p) => ["pedido", "saida", "pausado"].includes(p.status)).reverse());
      const getActionTime = (log: LogPedido) => {
        if (log.status.includes('saida')) return new Date(log.go_time || log.require_time).getTime();
        if (log.status === 'concluido') return new Date(log.back_time || log.require_time).getTime();
        return new Date(log.require_time).getTime();
      };
      const logsOrdenados = data.sort((a, b) => getActionTime(b) - getActionTime(a));

      if (usuario.acess_level === "admin") setHistoricoCompleto(logsOrdenados);
      else if (usuario.acess_level === "Teacher") setHistoricoCompleto(logsOrdenados.filter((log) => log.users?.acess_level === "aluno" || log.users?.acess_level === "Student"));
      else setHistoricoCompleto([]);
    }
  };

  const logsDaTurmaAtiva = todosLogsAtivos.filter(log =>
    (log.status === "pausado" && log.description?.includes(`[TURMA:${turmaAtiva?.id}]`)) ||
    alunosNaTurmaAtual.some(a => a.user_id === log.user_id) ||
    (log.user_id === currentUser?.user_id && log.status !== "pausado")
  );

  const historicoDaTurma = historicoCompleto.filter(log => 
    (log.status === "pausado" && log.description?.includes(`[TURMA:${turmaAtiva?.id}]`)) ||
    alunosNaTurmaAtual.some(a => a.user_id === log.user_id)
  );

  const getEffectiveTime = (log: LogPedido) => {
    const match = log.description?.match(/\[OVERRIDE:(.*?)\]/);
    return match ? match[1] : log.require_time;
  };

  const filaEsperaOrdenada = logsDaTurmaAtiva
    .filter((p) => p.status === "pedido")
    .sort((a, b) => new Date(getEffectiveTime(a)).getTime() - new Date(getEffectiveTime(b)).getTime());

  const noBanheiro = logsDaTurmaAtiva.find((p) => p.status === "saida");
  const isPaused = logsDaTurmaAtiva.some((p) => p.status === "pausado");
  const meuPedido = logsDaTurmaAtiva.find((p) => p.user_id === currentUser?.user_id && ["pedido", "saida"].includes(p.status));
  const souOPrimeiro = filaEsperaOrdenada.length > 0 && filaEsperaOrdenada[0].user_id === currentUser?.user_id;

  const alternarPausa = async () => {
    if (processingRef.current || !currentUser || !turmaAtiva) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      if (isPaused) {
        const pausaLog = logsDaTurmaAtiva.find(p => p.status === "pausado");
        if (pausaLog) await supabase.from("logs").update({ status: "concluido" }).eq("id", pausaLog.id);
      } else {
        await supabase.from("logs").insert([{ user_id: currentUser.user_id, name: "SISTEMA", status: "pausado", description: `Fila pausada por ${currentUser.name} [TURMA:${turmaAtiva.id}]` }]);
      }
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const requisitar = async () => {
    if (!currentUser || processingRef.current || meuPedido) return; 
    processingRef.current = true; setIsProcessing(true);
    try {
      const { data: jaExiste } = await supabase.from("logs").select("id").eq("user_id", currentUser.user_id).in("status", ["pedido", "saida"]);
      if (jaExiste && jaExiste.length > 0) return;
      await supabase.from("logs").insert([{ user_id: currentUser.user_id, name: currentUser.name, status: "pedido" }]);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const registrarSaida = async (pedido: LogPedido) => {
    if (processingRef.current) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      await supabase.from("logs").update({ status: "pedido_historico" }).eq("id", pedido.id);
      await supabase.from("logs").insert([{ user_id: pedido.user_id, name: pedido.name, status: "saida", require_time: pedido.require_time, go_time: new Date().toISOString(), description: pedido.description }]);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const registrarChegada = async (pedido: LogPedido) => {
    if (processingRef.current) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      await supabase.from("logs").update({ status: "saida_historico" }).eq("id", pedido.id);
      await supabase.from("logs").insert([{ user_id: pedido.user_id, name: pedido.name, status: "concluido", require_time: pedido.require_time, go_time: pedido.go_time, back_time: new Date().toISOString(), description: pedido.description }]);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const adicionarAlunoManualmenteFila = async () => {
    if (!alunoSelecionadoFila || processingRef.current || !currentUser) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      const aluno = alunosNaTurmaAtual.find(a => a.user_id === alunoSelecionadoFila);
      if (!aluno) return;

      const { data: jaExiste } = await supabase.from("logs").select("id").eq("user_id", aluno.user_id).in("status", ["pedido", "saida"]);
      if (jaExiste && jaExiste.length > 0) return;

      await supabase.from("logs").insert([{ user_id: aluno.user_id, name: aluno.name, status: "pedido", description: `(Adicionado por: ${currentUser.name})` }]);
      setAlunoSelecionadoFila("");
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const forcarSaidaAluno = async (pedidoAntigo: LogPedido) => {
    if (processingRef.current || !currentUser) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      await supabase.from("logs").update({ status: "pedido_historico" }).eq("id", pedidoAntigo.id);
      await supabase.from("logs").insert([{ user_id: pedidoAntigo.user_id, name: pedidoAntigo.name, status: "saida", require_time: pedidoAntigo.require_time, go_time: new Date().toISOString(), description: ((pedidoAntigo.description || "") + ` (Forçada por: ${currentUser.name})`).trim() }]);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const cancelarPedido = async (pedido: LogPedido) => {
    if(processingRef.current) return;
    processingRef.current = true; setIsProcessing(true);
    try { await supabase.from("logs").update({ status: "cancelado", description: "Cancelado / Removido" }).eq("id", pedido.id); }
    finally { processingRef.current = false; setIsProcessing(false); }
  };

  const removerDaFila = async (aluno: LogPedido) => {
    if (processingRef.current || !currentUser) return;
    processingRef.current = true; setIsProcessing(true);
    try { await supabase.from("logs").update({ status: "cancelado", description: `(Removido por ${currentUser.name}) ` + (aluno.description || "") }).eq("id", aluno.id); } 
    finally { processingRef.current = false; setIsProcessing(false); }
  };

  const moverPosicao = async (index: number, direcao: "up" | "down") => {
    if (processingRef.current || !currentUser) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      const atual = filaEsperaOrdenada[index];
      const outro = filaEsperaOrdenada[direcao === "up" ? index - 1 : index + 1];
      if (!atual || !outro) return;
      const tAtual = getEffectiveTime(atual);
      const tOutro = getEffectiveTime(outro);
      const newDescAtual = (atual.description || "").replace(/\[OVERRIDE:.*?\]/g, "") + ` [OVERRIDE:${tOutro}]`;
      const newDescOutro = (outro.description || "").replace(/\[OVERRIDE:.*?\]/g, "") + ` [OVERRIDE:${tAtual}]`;
      await supabase.from("logs").update({ description: newDescAtual.trim() }).eq("id", atual.id);
      await supabase.from("logs").update({ description: newDescOutro.trim() }).eq("id", outro.id);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const fazerLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // ====================================================
  // SISTEMA ESTATÍSTICO (RESUMO DA SALA POR ALUNO)
  // ====================================================
  const gerarRankingDaSala = () => {
    const statsPorAluno: Record<string, { name: string, idas: number, tempoTotalMin: number }> = {};

    historicoDaTurma.forEach(log => {
      if (log.status !== 'concluido' || !log.go_time || !log.back_time) return;
      const tempoMin = (new Date(log.back_time).getTime() - new Date(log.go_time).getTime()) / 60000;
      
      if (!statsPorAluno[log.user_id]) {
        statsPorAluno[log.user_id] = { name: log.name, idas: 0, tempoTotalMin: 0 };
      }
      statsPorAluno[log.user_id].idas += 1;
      if (tempoMin >= 0) {
        statsPorAluno[log.user_id].tempoTotalMin += tempoMin;
      }
    });

    return Object.values(statsPorAluno)
      .map(s => ({
        nome: s.name,
        idas: s.idas,
        tempoTotal: Math.round(s.tempoTotalMin),
        mediaTempo: Math.round(s.tempoTotalMin / s.idas)
      }))
      .sort((a, b) => b.idas - a.idas);
  };

  const rankingSala = gerarRankingDaSala();

  // ====================================================
  // HELPERS VISUAIS
  // ====================================================
  const formatarHora = (isoDate: string | null) => isoDate ? new Date(isoDate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
  const getEventTime = (log: LogPedido) => log.status.includes('saida') ? log.go_time : log.status === 'concluido' ? log.back_time : log.require_time;
  
  const getStatusDisplay = (status: string) => {
    switch(status) {
      case "pedido": case "pedido_historico": return { texto: "PEDIDO", cor: "bg-white border-2 border-[#00579D] text-[#00579D]" };
      case "saida": case "saida_historico": return { texto: "NO BANHEIRO", cor: "bg-[#00579D] text-white border-2 border-[#00579D]" };
      case "concluido": return { texto: "CONCLUÍDO", cor: "bg-[#2B2B2B] text-white border-2 border-[#2B2B2B]" };
      case "cancelado": return { texto: "CANCELADO", cor: "bg-gray-200 border-2 border-[#2B2B2B] text-[#2B2B2B] line-through" };
      case "pausado": return { texto: "SISTEMA", cor: "bg-gray-800 text-white border-2 border-gray-800" };
      default: return { texto: status.toUpperCase(), cor: "bg-gray-100 border-2 border-gray-300 text-gray-600" };
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
      <div className="text-xl font-bold text-[#00579D] uppercase tracking-widest animate-pulse">Carregando Sistema...</div>
    </div>
  );

  return (
    <main className="min-h-screen flex flex-col bg-[#F4F4F4] font-sans text-[#2B2B2B]">
      
      {/* CABEÇALHO GERAL */}
      <header className="bg-[#00579D] text-white px-8 py-4 shadow-md flex justify-between items-center z-10">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-senai.png" alt="Logo SENAI" className="h-14 sm:h-16 object-contain" onError={(e) => e.currentTarget.style.display = 'none'} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-weg.png" alt="Logo WEG" className="h-14 sm:h-16 object-contain" onError={(e) => e.currentTarget.style.display = 'none'} />
        </div>
        <div className="flex items-center gap-6">
          <span className="text-sm tracking-wide hidden md:block">
            {isPrivileged ? "Docente:" : "Aluno:"} <strong className="font-bold uppercase">{currentUser.name}</strong>
          </span>
          
          {isPrivileged && turmaAtiva && (
            <button
              onClick={() => {
                if (viewMode === "queue" || viewMode === "settings") {
                  carregarDashboard();
                  setViewMode("dashboard");
                } else { setViewMode("queue"); }
              }}
              className="flex items-center gap-2 bg-[#2B2B2B] text-white px-4 py-2 font-bold uppercase tracking-wider hover:bg-black transition-colors duration-300 border-b-4 border-black active:border-b-0 active:translate-y-1"
            >
              {viewMode === "dashboard" ? <ArrowLeft size={18} /> : <LayoutGrid size={18} />}
              {viewMode === "dashboard" ? "Voltar à Fila" : "Painel de Turmas"}
            </button>
          )}

          <button onClick={fazerLogout} disabled={isProcessing} className="flex items-center gap-2 bg-white text-[#00579D] px-4 py-2 font-bold uppercase tracking-wider hover:bg-gray-200 transition-colors border-b-4 border-gray-400 active:border-b-0 active:translate-y-1">
            <LogOut size={18} /> <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </header>

      <div className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8 relative">

        {viewMode === "no_class" && (
          <div className="flex flex-col items-center justify-center mt-20 text-center space-y-4">
            <BookOpen size={64} className="text-gray-300" />
            <h2 className="text-2xl font-extrabold text-[#2B2B2B] uppercase">Você ainda não possui turma</h2>
            <p className="text-gray-600 font-medium">Aguarde o professor ou administrador adicionar você em uma sala para acessar a fila do banheiro.</p>
          </div>
        )}

        {/* =========================================================
            DASHBOARD DE TURMAS 
            ========================================================= */}
        {viewMode === "dashboard" && isPrivileged && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10">
            <div className="flex justify-between items-center border-b-4 border-[#00579D] pb-4 mb-8">
              <h2 className="text-2xl font-extrabold uppercase tracking-widest flex items-center gap-2">
                <LayoutGrid size={28} /> Painel de Turmas
              </h2>
            </div>

            {isAdmin && (
              <div className="bg-white border-2 border-[#2B2B2B] p-6 mb-8 flex flex-col md:flex-row gap-4 items-end shadow-md">
                <div className="flex-1 w-full">
                  <label className="block text-xs font-bold mb-2 uppercase tracking-wider">Criar Nova Turma</label>
                  <input type="text" placeholder="Ex: TÉCNICO DEV-01" className="w-full px-4 py-3 bg-[#F4F4F4] border-2 border-[#2B2B2B] font-bold focus:outline-none focus:border-[#00579D] uppercase" value={novaTurmaNome} onChange={(e) => setNovaTurmaNome(e.target.value)} />
                </div>
                <button onClick={criarTurma} disabled={isProcessing || !novaTurmaNome.trim()} className="bg-[#00579D] text-white font-bold uppercase tracking-widest py-3 px-8 hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 w-full md:w-auto">
                  <Plus size={20} className="inline mr-2"/> Criar
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {turmas.map(turma => (
                <div key={turma.id} className="bg-white border-2 border-gray-200 shadow-sm hover:shadow-md hover:border-[#00579D] transition-all flex flex-col">
                  <div className="bg-[#2B2B2B] text-white px-4 py-3 flex justify-between items-center">
                    <span className="font-bold uppercase tracking-wider truncate mr-2" title={turma.name}>{turma.name}</span>
                    <button onClick={() => abrirConfiguracoes(turma)} className="text-gray-300 hover:text-white transition-colors" title="Configurações da Turma">
                      <Settings size={20} />
                    </button>
                  </div>
                  <div className="p-6 flex-1 flex flex-col justify-between gap-6">
                    <div className="flex items-center gap-3 text-gray-600 font-medium">
                      <Users size={24} className="text-[#00579D]"/>
                      <span><strong className="text-xl text-[#2B2B2B]">{turma.student_count}</strong> Alunos</span>
                    </div>
                    <button onClick={() => abrirFila(turma)} className="w-full bg-[#00579D] text-white font-bold uppercase tracking-widest py-3 hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 flex items-center justify-center gap-2">
                      <DoorOpen size={20} /> Abrir Fila
                    </button>
                  </div>
                </div>
              ))}
              {turmas.length === 0 && <p className="col-span-full text-center text-gray-500 font-bold uppercase py-10">Nenhuma turma criada.</p>}
            </div>
          </div>
        )}

        {/* =========================================================
            CONFIGURAÇÕES DA TURMA (GEAR)
            ========================================================= */}
        {viewMode === "settings" && turmaAtiva && isPrivileged && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <button onClick={() => { carregarDashboard(); setViewMode("dashboard"); }} className="mb-6 flex items-center gap-2 text-[#00579D] font-bold uppercase hover:underline">
              <ArrowLeft size={20} /> Voltar ao Painel
            </button>
            
            <div className="bg-white border-2 border-[#2B2B2B] shadow-md">
              <div className="bg-[#2B2B2B] text-white px-6 py-4 flex justify-between items-center">
                <h2 className="text-xl font-extrabold uppercase tracking-widest flex items-center gap-2">
                  <Settings size={24} /> Configurações: {turmaAtiva.name}
                </h2>
                {isAdmin && (
                  <button onClick={() => excluirTurma(turmaAtiva.id)} className="text-red-400 hover:text-red-500 transition-colors" title="Excluir Turma">
                    <Trash2 size={20} />
                  </button>
                )}
              </div>

              <div className="p-6 flex flex-col md:flex-row gap-8">
                <div className="flex-1 bg-[#F4F4F4] p-6 border-2 border-gray-200 h-fit">
                  <h3 className="font-bold uppercase tracking-wider mb-4 border-b-2 border-gray-300 pb-2">Adicionar Aluno</h3>
                  <select className="w-full px-4 py-3 mb-4 border-2 border-[#2B2B2B] uppercase font-bold text-sm" value={alunoParaAdicionar} onChange={(e) => setAlunoParaAdicionar(e.target.value)}>
                    <option value="">-- SELECIONAR ALUNO SEM TURMA --</option>
                    {alunosSemTurma.map(a => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
                  </select>
                  <button onClick={puxarAlunoParaTurma} disabled={!alunoParaAdicionar || isProcessing} className="w-full bg-[#00579D] text-white font-bold uppercase py-3 border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 disabled:opacity-50">
                    Adicionar à Turma
                  </button>
                </div>

                <div className="flex-1">
                  <h3 className="font-bold uppercase tracking-wider mb-4 border-b-2 border-gray-300 pb-2">Lista de Integrantes ({alunosNaTurmaAtual.length})</h3>
                  <ul className="divide-y divide-gray-200 border-2 border-gray-200 max-h-96 overflow-y-auto">
                    {alunosNaTurmaAtual.length === 0 ? <p className="p-4 text-gray-500 italic text-sm">Turma vazia</p> : 
                      alunosNaTurmaAtual.map(aluno => (
                        <li key={aluno.user_id} className="p-3 flex justify-between items-center hover:bg-gray-50">
                          <span className="font-bold text-sm uppercase text-[#2B2B2B]">{aluno.name}</span>
                          <button onClick={() => removerAlunoDaTurma(aluno.user_id)} className="text-gray-400 hover:text-red-600 transition-colors p-2"><Trash2 size={16}/></button>
                        </li>
                      ))
                    }
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            MÓDULO DE FILA DA TURMA
            ========================================================= */}
        {viewMode === "queue" && turmaAtiva && (
          <div className="flex flex-col xl:flex-row gap-6 items-start animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* PAINEL RETRÁTIL ESQUERDO: RANKING */}
            {isPrivileged && (
              <div className={`bg-white border-2 border-[#00579D] shadow-md transition-all duration-300 ease-in-out overflow-hidden flex flex-col shrink-0 ${isStatsExpanded ? 'w-full xl:w-[350px]' : 'w-full xl:w-[72px]'} h-fit`}>
                <button 
                  onClick={() => setIsStatsExpanded(!isStatsExpanded)} 
                  className="bg-[#00579D] text-white p-4 flex items-center justify-between w-full hover:bg-[#003E7E] transition-colors" 
                  title={isStatsExpanded ? "Fechar Resumo" : "Ver Resumo da Sala"}
                >
                  {isStatsExpanded ? (
                    <span className="font-bold uppercase tracking-widest text-sm flex items-center gap-2 whitespace-nowrap">
                      <BarChart3 size={18} className="shrink-0"/> Resumo da Sala
                    </span>
                  ) : (
                    <BarChart3 size={24} className="mx-auto shrink-0"/>
                  )}
                  {isStatsExpanded && <XCircle size={18} className="shrink-0" />}
                </button>
                
                <div className={`transition-opacity duration-300 ${isStatsExpanded ? 'opacity-100 p-0' : 'opacity-0 h-0 overflow-hidden'}`}>
                  {rankingSala.length === 0 ? (
                    <p className="p-6 text-center text-sm font-bold text-gray-400 uppercase">Sem registros nesta sala</p>
                  ) : (
                    <ul className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
                      <li className="bg-gray-100 px-4 py-2 flex justify-between items-center text-[10px] font-black uppercase text-gray-500 tracking-widest">
                        <span>Aluno (Idas)</span>
                        <span className="text-right">Tempo Total / Média</span>
                      </li>
                      {rankingSala.map((estatistica, i) => (
                        <li key={i} className="p-4 flex justify-between items-center hover:bg-gray-50">
                          <div>
                            <p className="font-extrabold text-[#2B2B2B] uppercase text-sm">{estatistica.nome}</p>
                            <p className="text-xs font-bold text-[#00579D]">{estatistica.idas} {estatistica.idas === 1 ? 'ida' : 'idas'}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-gray-700">{estatistica.tempoTotal} min</p>
                            <p className="text-[10px] font-bold text-gray-400 uppercase">Média: {estatistica.mediaTempo} min</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* PAINEL CENTRAL / DIREITO: CONTEÚDO DA FILA */}
            <div className="flex-1 w-full space-y-6 min-w-0">
              
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b-4 border-[#00579D] pb-4">
                <div>
                  <h2 className="text-2xl font-extrabold uppercase tracking-widest flex items-center gap-2">
                    <ClipboardList size={28} /> Fila: {turmaAtiva.name}
                  </h2>
                </div>
                
                {isPrivileged && (
                  <button onClick={alternarPausa} disabled={isProcessing} className={`font-bold uppercase tracking-widest py-3 px-6 border-b-4 active:border-b-0 active:translate-y-1 transition-all flex items-center gap-2 text-white ${isPaused ? "bg-[#00579D] border-[#003865] hover:bg-[#003865]" : "bg-[#2B2B2B] border-black hover:bg-black"}`}>
                    {isPaused ? <PlayCircle size={20} /> : <PauseCircle size={20} />}
                    {isPaused ? "Liberar Turma" : "Bloquear Turma"}
                  </button>
                )}
              </div>

              {isPrivileged && (
                <div className="bg-white p-4 border-2 border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 items-end">
                   <div className="flex-1 w-full">
                    <label className="block text-xs font-bold mb-2 uppercase text-gray-600">Inserir aluno da turma manualmente</label>
                    <select className="w-full px-4 py-2 bg-[#F4F4F4] border-2 border-gray-300 font-bold uppercase text-sm" value={alunoSelecionadoFila} onChange={(e) => setAlunoSelecionadoFila(e.target.value)}>
                      <option value="">-- SELECIONAR ALUNO --</option>
                      {alunosNaTurmaAtual.filter(a => !logsDaTurmaAtiva.some(log => log.user_id === a.user_id)).map(a => (
                        <option key={a.user_id} value={a.user_id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={adicionarAlunoManualmenteFila} disabled={!alunoSelecionadoFila || isProcessing} className="bg-[#2B2B2B] text-white font-bold uppercase py-2 px-6 border-b-4 border-black active:border-b-0 active:translate-y-1 w-full md:w-auto">
                    Inserir na Fila
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <section className="bg-white shadow-xl border-t-8 border-[#00579D] p-8 flex flex-col items-center justify-center text-center h-full">
                  <h2 className="text-xl font-extrabold text-[#00579D] uppercase mb-4">Seu Acesso</h2>
                  {isPaused ? (
                    <div className="text-[#2B2B2B] font-bold p-4 bg-gray-100 border-2 border-[#2B2B2B] flex items-center gap-2 uppercase">
                      <ShieldAlert size={20} /> Professor bloqueou a fila
                    </div>
                  ) : !meuPedido ? (
                    <button onClick={requisitar} disabled={isProcessing} className="bg-[#00579D] text-white font-bold uppercase py-4 px-10 hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 flex items-center gap-2">
                      <UserPlus size={20} /> Requisitar Acesso
                    </button>
                  ) : meuPedido.status === "pedido" ? (
                    souOPrimeiro && !noBanheiro ? (
                       <div className="w-full space-y-3">
                        <p className="text-[#00579D] font-bold uppercase text-lg">Sua vez!</p>
                        <button onClick={() => registrarSaida(meuPedido)} className="w-full bg-[#00579D] text-white font-bold uppercase py-4 border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 flex justify-center gap-2"><DoorOpen size={20}/> Confirmar Saída</button>
                        <button onClick={() => cancelarPedido(meuPedido)} className="w-full bg-white text-red-600 font-bold uppercase py-2 border-2 border-red-600 hover:bg-red-50 text-sm">Cancelar Pedido</button>
                      </div>
                    ) : (
                      <div className="w-full space-y-3">
                        <p className="text-[#2B2B2B] font-bold uppercase border-2 border-[#2B2B2B] p-4">Aguardando...</p>
                        <button onClick={() => cancelarPedido(meuPedido)} className="w-full bg-white text-red-600 font-bold uppercase py-2 border-2 border-red-600 hover:bg-red-50 text-sm">Desistir</button>
                      </div>
                    )
                  ) : meuPedido.status === "saida" ? (
                    <div className="w-full space-y-4">
                      <p className="text-[#00579D] font-bold uppercase text-lg">Você está fora.</p>
                      <button onClick={() => registrarChegada(meuPedido)} className="w-full bg-[#2B2B2B] text-white font-bold uppercase py-4 border-b-4 border-black active:border-b-0 active:translate-y-1 flex justify-center gap-2"><CheckCircle2 size={20}/> Confirmar Retorno</button>
                    </div>
                  ) : null}
                </section>

                <div className="space-y-6">
                  {/* SESSÃO FORA DE SALA COM NOVOS BOTÕES PRO PROFESSOR */}
                  <section className="bg-white border-2 border-[#00579D]">
                    <div className="bg-[#00579D] text-white px-4 py-3 font-bold uppercase flex justify-between"><span>Fora de Sala</span><DoorOpen size={18} /></div>
                    <div className="p-6">
                      {noBanheiro ? (
                        <div className="flex justify-between items-center gap-2">
                          <div>
                            <p className="font-extrabold text-xl text-[#00579D] uppercase">{noBanheiro.name}</p>
                            <p className="text-sm font-bold text-gray-500 uppercase mt-1">Saída: {formatarHora(noBanheiro.go_time)}</p>
                          </div>
                          
                          {isPrivileged && (
                            <div className="flex gap-2">
                              <button onClick={() => registrarChegada(noBanheiro)} className="p-3 bg-green-600 text-white hover:bg-green-700 transition-colors rounded-sm" title="Forçar Retorno"><CheckCircle2 size={18}/></button>
                              <button onClick={() => cancelarPedido(noBanheiro)} className="p-3 bg-red-600 text-white hover:bg-red-700 transition-colors rounded-sm" title="Excluir Registro (Bugado)"><Trash2 size={18}/></button>
                            </div>
                          )}
                        </div>
                      ) : <p className="text-center text-gray-500 font-medium italic uppercase text-sm">Ninguém fora da sala</p>}
                    </div>
                  </section>

                  <section className="bg-white border-2 border-[#2B2B2B]">
                    <div className="bg-[#2B2B2B] text-white px-4 py-3 font-bold uppercase flex justify-between"><span>Fila ({filaEsperaOrdenada.length})</span><ClipboardList size={18} /></div>
                    <ul className="divide-y divide-gray-200 max-h-48 overflow-y-auto">
                      {filaEsperaOrdenada.length === 0 ? <p className="text-center text-gray-500 font-medium italic uppercase text-sm p-6">Fila vazia</p> : 
                        filaEsperaOrdenada.map((aluno, i) => (
                          <li key={aluno.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
                            <div className="flex items-center gap-4">
                              <span className="text-[#00579D] font-black text-xl w-6">{i + 1}º</span>
                              <div>
                                <p className="font-bold text-[#2B2B2B] uppercase">{aluno.name}</p>
                                <p className="text-xs font-bold text-gray-500 uppercase">Req: {formatarHora(aluno.require_time)}</p>
                              </div>
                            </div>
                            {isPrivileged && (
                              <div className="flex gap-2">
                                <button onClick={() => forcarSaidaAluno(aluno)} className="p-2 bg-green-600 text-white hover:bg-green-700" title="Liberar"><DoorOpen size={16}/></button>
                                <button onClick={() => cancelarPedido(aluno)} className="p-2 bg-[#2B2B2B] text-white hover:bg-black" title="Remover"><Trash2 size={16}/></button>
                              </div>
                            )}
                          </li>
                        ))
                      }
                    </ul>
                  </section>
                </div>
              </div>

              {/* HISTÓRICO ORIGINAL DE VOLTA */}
              {isPrivileged && historicoDaTurma.length > 0 && (
                <section className="bg-white shadow-md border-t-8 border-[#2B2B2B] mt-8">
                  <div className="bg-[#2B2B2B] text-white px-6 py-4 font-bold uppercase tracking-widest">Histórico Completo da Sala</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#F4F4F4] border-b-2 border-[#2B2B2B] text-[#2B2B2B] uppercase text-xs">
                          <th className="p-4 font-bold">Hora</th><th className="p-4 font-bold">Operador</th><th className="p-4 font-bold">Status</th><th className="p-4 font-bold hidden sm:table-cell">Detalhes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {historicoDaTurma.map((log) => {
                          const badge = getStatusDisplay(log.status);
                          return (
                            <tr key={log.id} className="hover:bg-gray-50">
                              <td className="p-4 font-mono text-sm font-bold text-gray-600">{formatarHora(getEventTime(log))}</td>
                              <td className="p-4 font-extrabold text-[#2B2B2B] uppercase">{log.name}</td>
                              <td className="p-4"><span className={`px-3 py-1 font-bold text-[10px] uppercase tracking-wider ${badge.cor}`}>{badge.texto}</span></td>
                              <td className="p-4 text-xs font-bold text-gray-500 hidden sm:table-cell uppercase">{renderDetalhes(log)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

            </div>
          </div>
        )}

      </div>
      <footer className="bg-[#2B2B2B] text-white text-center text-xs py-4 font-bold tracking-widest uppercase border-t-2 border-gray-600 mt-auto">
        © {new Date().getFullYear()} WEG / SENAI • Sistema de Controle
      </footer>
    </main>
  );
}
