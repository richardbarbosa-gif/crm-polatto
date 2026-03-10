import { supabaseClient } from "../utility";
import { isLeadTemperature, type LeadTemperature } from "./leadTemperature";

const STORAGE_KEY = "crm-polatto:lead-temperature:v1";

/**
 * Migra temperaturas de leads do localStorage para a coluna `temperatura` na tabela `clientes`.
 * Executar uma vez manualmente via console do navegador: `migrateLeadTemperaturesFromLocalStorage()`.
 * Após a migração, a chave do localStorage é removida.
 */
export const migrateLeadTemperaturesFromLocalStorage = async (): Promise<{
    migrated: number;
    failed: number;
    skipped: number;
}> => {
    if (typeof window === "undefined") {
        return { migrated: 0, failed: 0, skipped: 0 };
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return { migrated: 0, failed: 0, skipped: 0 };
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return { migrated: 0, failed: 0, skipped: 0 };
    }

    const entries = Object.entries(parsed).filter(
        (entry): entry is [string, LeadTemperature] => isLeadTemperature(entry[1]),
    );

    let migrated = 0;
    let failed = 0;
    let skipped = 0;

    for (const [id, temperatura] of entries) {
        const { error } = await supabaseClient
            .from("clientes")
            .update({ temperatura })
            .eq("id", id)
            .is("temperatura", null);

        if (error) {
            console.warn(`Falha ao migrar temperatura do lead ${id}:`, error.message);
            failed++;
        } else {
            migrated++;
        }
    }

    skipped = entries.length - migrated - failed;

    window.localStorage.removeItem(STORAGE_KEY);
    console.log(`Migração concluída: ${migrated} migrados, ${failed} falhas, ${skipped} ignorados.`);

    return { migrated, failed, skipped };
};

// Expor globalmente para uso via console do navegador
if (typeof window !== "undefined") {
    (window as any).migrateLeadTemperaturesFromLocalStorage = migrateLeadTemperaturesFromLocalStorage;
}
