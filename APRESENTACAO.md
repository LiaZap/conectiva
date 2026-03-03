# Apresentação — Sistema de Atendimento Inteligente 24/7
## Conectiva Internet + IA

---

## 1. Visão Geral

Boa tarde a todos. Vou apresentar o sistema de atendimento inteligente que desenvolvemos para a Conectiva Internet.

O objetivo principal é claro: **reduzir em até 70% a carga de trabalho da equipe humana**, oferecendo ao cliente um suporte instantâneo, 24 horas por dia, 7 dias por semana — tanto para demandas financeiras quanto técnicas.

O sistema funciona de forma integrada com o **MK Solutions**, que é o ERP já utilizado pela Conectiva. Ou seja, a IA não trabalha isolada — ela consulta, emite boletos, abre ordens de serviço e atualiza cadastros diretamente no sistema, em tempo real.

---

## 2. Como Funciona — Arquitetura

O sistema é composto por 5 camadas integradas:

1. **Canal de Entrada (WhatsApp + Site)** — O cliente envia mensagem pelo WhatsApp ou pelo chat do site. Ambos os canais chegam no mesmo motor de atendimento.

2. **Motor de IA (Ana)** — A atendente virtual se chama Ana. Ela interpreta a mensagem do cliente, classifica a intenção e decide qual ação tomar. O cliente interage de forma natural, como se estivesse falando com uma pessoa real.

3. **Integração com o MK Solutions (via n8n)** — Quando a Ana precisa consultar dados ou executar ações no sistema, ela se comunica com o MK em tempo real através de workflows automatizados.

4. **Banco de Dados (PostgreSQL)** — Toda interação é registrada: mensagens, classificações da IA, ações executadas, tempos de resposta, escalonamentos. Nada se perde.

5. **Painel de Monitoramento (Dashboard)** — Os gestores e atendentes acompanham tudo em tempo real: conversas ativas, métricas de desempenho, escalonamentos pendentes.

---

## 3. Capacidades da IA — Por Critério de Aceitação

### AC1: Automação Financeira

A IA resolve as demandas financeiras mais comuns sem precisar de intervenção humana:

- **Consulta de faturas** — O cliente pergunta "quanto eu devo?" ou "tem boleto em aberto?", e a Ana consulta diretamente no MK e informa as faturas pendentes, valores e vencimentos.

- **Segunda via de boleto** — O cliente pede a segunda via e a Ana gera automaticamente. O sistema primeiro busca as faturas pendentes, identifica a correta e emite a segunda via — tudo em uma única interação.

- **Negociação de débitos** — O sistema possui regras de negociação configuráveis. Dependendo dos dias de atraso, a Ana pode oferecer descontos ou parcelamentos dentro dos limites definidos pela gestão.

- **Consulta avançada de faturas** — Filtros por contrato, período de vencimento, status de pagamento. A Ana consegue responder perguntas específicas como "qual minha fatura de janeiro?" ou "já foi compensado meu pagamento?".

### AC2: Suporte Técnico e Triagem

Para problemas técnicos, a IA faz o primeiro nível de atendimento:

- **Diagnóstico básico** — Cliente reclama de internet lenta ou queda de conexão. A Ana orienta passos práticos: reiniciar roteador, verificar cabos, testar em outro dispositivo. Linguagem simples e direta.

- **Desbloqueio de conexão** — Se a internet foi cortada por inadimplência e o cliente regulariza, a Ana pode executar o desbloqueio automático diretamente no MK.

- **Abertura de Ordem de Serviço** — Quando o diagnóstico indica necessidade de visita técnica, a Ana abre a O.S. no MK automaticamente, sem precisar de atendente humano.

- **Escalonamento inteligente** — Casos complexos que a IA não consegue resolver são escalonados para um atendente humano. E aqui o diferencial: o atendente recebe o **histórico completo** da conversa, os dados do cliente e o motivo do escalonamento. Não precisa o cliente repetir tudo de novo.

- **Notificação em tempo real** — Quando acontece um escalonamento, o atendente é notificado de duas formas: uma **mensagem automática no grupo WhatsApp da equipe** e um **alerta sonoro + visual no painel de monitoramento**. Nenhum escalonamento passa despercebido.

### AC3: Registro e Estruturação de Dados

Toda a operação é registrada e mensurável:

- **Logs estruturados** — Cada mensagem, cada classificação da IA, cada ação executada no MK, cada tempo de resposta — tudo é gravado no banco de dados.

- **Multicanal unificado** — As interações de WhatsApp e site são registradas no mesmo formato, permitindo análise consolidada.

- **Dashboard de métricas** — O painel exibe em tempo real:
  - Volume de atendimentos por período
  - Taxa de resolução automática (sem humano)
  - Tempo médio de resposta
  - Distribuição por tipo de demanda (financeiro, técnico, cadastro)
  - Escalonamentos pendentes e histórico

- **Monitor ao vivo** — Os gestores podem acompanhar cada conversa em andamento, vendo em tempo real o que o cliente escreve, como a IA classifica e o que ela responde.

### AC4: Integração de Cadastro

A conexão com a API do MK permite operações cadastrais:

- **Consulta de cadastro** — A Ana busca os dados do cliente pelo CPF diretamente no MK.

- **Atualização de cadastro** — O cliente pode solicitar alterações de dados (endereço, telefone, e-mail) e a Ana registra a atualização no sistema.

- **Consulta de contratos** — O cliente pode verificar seus contratos ativos, planos contratados e condições.

- **Geração de contrato** — O workflow de criação de contrato está implementado e conectado à API do MK. Por envolver decisões comerciais (escolha de plano, vencimento, forma de pagamento), a Ana coleta as informações e direciona para o atendente finalizar a contratação, garantindo que o cliente receba a melhor orientação.

---

## 4. Diferenciais do Sistema

### Atendimento Humanizado
A Ana não parece um robô. Ela conversa em linguagem natural, usa expressões do dia a dia, demonstra empatia quando o cliente tem um problema. O cliente não percebe que está falando com uma IA.

### Segurança
O sistema possui proteção contra tentativas de manipulação (prompt injection). A Ana não pode ser enganada para revelar informações do sistema, ignorar regras ou executar ações indevidas. Qualquer tentativa de burla é detectada e escalada para humano.

### Leitura de Imagens e Documentos
O cliente pode enviar fotos (ex: print de erro, foto do roteador) ou documentos (PDF de comprovante), e a IA analisa o conteúdo visualmente para dar um atendimento mais preciso.

### Áudio
O cliente pode enviar áudio pelo WhatsApp. O sistema transcreve automaticamente e processa como texto normal.

### Pesquisa de Satisfação (CSAT)
Ao final de cada atendimento, o cliente recebe uma pesquisa de satisfação (nota de 1 a 5). A IA também gera um resumo automático da conversa. Tudo registrado para análise de qualidade.

### Continuidade da Conversa
A sessão fica ativa por 30 minutos. Se o cliente faz uma pergunta, recebe a resposta e depois tem outra dúvida, a Ana continua a conversa normalmente — não encerra nem interrompe. A pesquisa de satisfação só é enviada quando o atendimento realmente termina.

---

## 5. Fluxo Típico de Atendimento

```
Cliente: "Oi, quero a segunda via do meu boleto"
   ↓
Ana: "Oi! Claro, vou puxar pra você 😊 Me passa seu CPF?"
   ↓
Cliente: "123.456.789-00"
   ↓
Ana consulta MK → identifica cliente → busca faturas → gera 2ª via
   ↓
Ana: "Achei aqui! Sua fatura de R$ 89,90 vence dia 15/03.
      Aqui está o código de barras: 23793.38128..."
   ↓
Cliente: "Valeu! Outra coisa, minha internet tá lenta"
   ↓
Ana: "Eita, vou verificar! Tenta reiniciar seu roteador..."
   ↓
(30 min sem interação → sessão expira)
   ↓
Ana: "Como você avalia o atendimento? De 1 a 5 💙"
```

Todo esse fluxo acontece **sem intervenção humana** e é registrado integralmente no sistema.

---

## 6. Tecnologias Utilizadas

| Componente | Tecnologia |
|---|---|
| Backend | Node.js + Express |
| IA | OpenAI GPT (classificação + resposta + visão) |
| Banco de Dados | PostgreSQL |
| Cache | Redis |
| WhatsApp | API Uazapi |
| Integrações MK | n8n (12 workflows automatizados) |
| Dashboard | React + Tailwind CSS |
| Comunicação Real-time | WebSocket (Socket.IO) |
| Hospedagem | EasyPanel (deploy automático) |

---

## 7. Métricas Esperadas

- **Redução de até 70%** na carga da equipe humana
- **Atendimento 24/7** — sem custo de hora extra ou plantão
- **Tempo de resposta < 10 segundos** para a maioria das demandas
- **100% dos atendimentos registrados** — visibilidade total para gestão
- **Escalonamento inteligente** — humano só entra quando realmente necessário

---

## 8. Próximos Passos

1. **Testes end-to-end** com cliente real no ambiente de produção
2. **Configuração do grupo WhatsApp** para notificações de escalonamento
3. **Ajuste fino das regras de negociação** conforme política comercial da Conectiva
4. **Treinamento da equipe** para uso do painel de monitoramento
5. **Acompanhamento das métricas** na primeira semana de operação

---

*Sistema desenvolvido sob medida para a Conectiva Internet — Atendimento inteligente que funciona.*
