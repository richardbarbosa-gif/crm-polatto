import { describe, expect, it } from "vitest";
import { canDelete } from "../permissions";

describe("canDelete", () => {
    it("superadmin sempre pode, mesmo sem role", () => {
        expect(canDelete(null, true)).toBe(true);
        expect(canDelete("vendedor", true)).toBe(true);
    });

    it("roles administrativos podem", () => {
        expect(canDelete("admin")).toBe(true);
        expect(canDelete("Administrador")).toBe(true);
        expect(canDelete("superadmin")).toBe(true);
        expect(canDelete("owner")).toBe(true);
    });

    it("roles comuns não podem", () => {
        expect(canDelete("vendedor")).toBe(false);
        expect(canDelete("gestor")).toBe(false);
    });

    it("sem role não pode", () => {
        expect(canDelete(null)).toBe(false);
        expect(canDelete(undefined)).toBe(false);
        expect(canDelete("")).toBe(false);
        expect(canDelete("   ")).toBe(false);
    });
});
