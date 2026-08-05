import os
import sys
import re
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

# 1. Carregar variáveis do .env manual caso rode direto
env_path = r"c:\Users\vieir\Desktop\NCM\.env"
db_url = None

if os.path.exists(env_path):
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                if key.strip() == "DATABASE_URL":
                    db_url = val.strip()
                    break

if not db_url:
    print("Erro: DATABASE_URL não encontrada no .env", file=sys.stderr)
    sys.exit(1)

# Se a URL contiver placeholders, avisa e sai
if "SUA_SENHA_AQUI" in db_url:
    print("Erro: A senha do banco ainda não foi configurada no .env", file=sys.stderr)
    sys.exit(1)

excel_path = r"c:\Users\vieir\Desktop\NCM\Tabela_NCM_Vigente_20260804.xlsx"

# SQL para estruturação do banco de dados
SQL_SCHEMA = """
-- 1. Habilitar UUID-OSSP
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabela de Usuários (Sincronizada com Supabase Auth)
CREATE TABLE IF NOT EXISTS public.users (
    id SERIAL PRIMARY KEY,
    auth_id UUID UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS para users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura para autenticados" ON public.users
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir atualização do próprio perfil" ON public.users
    FOR UPDATE TO authenticated USING (auth.uid() = auth_id);

-- 3. Tabela de NCMs
CREATE TABLE IF NOT EXISTS public.ncms (
    code VARCHAR(8) PRIMARY KEY,
    description TEXT NOT NULL,
    chapter VARCHAR(2) NOT NULL,
    position VARCHAR(4) NOT NULL,
    subposition VARCHAR(6) NOT NULL,
    full_description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS para ncms
ALTER TABLE public.ncms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura pública de NCMs para autenticados" ON public.ncms
    FOR SELECT TO authenticated USING (true);

-- 4. Tabela de Favoritos
CREATE TABLE IF NOT EXISTS public.favorites (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(auth_id) ON DELETE CASCADE,
    ncm_code VARCHAR(8) REFERENCES public.ncms(code) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, ncm_code)
);

-- RLS para favoritos
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários podem ver seus próprios favoritos" ON public.favorites
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Usuários podem criar seus próprios favoritos" ON public.favorites
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuários podem deletar seus próprios favoritos" ON public.favorites
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 5. Tabela de Logs de Auditoria
CREATE TABLE IF NOT EXISTS public.log (
    id SERIAL PRIMARY KEY,
    user_id UUID,
    user_name TEXT,
    user_email TEXT,
    action VARCHAR(50) NOT NULL,
    entity TEXT,
    module_name TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS para logs (apenas inserção permitida por autenticados, leitura apenas por administradores se houver)
ALTER TABLE public.log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir criação de logs por autenticados" ON public.log
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Permitir leitura de logs para o próprio usuário" ON public.log
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 6. Tabela de Logs de Erro
CREATE TABLE IF NOT EXISTS public.error_log (
    id SERIAL PRIMARY KEY,
    user_id UUID,
    user_name TEXT,
    user_email TEXT,
    route TEXT,
    message TEXT NOT NULL,
    stack TEXT,
    status_code INT DEFAULT 500,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS para logs de erro
ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir criação de logs de erro por autenticados" ON public.error_log
    FOR INSERT TO authenticated WITH CHECK (true);

-- 7. Função e Trigger para sincronizar auth.users com public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (auth_id, email, name, is_active)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', 'Novo Usuário'),
        TRUE
    ) ON CONFLICT (auth_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
"""

def create_db_schema(conn):
    print("Criando estrutura física de tabelas no banco de dados...")
    with conn.cursor() as cur:
        cur.execute(SQL_SCHEMA)
    conn.commit()
    print("Estrutura do banco criada com sucesso!")

def load_and_parse_excel(path):
    print("Lendo planilha do Excel...")
    df = pd.read_excel(path, header=None)
    
    # Procurar a linha do cabeçalho
    header_idx = None
    for idx, row in df.iterrows():
        val = str(row[0]).strip().lower()
        if "código" in val or "cód" in val or "cod" in val:
            header_idx = idx
            break
            
    if header_idx is None:
        raise ValueError("Cabeçalho da tabela NCM não encontrado!")
        
    headers = [str(val).strip() for val in df.iloc[header_idx]]
    df_clean = df.iloc[header_idx + 1:].copy()
    df_clean.columns = headers
    
    code_col = headers[0]
    desc_col = headers[1]
    
    # Filtra linhas sem código
    df_clean = df_clean[df_clean[code_col].notna()]
    
    # Tratamento dos códigos
    # Remove pontos e espaços, garantindo string
    df_clean['code_clean'] = df_clean[code_col].astype(str).str.strip().str.replace('.', '', regex=False)
    
    # Como os códigos perdem o zero à esquerda no Excel:
    # 2 dígitos -> Capítulo (zfill 2)
    # 4 dígitos -> Posição (zfill 4)
    # 5/6 dígitos -> Subposição (zfill 6)
    # 7/8 dígitos -> NCM completo (zfill 8)
    def clean_and_pad(code):
        c = re.sub(r'[^0-9]', '', code)
        length = len(c)
        if length <= 2:
            return c.zfill(2)
        elif length <= 4:
            return c.zfill(4)
        elif length <= 6:
            return c.zfill(6)
        else:
            return c.zfill(8)
            
    df_clean['code_clean'] = df_clean['code_clean'].apply(clean_and_pad)
    df_clean['len'] = df_clean['code_clean'].str.len()
    
    print(f"Total de registros limpos: {len(df_clean)}")
    
    # Agrupar descrições por nível para fazer a busca hierárquica
    capitulos = {}
    posicoes = {}
    subposicoes = {}
    ncms_8 = []
    
    # Dicionário temporário de mapeamento código -> descrição original
    mapping = {}
    for idx, row in df_clean.iterrows():
        code = row['code_clean']
        desc = str(row[desc_col]).strip()
        mapping[code] = desc
        
        if len(code) == 2:
            capitulos[code] = desc
        elif len(code) == 4:
            posicoes[code] = desc
        elif len(code) == 6:
            subposicoes[code] = desc
        elif len(code) == 8:
            ncms_8.append({
                'code': code,
                'description': desc
            })
            
    print(f"Capítulos carregados: {len(capitulos)}")
    print(f"Posições carregadas: {len(posicoes)}")
    print(f"Subposições carregadas: {len(subposicoes)}")
    print(f"NCMs finais (8 dígitos) carregados: {len(ncms_8)}")
    
    # Montar os registros com a descrição enriquecida (full_description)
    final_records = []
    for item in ncms_8:
        code = item['code']
        desc = item['description']
        
        cap_code = code[:2]
        pos_code = code[:4]
        sub_code = code[:6]
        
        cap_desc = capitulos.get(cap_code, "")
        pos_desc = posicoes.get(pos_code, "")
        sub_desc = subposicoes.get(sub_code, "")
        
        # Montar a descrição completa hierárquica
        hierarchy_parts = []
        if cap_desc:
            hierarchy_parts.append(f"Cap. {cap_code} - {cap_desc}")
        if pos_desc:
            hierarchy_parts.append(pos_desc)
        if sub_desc:
            hierarchy_parts.append(sub_desc)
        hierarchy_parts.append(desc)
        
        full_desc = " > ".join([p for p in hierarchy_parts if p])
        
        final_records.append((
            code,
            desc,
            cap_code,
            pos_code,
            sub_code,
            full_desc
        ))
        
    return final_records

def insert_ncms_in_bulk(conn, records):
    print("Iniciando a inserção dos dados de NCM no banco...")
    query = """
        INSERT INTO public.ncms (code, description, chapter, position, subposition, full_description)
        VALUES %s
        ON CONFLICT (code) DO UPDATE SET
            description = EXCLUDED.description,
            chapter = EXCLUDED.chapter,
            position = EXCLUDED.position,
            subposition = EXCLUDED.subposition,
            full_description = EXCLUDED.full_description
    """
    
    # Inserir em lotes de 1000
    batch_size = 1000
    total = len(records)
    
    with conn.cursor() as cur:
        for i in range(0, total, batch_size):
            batch = records[i:i + batch_size]
            print(f"Inserindo lote {i//batch_size + 1} ({i} a {min(i + batch_size, total)})...")
            execute_values(cur, query, batch)
            conn.commit()
            
    print("Inserção concluída com sucesso!")

def main():
    try:
        print(f"Conectando ao banco de dados Supabase...")
        conn = psycopg2.connect(db_url)
        
        # 1. Criar o schema
        create_db_schema(conn)
        
        # 2. Carregar e tratar os dados
        records = load_and_parse_excel(excel_path)
        
        # 3. Fazer o insert em lote
        insert_ncms_in_bulk(conn, records)
        
        conn.close()
        print("Tudo pronto! Banco de dados estruturado e populado.")
        
    except Exception as e:
        print(f"Erro crítico no processo de importação: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
