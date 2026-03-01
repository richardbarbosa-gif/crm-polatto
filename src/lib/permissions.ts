import { normalizeText } from "./formatters";

const ADMIN_ROLE_TERMS = ["admin", "superadmin", "owner", "administrador"];

export const canDelete = (role?: string | null, isSystemAdmin = false): boolean => {
    if (isSystemAdmin) {
        return true;
    }

    const normalized = normalizeText(role);
    if (!normalized) {
        return false;
    }

    return ADMIN_ROLE_TERMS.some((term) => normalized === term || normalized.includes(term));
};
