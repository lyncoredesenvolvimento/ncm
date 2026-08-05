# Manual de Segurança: Arquitetura, Criptografia e Controle de Acesso
Este manual foi elaborado para servir como referência técnica para agentes de Inteligência Artificial (como Claude Code, Antigravity ou outros agentes) e desenvolvedores. O objetivo é descrever detalhadamente como replicar as práticas de segurança e controle de dados implementadas neste projeto em qualquer outra aplicação que utilize **React, TanStack Start (ou Next.js), NodeJS e Supabase**.

---

## 🛡️ Diretrizes Gerais de Segurança

Ao criar ou migrar projetos, os seguintes princípios de design de segurança devem ser aplicados rigorosamente:
1. **Isolamento do Cliente**: O navegador do cliente (frontend) nunca deve ter acesso direto a segredos do servidor, chaves de API administrativas ou dados não autorizados.
2. **Criptografia na Origem (At-Rest)**: Credenciais de terceiros, tokens de API externos e dados extremamente sensíveis devem ser criptografados antes de serem inseridos no banco de dados.
3. **Imunidade a SQL Injection**: Consultas manuais concatenando strings no banco de dados são proibidas. Deve-se usar exclusivamente o query builder parametrizado ou funções seguras (RPC).
4. **Middlewares de Servidor**: Nenhuma rota ou função do servidor (API/Server Function) pode confiar no estado do frontend. Toda validação de autenticação e permissão deve ser feita diretamente no servidor a cada requisição.
5. **Auditoria por Padrão**: Todas as ações críticas (inserções, edições, exclusões e acessos a dados sensíveis) devem gerar logs auditáveis que identifiquem o operador, o horário e a entidade afetada.

---

## 1. ⚙️ Gerenciamento Seguro de Variáveis de Ambiente (`.env`)

### Regras de Configuração:
* **Nunca comitar segredos no Git**: O arquivo `.env` deve ser listado no `.gitignore`. Um arquivo modelo `.env.example` deve ser disponibilizado contendo apenas as chaves vazias e comentários explicativos.
* **Separação de Contexto (Vite/Next.js)**:
  * Variáveis que começam com o prefixo `VITE_` (ou `NEXT_PUBLIC_`) são expostas publicamente no pacote final do frontend. Use-as apenas para dados públicos (ex: URL pública do Supabase, chaves anônimas públicas).
  * Variáveis **sem** o prefixo `VITE_` (ex: `NVIDIA_API_KEY`, `TDP_ACCESS_ENCRYPTION_KEY`, `TRIVALLIS_SUPABASE_SECRET_KEY`) permanecem estritamente no servidor e são inacessíveis para o navegador.

---

## 2. 🔐 Criptografia de Dados Sensíveis com AES-256-GCM

Credenciais e segredos de clientes ou portais não devem ser gravados em texto limpo no banco de dados. Para protegê-los contra vazamentos (mesmo em caso de invasão direta ao banco), utilize o algoritmo **AES-256-GCM** (criptografia simétrica autenticada).

### Estrutura do Payload Criptografado (Padrão):
O dado criptografado deve ser armazenado na coluna da tabela como uma única string com o seguinte formato delimitado por `:`:
`enc:v1:[IV em Base64URL]:[AuthTag em Base64URL]:[BytesCriptografados em Base64URL]`

* **enc:v1**: Prefixo que identifica o algoritmo e a versão para futuras migrações.
* **IV (Vetor de Inicialização)**: Buffer aleatório de **12 bytes** (gerado a cada nova criptografia).
* **AuthTag (Tag de Autenticação GCM)**: Tag de verificação de integridade de **16 bytes**.
* **Bytes Criptografados**: O dado confidencial criptografado.

### Implementação de Referência (Node.js):
Crie um helper de criptografia no servidor (ex: `security.ts`):

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

// Função para decodificar a chave mestra de 32 bytes (armazenada em Base64)
function getSecretKey(): Buffer {
  const keyBase64 = process.env.DATABASE_ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new Error("A chave mestra DATABASE_ENCRYPTION_KEY não está configurada no servidor.");
  }
  const key = Buffer.from(keyBase64.trim(), "base64");
  if (key.length !== 32) {
    throw new Error("A chave de criptografia precisa ter exatamente 32 bytes (256 bits).");
  }
  return key;
}

// Criptografar dado sensível
export function encryptData(plainText: string): string {
  const key = getSecretKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
  
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    PREFIX.slice(0, -1), // "enc:v1"
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

// Descriptografar dado sensível
export function decryptData(encryptedPayload: string): string {
  if (!encryptedPayload.startsWith(PREFIX)) {
    // Retorna o valor original caso o dado ainda esteja em texto limpo (suporte à migração)
    return encryptedPayload;
  }

  const parts = encryptedPayload.split(":");
  if (parts.length !== 5) {
    throw new Error("Formato do payload criptografado inválido.");
  }

  const iv = Buffer.from(parts[2], "base64url");
  const authTag = Buffer.from(parts[3], "base64url");
  const encrypted = Buffer.from(parts[4], "base64url");

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("Parâmetros do payload corrompidos.");
  }

  const key = getSecretKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
```

### Regras para exibição de senhas criptografadas:
1. **Ocultação na Listagem Geral**: As funções que listam dados (ex: `listAccesses`) nunca devem retornar a senha descriptografada no JSON de resposta. Em vez disso, retorne apenas uma flag `has_password: true`.
2. **Revelação sob demanda**: Crie uma API ou Server Function específica (`revealAccessPassword`) que aceite o ID do registro, verifique a permissão do usuário logado, descriptografe o dado, retorne a senha limpa e **escreva um log de auditoria imediatamente** registrando a revelação.

---

## 3. 🚦 Controle de Acesso e Autenticação no Servidor

Toda requisição ao servidor que realize leitura ou gravação de dados precisa passar por filtros de autenticação e de permissões granulares.

### Middleware de Autenticação (`requireAuth`):
O fluxo de autenticação deve validar o token JWT enviado pelo cliente e verificar a atividade da conta no banco de dados.

```typescript
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "./supabase-admin-client";

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  const authHeader = request?.headers.get("authorization") ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    throw Object.assign(new Error("Sessão expirada ou inválida."), { statusCode: 401 });
  }

  const token = authHeader.slice(7);
  
  // 1. Validar o JWT do usuário contra o Supabase Auth
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    throw Object.assign(new Error("Sessão inválida."), { statusCode: 401 });
  }

  // 2. Buscar o usuário na nossa tabela customizada no banco para checar se ele está ativo
  const { data: dbUser } = await supabaseAdmin
    .from("users")
    .select("id, name, email, is_active, role_id, user_permission(page_key)")
    .eq("auth_id", user.id)
    .single();

  if (!dbUser || !dbUser.is_active) {
    throw Object.assign(new Error("Usuário inativo ou não cadastrado."), { statusCode: 403 });
  }

  // 3. Normalizar permissões (se for Administrador, ganha permissão total)
  const isUserAdmin = dbUser.id === 1 || dbUser.role_id === ADMIN_ROLE_ID;
  const rawPerms = dbUser.user_permission?.map((p) => p.page_key) ?? [];
  const permissions = isUserAdmin ? ALL_PERMISSIONS : rawPerms;

  const sessionUser = {
    id: dbUser.id,
    authId: user.id,
    name: dbUser.name,
    email: dbUser.email,
    permissions
  };

  // Repassa o usuário autenticado e o token para o contexto do handler
  return next({ context: { user: sessionUser, token } });
});
```

### Middleware de Permissão Granular (`requirePermission`):
Cria uma barreira específica que lê o contexto gerado pelo `requireAuth` e valida se o usuário possui a chave de permissão requerida.

```typescript
export function requirePermission(requiredKey: string) {
  return createMiddleware({ type: "function" }).server(async ({ next, context }) => {
    const user = context?.user;
    if (!user) {
      throw Object.assign(new Error("Sessão não autenticada."), { statusCode: 401 });
    }
    if (!user.permissions.includes(requiredKey)) {
      throw Object.assign(new Error("Acesso negado: permissão insuficiente."), { statusCode: 403 });
    }
    return next();
  });
}
```

### Exemplo de uso em funções de API (Server Functions):
```typescript
import { createServerFn } from "@tanstack/react-start";
import { requireAuth, requirePermission } from "./middlewares";
import { z } from "zod";

export const deleteSensitiveRecord = createServerFn({ method: "POST" })
  .middleware([requireAuth, requirePermission("delete_records")])
  .inputValidator(z.object({ id: z.number() }))
  .handler(async ({ data, context }) => {
    // Código seguro executado apenas por usuários autorizados
    const activeUser = context.user;
    // ...
  });
```

---

## 4. 🛢️ Segurança no Banco de Dados (Supabase / PostgreSQL)

A segurança do banco de dados não depende apenas das APIs. O PostgreSQL no Supabase deve ser configurado com políticas restritivas.

### Diretrizes de Modelagem:
1. **Desativação de Acesso Público por Padrão**: Toda tabela recém-criada deve ter o recurso **Row Level Security (RLS)** ativado.
2. **Utilizar Políticas RLS Baseadas em Autenticação**:
   * O cliente frontend deve usar o `supabaseClient` convencional (com a chave pública anônima `anon_key`). Suas operações serão limitadas pelas regras da política RLS.
   * O servidor privado da aplicação deve usar o `supabaseAdmin` (gerado com a chave secreta `service_role`). Esta chave ignora as políticas de RLS e é usada para processamento em lote ou consultas administrativas restritas.

### Exemplo de criação de tabela segura no PostgreSQL:
```sql
-- Criar a tabela
create table dev_project (
    id serial primary key,
    name text not null,
    created_by_id int references users(id) on delete set null,
    created_at timestamp with time zone default now()
);

-- 1. Habilitar o RLS obrigatoriamente
alter table dev_project enable row level security;

-- 2. Criar política de leitura: usuários logados podem ler projetos
create policy "Usuários autenticados podem ver projetos"
on dev_project for select
to authenticated
using (true);

-- 3. Criar política de inserção/edição: usuários só criam ou alteram seus próprios projetos
create policy "Usuários podem criar seus próprios projetos"
on dev_project for insert
to authenticated
with check (auth.uid() = (select auth_id from users where id = created_by_id));

create policy "Usuários podem atualizar seus próprios projetos"
on dev_project for update
to authenticated
using (auth.uid() = (select auth_id from users where id = created_by_id));
```

### Sincronização Automática com Supabase Auth (`Triggers`):
Ao criar um usuário no Supabase Auth (tabela `auth.users`), utilize uma função disparada por `trigger` para alimentar com segurança a tabela `public.users` interna.

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.users (auth_id, email, name, is_active)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'name', 'Novo Usuário'),
        true
    );
    return new;
end;
$$;

-- Criar gatilho
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
```

---

## 5. 📝 Auditoria e Captura de Erros

Um sistema seguro deve ser rastreável. Crie uma estrutura centralizada para registrar ações do usuário e falhas críticas no servidor.

### Gravação de Logs de Ação (`writeLog`):
Toda escrita de dados importantes deve invocar esta função:

```typescript
import { supabaseAdmin } from "./supabase-admin-client";

interface LogParams {
  user_id: number;
  user_name: string;
  user_email: string;
  action: "create" | "edit" | "delete" | "login" | "reveal";
  entity: string;
  module_name: string;
  description: string;
}

export async function writeLog(params: LogParams) {
  await supabaseAdmin.from("log").insert({
    user_id: params.user_id,
    user_name: params.user_name,
    user_email: params.user_email,
    action: params.action,
    entity: params.entity,
    module_name: params.module_name,
    description: params.description,
    created_at: new Date().toISOString()
  });
}
```

### Captura Global de Erros de Middleware:
No middleware de autenticação, envolva a chamada do handler (`next()`) em um bloco `try-catch` para capturar falhas imprevistas e salvá-las na tabela `error_log`:

```typescript
try {
  return await next();
} catch (error) {
  // Salva no banco o rastro do erro
  await supabaseAdmin.from("error_log").insert({
    user_id: sessionUser.id,
    user_name: sessionUser.name,
    user_email: sessionUser.email,
    route: request?.url ?? null,
    message: (error as Error).message ?? String(error),
    stack: (error as Error).stack ?? null,
    status_code: (error as any).statusCode ?? 500,
    created_at: new Date().toISOString()
  });
  throw error; // Repassa o erro para o tratamento de tela
}
```

---

## 6. 🧼 Sanitização de Inputs no Servidor (Anti-XSS)

* **Princípio**: Nunca confie na entrada de texto formatado (HTML) enviada pelo cliente.
* **Defesa**: Antes de inserir qualquer texto rico ou HTML no banco de dados, passe-o por uma biblioteca de sanitização no servidor (como `sanitize-html`).
* **Implementação**:

```typescript
import sanitizeHtml from "sanitize-html";

export function sanitizeUserInput(dirtyHtml: string): string {
  return sanitizeHtml(dirtyHtml, {
    allowedTags: [ "b", "i", "em", "strong", "a", "p", "ul", "ol", "li", "br" ],
    allowedAttributes: {
      "a": [ "href", "target", "rel" ]
    },
    allowedSchemes: [ "http", "https", "mailto" ]
  });
}
```

---

## 7. 🗂️ Upload Seguro de Arquivos (Supabase Storage)

* **Princípio**: Arquivos carregados por usuários podem conter scripts ocultos ou vulnerabilidades que infectam o navegador de outros usuários.
* **Defesas**:
  1. **Restrição por Mime-Type**: Configure o Supabase Storage para rejeitar qualquer extensão diferente do escopo necessário (ex: aceitar apenas `application/pdf`, `image/png`, `image/jpeg`).
  2. **Baldes Privados (Private Buckets)**: Os arquivos não devem estar disponíveis publicamente por URLs estáticas perpétuas. Use links temporários assinados (`createSignedUrl`) que expiram em minutos.
  3. **Forçar Download Seguro**: Ao expor os arquivos, sirva-os com o cabeçalho `Content-Disposition: attachment; filename="arquivo.pdf"`. Isso obriga o navegador a fazer o download físico do arquivo em vez de renderizá-lo (evitando que scripts HTML inseridos no meio do arquivo rodem na sessão ativa da sua aplicação).

---

## 8. ⏱️ Prevenção de Abuso e DoS (Rate Limiting)

* **Princípio**: Limitar a quantidade de requisições que uma única conta ou endereço de IP pode fazer em um intervalo de tempo, mitigando ataques de força bruta à senha ou esgotamento de créditos de IA.
* **Como Implementar**:
  1. **Servidor Edge ou Proxy (Cloudflare)**: Configure regras de Rate Limiting diretamente na borda (Edge) para chamadas de rotas de `/api/auth/login`.
  2. **Rate Limiter em Banco (Supabase/Postgres)**:
     Crie uma tabela de logs de tentativas ou use uma função de controle para verificar se o IP fez mais de $N$ requisições nos últimos $M$ minutos antes de disparar o processamento pesado.

---

## 9. 🌐 Cabeçalhos de Segurança HTTP (Content Security Policy - CSP)

* **Princípio**: Garantir que o navegador do usuário carregue e execute scripts e conexões que pertençam **apenas** a domínios seguros autorizados.
* **Configuração básica no servidor (Headers HTTP)**:
  Envie em todas as respostas os cabeçalhos abaixo para mitigar Clickjacking, XSS e sniffing de Mime-Type:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://apis.google.com; connect-src 'self' https://*.supabase.co https://integrate.api.nvidia.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline';
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

---

## 🔍 Resumo para Instrução de IA (Prompt Rápido)
Ao usar este manual com outra IA, copie e cole este bloco de instrução:

> *"Configure o projeto de acordo com o manual. Utilize NodeJS nativo (`node:crypto`) com AES-256-GCM para criptografia bidirecional de chaves e credenciais sensíveis na tabela `tdp_access`. Mantenha os dados secretos estritamente no servidor sem expô-los no frontend. Proteja as funções do servidor com middlewares que comprovem o token JWT do usuário ativo no Supabase Auth e validem as permissões na tabela `user_permission`. Force o Row Level Security (RLS) no Supabase SQL. Trate uploads restringindo mime-types, mantendo buckets privados e servindo downloads com cabeçalhos 'Content-Disposition: attachment'. Aplique sanitização de HTML no servidor e adote controle de frequência (Rate Limiting)."*
