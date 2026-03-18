"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import {
  UserPlus, CheckCircle2, LogOut,
  DoorOpen, PauseCircle, PlayCircle, Trash2, ShieldAlert,
  ClipboardList, XCircle, BookOpen, Users, Plus, Settings, LayoutGrid, BarChart3, Shield,
  ArrowUp, ArrowDown, ChevronDown, ChevronUp, Search, Timer
} from "lucide-react";
import { useRouter } from "next/navigation";

type LogPedido = {
  id: string; user_id: string; name: string; status: string;
  require_time: string; go_time: string | null; back_time: string | null;
  description: string | null; users?: { acess_level: string };
};
type UserDB = { user_id: string; name: string; acess_level: string; email?: string; fives_count?: number; last_login?: string; };
type Classroom = { id: string; name: string; time_limit_minutes: number; cooldown_minutes?: number; student_count?: number; qtd_5s?: number; };
type ClassroomTeacherDB = { user_id: string; classroom_id: string; };

export default function Home() {
  const [todosLogsAtivos, setTodosLogsAtivos] = useState<LogPedido[]>([]);
  const [historicoCompleto, setHistoricoCompleto] = useState<LogPedido[]>([]);
  const [currentUser, setCurrentUser] = useState<UserDB | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ultimoRetornoDoAluno, setUltimoRetornoDoAluno] = useState<LogPedido | null>(null);
  // Segundos restantes do cooldown — atualizado a cada 1s localmente, sem bater no banco
  const [cooldownSecondsLeft, setCooldownSecondsLeft] = useState(0);

  const processingRef = useRef(false);
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [is5sOpen, setIs5sOpen] = useState(false);
  const [alunosPulados, setAlunosPulados] = useState<string[]>([]);
  const [mostrarHistorico5S, setMostrarHistorico5S] = useState(false);
  const [isHistoricoOpen, setIsHistoricoOpen] = useState(false);
  const [abaHistorico, setAbaHistorico] = useState<"lista" | "relatorio">("lista");
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);
  const [buscaTurmas, setBuscaTurmas] = useState("");
  const [buscaUsuarios, setBuscaUsuarios] = useState("");
  const [usuariosSelecionados, setUsuariosSelecionados] = useState<string[]>([]);
  const [filtroAuditoria, setFiltroAuditoria] = useState("");
  const [filtroHistorico, setFiltroHistorico] = useState("");

  const isOptimistic = (id: string) => id.startsWith('otimista-');

  const isPrivileged = currentUser?.acess_level === "Teacher" || currentUser?.acess_level === "admin";
  const isAdmin = currentUser?.acess_level === "admin";

  // Fire-and-forget: logs de auditoria não bloqueiam a UI
  const registrarAuditoria = useCallback((acao: string) => {
    if (!currentUser || currentUser.acess_level === "aluno") return;
    supabase.from("logs").insert([{ user_id: currentUser.user_id, name: currentUser.name, status: "auditoria", description: acao }]).then(() => {});
  }, [currentUser]);

  const criarLogAuditoria = useCallback((acao: string) => {
    if (!currentUser) return;
    supabase.from("logs").insert([{ user_id: currentUser.user_id, name: currentUser.name, status: "auditoria", description: acao }]).then(() => {});
  }, [currentUser]);

  const limparLogsAntigos = useCallback(async () => {
    const d = new Date(); d.setDate(d.getDate() - 10);
    try { await supabase.from("logs").delete().lt("require_time", d.toISOString()); } catch (e) { console.error(e); }
  }, []);

  // Declarada ANTES do useEffect que a usa — evita "used before declaration"
  const limparUsuariosInativos = useCallback(async () => {
    const CHAVE = "ultima_limpeza_usuarios";
    const ultima = localStorage.getItem(CHAVE);
    const agora = new Date();
    if (ultima && agora.getTime() - new Date(ultima).getTime() < 24 * 60 * 60 * 1000) return;

    const limite = new Date();
    limite.setDate(limite.getDate() - 30);

    // 1) Alunos inativos há +30 dias
    // Tipo explícito apenas com os campos selecionados — evita erro ts(2345)
    const { data: inativos } = await supabase
      .from("users")
      .select("user_id, name")
      .in("acess_level", ["aluno", "Student"])
      .lt("last_login", limite.toISOString());

    if (inativos && inativos.length > 0) {
      const ids = (inativos as { user_id: string; name: string }[]).map(u => u.user_id);
      await Promise.all([
        supabase.from("user_classrooms").delete().in("user_id", ids),
        supabase.from("logs").delete().in("user_id", ids),
        supabase.from("users").delete().in("user_id", ids),
      ]);
      console.info(`[Limpeza automática] ${ids.length} aluno(s) inativo(s) removido(s).`);
    }

    // 2) Órfãos em user_classrooms
    const { data: todosVinculos } = await supabase.from("user_classrooms").select("user_id");
    if (todosVinculos && todosVinculos.length > 0) {
      const idsVinculados = [...new Set((todosVinculos as { user_id: string }[]).map(v => v.user_id))];
      const { data: existentes } = await supabase.from("users").select("user_id").in("user_id", idsVinculados);
      const existentesSet = new Set((existentes || []).map((u: { user_id: string }) => u.user_id));
      const orfaos = idsVinculados.filter(id => !existentesSet.has(id));
      if (orfaos.length > 0) {
        await supabase.from("user_classrooms").delete().in("user_id", orfaos);
        console.info(`[Limpeza automática] ${orfaos.length} vínculo(s) órfão(s) removido(s).`);
      }
    }

    localStorage.setItem(CHAVE, agora.toISOString());
  }, []);

  // useEffect depois das duas funções que referencia
  useEffect(() => {
    if (currentUser?.acess_level === "admin") {
      limparLogsAntigos();
      limparUsuariosInativos();
    }
  }, [currentUser, limparLogsAntigos, limparUsuariosInativos]);



  const carregarDados = useCallback(async (usuario: UserDB | null) => {
    if (!usuario) return;
    const ehPrivilegiado = usuario.acess_level === "admin" || usuario.acess_level === "Teacher";

    if (!ehPrivilegiado) {
      // ── ALUNOS: query mínima — só logs ativos, sem join, sem histórico ──
      // São a maioria dos usuários. Payload ~90% menor que a versão completa.
      const { data: ativos } = await supabase
        .from("logs")
        .select("id, user_id, name, status, require_time, go_time, back_time, description")
        .in("status", ["pedido", "saida", "pausado"]);

      const logsAtivos = (ativos || []) as LogPedido[];
      setTodosLogsAtivos(logsAtivos.reverse());

      // Cooldown: busca último retorno do próprio aluno (só 1 linha)
      const { data: ultimoRetorno } = await supabase
        .from("logs")
        .select("id, user_id, name, status, require_time, go_time, back_time, description")
        .eq("user_id", usuario.user_id)
        .eq("status", "concluido")
        .order("back_time", { ascending: false })
        .limit(1)
        .maybeSingle();

      setUltimoRetornoDoAluno(ultimoRetorno as LogPedido | null);
      setHistoricoCompleto([]);
      return;
    }

    // ── PROFESSORES / ADMIN: versão completa com histórico ──
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const [{ data: ativos }, { data: historico }] = await Promise.all([
      supabase.from("logs")
        .select("id, user_id, name, status, require_time, go_time, back_time, description, users(acess_level)")
        .in("status", ["pedido", "saida", "pausado"]),
      supabase.from("logs")
        .select("id, user_id, name, status, require_time, go_time, back_time, description, users(acess_level)")
        .gte("require_time", hoje.toISOString())
        .not("status", "in", "(pedido,saida,pausado,auditoria)")
        .order("require_time", { ascending: false })
        .limit(300),
    ]);
    const data = [...(ativos || []), ...(historico || [])];
    const logsData = data as unknown as LogPedido[];
    setTodosLogsAtivos(logsData.filter(p => ["pedido", "saida", "pausado"].includes(p.status)).reverse());
    const meuUltimoRetorno = logsData
      .filter(l => l.user_id === usuario.user_id && l.status === "concluido" && l.back_time)
      .sort((a, b) => new Date(b.back_time!).getTime() - new Date(a.back_time!).getTime())[0] ?? null;
    setUltimoRetornoDoAluno(meuUltimoRetorno);
    const getActionTime = (log: LogPedido) => {
      if (log.status.includes("saida")) return new Date(log.go_time || log.require_time).getTime();
      if (log.status === "concluido") return new Date(log.back_time || log.require_time).getTime();
      return new Date(log.require_time).getTime();
    };
    const sorted = [...logsData].sort((a, b) => getActionTime(b) - getActionTime(a));
    if (usuario.acess_level === "admin") setHistoricoCompleto(sorted.filter(l => l.status !== "auditoria"));
    else setHistoricoCompleto(sorted.filter(l => l.status !== "auditoria" && (l.users?.acess_level === "aluno" || l.users?.acess_level === "Student")));
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    // Canal ÚNICO por usuário — reduz conexões à metade (crítico no free tier: limite 200)
    const channel = supabase.channel(`rt_user_${currentUser.user_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "logs" }, () => {
        if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
        realtimeDebounceRef.current = setTimeout(() => carregarDados(currentUser), 200);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "classrooms" }, (payload) => {
        setTurmaAtiva(prev => prev && prev.id === payload.new.id
          ? { ...prev, qtd_5s: payload.new.qtd_5s, cooldown_minutes: payload.new.cooldown_minutes, time_limit_minutes: payload.new.time_limit_minutes }
          : prev
        );
      })
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [currentUser, carregarDados]);

  const carregarDashboard = useCallback(async (usuario: UserDB | null = null) => {
    const usr = usuario ?? currentUser;
    if (!usr) return;
    const { data: turmasData } = await supabase.from("classrooms").select("*").order("created_at", { ascending: true });
    const { data: vinculosProfessores } = await supabase.from("classroom_teachers").select("user_id, classroom_id");
    // Conta direto do user_classrooms — só alunos ficam nessa tabela (professores usam classroom_teachers)
    // Só classroom_id — coluna mínima para contagem
    const { data: vinculos } = await supabase.from("user_classrooms").select("classroom_id", { count: "exact", head: false });
    if (!turmasData) return;
    let turmasVisiveis = turmasData;
    if (usr.acess_level === "Teacher") {
      const minhasSalasIds = vinculosProfessores?.filter((vp: ClassroomTeacherDB) => vp.user_id === usr.user_id).map((vp: ClassroomTeacherDB) => vp.classroom_id) ?? [];
      turmasVisiveis = turmasData.filter(t => minhasSalasIds.includes(t.id));
    }
    setTurmas(turmasVisiveis.map(t => ({ ...t, student_count: vinculos ? vinculos.filter((v: any) => v.classroom_id === t.id).length : 0 })));
  }, [currentUser]);

  const verificarLogin = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.push("/login");
    const { data: usuarioDB } = await supabase.from("users").select("user_id, name, acess_level, email, fives_count").eq("user_id", session.user.id).single();
    if (usuarioDB) {
      setCurrentUser(usuarioDB as UserDB);
      carregarDados(usuarioDB as UserDB);
      // Registra o último login para controle de inatividade
      supabase.from("users").update({ last_login: new Date().toISOString() }).eq("user_id", session.user.id).then(() => {});
      if (usuarioDB.acess_level === "admin" || usuarioDB.acess_level === "Teacher") {
        await carregarDashboard(usuarioDB as UserDB); setViewMode("dashboard");
      } else {
        const { data: vinculo } = await supabase.from("user_classrooms").select("classroom_id").eq("user_id", usuarioDB.user_id).maybeSingle();
        if (vinculo) {
          // Turma e membros em paralelo — corta latência de login do aluno pela metade
          const [{ data: turma }, { data: membros }] = await Promise.all([
            supabase.from("classrooms").select("*").eq("id", vinculo.classroom_id).single(),
            supabase.from("user_classrooms").select("user_id").eq("classroom_id", vinculo.classroom_id),
          ]);
          if (membros && membros.length > 0) {
            const { data: alunosData } = await supabase.from("users").select("user_id, name, acess_level, fives_count").in("user_id", membros.map(m => m.user_id));
            setAlunosNaTurmaAtual(alunosData || []);
          }
          setTurmaAtiva(turma); setViewMode("queue");
        } else { setViewMode("no_class"); }
      }
    } else { fazerLogout(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { verificarLogin(); }, [verificarLogin]);

  const abrirConfiguracoes = async (turma: Classroom) => {
    setTurmaAtiva(turma); setIsProcessing(true);
    try {
      const [{ data: todosAlunos }, { data: listaTodosProfs }, { data: vinculosAlunos }, { data: vinculosProfs }] = await Promise.all([
        supabase.from("users").select("user_id, name, acess_level").in("acess_level", ["aluno", "Student"]),
        supabase.from("users").select("user_id, name, acess_level, email").eq("acess_level", "Teacher"),
        supabase.from("user_classrooms").select("user_id, classroom_id"),
        supabase.from("classroom_teachers").select("user_id").eq("classroom_id", turma.id),
      ]);
      if (todosAlunos && vinculosAlunos) {
        const vinculadosIds = vinculosAlunos.map(v => v.user_id);
        const destaTurmaIds = vinculosAlunos.filter(v => v.classroom_id === turma.id).map(v => v.user_id);
        setAlunosSemTurma(todosAlunos.filter((a: UserDB) => !vinculadosIds.includes(a.user_id)));
        setAlunosNaTurmaAtual(todosAlunos.filter((a: UserDB) => destaTurmaIds.includes(a.user_id)));
      }
      if (listaTodosProfs && vinculosProfs) {
        setTodosProfessores(listaTodosProfs);
        const profsIds = vinculosProfs.map((v: any) => v.user_id);
        setProfessoresNaTurmaAtual(listaTodosProfs.filter((p: UserDB) => profsIds.includes(p.user_id)));
      }
      setViewMode("settings");
    } finally { setIsProcessing(false); }
  };

  const abrirFila = async (turma: Classroom) => {
    setTurmaAtiva(turma); setIsProcessing(true); setFiltroHistorico("");
    try {
      const { data: vinculos } = await supabase.from("user_classrooms").select("user_id").eq("classroom_id", turma.id);
      if (vinculos && vinculos.length > 0) {
        const { data: alunosData } = await supabase.from("users").select("user_id, name, acess_level, fives_count").in("user_id", vinculos.map(v => v.user_id));
        setAlunosNaTurmaAtual(alunosData || []);
      } else setAlunosNaTurmaAtual([]);
      setViewMode("queue");
    } finally { setIsProcessing(false); }
  };

  const criarTurma = async () => {
    if (!novaTurmaNome.trim() || isProcessing) return; setIsProcessing(true);
    try { await supabase.from("classrooms").insert([{ name: novaTurmaNome.trim() }]); setNovaTurmaNome(""); await carregarDashboard(); } finally { setIsProcessing(false); }
  };

  const puxarAlunoParaTurma = async () => {
    if (!alunoParaAdicionar || !turmaAtiva || isProcessing) return; setIsProcessing(true);
    try { await supabase.from("user_classrooms").insert([{ classroom_id: turmaAtiva.id, user_id: alunoParaAdicionar }]); await abrirConfiguracoes(turmaAtiva); setAlunoParaAdicionar(""); } finally { setIsProcessing(false); }
  };

  const removerAlunoDaTurma = async (userId: string) => {
    if (!turmaAtiva || isProcessing) return; setIsProcessing(true);
    try { await supabase.from("user_classrooms").delete().eq("user_id", userId); await abrirConfiguracoes(turmaAtiva); } finally { setIsProcessing(false); }
  };

  const puxarProfessorParaTurma = async () => {
    if (!professorParaAdicionar || !turmaAtiva || isProcessing) return; setIsProcessing(true);
    try { await supabase.from("classroom_teachers").insert([{ classroom_id: turmaAtiva.id, user_id: professorParaAdicionar }]); await abrirConfiguracoes(turmaAtiva); setProfessorParaAdicionar(""); } finally { setIsProcessing(false); }
  };

  const removerProfessorDaTurma = async (userId: string) => {
    if (!turmaAtiva || isProcessing) return; setIsProcessing(true);
    try { await supabase.from("classroom_teachers").delete().match({ classroom_id: turmaAtiva.id, user_id: userId }); await abrirConfiguracoes(turmaAtiva); } finally { setIsProcessing(false); }
  };

  const atualizarTempoLimite = async (minutos: number) => {
    if (!turmaAtiva) return;
    await supabase.from("classrooms").update({ time_limit_minutes: minutos }).eq("id", turmaAtiva.id);
    setTurmaAtiva({ ...turmaAtiva, time_limit_minutes: minutos });
  };

  const atualizarCooldown = async (minutos: number) => {
    if (!turmaAtiva) return;
    await supabase.from("classrooms").update({ cooldown_minutes: minutos }).eq("id", turmaAtiva.id);
    setTurmaAtiva({ ...turmaAtiva, cooldown_minutes: minutos });
    registrarAuditoria(`Alterou o cooldown de requisição para ${minutos} min [TURMA:${turmaAtiva.name}]`);
  };

  const excluirTurma = async (id: string) => {
    if (!confirm("Tem certeza?") || isProcessing) return; setIsProcessing(true);
    try { await supabase.from("classrooms").delete().eq("id", id); await carregarDashboard(); } finally { setIsProcessing(false); }
  };

  const carregarPainelAdmin = async () => {
    setIsProcessing(true);
    try {
      const [{ data: usuariosData }, { data: auditoriaData }] = await Promise.all([
        supabase.from("users").select("user_id, name, acess_level, email").order("name"),
        supabase.from("logs").select("id, user_id, name, status, require_time, description").eq("status", "auditoria").order("require_time", { ascending: false }).limit(200),
      ]);
      if (usuariosData) setTodosUsuarios(usuariosData);
      if (auditoriaData) setLogsAuditoria(auditoriaData as LogPedido[]);
      setUsuariosSelecionados([]); setViewMode("admin_panel");
    } finally { setIsProcessing(false); }
  };

  const alterarCargoUsuario = async (userId: string, novoCargo: string) => {
    if (!confirm(`Alterar cargo para ${novoCargo}?`) || isProcessing) return; setIsProcessing(true);
    try { await supabase.from("users").update({ acess_level: novoCargo }).eq("user_id", userId); await carregarPainelAdmin(); } finally { setIsProcessing(false); }
  };

  const excluirUsuariosEmMassa = async () => {
    if (usuariosSelecionados.length === 0 || isProcessing) return;
    if (!confirm(`Excluir ${usuariosSelecionados.length} usuário(s)?`)) return;
    setIsProcessing(true);
    try { await supabase.from("users").delete().in("user_id", usuariosSelecionados); setUsuariosSelecionados([]); await carregarPainelAdmin(); }
    catch (err: any) { alert("Erro: " + err.message); } finally { setIsProcessing(false); }
  };

  const registrarNovoUsuario = async (e: React.FormEvent) => {
    e.preventDefault(); if (isProcessing) return; setIsProcessing(true);
    try {
      const DOMINIO = "@estudante.sesisenai.org.br";
      const emailCompleto = novoUserEmail.includes("@") ? novoUserEmail : novoUserEmail.trim().toLowerCase() + DOMINIO;
      const tempSupa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await tempSupa.auth.signUp({ email: emailCompleto, password: novoUserSenha, options: { data: { name: novoUserNome } } });
      if (error) throw error;
      if (data.user && novoUserCargo !== "aluno") await supabase.from("users").update({ acess_level: novoUserCargo }).eq("user_id", data.user.id);
      alert("Usuário criado!"); setNovoUserNome(""); setNovoUserEmail(""); setNovoUserSenha("");
      await carregarPainelAdmin();
    } catch (err: any) { alert("Erro: " + err.message); } finally { setIsProcessing(false); }
  };

  const toggleUsuarioSelecionado = (userId: string) => setUsuariosSelecionados(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  const toggleSelecionarTodos = (lista: UserDB[]) => { if (usuariosSelecionados.length === lista.length && lista.length > 0) setUsuariosSelecionados([]); else setUsuariosSelecionados(lista.map(u => u.user_id)); };

  // Derivados da fila (memoizados)
  const logsDaTurmaAtiva = useMemo(() => todosLogsAtivos.filter(log =>
    (log.status === "pausado" && log.description?.includes(`[TURMA:${turmaAtiva?.id}]`)) ||
    alunosNaTurmaAtual.some(a => a.user_id === log.user_id) ||
    (log.user_id === currentUser?.user_id && log.status !== "pausado")
  ), [todosLogsAtivos, turmaAtiva, alunosNaTurmaAtual, currentUser]);

  const historicoDaTurma = useMemo(() => historicoCompleto.filter(log =>
    (log.status === "pausado" && log.description?.includes(`[TURMA:${turmaAtiva?.id}]`)) ||
    alunosNaTurmaAtual.some(a => a.user_id === log.user_id)
  ), [historicoCompleto, turmaAtiva, alunosNaTurmaAtual]);

  const getEffectiveTime = (log: LogPedido) => { const m = log.description?.match(/\[OVERRIDE:(.*?)\]/); return m ? m[1] : log.require_time; };

  const filaEsperaOrdenada = useMemo(() =>
    logsDaTurmaAtiva.filter(p => p.status === "pedido").sort((a, b) => new Date(getEffectiveTime(a)).getTime() - new Date(getEffectiveTime(b)).getTime()),
    [logsDaTurmaAtiva]);

  const noBanheiroList = useMemo(() => logsDaTurmaAtiva.filter(p => p.status === "saida"), [logsDaTurmaAtiva]);
  const isPaused = useMemo(() => logsDaTurmaAtiva.some(p => p.status === "pausado"), [logsDaTurmaAtiva]);
  const meuPedido = useMemo(() => logsDaTurmaAtiva.find(p => p.user_id === currentUser?.user_id && ["pedido", "saida"].includes(p.status)), [logsDaTurmaAtiva, currentUser]);
  const souOPrimeiro = filaEsperaOrdenada.length > 0 && filaEsperaOrdenada[0].user_id === currentUser?.user_id;
  const acessoLivreParaAluno = noBanheiroList.length === 0;

  // Calcula segundos totais restantes e inicializa o estado
  useEffect(() => {
    const cm = turmaAtiva?.cooldown_minutes || 0;
    if (cm <= 0 || !ultimoRetornoDoAluno?.back_time) {
      setCooldownSecondsLeft(0);
      return;
    }
    const calcRestante = () => Math.max(0, Math.ceil(
      (new Date(ultimoRetornoDoAluno.back_time!).getTime() + cm * 60000 - Date.now()) / 1000
    ));
    const inicial = calcRestante();
    setCooldownSecondsLeft(inicial);
    if (inicial <= 0) return;

    // Intervalo de 1s — só corre quando há cooldown ativo, se auto-cancela ao zerar
    const timer = setInterval(() => {
      const restante = calcRestante();
      setCooldownSecondsLeft(restante);
      if (restante <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [turmaAtiva?.cooldown_minutes, ultimoRetornoDoAluno]);

  // Derivado síncrono do estado — sem useMemo necessário
  const cooldownInfo = {
    emCooldown: cooldownSecondsLeft > 0,
    minutos: Math.floor(cooldownSecondsLeft / 60),
    segundosRestantes: cooldownSecondsLeft % 60,
  };

  // Ações da fila
  const alternarPausa = async () => {
    if (processingRef.current || !currentUser || !turmaAtiva) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      if (isPaused) {
        const pl = logsDaTurmaAtiva.find(p => p.status === "pausado");
        if (pl) {
          // Optimistic: remove o log de pausa localmente
          setTodosLogsAtivos(prev => prev.filter(l => l.id !== pl.id));
          await Promise.all([
            supabase.from("logs").update({ status: "concluido" }).eq("id", pl.id),
            supabase.from("logs").insert([{ user_id: currentUser.user_id, name: currentUser.name, status: "auditoria", description: `Liberou a fila da sala ${turmaAtiva.name}` }]),
          ]);
        }
      } else {
        // Optimistic: adiciona log de pausa localmente
        const pausaOtimista: LogPedido = {
          id: `otimista-pausa-${Date.now()}`,
          user_id: currentUser.user_id,
          name: "SISTEMA",
          status: "pausado",
          require_time: new Date().toISOString(),
          go_time: null, back_time: null,
          description: `Fila pausada por ${currentUser.name} [TURMA:${turmaAtiva.id}]`,
        };
        setTodosLogsAtivos(prev => [pausaOtimista, ...prev]);
        const [{ data: pausaReal }] = await Promise.all([
          supabase.from("logs").insert([{ user_id: currentUser.user_id, name: "SISTEMA", status: "pausado", description: `Fila pausada por ${currentUser.name} [TURMA:${turmaAtiva.id}]` }]).select("id").single(),
          supabase.from("logs").insert([{ user_id: currentUser.user_id, name: currentUser.name, status: "auditoria", description: `Bloqueou a fila da sala ${turmaAtiva.name}` }]),
        ]);
        // Substitui o ID otimista da pausa pelo ID real
        if (pausaReal?.id) {
          setTodosLogsAtivos(prev => prev.map(l =>
            l.id === pausaOtimista.id ? { ...l, id: pausaReal.id } : l
          ));
        }
      }
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  // Aluno pode entrar na fila mesmo com fila bloqueada.
  // Proteção em 3 camadas contra spam:
  //  1. processingRef bloqueia cliques enquanto a função está rodando
  //  2. Optimistic update seta meuPedido na UI imediatamente (fecha janela de ~200ms)
  //  3. SELECT no banco confirma que não existe pedido ativo antes de inserir (bulletproof)
  //     → Só esta função tem o SELECT: admin/professor adicionam via adicionarAlunoManualmenteFila
  const requisitar = async () => {
    if (cooldownInfo.emCooldown && !isPrivileged) return;
    if (!currentUser || processingRef.current || meuPedido) return;
    processingRef.current = true; setIsProcessing(true);

    // Optimistic: insere na UI imediatamente (camada 2)
    const pedidoOtimista: LogPedido = {
      id: `otimista-${Date.now()}`,
      user_id: currentUser.user_id,
      name: currentUser.name,
      status: "pedido",
      require_time: new Date().toISOString(),
      go_time: null,
      back_time: null,
      description: null,
    };
    setTodosLogsAtivos(prev => [pedidoOtimista, ...prev]);

    try {
      // Camada 3: confirma no banco antes de inserir
      const { data: jaExiste } = await supabase
        .from("logs")
        .select("id")
        .eq("user_id", currentUser.user_id)
        .in("status", ["pedido", "saida"])
        .limit(1);

      if (jaExiste && jaExiste.length > 0) {
        setTodosLogsAtivos(prev => prev.filter(l => l.id !== pedidoOtimista.id));
        return;
      }

      // INSERT e captura o ID real retornado
      const { data: inserido } = await supabase
        .from("logs")
        .insert([{ user_id: currentUser.user_id, name: currentUser.name, status: "pedido" }])
        .select("id")
        .single();

      // Substitui o ID otimista pelo ID real — resolve o bug do PATCH com ID falso
      if (inserido?.id) {
        setTodosLogsAtivos(prev => prev.map(l =>
          l.id === pedidoOtimista.id ? { ...l, id: inserido.id } : l
        ));
      }
    } catch {
      setTodosLogsAtivos(prev => prev.filter(l => l.id !== pedidoOtimista.id));
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const registrarSaida = async (pedido: LogPedido) => {
    if (processingRef.current) return; processingRef.current = true; setIsProcessing(true);
    const goNow = new Date().toISOString();
    // Optimistic: substitui o log de pedido por saida localmente
    setTodosLogsAtivos(prev => prev.map(l =>
      l.id === pedido.id ? { ...l, status: "saida", go_time: goNow } : l
    ));
    try {
      // Se ID ainda é otimista, o INSERT do requisitar não completou — aguarda o realtime
      if (isOptimistic(pedido.id)) {
        setTodosLogsAtivos(prev => prev.map(l => l.id === pedido.id ? { ...l, status: "pedido", go_time: null } : l));
        return;
      }
      await Promise.all([
        supabase.from("logs").update({ status: "pedido_historico" }).eq("id", pedido.id),
        supabase.from("logs").insert([{ user_id: pedido.user_id, name: pedido.name, status: "saida", require_time: pedido.require_time, go_time: goNow, description: pedido.description }]),
      ]);
      if (isPrivileged) registrarAuditoria(`Liberou saída manual do aluno ${pedido.name}`);
    } catch {
      setTodosLogsAtivos(prev => prev.map(l => l.id === pedido.id ? { ...l, status: "pedido", go_time: null } : l));
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const registrarChegada = async (pedido: LogPedido) => {
    if (processingRef.current) return; processingRef.current = true; setIsProcessing(true);
    const backNow = new Date().toISOString();
    // Optimistic: remove da lista ativa (vai para histórico)
    setTodosLogsAtivos(prev => prev.filter(l => l.id !== pedido.id));
    // Atualiza cooldown localmente imediatamente
    setUltimoRetornoDoAluno({ ...pedido, status: "concluido", back_time: backNow });
    try {
      await Promise.all([
        supabase.from("logs").update({ status: "saida_historico" }).eq("id", pedido.id),
        supabase.from("logs").insert([{ user_id: pedido.user_id, name: pedido.name, status: "concluido", require_time: pedido.require_time, go_time: pedido.go_time, back_time: backNow, description: pedido.description }]),
      ]);
    } catch {
      setTodosLogsAtivos(prev => [pedido, ...prev]);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const adicionarAlunoManualmenteFila = async () => {
    if (!alunoSelecionadoFila || processingRef.current || !currentUser) return;
    processingRef.current = true; setIsProcessing(true);
    try {
      const aluno = alunosNaTurmaAtual.find(a => a.user_id === alunoSelecionadoFila);
      if (!aluno) return;
      await supabase.from("logs").insert([{ user_id: aluno.user_id, name: aluno.name, status: "pedido", description: `(Adicionado por: ${currentUser.name})` }]);
      criarLogAuditoria(`Adicionou ${aluno.name} na fila da sala ${turmaAtiva?.name}`);
      setAlunoSelecionadoFila("");
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const forcarSaidaAluno = async (p: LogPedido) => {
    if (processingRef.current || !currentUser) return; processingRef.current = true; setIsProcessing(true);
    const goNow2 = new Date().toISOString();
    setTodosLogsAtivos(prev => prev.map(l =>
      l.id === p.id ? { ...l, status: "saida", go_time: goNow2 } : l
    ));
    try {
      await Promise.all([
        supabase.from("logs").update({ status: "pedido_historico" }).eq("id", p.id),
        supabase.from("logs").insert([{ user_id: p.user_id, name: p.name, status: "saida", require_time: p.require_time, go_time: goNow2, description: ((p.description || "") + ` (Forçada por: ${currentUser.name})`).trim() }]),
      ]);
      criarLogAuditoria(`Forçou a saída do aluno ${p.name}`);
    } catch {
      setTodosLogsAtivos(prev => prev.map(l => l.id === p.id ? { ...l, status: "pedido", go_time: null } : l));
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const forcarRetornoAluno = async (p: LogPedido) => {
    if (processingRef.current) return; processingRef.current = true; setIsProcessing(true);
    const backNow2 = new Date().toISOString();
    setTodosLogsAtivos(prev => prev.filter(l => l.id !== p.id));
    try {
      await Promise.all([
        supabase.from("logs").update({ status: "saida_historico" }).eq("id", p.id),
        supabase.from("logs").insert([{ user_id: p.user_id, name: p.name, status: "concluido", require_time: p.require_time, go_time: p.go_time, back_time: backNow2, description: ((p.description || "") + ` (Retorno forçado por: ${currentUser?.name})`).trim() }]),
      ]);
      criarLogAuditoria(`Forçou o retorno do aluno ${p.name}`);
    } catch {
      setTodosLogsAtivos(prev => [p, ...prev]);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const cancelarPedido = async (p: LogPedido) => {
    if (processingRef.current) return; processingRef.current = true; setIsProcessing(true);
    // Optimistic: remove imediatamente da fila ativa
    setTodosLogsAtivos(prev => prev.filter(l => l.id !== p.id));
    try {
      // Se for ID otimista, o INSERT ainda não completou — não há registro no banco para cancelar
      if (isOptimistic(p.id)) return;
      await supabase.from("logs").update({ status: "cancelado", description: "Cancelado / Removido" }).eq("id", p.id);
      if (isPrivileged && currentUser?.user_id !== p.user_id) criarLogAuditoria(`Removeu/Cancelou o registro de ${p.name}`);
      if (isPrivileged) registrarAuditoria(`Removeu da fila ou cancelou o pedido de ${p.name}`);
    } catch {
      setTodosLogsAtivos(prev => [p, ...prev]);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const moverPosicao = async (index: number, direcao: "up" | "down") => {
    if (processingRef.current || !currentUser) return; processingRef.current = true; setIsProcessing(true);
    try {
      const atual = filaEsperaOrdenada[index], outro = filaEsperaOrdenada[direcao === "up" ? index - 1 : index + 1];
      if (!atual || !outro) return;
      // Todas as 3 operações em paralelo
      await Promise.all([
        supabase.from("logs").update({ description: ((atual.description || "").replace(/\[OVERRIDE:.*?\]/g, "") + ` [OVERRIDE:${getEffectiveTime(outro)}]`).trim() }).eq("id", atual.id),
        supabase.from("logs").update({ description: ((outro.description || "").replace(/\[OVERRIDE:.*?\]/g, "") + ` [OVERRIDE:${getEffectiveTime(atual)}]`).trim() }).eq("id", outro.id),
        supabase.from("logs").insert([{ user_id: currentUser.user_id, name: currentUser.name, status: "auditoria", description: `Alterou a posição de ${atual.name} e ${outro.name} na fila` }]),
      ]);
    } finally { processingRef.current = false; setIsProcessing(false); }
  };

  const fazerLogout = async () => { await supabase.auth.signOut(); router.push("/login"); };

  // 5S
  const alterarQtd5S = async (novaQtd: number) => {
    if (!turmaAtiva) return;
    setTurmaAtiva({ ...turmaAtiva, qtd_5s: novaQtd });
    await supabase.from("classrooms").update({ qtd_5s: novaQtd }).eq("id", turmaAtiva.id);
    registrarAuditoria(`Alterou a quantidade do 5S para ${novaQtd} [TURMA:${turmaAtiva.name}]`);
  };

  const alunosPara5S = useMemo(() => {
    if (!alunosNaTurmaAtual.length) return [];
    return [...alunosNaTurmaAtual.filter(a => !alunosPulados.includes(a.user_id))]
      .sort((a, b) => { const d = (a.fives_count || 0) - (b.fives_count || 0); return d !== 0 ? d : a.name.localeCompare(b.name); })
      .slice(0, turmaAtiva?.qtd_5s || 3);
  }, [alunosNaTurmaAtual, alunosPulados, turmaAtiva?.qtd_5s]);

  const pularAluno5S = (alunoId: string, nomeAluno: string) => { setAlunosPulados(p => [...p, alunoId]); registrarAuditoria(`Pulou o aluno ${nomeAluno} no 5S`); };
  const adicionarPontoManual = async (aluno: UserDB) => {
    if (!confirm(`Dar +1 no 5S para ${aluno.name}?`)) return;
    await supabase.from("users").update({ fives_count: (aluno.fives_count || 0) + 1 }).eq("user_id", aluno.user_id);
    registrarAuditoria(`Deu +1 manual no 5S para ${aluno.name}`);
  };

  const confirmar5S = async () => {
    if (isProcessing || !alunosPara5S.length) return; setIsProcessing(true);
    try {
      await Promise.all(alunosPara5S.map(a => supabase.from("users").update({ fives_count: (a.fives_count || 0) + 1 }).eq("user_id", a.user_id)));
      await supabase.from("logs").insert(alunosPara5S.map(a => ({ user_id: a.user_id, name: a.name, status: "5s_history", description: `5S [TURMA:${turmaAtiva?.name}]` })));
      registrarAuditoria(`Confirmou e liberou o 5S da turma ${turmaAtiva?.name}`);
      setAlunosPulados([]); alert("5S confirmado!");
      if (turmaAtiva) await abrirFila(turmaAtiva);
    } catch { alert("Erro ao confirmar 5S."); } finally { setIsProcessing(false); }
  };

  const historico5SDaTurma = useMemo(() => historicoCompleto.filter(l => l.status === "5s_history" && l.description?.includes(`[TURMA:${turmaAtiva?.name}]`)), [historicoCompleto, turmaAtiva?.name]);

  // Relatórios (memoizados)
  const gerarResumoDoDia = useMemo(() => {
    const hoje = new Date().toLocaleDateString("pt-BR");
    const mapa: Record<string, { nome: string; idas: number; tempoTotal: number }> = {};
    historicoDaTurma.forEach(log => {
      if (log.status !== "concluido" || !log.go_time || !log.back_time) return;
      if (new Date(log.go_time).toLocaleDateString("pt-BR") !== hoje) return;
      const t = Math.round((new Date(log.back_time).getTime() - new Date(log.go_time).getTime()) / 60000);
      if (!mapa[log.user_id]) mapa[log.user_id] = { nome: log.name, idas: 0, tempoTotal: 0 };
      mapa[log.user_id].idas += 1; mapa[log.user_id].tempoTotal += t;
    });
    return Object.values(mapa).map(i => ({ ...i, mediaTempo: i.idas > 0 ? Math.round(i.tempoTotal / i.idas) : 0 })).sort((a, b) => b.idas - a.idas);
  }, [historicoDaTurma]);

  const gerarRelatorioTurma = useMemo(() => {
    const porData: Record<string, { data: string; dataISO: string; alunos: { name: string; goTime: string; backTime: string; tempoMin: number }[]; resumoPorAluno: Record<string, { name: string; idas: number; tempoTotal: number }>; }> = {};
    historicoDaTurma.forEach(log => {
      if (log.status !== "concluido" || !log.go_time || !log.back_time) return;
      const dataObj = new Date(log.go_time); const dataChave = dataObj.toLocaleDateString("pt-BR"); const dataISO = dataObj.toISOString().split("T")[0];
      const t = Math.round((new Date(log.back_time).getTime() - dataObj.getTime()) / 60000);
      if (t < 0) return;
      if (!porData[dataChave]) porData[dataChave] = { data: dataChave, dataISO, alunos: [], resumoPorAluno: {} };
      porData[dataChave].alunos.push({ name: log.name, goTime: log.go_time, backTime: log.back_time, tempoMin: t });
      if (!porData[dataChave].resumoPorAluno[log.user_id]) porData[dataChave].resumoPorAluno[log.user_id] = { name: log.name, idas: 0, tempoTotal: 0 };
      porData[dataChave].resumoPorAluno[log.user_id].idas += 1; porData[dataChave].resumoPorAluno[log.user_id].tempoTotal += t;
    });
    return Object.values(porData).sort((a, b) => new Date(b.dataISO).getTime() - new Date(a.dataISO).getTime());
  }, [historicoDaTurma]);

  useEffect(() => {
    if (!currentUser || !isPrivileged) return;
    const verificar = async () => {
      const CHAVE = `ultima_limpeza_turma_${turmaAtiva?.id || "global"}`;
      const ultima = localStorage.getItem(CHAVE); const agora = new Date(); const semMs = 7 * 24 * 60 * 60 * 1000;
      if (ultima && agora.getTime() - new Date(ultima).getTime() < semMs) return;
      const { error } = await supabase.from("logs").delete().lt("require_time", new Date(agora.getTime() - semMs).toISOString()).in("status", ["concluido", "cancelado", "pedido_historico", "saida_historico"]);
      if (!error) localStorage.setItem(CHAVE, agora.toISOString());
    };
    verificar();
  }, [currentUser, turmaAtiva, isPrivileged]);

  // Helpers
  const formatarHora = (d: string | null) => d ? new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
  const getEventTime = (l: LogPedido) => l.status.includes("saida") ? l.go_time : l.status === "concluido" ? l.back_time : l.require_time;
  const getStatusDisplay = (s: string) => {
    switch (s) {
      case "pedido": case "pedido_historico": return { texto: "PEDIDO", cor: "bg-white border-2 border-[#00579D] text-[#00579D]" };
      case "saida": case "saida_historico": return { texto: "NO BANHEIRO", cor: "bg-[#00579D] text-white border-2 border-[#00579D]" };
      case "concluido": return { texto: "CONCLUÍDO", cor: "bg-[#2B2B2B] text-white border-2 border-[#2B2B2B]" };
      case "cancelado": return { texto: "CANCELADO", cor: "bg-gray-200 border-2 border-[#2B2B2B] text-[#2B2B2B] line-through" };
      case "pausado": return { texto: "SISTEMA", cor: "bg-gray-800 text-white border-2 border-gray-800" };
      default: return { texto: s.toUpperCase(), cor: "bg-gray-100 border-2 border-gray-300 text-gray-600" };
    }
  };
  const renderDetalhes = (log: LogPedido) => {
    const desc = log.description ? log.description.replace(/\[OVERRIDE:.*?\]/g, "") : "";
    if (log.status === "concluido" && log.go_time && log.back_time) {
      const d = Math.round((new Date(log.back_time).getTime() - new Date(log.go_time).getTime()) / 60000);
      return `${desc ? desc + " | " : ""}Tempo fora: ${d < 1 ? "Menos de 1 min" : `${d} min`}`;
    }
    return desc || "-";
  };

  const usuariosVisiveis = useMemo(() => todosUsuarios.filter(u => u.name.toLowerCase().includes(buscaUsuarios.toLowerCase()) || (u.email && u.email.toLowerCase().includes(buscaUsuarios.toLowerCase()))), [todosUsuarios, buscaUsuarios]);
  const auditoriaVisivel = useMemo(() => logsAuditoria.filter(l => l.name.toLowerCase().includes(filtroAuditoria.toLowerCase())), [logsAuditoria, filtroAuditoria]);
  const turmasVisiveisList = useMemo(() => turmas.filter(t => t.name.toLowerCase().includes(buscaTurmas.toLowerCase())), [turmas, buscaTurmas]);
  const historicoVisivel = useMemo(() => historicoDaTurma.filter(l => l.name.toLowerCase().includes(filtroHistorico.toLowerCase())), [historicoDaTurma, filtroHistorico]);

  if (!currentUser) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
      <div className="text-xl font-bold text-[#00579D] uppercase tracking-widest animate-pulse">Carregando Sistema...</div>
    </div>
  );

  return (
    <main className="min-h-screen flex flex-col bg-[#F4F4F4] font-sans text-[#2B2B2B]">
      <header className="bg-[#00579D] text-white px-8 py-4 shadow-md flex justify-between items-center z-10">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-senai.png" alt="Logo SENAI" className="h-8 sm:h-10 object-contain" onError={e => e.currentTarget.style.display = "none"} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-weg.png" alt="Logo WEG" className="h-8 sm:h-10 object-contain" onError={e => e.currentTarget.style.display = "none"} />
        </div>
        <div className="flex items-center gap-4 sm:gap-6 flex-wrap justify-end">
          <span className="text-sm tracking-wide hidden md:block">{isAdmin ? "Admin:" : isPrivileged ? "Docente:" : "Aluno:"} <strong className="font-bold uppercase">{currentUser.name}</strong></span>
          {isAdmin && viewMode !== "admin_panel" && <button onClick={carregarPainelAdmin} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 font-bold uppercase tracking-wider hover:bg-purple-700 border-b-4 border-purple-800 active:border-b-0 active:translate-y-1"><Shield size={18} /><span className="hidden sm:inline">Admin</span></button>}
          {isPrivileged && (viewMode === "settings" || viewMode === "queue" || viewMode === "admin_panel") && <button onClick={() => { carregarDashboard(); setViewMode("dashboard"); }} className="flex items-center gap-2 bg-[#2B2B2B] text-white px-4 py-2 font-bold uppercase tracking-wider hover:bg-black border-b-4 border-black active:border-b-0 active:translate-y-1"><LayoutGrid size={18} /><span className="hidden sm:inline">Painel de Turmas</span></button>}
          <button onClick={fazerLogout} disabled={isProcessing} className="flex items-center gap-2 bg-white text-[#00579D] px-4 py-2 font-bold uppercase tracking-wider hover:bg-gray-200 border-b-4 border-gray-400 active:border-b-0 active:translate-y-1"><LogOut size={18} /><span className="hidden sm:inline">Sair</span></button>
        </div>
      </header>

      <div className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8 relative">

        {viewMode === "no_class" && (
          <div className="flex flex-col items-center justify-center mt-20 text-center space-y-4">
            <BookOpen size={64} className="text-gray-300" />
            <h2 className="text-2xl font-extrabold text-[#2B2B2B] uppercase">Você ainda não possui turma</h2>
            <p className="text-gray-600 font-medium">Aguarde o professor ou administrador adicionar você em uma sala.</p>
          </div>
        )}

        {/* ADMIN PANEL */}
        {viewMode === "admin_panel" && isAdmin && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10">
            <div className="flex justify-between items-center border-b-4 border-purple-600 pb-4 mb-8">
              <h2 className="text-2xl font-extrabold uppercase tracking-widest flex items-center gap-2 text-purple-700"><Shield size={28} /> Painel de Administração Geral</h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <section className="bg-white shadow-md border-t-8 border-purple-600 lg:col-span-1 h-fit">
                <div className="bg-purple-600 text-white px-6 py-4 font-bold uppercase tracking-widest">Criar Novo Usuário</div>
                <form onSubmit={registrarNovoUsuario} className="p-6 space-y-4">
                  <div><label className="block text-xs font-bold mb-1 uppercase">Nome Completo</label><input type="text" required className="w-full px-3 py-2 border-2 border-gray-300 focus:border-purple-600 outline-none" value={novoUserNome} onChange={e => setNovoUserNome(e.target.value)} /></div>
                  <div><label className="block text-xs font-bold mb-1 uppercase">Prefixo E-mail (ou Completo)</label><input type="text" required className="w-full px-3 py-2 border-2 border-gray-300 focus:border-purple-600 outline-none" value={novoUserEmail} onChange={e => setNovoUserEmail(e.target.value)} placeholder="ex: joao.silva" /></div>
                  <div><label className="block text-xs font-bold mb-1 uppercase">Senha Inicial</label><input type="password" required className="w-full px-3 py-2 border-2 border-gray-300 focus:border-purple-600 outline-none" value={novoUserSenha} onChange={e => setNovoUserSenha(e.target.value)} /></div>
                  <div><label className="block text-xs font-bold mb-1 uppercase">Cargo Inicial</label><select className="w-full px-3 py-2 border-2 border-gray-300 focus:border-purple-600 outline-none uppercase font-bold text-sm" value={novoUserCargo} onChange={e => setNovoUserCargo(e.target.value)}><option value="aluno">Aluno</option><option value="Teacher">Professor</option><option value="admin">Administrador</option></select></div>
                  <button type="submit" disabled={isProcessing} className="w-full bg-purple-600 text-white font-bold uppercase py-3 border-b-4 border-purple-800 active:border-b-0 active:translate-y-1 mt-4">{isProcessing ? "Cadastrando..." : "Cadastrar"}</button>
                </form>
              </section>
              <section className="bg-white shadow-md border-t-8 border-purple-600 lg:col-span-1 h-fit">
                <div className="bg-purple-600 text-white px-6 py-4 font-bold uppercase tracking-widest flex justify-between items-center"><span>Cargos & Usuários</span><span className="text-xs bg-white text-purple-600 px-2 py-1 rounded font-black">{usuariosVisiveis.length}</span></div>
                <div className="p-4 border-b-2 border-gray-200 bg-gray-50 flex flex-col gap-3">
                  <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} /><input type="text" placeholder="Buscar..." className="w-full pl-9 pr-3 py-2 border-2 border-gray-300 focus:border-purple-600 outline-none text-sm font-bold uppercase" value={buscaUsuarios} onChange={e => setBuscaUsuarios(e.target.value)} /></div>
                  <div className="flex justify-between items-center">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold uppercase text-gray-600"><input type="checkbox" className="w-4 h-4" checked={usuariosVisiveis.length > 0 && usuariosSelecionados.length === usuariosVisiveis.length} onChange={() => toggleSelecionarTodos(usuariosVisiveis)} />Selecionar Todos</label>
                    {usuariosSelecionados.length > 0 && <button onClick={excluirUsuariosEmMassa} disabled={isProcessing} className="bg-red-600 text-white px-3 py-1 text-xs font-bold uppercase hover:bg-red-700 flex items-center gap-1 rounded shadow"><Trash2 size={14} />Excluir ({usuariosSelecionados.length})</button>}
                  </div>
                </div>
                <ul className="divide-y divide-gray-200 max-h-[400px] overflow-y-auto">
                  {usuariosVisiveis.length === 0 && <p className="p-4 text-center text-gray-400 font-bold text-sm uppercase">Nenhum usuário encontrado</p>}
                  {usuariosVisiveis.map(u => (
                    <li key={u.user_id} className={`p-4 flex flex-col xl:flex-row justify-between items-start xl:items-center hover:bg-gray-50 gap-2 ${usuariosSelecionados.includes(u.user_id) ? "bg-purple-50" : ""}`}>
                      <div className="flex items-center gap-3"><input type="checkbox" className="w-4 h-4 cursor-pointer" checked={usuariosSelecionados.includes(u.user_id)} onChange={() => toggleUsuarioSelecionado(u.user_id)} disabled={u.user_id === currentUser.user_id} /><div><p className="font-bold text-[#2B2B2B] uppercase text-sm">{u.name}</p><p className="text-[10px] font-bold text-gray-400 uppercase">{u.email || "Sem e-mail"}</p></div></div>
                      <select className="px-2 py-1 border-2 border-gray-300 bg-white font-bold uppercase text-xs focus:border-purple-600 focus:outline-none w-full xl:w-auto" value={u.acess_level} onChange={e => alterarCargoUsuario(u.user_id, e.target.value)} disabled={isProcessing || u.user_id === currentUser.user_id}><option value="aluno">Aluno</option><option value="Teacher">Professor</option><option value="admin">Admin</option></select>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="bg-white shadow-md border-t-8 border-[#2B2B2B] lg:col-span-1 h-fit">
                <div className="bg-[#2B2B2B] text-white px-6 py-4 font-bold uppercase tracking-widest flex justify-between items-center"><span>Auditoria</span><span className="text-xs bg-white text-[#2B2B2B] px-2 py-1 rounded font-black">{auditoriaVisivel.length}</span></div>
                <div className="p-4 border-b-2 border-gray-200 bg-gray-50"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} /><input type="text" placeholder="Filtrar por professor..." className="w-full pl-9 pr-3 py-2 border-2 border-gray-300 focus:border-[#2B2B2B] outline-none text-sm font-bold uppercase" value={filtroAuditoria} onChange={e => setFiltroAuditoria(e.target.value)} /></div></div>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#F4F4F4] shadow-sm"><tr className="border-b-2 border-[#2B2B2B] text-[#2B2B2B] uppercase text-xs"><th className="p-4 font-bold">Hora</th><th className="p-4 font-bold">Professor / Ação</th></tr></thead>
                    <tbody className="divide-y divide-gray-200">
                      {auditoriaVisivel.length === 0 ? <tr><td colSpan={2} className="p-6 text-center text-gray-400 font-bold uppercase">Nenhum registro.</td></tr>
                        : auditoriaVisivel.map(log => <tr key={log.id} className="hover:bg-gray-50"><td className="p-4 font-mono text-xs font-bold text-gray-600 whitespace-nowrap align-top">{formatarHora(log.require_time)}</td><td className="p-4"><p className="font-extrabold text-[#2B2B2B] uppercase text-xs">{log.name}</p><p className="text-[10px] font-bold text-purple-700 uppercase mt-1">{log.description}</p></td></tr>)}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* DASHBOARD */}
        {viewMode === "dashboard" && isPrivileged && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b-4 border-[#00579D] pb-4 mb-8 gap-4">
              <h2 className="text-2xl font-extrabold uppercase tracking-widest flex items-center gap-2"><LayoutGrid size={28} /> Painel de Turmas</h2>
              <div className="relative w-full md:w-auto"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><input type="text" placeholder="Buscar turma..." className="w-full md:w-64 pl-10 pr-4 py-3 bg-white border-2 border-gray-300 focus:border-[#00579D] outline-none font-bold uppercase text-sm shadow-sm" value={buscaTurmas} onChange={e => setBuscaTurmas(e.target.value)} /></div>
            </div>
            {isAdmin && (
              <div className="bg-white border-2 border-[#2B2B2B] p-6 mb-8 flex flex-col md:flex-row gap-4 items-end shadow-md">
                <div className="flex-1 w-full"><label className="block text-xs font-bold mb-2 uppercase tracking-wider">Criar Nova Turma</label><input type="text" placeholder="Ex: TÉCNICO DEV-01" className="w-full px-4 py-3 bg-[#F4F4F4] border-2 border-[#2B2B2B] font-bold focus:outline-none focus:border-[#00579D] uppercase" value={novaTurmaNome} onChange={e => setNovaTurmaNome(e.target.value)} /></div>
                <button onClick={criarTurma} disabled={isProcessing || !novaTurmaNome.trim()} className="bg-[#00579D] text-white font-bold uppercase tracking-widest py-3 px-8 hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 w-full md:w-auto"><Plus size={20} className="inline mr-2" />Criar</button>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {turmasVisiveisList.map(turma => (
                <div key={turma.id} className="bg-white border-2 border-gray-200 shadow-sm hover:shadow-md hover:border-[#00579D] transition-all flex flex-col">
                  <div className="bg-[#2B2B2B] text-white px-4 py-3 flex justify-between items-center"><span className="font-bold uppercase tracking-wider truncate mr-2">{turma.name}</span><button onClick={() => abrirConfiguracoes(turma)} className="text-gray-300 hover:text-white"><Settings size={20} /></button></div>
                  <div className="p-6 flex-1 flex flex-col justify-between gap-6">
                    <div className="flex items-center gap-3 text-gray-600 font-medium"><Users size={24} className="text-[#00579D]" /><span><strong className="text-xl text-[#2B2B2B]">{turma.student_count}</strong> Alunos</span></div>
                    <button onClick={() => abrirFila(turma)} className="w-full bg-[#00579D] text-white font-bold uppercase tracking-widest py-3 hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 flex items-center justify-center gap-2"><DoorOpen size={20} />Abrir Fila</button>
                  </div>
                </div>
              ))}
              {turmasVisiveisList.length === 0 && <p className="col-span-full text-center text-gray-500 font-bold uppercase py-10">Nenhuma turma encontrada.</p>}
            </div>
          </div>
        )}

        {/* SETTINGS */}
        {viewMode === "settings" && turmaAtiva && isPrivileged && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white border-2 border-[#2B2B2B] shadow-md">
              <div className="bg-[#2B2B2B] text-white px-6 py-4 flex justify-between items-center">
                <h2 className="text-xl font-extrabold uppercase tracking-widest flex items-center gap-2"><Settings size={24} /> Configurações: {turmaAtiva.name}</h2>
                {isAdmin && <button onClick={() => excluirTurma(turmaAtiva.id)} className="text-red-400 hover:text-red-500"><Trash2 size={20} /></button>}
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="col-span-1 md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="bg-[#F4F4F4] p-6 border-2 border-gray-200">
                    <h3 className="font-bold uppercase tracking-wider mb-2 border-b-2 border-gray-300 pb-2 flex items-center gap-2"><ShieldAlert size={18} />Tempo Limite de Alerta</h3>
                    <p className="text-xs text-gray-600 mb-4 font-bold uppercase">Minutos fora antes do alerta vermelho aparecer.</p>
                    <div className="flex gap-4 items-center">
                      <input type="number" min="1" max="60" className="w-32 px-4 py-3 border-2 border-[#2B2B2B] font-bold text-lg text-center focus:outline-none focus:border-[#00579D]" value={turmaAtiva.time_limit_minutes || 15} onChange={e => setTurmaAtiva({ ...turmaAtiva, time_limit_minutes: Number(e.target.value) })} />
                      <button onClick={() => atualizarTempoLimite(turmaAtiva.time_limit_minutes)} disabled={isProcessing} className="bg-[#2B2B2B] text-white font-bold uppercase py-3 px-8 border-b-4 border-black active:border-b-0 active:translate-y-1 disabled:opacity-50">Salvar</button>
                    </div>
                  </div>
                  <div className="bg-[#F4F4F4] p-6 border-2 border-[#00579D]">
                    <h3 className="font-bold uppercase tracking-wider mb-2 border-b-2 border-[#00579D] pb-2 flex items-center gap-2 text-[#00579D]"><Timer size={18} />Cooldown Entre Requisições</h3>
                    <p className="text-xs text-gray-600 mb-4 font-bold uppercase">Minutos de espera após retorno. Use <strong>0</strong> para desativar.</p>
                    <div className="flex gap-4 items-center">
                      <input type="number" min="0" max="120" className="w-32 px-4 py-3 border-2 border-[#00579D] font-bold text-lg text-center focus:outline-none" value={turmaAtiva.cooldown_minutes ?? 0} onChange={e => setTurmaAtiva({ ...turmaAtiva, cooldown_minutes: Number(e.target.value) })} />
                      <button onClick={() => atualizarCooldown(turmaAtiva.cooldown_minutes ?? 0)} disabled={isProcessing} className="bg-[#00579D] text-white font-bold uppercase py-3 px-8 border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 disabled:opacity-50">Salvar</button>
                    </div>
                    <p className="mt-3 text-xs font-bold uppercase">{(turmaAtiva.cooldown_minutes ?? 0) > 0 ? <span className="text-[#00579D]">✓ Ativo: {turmaAtiva.cooldown_minutes} min de espera</span> : <span className="text-gray-400">Desativado</span>}</p>
                  </div>
                </div>
                <div className="space-y-6">
                  <div className="bg-[#F4F4F4] p-6 border-2 border-gray-200">
                    <h3 className="font-bold uppercase tracking-wider mb-4 border-b-2 border-gray-300 pb-2">Vincular Aluno</h3>
                    <select className="w-full px-4 py-3 mb-4 border-2 border-[#2B2B2B] uppercase font-bold text-sm" value={alunoParaAdicionar} onChange={e => setAlunoParaAdicionar(e.target.value)}><option value="">-- SELECIONAR ALUNO --</option>{alunosSemTurma.map(a => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}</select>
                    <button onClick={puxarAlunoParaTurma} disabled={!alunoParaAdicionar || isProcessing} className="w-full bg-[#00579D] text-white font-bold uppercase py-3 border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 disabled:opacity-50">Adicionar à Turma</button>
                  </div>
                  <div>
                    <h3 className="font-bold uppercase tracking-wider mb-2 border-b-2 border-gray-300 pb-2">Alunos Integrantes ({alunosNaTurmaAtual.length})</h3>
                    <ul className="divide-y divide-gray-200 border-2 border-gray-200 max-h-60 overflow-y-auto">
                      {alunosNaTurmaAtual.length === 0 ? <p className="p-4 text-gray-500 italic text-sm">Turma vazia</p> : alunosNaTurmaAtual.map(a => <li key={a.user_id} className="p-3 flex justify-between items-center hover:bg-gray-50"><span className="font-bold text-sm uppercase text-[#2B2B2B]">{a.name}</span><button onClick={() => removerAlunoDaTurma(a.user_id)} className="text-gray-400 hover:text-red-600 p-2"><Trash2 size={16} /></button></li>)}
                    </ul>
                  </div>
                </div>
                {isAdmin && (
                  <div className="space-y-6">
                    <div className="bg-[#F4F4F4] p-6 border-2 border-purple-600">
                      <h3 className="font-bold text-purple-700 uppercase tracking-wider mb-4 border-b-2 border-purple-300 pb-2">Vincular Professor</h3>
                      <select className="w-full px-4 py-3 mb-4 border-2 border-[#2B2B2B] uppercase font-bold text-sm" value={professorParaAdicionar} onChange={e => setProfessorParaAdicionar(e.target.value)}><option value="">-- SELECIONAR PROFESSOR --</option>{todosProfessores.filter(p => !professoresNaTurmaAtual.some(pt => pt.user_id === p.user_id)).map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select>
                      <button onClick={puxarProfessorParaTurma} disabled={!professorParaAdicionar || isProcessing} className="w-full bg-purple-600 text-white font-bold uppercase py-3 border-b-4 border-purple-800 active:border-b-0 active:translate-y-1 disabled:opacity-50">Conceder Acesso</button>
                    </div>
                    <div>
                      <h3 className="font-bold uppercase tracking-wider mb-2 border-b-2 border-gray-300 pb-2">Professores desta Turma ({professoresNaTurmaAtual.length})</h3>
                      <ul className="divide-y divide-gray-200 border-2 border-gray-200 max-h-60 overflow-y-auto">
                        {professoresNaTurmaAtual.length === 0 ? <p className="p-4 text-gray-500 italic text-sm">Nenhum professor vinculado</p> : professoresNaTurmaAtual.map(p => <li key={p.user_id} className="p-3 flex justify-between items-center hover:bg-purple-50"><span className="font-bold text-sm uppercase text-purple-700">{p.name}</span><button onClick={() => removerProfessorDaTurma(p.user_id)} className="text-gray-400 hover:text-red-600 p-2"><Trash2 size={16} /></button></li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* FILA */}
        {viewMode === "queue" && turmaAtiva && (
          <>
            <div className="flex flex-col xl:flex-row gap-6 items-start animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Painel Resumo */}
              <div className={`transition-all duration-300 ease-in-out border-2 border-[#00579D] bg-white shadow-md flex flex-col ${isStatsExpanded ? "w-full md:w-80" : "w-16"}`}>
                <button onClick={() => setIsStatsExpanded(!isStatsExpanded)} className="p-4 bg-[#00579D] text-white flex items-center justify-between hover:bg-[#003865] transition-colors">
                  {isStatsExpanded ? <span className="font-bold uppercase tracking-widest text-sm flex items-center gap-2 whitespace-nowrap"><BarChart3 size={18} className="shrink-0" />Resumo de Hoje</span> : <BarChart3 size={24} className="mx-auto shrink-0" />}
                  {isStatsExpanded && <XCircle size={18} className="shrink-0" />}
                </button>
                <div className={`transition-opacity duration-300 ${isStatsExpanded ? "opacity-100" : "opacity-0 h-0 overflow-hidden"}`}>
                  {isStatsExpanded && (
                    <div className="p-4 max-h-[600px] overflow-y-auto">
                      <ul className="space-y-3">
                        {gerarResumoDoDia.length === 0 ? <p className="text-sm text-gray-500 font-bold text-center mt-4">Nenhum aluno foi ao banheiro hoje.</p>
                          : gerarResumoDoDia.map((e, idx) => <li key={idx} className="flex justify-between items-center p-3 bg-[#F4F4F4] border-l-4 border-[#00579D]"><div><p className="font-black text-[#2B2B2B] uppercase text-sm">{idx + 1}º {e.nome}</p><p className="text-xs font-bold text-[#00579D]">{e.idas} {e.idas === 1 ? "ida" : "idas"}</p></div><div className="text-right"><p className="text-sm font-bold text-gray-700">{e.tempoTotal} min</p><p className="text-[10px] font-bold text-gray-400 uppercase">Média: {e.mediaTempo} min</p></div></li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Painel Principal */}
              <div className="flex-1 w-full space-y-6 min-w-0">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b-4 border-[#00579D] pb-4">
                  <h2 className="text-2xl font-extrabold uppercase tracking-widest flex items-center gap-2"><ClipboardList size={28} />Fila: {turmaAtiva.name}</h2>
                  {isPrivileged && <button onClick={alternarPausa} disabled={isProcessing} className={`font-bold uppercase tracking-widest py-3 px-6 border-b-4 active:border-b-0 active:translate-y-1 flex items-center gap-2 text-white ${isPaused ? "bg-[#00579D] border-[#003865]" : "bg-[#2B2B2B] border-black hover:bg-black"}`}>{isPaused ? <PlayCircle size={20} /> : <PauseCircle size={20} />}{isPaused ? "Liberar Turma" : "Bloquear Turma"}</button>}
                </div>

                {isPrivileged && (
                  <div className="bg-white p-4 border-2 border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 items-end">
                    <div className="flex-1 w-full"><label className="block text-xs font-bold mb-2 uppercase text-gray-600">Inserir aluno manualmente na fila</label><select className="w-full px-4 py-2 bg-[#F4F4F4] border-2 border-gray-300 font-bold uppercase text-sm" value={alunoSelecionadoFila} onChange={e => setAlunoSelecionadoFila(e.target.value)}><option value="">-- SELECIONAR ALUNO --</option>{alunosNaTurmaAtual.filter(a => !logsDaTurmaAtiva.some(l => l.user_id === a.user_id)).map(a => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}</select></div>
                    <button onClick={adicionarAlunoManualmenteFila} disabled={!alunoSelecionadoFila || isProcessing} className="bg-[#2B2B2B] text-white font-bold uppercase py-2 px-6 border-b-4 border-black active:border-b-0 active:translate-y-1 w-full md:w-auto">Inserir na Fila</button>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* SEU ACESSO */}
                  <div className="h-full">
                    <section className="bg-white shadow-xl border-t-8 border-[#00579D] p-8 flex flex-col items-center justify-center text-center h-full min-h-[300px]">
                      <h2 className="text-xl font-extrabold text-[#00579D] uppercase mb-6">Seu Acesso</h2>
                      {!meuPedido ? (
                        cooldownInfo.emCooldown ? (
                          <div className="w-full space-y-4">
                            <div className="bg-blue-50 border-2 border-[#00579D] p-6 flex flex-col items-center gap-3">
                              <Timer size={36} className="text-[#00579D]" />
                              <p className="font-extrabold text-[#00579D] uppercase text-lg">Aguarde para requisitar</p>
                              <div className="bg-[#00579D] text-white px-6 py-3 font-black text-3xl tracking-widest tabular-nums">{cooldownInfo.minutos > 0 ? `${cooldownInfo.minutos} min ${cooldownInfo.segundosRestantes.toString().padStart(2, "0")} s` : `${cooldownInfo.segundosRestantes} s`}</div>
                              <p className="text-xs text-[#00579D] font-bold uppercase">Você poderá requisitar em breve</p>
                            </div>
                          </div>
                        ) : (
                          <div className="w-full space-y-3">
                            {/* FIX: aviso mas ainda permite requisitar quando bloqueado */}
                            {isPaused && !isPrivileged && <div className="flex items-center justify-center gap-2 bg-amber-50 border-2 border-amber-400 px-4 py-2 text-amber-700 font-bold text-sm uppercase"><ShieldAlert size={16} />Fila bloqueada — você entrará na fila e aguardará</div>}
                            <button onClick={requisitar} disabled={isProcessing} className="bg-[#00579D] text-white font-bold uppercase py-5 px-10 hover:bg-[#003865] border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 flex items-center justify-center gap-2 w-full text-lg"><UserPlus size={24} />Requisitar</button>
                          </div>
                        )
                      ) : meuPedido.status === "pedido" ? (
                        souOPrimeiro && acessoLivreParaAluno && !isPaused ? (
                          <div className="w-full space-y-4">
                            <p className="text-[#00579D] font-bold uppercase text-xl mb-2">Sua vez!</p>
                            <button onClick={() => registrarSaida(meuPedido)} disabled={isProcessing} className="w-full bg-[#00579D] text-white font-bold uppercase py-5 border-b-4 border-[#003865] active:border-b-0 active:translate-y-1 flex justify-center items-center gap-2 text-lg disabled:opacity-60 disabled:cursor-not-allowed"><DoorOpen size={24} />Confirmar Saída</button>
                            <button onClick={() => cancelarPedido(meuPedido)} disabled={isProcessing} className="w-full bg-white text-red-600 font-bold uppercase py-3 border-2 border-red-600 hover:bg-red-50 text-sm disabled:opacity-60 disabled:cursor-not-allowed">Cancelar Pedido</button>
                          </div>
                        ) : (
                          <div className="w-full space-y-4">
                            {isPaused ? <p className="text-amber-700 font-bold uppercase border-2 border-amber-400 bg-amber-50 p-4 flex items-center justify-center gap-2"><ShieldAlert size={18} />Na fila — aguardando liberação</p> : <p className="text-[#2B2B2B] font-bold uppercase border-2 border-[#2B2B2B] p-5 text-lg">Aguardando...</p>}
                            <button onClick={() => cancelarPedido(meuPedido)} disabled={isProcessing} className="w-full bg-white text-red-600 font-bold uppercase py-3 border-2 border-red-600 hover:bg-red-50 text-sm disabled:opacity-60 disabled:cursor-not-allowed">Desistir da Fila</button>
                          </div>
                        )
                      ) : meuPedido.status === "saida" ? (
                        <div className="w-full space-y-5">
                          <p className="text-[#00579D] font-bold uppercase text-xl">Você está fora.</p>
                          <button onClick={() => registrarChegada(meuPedido)} disabled={isProcessing} className="w-full bg-[#2B2B2B] text-white font-bold uppercase py-5 border-b-4 border-black active:border-b-0 active:translate-y-1 flex justify-center items-center gap-2 text-lg disabled:opacity-60 disabled:cursor-not-allowed"><CheckCircle2 size={24} />Confirmar Retorno</button>
                        </div>
                      ) : null}
                    </section>
                  </div>

                  {/* FORA + FILA */}
                  <div className="space-y-6">
                    <section className="bg-white border-2 border-[#00579D] shadow-md">
                      <div className="bg-[#00579D] text-white px-4 py-3 font-bold uppercase flex justify-between"><span>Fora de Sala ({noBanheiroList.length})</span><DoorOpen size={18} /></div>
                      <ul className="divide-y divide-gray-200 max-h-48 overflow-y-auto">
                        {noBanheiroList.length === 0 ? <p className="p-6 text-center text-gray-500 font-medium italic uppercase text-sm">Ninguém fora da sala</p>
                          : noBanheiroList.map(af => {
                            const tm = Math.floor((Date.now() - new Date(af.go_time!).getTime()) / 60000);
                            const exc = tm >= (turmaAtiva.time_limit_minutes || 15);
                            return <li key={af.id} className={`p-4 flex justify-between items-center ${exc ? "bg-red-50 border-l-4 border-red-600" : "hover:bg-gray-50"}`}>
                              <div><p className={`font-extrabold text-lg uppercase ${exc ? "text-red-700" : "text-[#00579D]"}`}>{af.name}</p><p className="text-xs font-bold text-gray-500 uppercase mt-1">Saída: {formatarHora(af.go_time)}</p>{exc && <p className="text-xs font-bold text-red-600 uppercase mt-1 flex items-center gap-1 animate-pulse"><ShieldAlert size={14} />Excedeu {tm} min</p>}</div>
                              {isPrivileged && <div className="flex gap-2"><button onClick={() => forcarRetornoAluno(af)} disabled={isProcessing} className="p-3 bg-green-600 text-white hover:bg-green-700 rounded-sm disabled:opacity-60"><CheckCircle2 size={18} /></button><button onClick={() => cancelarPedido(af)} disabled={isProcessing} className="p-3 bg-red-600 text-white hover:bg-red-700 rounded-sm disabled:opacity-60"><Trash2 size={18} /></button></div>}
                            </li>;
                          })}
                      </ul>
                    </section>
                    <section className="bg-white border-2 border-[#2B2B2B]">
                      <div className="bg-[#2B2B2B] text-white px-4 py-3 font-bold uppercase flex justify-between"><span>Fila ({filaEsperaOrdenada.length})</span><ClipboardList size={18} /></div>
                      <ul className="divide-y divide-gray-200 max-h-60 overflow-y-auto">
                        {filaEsperaOrdenada.length === 0 ? <p className="text-center text-gray-500 font-medium italic uppercase text-sm p-6">Fila vazia</p>
                          : filaEsperaOrdenada.map((a, i) => <li key={a.id} className="p-4 flex flex-wrap gap-2 justify-between items-center hover:bg-gray-50">
                            <div className="flex items-center gap-4"><span className="text-[#00579D] font-black text-xl w-6">{i + 1}º</span><div><p className="font-bold text-[#2B2B2B] uppercase">{a.name}</p><p className="text-xs font-bold text-gray-500 uppercase">Req: {formatarHora(a.require_time)}</p></div></div>
                            {isPrivileged && <div className="flex gap-2 items-center"><div className="flex flex-col gap-1 mr-2"><button onClick={() => moverPosicao(i, "up")} disabled={i === 0 || isProcessing} className="p-1 bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-30"><ArrowUp size={14} /></button><button onClick={() => moverPosicao(i, "down")} disabled={i === filaEsperaOrdenada.length - 1 || isProcessing} className="p-1 bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-30"><ArrowDown size={14} /></button></div><button onClick={() => forcarSaidaAluno(a)} disabled={isProcessing} className="p-2 bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"><DoorOpen size={16} /></button><button onClick={() => cancelarPedido(a)} disabled={isProcessing} className="p-2 bg-[#2B2B2B] text-white hover:bg-black disabled:opacity-60"><Trash2 size={16} /></button></div>}
                          </li>)}
                      </ul>
                    </section>
                  </div>
                </div>

                {/* HISTÓRICO */}
                {isPrivileged && historicoDaTurma.length > 0 && (
                  <section className="bg-white shadow-md border-t-8 border-[#2B2B2B] mt-8 w-full">
                    <button onClick={() => setIsHistoricoOpen(!isHistoricoOpen)} className="w-full bg-[#2B2B2B] text-white px-6 py-4 font-bold uppercase tracking-widest flex justify-between items-center hover:bg-black">
                      <span>Histórico de Saídas da Sala ({historicoVisivel.length})</span>{isHistoricoOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>
                    {isHistoricoOpen && (
                      <div className="bg-white border-x-2 border-b-2 border-[#2B2B2B]">
                        <div className="flex border-b-2 border-gray-200">
                          <button onClick={() => setAbaHistorico("lista")} className={`flex-1 py-3 px-4 font-bold uppercase text-xs tracking-wider flex items-center justify-center gap-2 ${abaHistorico === "lista" ? "bg-[#2B2B2B] text-white" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}><ClipboardList size={14} />Lista de Registros</button>
                          <button onClick={() => { setAbaHistorico("relatorio"); setDiaSelecionado(null); }} className={`flex-1 py-3 px-4 font-bold uppercase text-xs tracking-wider flex items-center justify-center gap-2 ${abaHistorico === "relatorio" ? "bg-[#00579D] text-white" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}><BarChart3 size={14} />Relatório por Dia</button>
                        </div>
                        {abaHistorico === "lista" && (
                          <>
                            <div className="p-4 border-b-2 border-gray-200 bg-gray-50"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} /><input type="text" placeholder="Buscar aluno no histórico..." className="w-full pl-9 pr-3 py-2 border-2 border-gray-300 focus:border-[#2B2B2B] outline-none text-sm font-bold uppercase" value={filtroHistorico} onChange={e => setFiltroHistorico(e.target.value)} /></div></div>
                            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                              <table className="w-full text-left border-collapse">
                                <thead className="sticky top-0 bg-[#F4F4F4] shadow-sm"><tr className="border-b-2 border-[#2B2B2B] text-[#2B2B2B] uppercase text-xs"><th className="p-4 font-bold">Hora</th><th className="p-4 font-bold">Aluno</th><th className="p-4 font-bold">Status</th><th className="p-4 font-bold hidden sm:table-cell">Tempo Fora</th></tr></thead>
                                <tbody className="divide-y divide-gray-200">
                                  {historicoVisivel.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-gray-400 font-bold uppercase">Nenhum registro.</td></tr>
                                    : historicoVisivel.map(log => { const b = getStatusDisplay(log.status); return <tr key={log.id} className="hover:bg-gray-50"><td className="p-4 font-mono text-sm font-bold text-gray-600">{formatarHora(getEventTime(log))}</td><td className="p-4 font-extrabold text-[#2B2B2B] uppercase">{log.name}</td><td className="p-4"><span className={`px-3 py-1 font-bold text-[10px] uppercase tracking-wider ${b.cor}`}>{b.texto}</span></td><td className="p-4 text-xs font-bold text-gray-500 hidden sm:table-cell uppercase">{renderDetalhes(log)}</td></tr>; })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                        {abaHistorico === "relatorio" && (
                          <div className="flex flex-col md:flex-row h-auto md:min-h-[420px]">
                            <div className="w-full md:w-52 border-b-2 md:border-b-0 md:border-r-2 border-gray-200 shrink-0">
                              <div className="bg-gray-50 px-4 py-2 border-b-2 border-gray-200"><p className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Selecione o dia</p></div>
                              <ul className="max-h-48 md:max-h-[380px] overflow-y-auto divide-y divide-gray-100">
                                {gerarRelatorioTurma.length === 0 ? <p className="p-4 text-center text-xs font-bold text-gray-400 uppercase">Sem dados</p>
                                  : gerarRelatorioTurma.map(dia => { const dO = new Date(dia.dataISO + "T12:00:00"); const nd = dO.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase(); const isSel = diaSelecionado === dia.data; return <li key={dia.data}><button onClick={() => setDiaSelecionado(isSel ? null : dia.data)} className={`w-full text-left px-4 py-3 transition-colors ${isSel ? "bg-[#00579D] text-white" : "hover:bg-blue-50 text-[#2B2B2B]"}`}><p className={`font-black text-sm uppercase ${isSel ? "text-white" : "text-[#2B2B2B]"}`}>{dia.data}</p><p className={`text-[10px] font-bold uppercase ${isSel ? "text-blue-200" : "text-gray-400"}`}>{nd} · {dia.alunos.length} saída{dia.alunos.length !== 1 ? "s" : ""}</p></button></li>; })}
                              </ul>
                            </div>
                            <div className="flex-1 overflow-auto">
                              {!diaSelecionado ? <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6"><BarChart3 size={40} className="text-gray-200 mb-3" /><p className="text-sm font-bold text-gray-400 uppercase">Selecione um dia para ver o relatório</p></div>
                                : (() => {
                                  const dd = gerarRelatorioTurma.find(d => d.data === diaSelecionado); if (!dd) return null;
                                  const dO = new Date(dd.dataISO + "T12:00:00");
                                  const nomeDia = dO.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
                                  const totalMin = dd.alunos.reduce((a, b) => a + b.tempoMin, 0);
                                  const mediaMin = dd.alunos.length > 0 ? Math.round(totalMin / dd.alunos.length) : 0;
                                  const alunosOrd = [...dd.alunos].sort((a, b) => new Date(a.goTime).getTime() - new Date(b.goTime).getTime());
                                  const resumoAlunos = Object.values(dd.resumoPorAluno).sort((a, b) => b.idas - a.idas);
                                  return <div>
                                    <div className="px-6 py-4 border-b-2 border-gray-200 bg-blue-50"><p className="text-[10px] font-black uppercase text-[#00579D] tracking-widest mb-1">Relatório do Dia</p><p className="font-extrabold text-[#2B2B2B] uppercase text-sm capitalize">{nomeDia}</p><div className="flex gap-6 mt-3">{[{ v: dd.alunos.length, l: "Saídas" }, { v: resumoAlunos.length, l: "Alunos" }, { v: totalMin, l: "Min. Total" }, { v: mediaMin, l: "Média/Saída" }].map(({ v, l }) => <div key={l} className="text-center"><p className="text-2xl font-black text-[#00579D]">{v}</p><p className="text-[10px] font-bold text-gray-500 uppercase">{l}</p></div>)}</div></div>
                                    <div className="border-b-2 border-gray-200"><div className="px-6 py-2 bg-gray-50 border-b border-gray-200"><p className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Resumo por Aluno</p></div>
                                      <table className="w-full text-left border-collapse"><thead className="bg-[#F4F4F4]"><tr className="border-b-2 border-gray-200 text-[#2B2B2B] uppercase text-[10px]"><th className="px-6 py-2 font-black">Aluno</th><th className="px-6 py-2 font-black text-center">Idas</th><th className="px-6 py-2 font-black text-center">Total</th><th className="px-6 py-2 font-black text-right">Média</th></tr></thead>
                                        <tbody className="divide-y divide-gray-100">{resumoAlunos.map((a, idx) => { const m = Math.round(a.tempoTotal / a.idas); const ex = m >= (turmaAtiva.time_limit_minutes || 15); return <tr key={idx} className={ex ? "bg-red-50" : "hover:bg-gray-50"}><td className="px-6 py-2"><p className={`font-extrabold uppercase text-xs ${ex ? "text-red-700" : "text-[#2B2B2B]"}`}>{a.name}</p></td><td className="px-6 py-2 text-center"><span className="font-black text-sm text-[#00579D]">{a.idas}</span></td><td className="px-6 py-2 text-center"><span className="font-bold text-xs text-gray-700">{a.tempoTotal} min</span></td><td className="px-6 py-2 text-right"><span className={`font-black text-xs ${ex ? "text-red-600" : "text-gray-500"}`}>{m} min</span></td></tr>; })}</tbody>
                                      </table></div>
                                    <div><div className="px-6 py-2 bg-gray-50 border-b border-gray-200"><p className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Cronologia das Saídas</p></div>
                                      <table className="w-full text-left border-collapse"><thead className="sticky top-0 bg-[#F4F4F4]"><tr className="border-b-2 border-gray-200 text-[#2B2B2B] uppercase text-[10px]"><th className="px-6 py-3 font-black">Aluno</th><th className="px-6 py-3 font-black">Saída</th><th className="px-6 py-3 font-black">Retorno</th><th className="px-6 py-3 font-black text-right">Tempo</th></tr></thead>
                                        <tbody className="divide-y divide-gray-100">{alunosOrd.map((a, idx) => { const ex = a.tempoMin >= (turmaAtiva.time_limit_minutes || 15); return <tr key={idx} className={ex ? "bg-red-50" : "hover:bg-gray-50"}><td className="px-6 py-3"><p className={`font-extrabold uppercase text-xs ${ex ? "text-red-700" : "text-[#2B2B2B]"}`}>{a.name}</p>{ex && <p className="text-[10px] font-bold text-red-500 uppercase flex items-center gap-1 mt-0.5"><ShieldAlert size={10} />Excedeu o limite</p>}</td><td className="px-6 py-3 font-mono text-xs font-bold text-gray-600">{formatarHora(a.goTime)}</td><td className="px-6 py-3 font-mono text-xs font-bold text-gray-600">{formatarHora(a.backTime)}</td><td className="px-6 py-3 text-right"><span className={`font-black text-sm ${ex ? "text-red-600" : "text-[#00579D]"}`}>{a.tempoMin} min</span></td></tr>; })}</tbody>
                                      </table></div>
                                  </div>;
                                })()}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>

            {/* 5S — FIX: botão fixo na base, lista rolável */}
            <div className="fixed right-0 top-[30%] z-50 flex items-start">
              <div onClick={() => setIs5sOpen(!is5sOpen)} className="bg-[#00579D] text-white p-2 rounded-l-lg shadow-lg cursor-pointer flex items-center justify-center min-h-[120px] border-y-2 border-l-2 border-[#2B2B2B] select-none">
                <span className="font-extrabold uppercase tracking-widest text-lg [writing-mode:vertical-lr] rotate-180">ESCALA 5S</span>
              </div>
              {/*
                O wrapper externo só faz a animação de LARGURA (overflow-hidden clipa horizontalmente).
                O painel interno tem seu próprio flex-col + scroll — sem interferência do pai.
              */}
              <div
                className={`transition-all duration-300 ease-in-out -ml-1 ${is5sOpen ? "w-[350px]" : "w-0 overflow-hidden"}`}
              >
                <div
                  className="w-[350px] bg-white shadow-2xl border-y-2 border-[#2B2B2B]"
                  style={{ display: "flex", flexDirection: "column", maxHeight: "68vh" }}
                >
                  {/* Abas — altura fixa, nunca encolhem */}
                  <div className="flex border-b-2 border-gray-200 bg-gray-50" style={{ flexShrink: 0 }}>
                    <button onClick={() => setMostrarHistorico5S(false)} className={`flex-1 py-3 font-bold uppercase text-xs tracking-widest ${!mostrarHistorico5S ? "bg-[#00579D] text-white" : "text-gray-500 hover:bg-gray-200"}`}>Hoje</button>
                    <button onClick={() => setMostrarHistorico5S(true)} className={`flex-1 py-3 font-bold uppercase text-xs tracking-widest ${mostrarHistorico5S ? "bg-[#00579D] text-white" : "text-gray-500 hover:bg-gray-200"}`}>Histórico</button>
                  </div>

                  {/* Área de scroll — altura explícita: 68vh menos abas(~44px) menos botão(~58px) */}
                  <div style={{ overflowY: "scroll", flexShrink: 1, flexGrow: 1, height: "calc(68vh - 102px)", padding: "20px" }}>
                    {!mostrarHistorico5S ? (
                      <>
                        <h3 className="text-xl font-extrabold uppercase text-[#00579D] pb-2 mb-4">Quem Limpa Hoje?</h3>
                        {isPrivileged && (
                          <div className="mb-4 flex items-center justify-between bg-gray-50 p-2 border border-gray-200 rounded">
                            <label className="text-xs font-bold text-gray-600 uppercase">Alunos (Qtd):</label>
                            <input type="number" min="1" max={alunosNaTurmaAtual?.length || 10} value={turmaAtiva?.qtd_5s || 3} onChange={e => alterarQtd5S(Number(e.target.value))} className="w-16 p-1 border-2 border-gray-300 font-bold text-center text-[#00579D]" />
                          </div>
                        )}
                        <ul className="space-y-2">
                          {alunosPara5S.map((aluno, idx) => (
                            <li key={aluno.user_id} className="p-2 bg-gray-50 border-l-4 border-[#00579D] flex flex-col gap-2 shadow-sm">
                              <div className="flex justify-between items-center">
                                <span className="font-bold text-sm text-[#2B2B2B] truncate">{idx + 1}. {aluno.name}</span>
                                <span className="text-[10px] text-gray-500 font-bold bg-gray-200 px-2 py-1 rounded" style={{ flexShrink: 0 }}>({aluno.fives_count || 0}x)</span>
                              </div>
                              {isPrivileged && (
                                <div className="flex gap-2 w-full">
                                  <button onClick={() => pularAluno5S(aluno.user_id, aluno.name)} className="flex-1 bg-yellow-100 text-yellow-700 border border-yellow-300 hover:bg-yellow-200 text-[10px] font-bold uppercase py-1 rounded">Faltou/Pular</button>
                                  <button onClick={() => adicionarPontoManual(aluno)} className="flex-1 bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200 text-[10px] font-bold uppercase py-1 rounded">Dar +1</button>
                                </div>
                              )}
                            </li>
                          ))}
                          {alunosPara5S.length === 0 && <p className="text-sm text-gray-500 text-center font-bold">Ninguém disponível.</p>}
                        </ul>
                      </>
                    ) : (
                      <>
                        <h3 className="text-xl font-extrabold uppercase text-[#00579D] pb-2 mb-4">Últimas Limpezas</h3>
                        <ul className="space-y-3">
                          {historico5SDaTurma.length === 0
                            ? <p className="text-xs text-gray-500 font-bold text-center">Nenhum histórico registrado.</p>
                            : historico5SDaTurma.slice(0, 15).map(log => (
                              <li key={log.id} className="text-xs font-bold border-b border-gray-100 pb-2">
                                <span className="text-[#00579D]">{new Date(log.require_time).toLocaleDateString("pt-BR")}</span>{" - "}
                                <span className="text-[#2B2B2B]">{log.name}</span>
                              </li>
                            ))}
                        </ul>
                      </>
                    )}
                  </div>

                  {/* Botão — sempre fixo na base, fora da área de scroll */}
                  {isPrivileged && !mostrarHistorico5S && alunosPara5S.length > 0 && (
                    <div style={{ flexShrink: 0, padding: "12px", borderTop: "2px solid #e5e7eb", background: "white" }}>
                      <button onClick={confirmar5S} disabled={isProcessing} className="w-full bg-green-600 text-white font-bold uppercase py-3 hover:bg-green-700 text-xs tracking-widest flex items-center justify-center gap-2 border-b-4 border-green-800 active:border-b-0 active:translate-y-1">
                        <CheckCircle2 size={16} />Confirmar e Liberar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}