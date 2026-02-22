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
