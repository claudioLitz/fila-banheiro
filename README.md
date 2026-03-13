# 🚽 Sistema de Fila - SENAI / WEG

Um sistema web de controle de fluxo de alunos desenvolvido para otimizar e gerenciar as saídas de sala (como idas ao banheiro) nas turmas do SENAI / WEG. O sistema conta com painel do professor, fila de espera em tempo real, histórico de saídas e métricas de tempo.

## 🚀 Tecnologias Utilizadas

Este projeto utiliza as tecnologias mais modernas do ecossistema React:
- **[Next.js 16](https://nextjs.org/)** (App Router & React Compiler)
- **[React 19](https://react.dev/)**
- **[Supabase](https://supabase.com/)** (Banco de dados PostgreSQL e Realtime)
- **[Tailwind CSS v4](https://tailwindcss.com/)** (Estilização)
- **[Lucide React](https://lucide.dev/)** (Ícones)
- **[i18next](https://www.i18next.com/)** (Internacionalização/Tradução)

---

## ⚙️ Como rodar o projeto localmente

Siga o passo a passo abaixo para rodar o sistema no seu computador.

### 1. Pré-requisitos
Certifique-se de ter o **[Node.js](https://nodejs.org/)** instalado (versão 20 ou superior).

### 2. Instalação
Clone este repositório ou extraia os arquivos. Depois, abra o terminal na pasta raiz do projeto e instale as dependências:

```bash
npm install
```

### 3. Configuração do Banco de Dados (Variáveis de Ambiente)
O projeto depende do Supabase para funcionar. Você precisa das chaves de acesso do banco de dados.

1. Crie um arquivo chamado `.env.local` na raiz do projeto (mesmo local deste README).
2. Adicione as seguintes variáveis (solicite os valores reais ao administrador do projeto):

```env
NEXT_PUBLIC_SUPABASE_URL=[https://seu-projeto.supabase.co](https://seu-projeto.supabase.co)
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anonima_aqui
```
*(Atenção: Nunca commite o arquivo `.env.local` no GitHub!)*

### 4. Iniciando o Servidor de Desenvolvimento
Com as dependências instaladas e o `.env.local` configurado, rode o comando:

```bash
npm run dev
```

O servidor será iniciado. Abra o seu navegador e acesse: **[http://localhost:3000](http://localhost:3000)**

---

## 👥 Perfis de Acesso

O sistema possui diferentes visões dependendo do nível de acesso do usuário logado:
- **Aluno (`Student` / `aluno`):** Pode entrar na fila da sua respectiva turma, ver sua posição e registrar saídas/retornos.
- **Professor (`Teacher` / `admin`):** Possui acesso ao painel de gerenciamento, podendo criar turmas, adicionar alunos, pausar filas, forçar retornos, remover registros e visualizar métricas/histórico de tempo de cada aluno.

---
*Desenvolvido para uso institucional - WEG / SENAI*