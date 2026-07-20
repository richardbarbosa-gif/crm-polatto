import Papa from "papaparse";

/**
 * Exporta linhas para CSV compatível com Excel BR:
 * delimitador ";" e BOM UTF-8 para acentuação correta.
 */
export const exportRowsToCsv = (
    filename: string,
    rows: Record<string, unknown>[],
): void => {
    if (!rows.length) return;

    const csv = Papa.unparse(rows, { delimiter: ";" });

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
