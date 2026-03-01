/**
 * Valida CPF brasileiro com cálculo dos dígitos verificadores.
 */
export function isValidCPF(cpf) {
  if (!cpf) return false;
  const digits = String(cpf).replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  for (let t = 9; t < 11; t++) {
    let sum = 0;
    for (let i = 0; i < t; i++) {
      sum += parseInt(digits[i]) * (t + 1 - i);
    }
    let remainder = (sum * 10) % 11;
    if (remainder === 10) remainder = 0;
    if (remainder !== parseInt(digits[t])) return false;
  }
  return true;
}

/**
 * Valida CNPJ brasileiro com cálculo dos dígitos verificadores.
 */
export function isValidCNPJ(cnpj) {
  if (!cnpj) return false;
  const digits = String(cnpj).replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  for (const [t, w] of [[12, weights1], [13, weights2]]) {
    let sum = 0;
    for (let i = 0; i < t; i++) {
      sum += parseInt(digits[i]) * w[i];
    }
    let remainder = sum % 11;
    const expected = remainder < 2 ? 0 : 11 - remainder;
    if (parseInt(digits[t]) !== expected) return false;
  }
  return true;
}

/**
 * Formata CPF para exibição: 123.456.789-00
 * Se já formatado, retorna como está.
 */
export function formatCPF(cpf) {
  if (!cpf) return '';
  const digits = String(cpf).replace(/\D/g, '');
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/**
 * Formata telefone para padrão internacional (5543999991234).
 * Aceita: +55 43 99999-1234, (43) 99999-1234, 43999991234, etc.
 */
export function formatPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

/**
 * Extrai CPF de um texto livre usando regex.
 * Detecta: 123.456.789-00, 12345678900, ou sequências de 11 dígitos.
 */
export function extractCPFFromText(text) {
  const formatted = text.match(/\d{3}\.?\d{3}\.?\d{3}[-.]?\d{2}/);
  if (formatted) {
    const candidate = formatted[0].replace(/\D/g, '');
    if (candidate.length === 11 && isValidCPF(candidate)) return candidate;
  }
  return null;
}
