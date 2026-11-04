/**
 * Validação de CPF e CNPJ pelos dígitos verificadores.
 *
 * O cadastro só formatava o documento: "111.111.111-11" ou um CNPJ com um
 * dígito trocado entravam normalmente e quebravam a deduplicação, a
 * emissão de contrato e a vinculação a organizações (que usa o CNPJ).
 */

export const somenteDigitos = (valor?: string | null): string => (valor ?? "").replace(/\D/g, "");

const todosIguais = (digitos: string): boolean => /^(\d)\1+$/.test(digitos);

export const validarCpf = (valor?: string | null): boolean => {
    const cpf = somenteDigitos(valor);
    if (cpf.length !== 11 || todosIguais(cpf)) return false;

    const digitoVerificador = (base: string, pesoInicial: number): number => {
        const soma = base
            .split("")
            .reduce((acc, digito, indice) => acc + Number(digito) * (pesoInicial - indice), 0);
        const resto = (soma * 10) % 11;
        return resto === 10 ? 0 : resto;
    };

    const primeiro = digitoVerificador(cpf.slice(0, 9), 10);
    const segundo = digitoVerificador(cpf.slice(0, 10), 11);
    return primeiro === Number(cpf[9]) && segundo === Number(cpf[10]);
};

/**
 * CNPJ em caracteres válidos (dígitos e, desde jul/2026, letras A–Z nas 12
 * primeiras posições — o CNPJ alfanumérico da Receita Federal).
 */
export const normalizarCnpj = (valor?: string | null): string =>
    (valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * CNPJ numérico ou alfanumérico pelos dígitos verificadores. Cada caractere
 * vale (código ASCII − 48): "0".."9" = 0..9, "A" = 17 … "Z" = 42. Mesma conta
 * de identidade_cnpj_valido() no banco (migration 13).
 */
export const validarCnpj = (valor?: string | null): boolean => {
    const cnpj = normalizarCnpj(valor);
    if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;

    const valorDoCaractere = (c: string) => c.charCodeAt(0) - 48;
    const digitoVerificador = (base: string): number => {
        const pesos = base.length === 12
            ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
            : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        const soma = base.split("").reduce((acc, c, i) => acc + valorDoCaractere(c) * pesos[i], 0);
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
    };

    const primeiro = digitoVerificador(cnpj.slice(0, 12));
    const segundo = digitoVerificador(cnpj.slice(0, 13));
    return primeiro === Number(cnpj[12]) && segundo === Number(cnpj[13]);
};

/** Aceita CPF (11 dígitos) ou CNPJ (14 dígitos) válidos. */
export const validarCpfOuCnpj = (valor?: string | null): boolean => {
    const caracteres = normalizarCnpj(valor);
    if (caracteres.length === 11 && /^\d+$/.test(caracteres)) return validarCpf(caracteres);
    if (caracteres.length === 14) return validarCnpj(caracteres);
    return false;
};

/**
 * Regra de formulário do antd: vazio passa (a obrigatoriedade é outra
 * regra); preenchido precisa ser um documento válido.
 */
export const regraCpfCnpj = (tipo: "cpf" | "cnpj" | "ambos" = "ambos") => ({
    validator: async (_: unknown, valor?: string | null) => {
        if (!normalizarCnpj(valor)) return;
        const valido =
            tipo === "cpf" ? validarCpf(valor) : tipo === "cnpj" ? validarCnpj(valor) : validarCpfOuCnpj(valor);
        if (!valido) {
            const nome = tipo === "cpf" ? "CPF" : tipo === "cnpj" ? "CNPJ" : "CPF ou CNPJ";
            throw new Error(`${nome} inválido. Confira os dígitos.`);
        }
    },
});

/**
 * Telefone brasileiro: 10 (fixo) ou 11 (celular) dígitos com DDD; números
 * de outros países passam com 7 a 15 dígitos (padrão E.164).
 */
export const validarTelefone = (valor?: string | null, ddi = "+55"): boolean => {
    const digitos = somenteDigitos(valor);
    if (ddi === "+55") return digitos.length === 10 || digitos.length === 11;
    return digitos.length >= 7 && digitos.length <= 15;
};

/** Formata DDD + número brasileiro: (11) 99999-9999 / (11) 3333-4444. */
export const formatarTelefoneBR = (valor?: string | null): string => {
    const digitos = somenteDigitos(valor).slice(0, 11);
    if (digitos.length <= 2) return digitos;
    const ddd = digitos.slice(0, 2);
    const numero = digitos.slice(2);
    if (numero.length <= 4) return `(${ddd}) ${numero}`;
    const corte = numero.length === 9 ? 5 : 4;
    return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`;
};

/**
 * Formas como o mesmo telefone pode estar gravado (digitado à mão,
 * formatado pelo cadastro, importado cru). Usado na checagem de duplicata.
 */
export const variantesTelefone = (valor?: string | null): string[] => {
    const original = (valor ?? "").trim();
    const digitos = somenteDigitos(original);
    const variantes = new Set<string>();
    if (original) variantes.add(original);
    if (digitos) {
        variantes.add(digitos);
        if (digitos.length === 10 || digitos.length === 11) variantes.add(formatarTelefoneBR(digitos));
        if (digitos.length === 12 || digitos.length === 13) {
            // 55 + DDD + número
            const semPais = digitos.startsWith("55") ? digitos.slice(2) : digitos;
            variantes.add(semPais);
            variantes.add(formatarTelefoneBR(semPais));
        }
    }
    return Array.from(variantes);
};

/** CPF/CNPJ como pode estar gravado: só dígitos ou formatado. */
export const variantesDocumento = (valor?: string | null): string[] => {
    const digitos = normalizarCnpj(valor);
    if (!digitos) return [];
    const variantes = new Set<string>([digitos]);
    if (digitos.length === 11) {
        variantes.add(`${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`);
    }
    if (digitos.length === 14) {
        variantes.add(
            `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`,
        );
    }
    const original = (valor ?? "").trim();
    if (original) variantes.add(original);
    return Array.from(variantes);
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validarEmail = (valor?: string | null): boolean => EMAIL_RE.test((valor ?? "").trim());

/** Pessoa física (CPF) ou empresa (CNPJ) — inferido do documento salvo. */
export type TipoPessoa = "pf" | "pj";

export const tipoPessoaDoDocumento = (valor?: string | null): TipoPessoa =>
    normalizarCnpj(valor).length > 11 || /[A-Z]/.test(normalizarCnpj(valor)) ? "pj" : "pf";

/** Máscara do documento conforme o tipo escolhido (CPF corta em 11 dígitos). */
export const formatarDocumento = (valor: string | null | undefined, tipo: TipoPessoa): string => {
    if (tipo === "pf") {
        const digitos = somenteDigitos(valor).slice(0, 11);
        return digitos
            .replace(/^(\d{3})(\d)/, "$1.$2")
            .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
            .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
    }
    // CNPJ: 12 caracteres alfanuméricos + 2 dígitos verificadores
    const c = normalizarCnpj(valor).slice(0, 14);
    return c
        .replace(/^([0-9A-Z]{2})([0-9A-Z])/, "$1.$2")
        .replace(/^([0-9A-Z]{2})\.([0-9A-Z]{3})([0-9A-Z])/, "$1.$2.$3")
        .replace(/\.([0-9A-Z]{3})([0-9A-Z])/, ".$1/$2")
        .replace(/([0-9A-Z]{4})([0-9A-Z]{1,2})$/, "$1-$2");
};
