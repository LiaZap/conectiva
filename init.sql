-- ============================================================
-- Conectiva Bot - Schema PostgreSQL
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. SESSIONS - Cada conversa é uma sessão
-- ============================================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    canal VARCHAR(20) NOT NULL CHECK (canal IN ('whatsapp', 'site')),
    telefone VARCHAR(20),
    nome_cliente VARCHAR(255),
    cpf_cnpj VARCHAR(20),
    cd_cliente_mk INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'ativa'
        CHECK (status IN ('ativa', 'aguardando_humano', 'finalizada', 'expirada', 'aguardando_avaliacao')),
    intencao_principal VARCHAR(50),
    total_mensagens INTEGER NOT NULL DEFAULT 0,
    resolvida_por VARCHAR(20) CHECK (resolvida_por IN ('ia', 'humano', NULL)),
    nota_satisfacao INTEGER CHECK (nota_satisfacao >= 1 AND nota_satisfacao <= 5),
    resumo_ia TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
);

-- ============================================================
-- 2. MESSAGES - Cada mensagem individual
-- ============================================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    direcao VARCHAR(10) NOT NULL CHECK (direcao IN ('entrada', 'saida')),
    conteudo TEXT NOT NULL,
    canal VARCHAR(20),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. INTERACTIONS_LOG - Log detalhado do processamento da IA
-- ============================================================
CREATE TABLE interactions_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    intencao VARCHAR(50),
    confianca DECIMAL(3,2) CHECK (confianca >= 0 AND confianca <= 1),
    mensagem_cliente TEXT,
    resposta_ia TEXT,
    acao_mk VARCHAR(100),
    mk_endpoint VARCHAR(100),
    mk_sucesso BOOLEAN,
    mk_resposta JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'processando'
        CHECK (status IN ('processando', 'sucesso', 'erro', 'escalonado', 'aguardando_cpf')),
    tempo_classificacao_ms INTEGER,
    tempo_mk_ms INTEGER,
    tempo_resposta_ms INTEGER,
    os_criada VARCHAR(50),
    boleto_gerado BOOLEAN NOT NULL DEFAULT FALSE,
    desbloqueio_executado BOOLEAN NOT NULL DEFAULT FALSE,
    contrato_criado BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. AI_ACTIONS_LOG - Log granular de cada ação da IA
-- ============================================================
CREATE TABLE ai_actions_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    interaction_id UUID REFERENCES interactions_log(id) ON DELETE CASCADE,
    acao VARCHAR(100) NOT NULL,
    descricao TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'executando'
        CHECK (status IN ('executando', 'sucesso', 'erro')),
    dados_entrada JSONB,
    dados_saida JSONB,
    tempo_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. ESCALATIONS - Escalonamentos para humano
-- ============================================================
CREATE TABLE escalations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    motivo TEXT NOT NULL,
    prioridade VARCHAR(10) NOT NULL DEFAULT 'media'
        CHECK (prioridade IN ('baixa', 'media', 'alta', 'critica')),
    historico_conversa JSONB,
    dados_cliente JSONB,
    os_mk VARCHAR(50),
    atendente_designado VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente', 'em_atendimento', 'resolvido', 'cancelado')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. NEGOTIATION_RULES - Regras de negociação configuráveis
-- ============================================================
CREATE TABLE negotiation_rules (
    id SERIAL PRIMARY KEY,
    dias_atraso_min INTEGER NOT NULL,
    dias_atraso_max INTEGER NOT NULL,
    desconto_max_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    parcelas_max INTEGER NOT NULL DEFAULT 1,
    acao VARCHAR(50) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_dias_range CHECK (dias_atraso_max >= dias_atraso_min)
);

-- ============================================================
-- INDEXES
-- ============================================================

-- sessions
CREATE INDEX idx_sessions_telefone ON sessions(telefone);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_cpf ON sessions(cpf_cnpj);
CREATE INDEX idx_sessions_expires ON sessions(expires_at) WHERE status = 'ativa';
CREATE INDEX idx_sessions_canal ON sessions(canal);

-- messages
CREATE INDEX idx_messages_session ON messages(session_id);
CREATE INDEX idx_messages_created ON messages(session_id, created_at);

-- interactions_log
CREATE INDEX idx_interactions_session ON interactions_log(session_id);
CREATE INDEX idx_interactions_intencao ON interactions_log(intencao);
CREATE INDEX idx_interactions_status ON interactions_log(status);

-- ai_actions_log
CREATE INDEX idx_ai_actions_session ON ai_actions_log(session_id);
CREATE INDEX idx_ai_actions_interaction ON ai_actions_log(interaction_id);

-- escalations
CREATE INDEX idx_escalations_status ON escalations(status);
CREATE INDEX idx_escalations_prioridade ON escalations(prioridade) WHERE status = 'pendente';
CREATE INDEX idx_escalations_session ON escalations(session_id);

-- negotiation_rules
CREATE INDEX idx_negotiation_ativo ON negotiation_rules(ativo) WHERE ativo = TRUE;

-- ============================================================
-- SEED - Regras de negociação padrão
-- ============================================================
INSERT INTO negotiation_rules (dias_atraso_min, dias_atraso_max, desconto_max_percent, parcelas_max, acao) VALUES
    (1,   30,  5.00,  2, 'desconto_automatico'),
    (31,  90,  10.00, 4, 'desconto_automatico'),
    (91,  180, 15.00, 6, 'desconto_automatico'),
    (181, 9999, 0.00, 1, 'escalonar_humano');

-- ============================================================
-- MIGRATION: Adicionar colunas CSAT + Resumo IA (v2)
-- Executar em produção se o banco já existe:
-- ============================================================
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS nota_satisfacao INTEGER CHECK (nota_satisfacao >= 1 AND nota_satisfacao <= 5);
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS resumo_ia TEXT;
-- ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
-- ALTER TABLE sessions ADD CONSTRAINT sessions_status_check CHECK (status IN ('ativa', 'aguardando_humano', 'finalizada', 'expirada', 'aguardando_avaliacao'));
