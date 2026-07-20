/**
 * Monitoramento de erros em produção — sem dependência de serviço externo.
 * Registra erros de runtime na tabela client_errors do Supabase via RPC
 * registrar_erro_cliente (rate-limited no banco: 60 erros/usuário/hora).
 *
 * Consulta dos erros: select * from client_errors order by criado_em desc;
 */
import { supabaseClient } from "./supabaseClient";

type ErrorOrigin = "window.onerror" | "unhandledrejection" | "error-boundary" | "manual";

// Dedup local: o mesmo erro em loop (ex: erro em render) não flooda o banco
const recentErrors = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;
const MAX_ERRORS_PER_SESSION = 40;
let sessionErrorCount = 0;

const shouldReport = (message: string): boolean => {
    if (sessionErrorCount >= MAX_ERRORS_PER_SESSION) return false;
    const now = Date.now();
    const lastSeen = recentErrors.get(message);
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return false;
    recentErrors.set(message, now);
    sessionErrorCount += 1;
    return true;
};

export const reportError = (
    error: unknown,
    origin: ErrorOrigin = "manual",
    context: Record<string, unknown> = {},
): void => {
    try {
        const message =
            error instanceof Error
                ? error.message
                : typeof error === "string"
                  ? error
                  : JSON.stringify(error).slice(0, 500);

        if (!message || !shouldReport(message)) return;

        const stack = error instanceof Error ? error.stack || null : null;

        // fire-and-forget: monitoramento nunca pode quebrar a aplicação
        void supabaseClient
            .rpc("registrar_erro_cliente", {
                p_mensagem: message,
                p_stack: stack,
                p_url: window.location.href,
                p_user_agent: navigator.userAgent,
                p_origem: origin,
                p_contexto: context,
            })
            .then(undefined, () => undefined);
    } catch {
        // silêncio absoluto: nunca propagar erro do monitoramento
    }
};

let installed = false;

/** Instala os handlers globais. Chamar uma única vez no boot (index.tsx). */
export const installErrorMonitoring = (): void => {
    if (installed) return;
    installed = true;

    window.addEventListener("error", (event) => {
        reportError(event.error ?? event.message, "window.onerror", {
            filename: event.filename,
            lineno: event.lineno,
        });
    });

    window.addEventListener("unhandledrejection", (event) => {
        reportError(event.reason, "unhandledrejection");
    });
};
