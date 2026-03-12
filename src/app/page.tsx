"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { 
  UserPlus, CheckCircle2, LogOut, 
  DoorOpen, PauseCircle, PlayCircle, Trash2, ShieldAlert,
  ClipboardList, XCircle, BookOpen, Users, Plus, ArrowLeft, Settings, LayoutGrid, BarChart3, Shield,
  ArrowUp, ArrowDown, ChevronDown, ChevronUp, Search
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
  time_limit_minutes: number;
  student_count?: number;
};

type ClassroomTeacherDB = {
  user_id: string;
  classroom_id: string;
};

type UserClassroomDB = {
  user_id: string;
  classroom_id: string;
};

export default function Home() {
  const [todosLogsAtivos, setTodosLogsAtivos] = useState<LogPedido[]>([]);
  const [historicoCompleto, setHistoricoCompleto] = useState<LogPedido[]>([]);
  const [currentUser, setCurrentUser] = useState<UserDB | null>(null);
  const [isProcessing, setIsProcessing] = useState(false); 
  
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const processingRef = useRef(false);
  const router = useRouter();

  type ViewMode = "dashboard" | "settings" | "queue" | "no_class" | "admin_panel";
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  
  const [turmas, setTurmas] = useState<Classroom[]>([]);
  const [novaTurmaNome, setNovaTurmaNome] = useState("");
  const [turmaAtiva, setTurmaAtiva] = useState<Classroom | null>(null);
  
  const [alunosSemTurma, setAlunosSemTurma] = useState<UserDB[]>([]);
  const [alunosNaTurmaAtual, setAlunosNaTurmaAtual] = useState<UserDB[]>([]);
  const [professoresNaTurmaAtual, setProfessoresNaTurmaAtual] = useState<UserDB[]>([]);
  const [todosProfessores, setTodosProfessores] = useState<UserDB[]>([]);
  const [alunoParaAdicionar, setAlunoParaAdicionar] = useState("");
  const [professorParaAdicionar, setProfessorParaAdicionar] = useState("");
  const [alunoSelecionadoFila, setAlunoSelecionadoFila] = useState("");
  
  const [todosUsuarios, setTodosUsuarios] = useState<UserDB[]>([]);
  const [logsAuditoria, setLogsAuditoria] = useState<LogPedido[]>([]);
  
  const [novoUserNome, setNovoUserNome] = useState("");
  const [novoUserEmail, setNovoUserEmail] = useState("");
  const [novoUserSenha, setNovoUserSenha] = useState("");
  const [novoUserCargo, setNovoUserCargo] = useState("aluno");

  const [isStatsExpanded, setIsStatsExpanded] = useState(false);
  const [isHistoricoOpen, setIsHistoricoOpen] = useState(false); 

  // ================= NOVOS ESTADOS PARA BUSCA E FILTROS =================
  const [buscaTurmas, setBuscaTurmas] = useState("");
  const [buscaUsuarios, setBuscaUsuarios] = useState("");
  const [usuariosSelecionados, setUsuariosSelecionados] = useState<string[]>([]);
  const [filtroAuditoria, setFiltroAuditoria] = useState("");
  const [filtroHistorico, setFiltroHistorico] = useState("");

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
  // LOGIN & INICIALIZAÇÃO
  // ====================================================
  const verificarLogin = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.push("/login");

    const { data: usuarioDB } = await supabase.from("users").select("*").eq("user_id", session.user.id).single();

    if (usuarioDB) {
      setCurrentUser(usuarioDB as UserDB);
      carregarDados(usuarioDB as UserDB);
      
      if (usuarioDB.acess_level === "admin" || usuarioDB.acess_level === "Teacher") {
        await carregarDashboard(usuarioDB as UserDB);
        setViewMode("dashboard");
      } else {
        const { data: vinculo } = await supabase.from("user_classrooms").select("classroom_id").eq("user_id", usuarioDB.user_id).maybeSingle();
        if (vinculo) {
          const { data: turma } = await supabase.from("classrooms").select("*").eq("id", vinculo.classroom_id).single();
          const { data: membros } = await supabase.from("user_classrooms").select("user_id").eq("classroom_id", turma.id);
          if (membros) {
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
  const carregarDashboard = async (usuario = currentUser) => {
    if (!usuario) return;
    const { data: turmasData } = await supabase.from("classrooms").select("*").order("created_at", { ascending: true });
    const { data: vinculos } = await supabase.from("user_classrooms").select("classroom_id");
    const { data: vinculosProfessores } = await supabase.from("classroom_teachers").select("*");

    if (turmasData) {
      let turmasVisiveis = turmasData;
      
      if (usuario.acess_level === "Teacher") {
        const minhasSalasIds = vinculosProfessores?.filter((vp: ClassroomTeacherDB) => vp.user_id === usuario.user_id).map((vp: ClassroomTeacherDB) => vp.classroom_id) || [];
        turmasVisiveis = turmasData.filter(t => minhasSalasIds.includes(t.id));
      }

      const turmasComContagem = turmasVisiveis.map(t => ({
        ...t, student_count: vinculos ? vinculos.filter((v) => v.classroom_id === t.id).length : 0
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
      const { data: listaTodosProfs } = await supabase.from("users").select("*").eq("acess_level", "Teacher");
      const { data: vinculosAlunos } = await supabase.from("user_classrooms").select("user_id, classroom_id");
      const { data: vinculosProfs } = await supabase.from("classroom_teachers").select("user_id").eq("classroom_id", turma.id);

      if (todosAlunos && vinculosAlunos) {
        const vinculadosIds = vinculosAlunos.map((v) => v.user_id);
        const alunosDestaTurmaIds = vinculosAlunos.filter((v) => v.classroom_id === turma.id).map((v) => v.user_id);
        setAlunosSemTurma(todosAlunos.filter((a: UserDB) => !vinculadosIds.includes(a.user_id)));
        setAlunosNaTurmaAtual(todosAlunos.filter((a: UserDB) => alunosDestaTurmaIds.includes(a.user_id)));
      }

      if (listaTodosProfs && vinculosProfs) {
        setTodosProfessores(listaTodosProfs);
        const profsDestaTurmaIds = vinculosProfs.map((v: ClassroomTeacherDB) => v.user_id);
        setProfessoresNaTurmaAtual(listaTodosProfs.filter((p: UserDB) => profsDestaTurmaIds.includes(p.user_id)));
      }

      setViewMode("settings");
    } finally { setIsProcessing(false); }
  };

  const abrirFila = async (turma: Classroom) => {
    setTurmaAtiva(turma);
    setIsProcessing(true);
    setFiltroHistorico(""); // Reseta o filtro ao abrir a sala
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
      await abrirConfiguracoes(turmaAtiva); setAlunoParaAdicionar("");
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

  const puxarProfessorParaTurma = async () => {
    if (!professorParaAdicionar || !turmaAtiva || isProcessing) return;
    setIsProcessing(true);
    try {
      await supabase.from("classroom_teachers").insert([{ classroom_id: turmaAtiva.id, user_id: professorParaAdicionar }]);
      await abrirConfiguracoes(turmaAtiva); setProfessorParaAdicionar("");
    } finally { setIsProcessing(false); }
  };

  const removerProfessorDaTurma = async (userId: string) => {
    if (!turmaAtiva || isProcessing) return;
    setIsProcessing(true);
    try {
      await supabase.from("classroom_teachers").delete().match({ classroom_id: turmaAtiva.id, user_id: userId });
      await abrirConfiguracoes(turmaAtiva);
    } finally { setIsProcessing(false); }
  };

  const atualizarTempoLimite = async (minutos: number) => {
    if (!turmaAtiva) return;
    await supabase.from("classrooms").update({ time_limit_minutes: minutos }).eq("id", turmaAtiva.id);
    setTurmaAtiva({ ...turmaAtiva, time_limit_minutes: minutos });
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
  // PAINEL DE CONTROLE GERAL DO ADMIN
  // ====================================================
  const carregarPainelAdmin = async () => {
    setIsProcessing(true);
    try {
      const { data: usuariosData } = await supabase.from("users").select("*").order("name");
      if (usuariosData) setTodosUsuarios(usuariosData);

      const { data: auditoriaData } = await supabase.from("logs").select("*").eq("status", "auditoria").order("require_time", { ascending: false });
      if (auditoriaData) setLogsAuditoria(auditoriaData);

      setUsuariosSelecionados([]); // Limpar seleção ao carregar
      setViewMode("admin_panel");
    } finally { setIsProcessing(false); }
  };

  const alterarCargoUsuario = async (userId: string, novoCargo: string) => {
    if (!confirm(`Tem certeza que deseja alterar o cargo deste usuário para ${novoCargo}?`) || isProcessing) return;
    setIsProcessing(true);
    try {
      await supabase.from("users").update({ acess_level: novoCargo }).eq("user_id", userId);
      await carregarPainelAdmin(); 
    } finally { setIsProcessing(false); }
  };

  // --- Função para Deletar Usuários em Massa ---
  const excluirUsuariosEmMassa = async () => {
    if (usuariosSelecionados.length === 0 || isProcessing) return;
    if (!confirm(`Tem certeza que deseja EXCLUIR DEFINITIVAMENTE os ${usuariosSelecionados.length} usuário(s) selecionado(s) do banco de dados?`)) return;
    
    setIsProcessing(true);
    try {
      await supabase.from("users").delete().in("user_id", usuariosSelecionados);
      setUsuariosSelecionados([]);
      await carregarPainelAdmin();
    } catch (err: any) {
      alert("Erro ao excluir usuários: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const registrarNovoUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const DOMINIO_SENAI = "@estudante.sesisenai.org.br";
      const emailCompleto = novoUserEmail.includes("@") ? novoUserEmail : novoUserEmail.trim().toLowerCase() + DOMINIO_SENAI;

      const tempSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!, 
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, 
        { auth: { persistSession: false, autoRefreshToken: false } }
      );

      const { data, error } = await tempSupabase.auth.signUp({
        email: emailCompleto,
        password: novoUserSenha,
        options: { data: { name: novoUserNome } }
      });

      if (error) throw error;

      if (data.user && novoUserCargo !== "aluno") {
        await supabase.from("users").update({ acess_level: novoUserCargo }).eq("user_id", data.user.id);
      }

      alert("Usuário criado com sucesso!");
      setNovoUserNome(""); setNovoUserEmail(""); setNovoUserSenha("");
      await carregarPainelAdmin();
    } catch (err: any) {
      alert("Erro ao criar usuário: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleUsuarioSelecionado = (userId: string) => {
    setUsuariosSelecionados(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const toggleSelecionarTodos = (usuariosVisiveis: UserDB[]) => {
    if (usuariosSelecionados.length === usuariosVisiveis.length && usuariosVisiveis.length > 0) {
      setUsuariosSelecionados([]); // Desmarca todos se já estão marcados
    } else {
      setUsuariosSelecionados(usuariosVisiveis.map(u => u.user_id)); // Marca todos os da lista atual
    }
  };

  // ====================================================
  // LÓGICA DA FILA DA SALA
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

      if (usuario.acess_level === "admin") setHistoricoCompleto(logsOrdenados.filter(l => l.status !== "auditoria"));
      else if (usuario.acess_level === "Teacher") setHistoricoCompleto(logsOrdenados.filter((log) => log.status !== "auditoria" && (log.users?.acess_level === "aluno" || log.users?.acess_level === "Student")));
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

  const noBanheiroList = logsDaTurmaAtiva.filter((p) => p.status === "saida");
  const isPaused = logsDaTurmaAtiva.some((p) => p.status === "pausado");
  const meuPedido = logsDaTurmaAtiva.find((p) => p.user_id === currentUser?.user_id && ["pedido", "saida"].includes(p.status));
  const souOPrimeiro = filaEsperaOrdenada.length > 0 && filaEsperaOrdenada[0].user_id === currentUser?.user_id;
  
  const acessoLivreParaAluno = noBanheiroList.length === 0;

  const criarLogAuditoria = async (acao: string) => {
    if (!currentUser) return;
    await supabase.from("logs").insert([{ user_id: currentUser.user_id, name: currentUser.name, status: "auditoria", description: acao }]);
  };

  const alternarPausa = async () => {
    if (processingRef.current || !currentUser || !turmaAtiva) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      if (isPaused) {
        const pausaLog = logsDaTurmaAtiva.find(p => p.status === "pausado");
        if (pausaLog) await supabase.from("logs").update({ status: "concluido" }).eq("id", pausaLog.id);
        criarLogAuditoria(`Liberou a fila da sala ${turmaAtiva.name}`);
      } else {
        await supabase.from("logs").insert([{ user_id: currentUser.user_id, name: "SISTEMA", status: "pausado", description: `Fila pausada por ${currentUser.name} [TURMA:${turmaAtiva.id}]` }]);
        criarLogAuditoria(`Bloqueou a fila da sala ${turmaAtiva.name}`);
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
      criarLogAuditoria(`Adicionou ${aluno.name} na fila da sala ${turmaAtiva?.name}`);
      setAlunoSelecionadoFila("");
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const forcarSaidaAluno = async (pedidoAntigo: LogPedido) => {
    if (processingRef.current || !currentUser) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      await supabase.from("logs").update({ status: "pedido_historico" }).eq("id", pedidoAntigo.id);
      await supabase.from("logs").insert([{ user_id: pedidoAntigo.user_id, name: pedidoAntigo.name, status: "saida", require_time: pedidoAntigo.require_time, go_time: new Date().toISOString(), description: ((pedidoAntigo.description || "") + ` (Forçada por: ${currentUser.name})`).trim() }]);
      criarLogAuditoria(`Forçou a saída do aluno ${pedidoAntigo.name}`);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const forcarRetornoAluno = async (pedido: LogPedido) => {
    if (processingRef.current) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      await supabase.from("logs").update({ status: "saida_historico" }).eq("id", pedido.id);
      await supabase.from("logs").insert([{ user_id: pedido.user_id, name: pedido.name, status: "concluido", require_time: pedido.require_time, go_time: pedido.go_time, back_time: new Date().toISOString(), description: ((pedido.description || "") + ` (Retorno forçado por: ${currentUser?.name})`).trim() }]);
      criarLogAuditoria(`Forçou o retorno do aluno ${pedido.name}`);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const cancelarPedido = async (pedido: LogPedido) => {
    if(processingRef.current) return;
    processingRef.current = true; setIsProcessing(true);
    try { 
      await supabase.from("logs").update({ status: "cancelado", description: "Cancelado / Removido" }).eq("id", pedido.id); 
      if(isPrivileged && currentUser?.user_id !== pedido.user_id) {
        criarLogAuditoria(`Removeu/Cancelou o registro de ${pedido.name}`);
      }
    }
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
      criarLogAuditoria(`Alterou a posição de ${atual.name} e ${outro.name} na fila`);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const fazerLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const gerarRankingDaSala = () => {
    const statsPorAluno: Record<string, { name: string, idas: number, tempoTotalMin: number }> = {};
    historicoDaTurma.forEach(log => {
      if (log.status !== 'concluido' || !log.go_time || !log.back_time) return;
      const tempoMin = (new Date(log.back_time).getTime() - new Date(log.go_time).getTime()) / 60000;
      if (!statsPorAluno[log.user_id]) statsPorAluno[log.user_id] = { name: log.name, idas: 0, tempoTotalMin: 0 };
      statsPorAluno[log.user_id].idas += 1;
      if (tempoMin >= 0) statsPorAluno[log.user_id].tempoTotalMin += tempoMin;
    });
    return Object.values(statsPorAluno).map(s => ({ nome: s.name, idas: s.idas, tempoTotal: Math.round(s.tempoTotalMin), mediaTempo: Math.round(s.tempoTotalMin / s.idas) })).sort((a, b) => b.idas - a.idas);
  };
  const rankingSala = gerarRankingDaSala();

  const formatarHora = (isoDate: string | null) => isoDate ? new Date(isoDate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
  const getEventTime = (log: LogPedido) => log.status.includes('saida') ? log.go_time : log.status === 'concluido' ? log.back_time : log.require_time;
  
  const getStatusDisplay = (status: string) => {
    switch(status) {
      case "pedido": case "pedido_historico": return { texto: "PEDIDO", cor: "bg-white border-2 border-[#00579D] text-[#00579D]" };
      case "saida": case "saida_historico": return { texto: "NO BANHEIRO", cor: "bg-[#00579D] text-white border-2 border-[#00579D]" };
      case "concluido": return { texto: "CONCLUÍDO", cor: "bg-[#2B2B2B] text-white border-2 border-[#2B2B2B]" };
      case "cancelado": return { texto: "CANCELADO", cor: "bg-gray-200 border-2 border-[#2B2B2B] text-[#2B2B2B] line-through" };
      case "pausado": return { texto: "SISTEMA", cor: "bg-gray-800 text-white border-2 border-gray-800" };
      case "auditoria": return { texto: "AUDITORIA", cor: "bg-purple-600 text-white border-2 border-purple-600" };
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

  // ================= APLICAÇÃO DOS FILTROS NAS VARIÁVEIS DE LISTAGEM =================
  const usuariosVisiveis = todosUsuarios.filter(u => 
    u.name.toLowerCase().includes(buscaUsuarios.toLowerCase()) || 
    (u.email && u.email.toLowerCase().includes(buscaUsuarios.toLowerCase()))
  );
  const auditoriaVisivel = logsAuditoria.filter(log => log.name.toLowerCase().includes(filtroAuditoria.toLowerCase()));
  const turmasVisiveisList = turmas.filter(t => t.name.toLowerCase().includes(buscaTurmas.toLowerCase()));
  const historicoVisivel = historicoDaTurma.filter(log => log.name.toLowerCase().includes(filtroHistorico.toLowerCase()));

  if (!currentUser) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F4F4]"><div className="text-xl font-bold text-[#00579D] uppercase tracking-widest animate-pulse">Carregando Sistema...</div></div>
  );

  return (
    <main className="min-h-screen flex flex-col bg-[#F4F4F4] font-sans text-[#2B2B2B]">
      
      {/* CABEÇALHO GERAL */}
      <header className="bg-[#00579D] text-white px-8 py-4 shadow-md flex justify-between items-center z-10">
        <div className="flex items-center gap-4">
          <img src="/logo-senai.png" alt="Logo SENAI" className="h-14 sm:h-16 object-contain" onError={(e) => e.currentTarget.style.display = 'none'} />
          <img src="/logo-weg.png" alt="Logo WEG" className="h-14 sm:h-16 object-contain" onError={(e) => e.currentTarget.style.display = 'none'} />
        </div>
        <div className="flex items-center gap-4 sm:gap-6 flex-wrap justify-end">
          <span className="text-sm tracking-wide hidden md:block">
            {isAdmin ? "Admin:" : isPrivileged ? "Docente:" : "Aluno:"} <strong className="font-bold uppercase">{currentUser.name}</strong>
          </span>

          {isAdmin && viewMode !== "admin_panel" && (
            <button onClick={carregarPainelAdmin} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 font-bold uppercase tracking-wider hover:bg-purple-700 transition-colors border-b-4 border-purple-800 active:border-b-0 active:translate-y-1">
              <Shield size={18} /> <span className="hidden sm:inline">Admin</span>
            </button>
          )}
          
          {isPrivileged && (viewMode === "settings" || viewMode === "queue" || viewMode === "admin_panel") && (
            <button
              onClick={() => { carregarDashboard(); setViewMode("dashboard"); }}
              className="flex items-center gap-2 bg-[#2B2B2B] text-white px-4 py-2 font-bold uppercase tracking-wider hover:bg-black transition-colors duration-300 border-b-4 border-black active:border-b-0 active:translate-y-1"
            >
              <LayoutGrid size={18} /> <span className="hidden sm:inline">Painel de Turmas</span>
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
            PAINEL DO ADMIN GERAL (CARGOS, LOGS E CRIAR USUÁRIO)
            ========================================================= */}
        {viewMode === "admin_panel" && isAdmin && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10">
            <div className="flex justify-between items-center border-b-4 border-purple-600 pb-4 mb-8">
              <h2 className="text-2xl font-extrabold uppercase tracking-widest flex items-center gap-2 text-purple-700">
                <Shield size={28} /> Painel de Administração Geral
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Formulário: Criar Novo Usuário */}
              <section className="bg-white shadow-md border-t-8 border-purple-600 lg:col-span-1 h-fit">
                <div className="bg-purple-600 text-white px-6 py-4 font-bold uppercase tracking-widest">
                  Criar Novo Usuário
                </div>
                <form onSubmit={registrarNovoUsuario} className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold mb-1 uppercase">Nome Completo</label>
                    <input type="text" required className="w-full px-3 py-2 border-2 border-gray-300 focus:border-purple-600 outline-none" value={novoUserNome} onChange={e => setNovoUserNome(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1 uppercase">Prefixo E-mail (ou Completo)</label>
                    <input type="text" required className="w-full px-3 py-2 border-2 border-gray-300 focus:border-purple-600 outline-none" value={novoUserEmail} onChange={e => setNovoUserEmail(e.target.value)} placeholder="ex: joao.silva" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1 uppercase">Senha Inicial</label>
                    <input type="password" required className="w-full px-3 py-2 border-2 border-gray-300 focus:border-purple-600 outline-none" value={novoUserSenha} onChange={e => setNovoUserSenha(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1 uppercase">Cargo Inicial</label>
                    <select className="w-full px-3 py-2 border-2 border-gray-300 focus:border-purple-600 outline-none uppercase font-bold text-sm" value={novoUserCargo} onChange={e => setNovoUserCargo(e.target.value)}>
                      <option value="aluno">Aluno</option>
                      <option value="Teacher">Professor</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                  <button type="submit" disabled={isProcessing} className="w-full bg-purple-600 text-white font-bold uppercase py-3 border-b-4 border-purple-800 active:border-b-0 active:translate-y-1 mt-4">
                    {isProcessing ? "Cadastrando..." : "Cadastrar"}
                  </button>
                </form>
              </section>

              {/* Gerenciamento de Usuários com Busca e Exclusão */}
              <section className="bg-white shadow-md border-t-8 border-purple-600 lg:col-span-1 h-fit">
                <div className="bg-purple-600 text-white px-6 py-4 font-bold uppercase tracking-widest flex justify-between items-center">
                  <span>Cargos & Usuários</span>
                  <span className="text-xs bg-white text-purple-600 px-2 py-1 rounded font-black">{usuariosVisiveis.length}</span>
                </div>
                
                {/* BARRA DE BUSCA E AÇÕES EM MASSA */}
                <div className="p-4 border-b-2 border-gray-200 bg-gray-50 flex flex-col gap-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16}/>
                    <input type="text" placeholder="Buscar por nome ou email..." className="w-full pl-9 pr-3 py-2 border-2 border-gray-300 focus:border-purple-600 outline-none text-sm font-bold uppercase" value={buscaUsuarios} onChange={e => setBuscaUsuarios(e.target.value)} />
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold uppercase text-gray-600">
                      <input type="checkbox" className="w-4 h-4" checked={usuariosVisiveis.length > 0 && usuariosSelecionados.length === usuariosVisiveis.length} onChange={() => toggleSelecionarTodos(usuariosVisiveis)} />
                      Selecionar Todos
                    </label>
                    
                    {usuariosSelecionados.length > 0 && (
                      <button onClick={excluirUsuariosEmMassa} disabled={isProcessing} className="bg-red-600 text-white px-3 py-1 text-xs font-bold uppercase hover:bg-red-700 flex items-center gap-1 rounded shadow">
                        <Trash2 size={14}/> Excluir ({usuariosSelecionados.length})
                      </button>
                    )}
                  </div>
                </div>

                <ul className="divide-y divide-gray-200 max-h-[400px] overflow-y-auto">
                  {usuariosVisiveis.length === 0 ? <p className="p-4 text-center text-gray-400 font-bold text-sm uppercase">Nenhum usuário encontrado</p> : null}
                  {usuariosVisiveis.map((u) => (
                    <li key={u.user_id} className={`p-4 flex flex-col xl:flex-row justify-between items-start xl:items-center hover:bg-gray-50 gap-2 ${usuariosSelecionados.includes(u.user_id) ? 'bg-purple-50' : ''}`}>
                      <div className="flex items-center gap-3">
                        <input type="checkbox" className="w-4 h-4 cursor-pointer" checked={usuariosSelecionados.includes(u.user_id)} onChange={() => toggleUsuarioSelecionado(u.user_id)} disabled={u.user_id === currentUser.user_id}/>
                        <div>
                          <p className="font-bold text-[#2B2B2B] uppercase text-sm">{u.name}</p>
                          <p className="text-[10px] font-bold text-gray-400 uppercase">{u.email || "Sem e-mail"}</p>
                        </div>
                      </div>
                      <select 
                        className="px-2 py-1 border-2 border-gray-300 bg-white font-bold uppercase text-xs focus:border-purple-600 focus:outline-none w-full xl:w-auto"
                        value={u.acess_level}
                        onChange={(e) => alterarCargoUsuario(u.user_id, e.target.value)}
                        disabled={isProcessing || u.user_id === currentUser.user_id}
                      >
                        <option value="aluno">Aluno</option>
                        <option value="Teacher">Professor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Logs de Auditoria Restritos com Busca */}
              <section className="bg-white shadow-md border-t-8 border-[#2B2B2B] lg:col-span-1 h-fit">
                <div className="bg-[#2B2B2B] text-white px-6 py-4 font-bold uppercase tracking-widest flex justify-between items-center">
                  <span>Auditoria</span>
                  <span className="text-xs bg-white text-[#2B2B2B] px-2 py-1 rounded font-black">{auditoriaVisivel.length}</span>
                </div>

                <div className="p-4 border-b-2 border-gray-200 bg-gray-50">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16}/>
                    <input type="text" placeholder="Filtrar por professor..." className="w-full pl-9 pr-3 py-2 border-2 border-gray-300 focus:border-[#2B2B2B] outline-none text-sm font-bold uppercase" value={filtroAuditoria} onChange={e => setFiltroAuditoria(e.target.value)} />
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#F4F4F4] shadow-sm">
                      <tr className="border-b-2 border-[#2B2B2B] text-[#2B2B2B] uppercase text-xs">
                        <th className="p-4 font-bold">Hora</th>
                        <th className="p-4 font-bold">Professor / Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {auditoriaVisivel.length === 0 ? (
                        <tr><td colSpan={2} className="p-6 text-center text-gray-400 font-bold uppercase">Nenhum registro encontrado.</td></tr>
                      ) : (
                        auditoriaVisivel.map((log) => (
                          <tr key={log.id} className="hover:bg-gray-50">
                            <td className="p-4 font-mono text-xs font-bold text-gray-600 whitespace-nowrap align-top">{formatarHora(log.require_time)}</td>
                            <td className="p-4">
                              <p className="font-extrabold text-[#2B2B2B] uppercase text-xs">{log.name}</p>
                              <p className="text-[10px] font-bold text-purple-700 uppercase mt-1">{log.description}</p>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* =========================================================
            DASHBOARD DE TURMAS COM BUSCA
            ========================================================= */}
        {viewMode === "dashboard" && isPrivileged && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b-4 border-[#00579D] pb-4 mb-8 gap-4">
              <h2 className="text-2xl font-extrabold uppercase tracking-widest flex items-center gap-2">
                <LayoutGrid size={28} /> Painel de Turmas
              </h2>
              
              {/* Filtro de turmas */}
              <div className="relative w-full md:w-auto">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18}/>
                <input type="text" placeholder="Buscar turma..." className="w-full md:w-64 pl-10 pr-4 py-3 bg-white border-2 border-gray-300 focus:border-[#00579D] outline-none font-bold uppercase text-sm shadow-sm" value={buscaTurmas} onChange={e => setBuscaTurmas(e.target.value)} />
              </div>
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
              {turmasVisiveisList.map(turma => (
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
              {turmasVisiveisList.length === 0 && <p className="col-span-full text-center text-gray-500 font-bold uppercase py-10">Nenhuma turma encontrada.</p>}
            </div>
          </div>
        )}

        {/* =========================================================
            CONFIGURAÇÕES DA TURMA (GEAR)
            ========================================================= */}
        {viewMode === "settings" && turmaAtiva && isPrivileged && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
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

              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                
                <div className="col-span-1 md:col-span-2 bg-[#F4F4F4] p-6 border-2 border-gray-200">
                  <h3 className="font-bold uppercase tracking-wider mb-2 border-b-2 border-gray-300 pb-2 flex items-center gap-2"><ShieldAlert size={18}/> Tempo Limite Fora de Sala (Alerta)</h3>
                  <p className="text-xs text-gray-600 mb-4 font-bold uppercase">Define quantos minutos o aluno pode ficar fora antes de receber um alerta vermelho na fila.</p>
                  <div className="flex gap-4 items-center">
                    <input type="number" min="1" max="60" className="w-32 px-4 py-3 border-2 border-[#2B2B2B] font-bold text-lg text-center focus:outline-none focus:border-[#00579D]" value={turmaAtiva.time_limit_minutes || 15} onChange={(e) => setTurmaAtiva({...turmaAtiva, time_limit_minutes: Number(e.target.value)})} />
                    <button onClick={() => atualizarTempoLimite(turmaAtiva.time_limit_minutes)} disabled={isProcessing} className="bg-[#2B2B2B] text-white font-bold uppercase py-3 px-8 border-b-4 border-black active:border-b-0 active:translate-y-1 disabled:opacity-50">
                      Salvar Tempo
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-[#F4F4F4] p-6 border-2 border-gray-200">
                    <h3 className="font-bold uppercase tracking-wider mb-4 border-b-2 border-gray-300 pb-2">Vincular Aluno</h3>
                    <select className="w-full px-4 py-3 mb-4 border-2 border-[#2B2B2B] uppercase font-bold text-sm" value={alunoParaAdicionar} onChange={(e) => setAlunoParaAdicionar(e.target.value)}>
                      <option value="">-- SELECIONAR ALUNO --</option>
                      {alunosSemTurma.map(a => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
                    </select>
                    <button onClick={puxarAlunoParaTurma} disabled={!alunoParaAdicionar || isProcessing} className="w-full bg-[#00579D] text-white font-bold uppercase py-3 border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 disabled:opacity-50">Adicionar à Turma</button>
                  </div>
                  <div>
                    <h3 className="font-bold uppercase tracking-wider mb-2 border-b-2 border-gray-300 pb-2">Alunos Integrantes ({alunosNaTurmaAtual.length})</h3>
                    <ul className="divide-y divide-gray-200 border-2 border-gray-200 max-h-60 overflow-y-auto">
                      {alunosNaTurmaAtual.length === 0 ? <p className="p-4 text-gray-500 italic text-sm">Turma vazia</p> : 
                        alunosNaTurmaAtual.map(aluno => (
                          <li key={aluno.user_id} className="p-3 flex justify-between items-center hover:bg-gray-50">
                            <span className="font-bold text-sm uppercase text-[#2B2B2B]">{aluno.name}</span>
                            <button onClick={() => removerAlunoDaTurma(aluno.user_id)} className="text-gray-400 hover:text-red-600 p-2"><Trash2 size={16}/></button>
                          </li>
                        ))
                      }
                    </ul>
                  </div>
                </div>

                {isAdmin && (
                  <div className="space-y-6">
                    <div className="bg-[#F4F4F4] p-6 border-2 border-purple-600">
                      <h3 className="font-bold text-purple-700 uppercase tracking-wider mb-4 border-b-2 border-purple-300 pb-2">Vincular Professor</h3>
                      <select className="w-full px-4 py-3 mb-4 border-2 border-[#2B2B2B] uppercase font-bold text-sm" value={professorParaAdicionar} onChange={(e) => setProfessorParaAdicionar(e.target.value)}>
                        <option value="">-- SELECIONAR PROFESSOR --</option>
                        {todosProfessores.filter(p => !professoresNaTurmaAtual.some(pt => pt.user_id === p.user_id)).map(p => (
                          <option key={p.user_id} value={p.user_id}>{p.name}</option>
                        ))}
                      </select>
                      <button onClick={puxarProfessorParaTurma} disabled={!professorParaAdicionar || isProcessing} className="w-full bg-purple-600 text-white font-bold uppercase py-3 border-b-4 border-purple-800 active:border-b-0 active:translate-y-1 disabled:opacity-50">Conceder Acesso</button>
                    </div>
                    <div>
                      <h3 className="font-bold uppercase tracking-wider mb-2 border-b-2 border-gray-300 pb-2">Professores desta Turma ({professoresNaTurmaAtual.length})</h3>
                      <ul className="divide-y divide-gray-200 border-2 border-gray-200 max-h-60 overflow-y-auto">
                        {professoresNaTurmaAtual.length === 0 ? <p className="p-4 text-gray-500 italic text-sm">Nenhum professor vinculado</p> : 
                          professoresNaTurmaAtual.map(prof => (
                            <li key={prof.user_id} className="p-3 flex justify-between items-center hover:bg-purple-50">
                              <span className="font-bold text-sm uppercase text-purple-700">{prof.name}</span>
                              <button onClick={() => removerProfessorDaTurma(prof.user_id)} className="text-gray-400 hover:text-red-600 p-2"><Trash2 size={16}/></button>
                            </li>
                          ))
                        }
                      </ul>
                    </div>
                  </div>
                )}
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
                <button onClick={() => setIsStatsExpanded(!isStatsExpanded)} className="bg-[#00579D] text-white p-4 flex items-center justify-between w-full hover:bg-[#003E7E] transition-colors" title={isStatsExpanded ? "Fechar Resumo" : "Ver Resumo da Sala"}>
                  {isStatsExpanded ? <span className="font-bold uppercase tracking-widest text-sm flex items-center gap-2 whitespace-nowrap"><BarChart3 size={18} className="shrink-0"/> Resumo da Sala</span> : <BarChart3 size={24} className="mx-auto shrink-0"/>}
                  {isStatsExpanded && <XCircle size={18} className="shrink-0" />}
                </button>
                <div className={`transition-opacity duration-300 ${isStatsExpanded ? 'opacity-100 p-0' : 'opacity-0 h-0 overflow-hidden'}`}>
                  {rankingSala.length === 0 ? (
                    <p className="p-6 text-center text-sm font-bold text-gray-400 uppercase">Sem registros</p>
                  ) : (
                    <ul className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
                      <li className="bg-gray-100 px-4 py-2 flex justify-between items-center text-[10px] font-black uppercase text-gray-500 tracking-widest"><span>Aluno (Idas)</span><span className="text-right">Tempo Total / Média</span></li>
                      {rankingSala.map((estatistica, i) => (
                        <li key={i} className="p-4 flex justify-between items-center hover:bg-gray-50">
                          <div><p className="font-extrabold text-[#2B2B2B] uppercase text-sm">{estatistica.nome}</p><p className="text-xs font-bold text-[#00579D]">{estatistica.idas} {estatistica.idas === 1 ? 'ida' : 'idas'}</p></div>
                          <div className="text-right"><p className="text-sm font-bold text-gray-700">{estatistica.tempoTotal} min</p><p className="text-[10px] font-bold text-gray-400 uppercase">Média: {estatistica.mediaTempo} min</p></div>
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
                <h2 className="text-2xl font-extrabold uppercase tracking-widest flex items-center gap-2">
                  <ClipboardList size={28} /> Fila: {turmaAtiva.name}
                </h2>
                {isPrivileged && (
                  <button onClick={alternarPausa} disabled={isProcessing} className={`font-bold uppercase tracking-widest py-3 px-6 border-b-4 active:border-b-0 active:translate-y-1 transition-all flex items-center gap-2 text-white ${isPaused ? "bg-[#00579D] border-[#003865] hover:bg-[#003865]" : "bg-[#2B2B2B] border-black hover:bg-black"}`}>
                    {isPaused ? <PlayCircle size={20} /> : <PauseCircle size={20} />} {isPaused ? "Liberar Turma" : "Bloquear Turma"}
                  </button>
                )}
              </div>

              {isPrivileged && (
                <div className="bg-white p-4 border-2 border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 items-end">
                   <div className="flex-1 w-full">
                    <label className="block text-xs font-bold mb-2 uppercase text-gray-600">Inserir aluno manualmente na fila</label>
                    <select className="w-full px-4 py-2 bg-[#F4F4F4] border-2 border-gray-300 font-bold uppercase text-sm" value={alunoSelecionadoFila} onChange={(e) => setAlunoSelecionadoFila(e.target.value)}>
                      <option value="">-- SELECIONAR ALUNO --</option>
                      {alunosNaTurmaAtual.filter(a => !logsDaTurmaAtiva.some(log => log.user_id === a.user_id)).map(a => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
                    </select>
                  </div>
                  <button onClick={adicionarAlunoManualmenteFila} disabled={!alunoSelecionadoFila || isProcessing} className="bg-[#2B2B2B] text-white font-bold uppercase py-2 px-6 border-b-4 border-black active:border-b-0 active:translate-y-1 w-full md:w-auto">
                    Inserir na Fila
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                
                {/* LADO ESQUERDO: SEU ACESSO */}
                <div className="h-full">
                  <section className="bg-white shadow-xl border-t-8 border-[#00579D] p-8 flex flex-col items-center justify-center text-center h-full min-h-[300px]">
                    <h2 className="text-xl font-extrabold text-[#00579D] uppercase mb-6">Seu Acesso</h2>
                    {isPaused ? (
                      <div className="text-[#2B2B2B] font-bold p-4 bg-gray-100 border-2 border-[#2B2B2B] flex items-center gap-2 uppercase w-full justify-center"><ShieldAlert size={20} /> Bloqueado</div>
                    ) : !meuPedido ? (
                      <button onClick={requisitar} disabled={isProcessing} className="bg-[#00579D] text-white font-bold uppercase py-5 px-10 hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 flex items-center justify-center gap-2 w-full text-lg"><UserPlus size={24} /> Requisitar</button>
                    ) : meuPedido.status === "pedido" ? (
                      souOPrimeiro && acessoLivreParaAluno ? (
                         <div className="w-full space-y-4">
                          <p className="text-[#00579D] font-bold uppercase text-xl mb-2">Sua vez!</p>
                          <button onClick={() => registrarSaida(meuPedido)} className="w-full bg-[#00579D] text-white font-bold uppercase py-5 border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 flex justify-center items-center gap-2 text-lg"><DoorOpen size={24}/> Confirmar Saída</button>
                          <button onClick={() => cancelarPedido(meuPedido)} className="w-full bg-white text-red-600 font-bold uppercase py-3 border-2 border-red-600 hover:bg-red-50 text-sm">Cancelar Pedido</button>
                        </div>
                      ) : (
                        <div className="w-full space-y-4">
                          <p className="text-[#2B2B2B] font-bold uppercase border-2 border-[#2B2B2B] p-5 text-lg">Aguardando...</p>
                          <button onClick={() => cancelarPedido(meuPedido)} className="w-full bg-white text-red-600 font-bold uppercase py-3 border-2 border-red-600 hover:bg-red-50 text-sm">Desistir da Fila</button>
                        </div>
                      )
                    ) : meuPedido.status === "saida" ? (
                      <div className="w-full space-y-5">
                        <p className="text-[#00579D] font-bold uppercase text-xl">Você está fora.</p>
                        <button onClick={() => registrarChegada(meuPedido)} className="w-full bg-[#2B2B2B] text-white font-bold uppercase py-5 border-b-4 border-black active:border-b-0 active:translate-y-1 flex justify-center items-center gap-2 text-lg"><CheckCircle2 size={24}/> Confirmar Retorno</button>
                      </div>
                    ) : null}
                  </section>
                </div>

                {/* LADO DIREITO: FORA DE SALA + FILA */}
                <div className="space-y-6">
                  {/* FORA DE SALA */}
                  <section className="bg-white border-2 border-[#00579D] shadow-md">
                    <div className="bg-[#00579D] text-white px-4 py-3 font-bold uppercase flex justify-between">
                      <span>Fora de Sala ({noBanheiroList.length})</span><DoorOpen size={18} />
                    </div>
                    <ul className="divide-y divide-gray-200 max-h-48 overflow-y-auto">
                      {noBanheiroList.length === 0 ? <p className="p-6 text-center text-gray-500 font-medium italic uppercase text-sm">Ninguém fora da sala</p> : 
                        noBanheiroList.map(alunoFora => {
                          const tempoMinutos = Math.floor((Date.now() - new Date(alunoFora.go_time!).getTime()) / 60000);
                          const tempoExcedido = tempoMinutos >= (turmaAtiva.time_limit_minutes || 15);
                          
                          return (
                            <li key={alunoFora.id} className={`p-4 flex justify-between items-center ${tempoExcedido ? 'bg-red-50 border-l-4 border-red-600' : 'hover:bg-gray-50'}`}>
                              <div>
                                <p className={`font-extrabold text-lg uppercase ${tempoExcedido ? 'text-red-700' : 'text-[#00579D]'}`}>{alunoFora.name}</p>
                                <p className="text-xs font-bold text-gray-500 uppercase mt-1">Saída: {formatarHora(alunoFora.go_time)}</p>
                                {tempoExcedido && <p className="text-xs font-bold text-red-600 uppercase mt-1 flex items-center gap-1 animate-pulse"><ShieldAlert size={14}/> Excedeu {tempoMinutos} min</p>}
                              </div>
                              {isPrivileged && (
                                <div className="flex gap-2">
                                  <button onClick={() => forcarRetornoAluno(alunoFora)} className="p-3 bg-green-600 text-white hover:bg-green-700 transition-colors rounded-sm" title="Forçar Retorno"><CheckCircle2 size={18}/></button>
                                  <button onClick={() => cancelarPedido(alunoFora)} className="p-3 bg-red-600 text-white hover:bg-red-700 transition-colors rounded-sm" title="Excluir Registro"><Trash2 size={18}/></button>
                                </div>
                              )}
                            </li>
                          )
                        })
                      }
                    </ul>
                  </section>

                  {/* FILA DE ESPERA */}
                  <section className="bg-white border-2 border-[#2B2B2B]">
                    <div className="bg-[#2B2B2B] text-white px-4 py-3 font-bold uppercase flex justify-between"><span>Fila ({filaEsperaOrdenada.length})</span><ClipboardList size={18} /></div>
                    <ul className="divide-y divide-gray-200 max-h-60 overflow-y-auto">
                      {filaEsperaOrdenada.length === 0 ? <p className="text-center text-gray-500 font-medium italic uppercase text-sm p-6">Fila vazia</p> : 
                        filaEsperaOrdenada.map((aluno, i) => (
                          <li key={aluno.id} className="p-4 flex flex-wrap gap-2 justify-between items-center hover:bg-gray-50">
                            <div className="flex items-center gap-4">
                              <span className="text-[#00579D] font-black text-xl w-6">{i + 1}º</span>
                              <div>
                                <p className="font-bold text-[#2B2B2B] uppercase">{aluno.name}</p>
                                <p className="text-xs font-bold text-gray-500 uppercase">Req: {formatarHora(aluno.require_time)}</p>
                              </div>
                            </div>
                            {isPrivileged && (
                              <div className="flex gap-2 items-center">
                                <div className="flex flex-col gap-1 mr-2">
                                  <button onClick={() => moverPosicao(i, "up")} disabled={i === 0 || isProcessing} className="p-1 bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-30"><ArrowUp size={14}/></button>
                                  <button onClick={() => moverPosicao(i, "down")} disabled={i === filaEsperaOrdenada.length - 1 || isProcessing} className="p-1 bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-30"><ArrowDown size={14}/></button>
                                </div>
                                <button onClick={() => forcarSaidaAluno(aluno)} className="p-2 bg-green-600 text-white hover:bg-green-700" title="Forçar Saída Imediata (Liberar)"><DoorOpen size={16}/></button>
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

              {/* ABAIXO DE TUDO: HISTÓRICO DA TURMA (AGORA EM ACORDEÃO RETRÁTIL COM BUSCA) */}
              {isPrivileged && historicoDaTurma.length > 0 && (
                <section className="bg-white shadow-md border-t-8 border-[#2B2B2B] mt-8 w-full">
                  <button 
                    onClick={() => setIsHistoricoOpen(!isHistoricoOpen)} 
                    className="w-full bg-[#2B2B2B] text-white px-6 py-4 font-bold uppercase tracking-widest flex justify-between items-center hover:bg-black transition-colors"
                  >
                    <span>Histórico de Saídas da Sala ({historicoVisivel.length})</span>
                    {isHistoricoOpen ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}
                  </button>
                  
                  {isHistoricoOpen && (
                    <div className="bg-white border-x-2 border-b-2 border-[#2B2B2B]">
                      
                      {/* FILTRO DE HISTÓRICO */}
                      <div className="p-4 border-b-2 border-gray-200 bg-gray-50">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16}/>
                          <input type="text" placeholder="Buscar aluno no histórico..." className="w-full pl-9 pr-3 py-2 border-2 border-gray-300 focus:border-[#2B2B2B] outline-none text-sm font-bold uppercase" value={filtroHistorico} onChange={e => setFiltroHistorico(e.target.value)} />
                        </div>
                      </div>

                      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="sticky top-0 bg-[#F4F4F4] shadow-sm">
                            <tr className="border-b-2 border-[#2B2B2B] text-[#2B2B2B] uppercase text-xs">
                              <th className="p-4 font-bold">Hora</th><th className="p-4 font-bold">Aluno</th><th className="p-4 font-bold">Status</th><th className="p-4 font-bold hidden sm:table-cell">Tempo Fora</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {historicoVisivel.length === 0 ? (
                              <tr><td colSpan={4} className="p-6 text-center text-gray-400 font-bold uppercase">Nenhum registro encontrado.</td></tr>
                            ) : (
                              historicoVisivel.map((log) => {
                                const badge = getStatusDisplay(log.status);
                                return (
                                  <tr key={log.id} className="hover:bg-gray-50">
                                    <td className="p-4 font-mono text-sm font-bold text-gray-600">{formatarHora(getEventTime(log))}</td>
                                    <td className="p-4 font-extrabold text-[#2B2B2B] uppercase">{log.name}</td>
                                    <td className="p-4"><span className={`px-3 py-1 font-bold text-[10px] uppercase tracking-wider ${badge.cor}`}>{badge.texto}</span></td>
                                    <td className="p-4 text-xs font-bold text-gray-500 hidden sm:table-cell uppercase">{renderDetalhes(log)}</td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
              )}

            </div>
          </div>
        )}

      </div>
    </main>
  );
}