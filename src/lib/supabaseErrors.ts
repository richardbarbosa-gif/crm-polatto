export const isSupabaseMissingRelation = (error: any): boolean => {
    if (!error) {
        return false;
    }

    const message = String(error?.message || error?.details || "").toLowerCase();

    return (
        error?.code === "42P01" ||
        error?.statusCode === 404 ||
        message.includes("does not exist") ||
        message.includes("could not find the table") ||
        message.includes("schema cache")
    );
};

export const isSupabaseMissingColumn = (error: any): boolean => {
    if (!error) {
        return false;
    }

    const message = String(error?.message || error?.details || "").toLowerCase();
    return error?.code === "42703" || (message.includes("column") && message.includes("does not exist"));
};

export const isSupabasePolicyRecursion = (error: any): boolean => {
    if (!error) {
        return false;
    }

    const message = String(error?.message || error?.details || "").toLowerCase();

    return (
        error?.code === "42P17" ||
        message.includes("infinite recursion detected in policy") ||
        (message.includes("policy for relation") && message.includes("recursion"))
    );
};

export const getSupabaseErrorMessage = (error: any): string => {
    if (!error) {
        return "";
    }

    const message = String(error?.message || "").trim();
    const details = String(error?.details || "").trim();

    if (message && details && !message.includes(details)) {
        return `${message} ${details}`.trim();
    }

    return message || details || "Erro inesperado ao consultar o Supabase.";
};
