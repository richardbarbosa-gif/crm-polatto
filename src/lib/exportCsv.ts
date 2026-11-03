import Papa from "papaparse";

/**
 * Célula que o Excel/LibreOffice/Google Sheets interpretaria como fórmula.
 *
 * SEGURANÇA (CSV/formula injection): nome, e-mail, observação etc. vêm de
 * lead/contato — dado digitado por qualquer pessoa, inclusive importado de
 * planilha de terceiros. "=HYPERLINK(...)" ou "=WEBSERVICE(...)" num campo
 * vira fórmula executada no computador de quem abre o relatório.
 * Regex sem âncora de fim de propósito: a padrão do Papa (/^[=+\-@\t\r].*$/)
 * não casa texto com quebra de linha, e "=1+1\nx" passaria.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Monta o CSV (sem BOM) com delimitador ";" (Excel BR) e neutraliza
 * fórmulas prefixando "'" — o padrão recomendado pela OWASP; o Excel
 * esconde o apóstrofo e mostra o texto original. Números (typeof number)
 * não são tocados, então valores negativos continuam numéricos.
 */
export const rowsToCsv = (rows: Record<string, unknown>[]): string =>
    Papa.unparse(rows, { delimiter: ";", escapeFormulae: FORMULA_PREFIX });

/**
 * Exporta linhas para CSV compatível com Excel BR:
 * delimitador ";" e BOM UTF-8 para acentuação correta.
 */
export const exportRowsToCsv = (
    filename: string,
    rows: Record<string, unknown>[],
): void => {
    if (!rows.length) return;

    const csv = rowsToCsv(rows);

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
