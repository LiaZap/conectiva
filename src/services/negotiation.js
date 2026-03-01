/**
 * negotiation.js — Serviço de negociação automática.
 *
 * Consulta a tabela `negotiation_rules` e calcula:
 *   - Desconto máximo disponível
 *   - Quantidade máxima de parcelas
 *   - Se deve escalonar para humano (dívidas muito antigas)
 *
 * Fluxo:
 *   1. Recebe faturas pendentes do cliente
 *   2. Calcula dias de atraso da fatura mais antiga
 *   3. Busca a regra correspondente na tabela
 *   4. Retorna proposta de negociação ou escalonamento
 */

import { query } from '../config/database.js';

/**
 * Busca as regras de negociação ativas, ordenadas por dias de atraso.
 */
export async function getRules() {
  const { rows } = await query(
    `SELECT * FROM negotiation_rules
     WHERE ativo = true
     ORDER BY dias_atraso_min ASC`
  );
  return rows;
}

/**
 * Encontra a regra aplicável para um número de dias de atraso.
 */
export async function findRule(diasAtraso) {
  const { rows } = await query(
    `SELECT * FROM negotiation_rules
     WHERE ativo = true
       AND dias_atraso_min <= $1
       AND dias_atraso_max >= $1
     LIMIT 1`,
    [diasAtraso]
  );
  return rows[0] || null;
}

/**
 * Calcula dias de atraso a partir de uma data de vencimento.
 */
export function calcularDiasAtraso(dataVencimento) {
  const vencimento = new Date(dataVencimento);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  vencimento.setHours(0, 0, 0, 0);

  const diffMs = hoje - vencimento;
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDias);
}

/**
 * Calcula o valor com desconto aplicado.
 */
function aplicarDesconto(valor, percentDesconto) {
  const desconto = valor * (percentDesconto / 100);
  return Math.round((valor - desconto) * 100) / 100;
}

/**
 * Gera opções de parcelamento para um valor.
 */
function gerarParcelas(valor, maxParcelas) {
  const opcoes = [];

  for (let i = 1; i <= maxParcelas; i++) {
    const valorParcela = Math.round((valor / i) * 100) / 100;
    opcoes.push({
      parcelas: i,
      valor_parcela: valorParcela,
      valor_total: Math.round(valorParcela * i * 100) / 100,
      label: i === 1
        ? `À vista: R$ ${valorParcela.toFixed(2)}`
        : `${i}x de R$ ${valorParcela.toFixed(2)}`,
    });
  }

  return opcoes;
}

/**
 * Formata valor em reais.
 */
function formatBRL(valor) {
  return `R$ ${Number(valor).toFixed(2).replace('.', ',')}`;
}

/**
 * Analisa as faturas do cliente e gera uma proposta de negociação.
 *
 * @param {Array} faturas - Faturas pendentes (cada uma com valor, vencimento, cd_fatura)
 * @returns {Object} Proposta de negociação
 *
 * Retorno:
 *   {
 *     tipo: 'desconto_automatico' | 'escalonar_humano',
 *     resumo: { total_faturas, valor_total, dias_atraso_max, fatura_mais_antiga },
 *     regra: { ... },
 *     proposta: {
 *       desconto_percent, valor_original, valor_com_desconto,
 *       economia, parcelas_opcoes
 *     },
 *     mensagem: "Texto formatado para enviar ao cliente"
 *   }
 */
export async function analisarNegociacao(faturas) {
  if (!faturas || faturas.length === 0) {
    return {
      tipo: 'sem_debitos',
      resumo: { total_faturas: 0, valor_total: 0 },
      proposta: null,
      mensagem: 'Parabéns! Você não possui faturas pendentes.',
    };
  }

  // Calcular resumo dos débitos
  const faturasAnalisadas = faturas.map((f) => {
    const valor = parseFloat(f.valor || f.ValorDocumento || f.valor_documento || 0);
    const vencimento = f.vencimento || f.DataVencimento || f.data_vencimento;
    const diasAtraso = vencimento ? calcularDiasAtraso(vencimento) : 0;

    return {
      cd_fatura: f.cd_fatura || f.CodigoFatura || f.codigo_fatura,
      valor,
      vencimento,
      dias_atraso: diasAtraso,
    };
  });

  // Apenas faturas vencidas (dias > 0)
  const faturasVencidas = faturasAnalisadas.filter((f) => f.dias_atraso > 0);

  if (faturasVencidas.length === 0) {
    const valorTotal = faturasAnalisadas.reduce((sum, f) => sum + f.valor, 0);
    return {
      tipo: 'sem_atraso',
      resumo: {
        total_faturas: faturasAnalisadas.length,
        valor_total: valorTotal,
        dias_atraso_max: 0,
      },
      proposta: null,
      mensagem:
        `Você possui ${faturasAnalisadas.length} fatura(s) em aberto no valor total de ${formatBRL(valorTotal)}, ` +
        `mas nenhuma está vencida. Deseja que eu envie a linha digitável para pagamento?`,
    };
  }

  // Totais
  const valorTotal = faturasVencidas.reduce((sum, f) => sum + f.valor, 0);
  const diasAtrasoMax = Math.max(...faturasVencidas.map((f) => f.dias_atraso));
  const faturaMaisAntiga = faturasVencidas.find((f) => f.dias_atraso === diasAtrasoMax);

  const resumo = {
    total_faturas: faturasVencidas.length,
    valor_total: valorTotal,
    dias_atraso_max: diasAtrasoMax,
    fatura_mais_antiga: faturaMaisAntiga,
  };

  // Buscar regra aplicável
  const regra = await findRule(diasAtrasoMax);

  if (!regra) {
    return {
      tipo: 'escalonar_humano',
      resumo,
      regra: null,
      proposta: null,
      mensagem:
        `Identifiquei ${faturasVencidas.length} fatura(s) vencida(s) no valor de ${formatBRL(valorTotal)}. ` +
        `Vou transferir para um atendente que poderá oferecer as melhores condições de negociação.`,
    };
  }

  // Se a regra manda escalonar
  if (regra.acao === 'escalonar_humano') {
    return {
      tipo: 'escalonar_humano',
      resumo,
      regra,
      proposta: null,
      mensagem:
        `Identifiquei ${faturasVencidas.length} fatura(s) vencida(s) há ${diasAtrasoMax} dias, ` +
        `totalizando ${formatBRL(valorTotal)}. Para dívidas com esse período de atraso, ` +
        `vou transferir para um atendente que poderá oferecer condições especiais de negociação.`,
    };
  }

  // Calcular proposta de desconto automático
  const descontoPercent = parseFloat(regra.desconto_max_percent);
  const valorComDesconto = aplicarDesconto(valorTotal, descontoPercent);
  const economia = Math.round((valorTotal - valorComDesconto) * 100) / 100;
  const parcelasOpcoes = gerarParcelas(valorComDesconto, regra.parcelas_max);

  const proposta = {
    desconto_percent: descontoPercent,
    valor_original: valorTotal,
    valor_com_desconto: valorComDesconto,
    economia,
    parcelas_max: regra.parcelas_max,
    parcelas_opcoes: parcelasOpcoes,
  };

  // Montar mensagem
  let mensagem =
    `Identifiquei ${faturasVencidas.length} fatura(s) vencida(s) totalizando ${formatBRL(valorTotal)}.\n\n`;

  if (descontoPercent > 0) {
    mensagem += `Posso oferecer um desconto de ${descontoPercent}%, ` +
      `ficando em ${formatBRL(valorComDesconto)} (economia de ${formatBRL(economia)}).\n\n`;
  }

  mensagem += `Opções de pagamento:\n`;
  for (const opcao of parcelasOpcoes) {
    mensagem += `  • ${opcao.label}\n`;
  }

  mensagem += `\nDeseja prosseguir com alguma dessas opções?`;

  return {
    tipo: 'desconto_automatico',
    resumo,
    regra,
    proposta,
    mensagem,
  };
}
