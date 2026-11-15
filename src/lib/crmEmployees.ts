import { supabaseClient } from "../utility";

/** Funcionário da empresa ativa (tabela funcionarios; a RLS filtra o tenant). */
export type CrmEmployee = {
    id: string;
    /** Login ligado ao funcionário; ausente em quem foi cadastrado sem acesso. */
    userId?: string;
    nome: string;
    email?: string;
    cargo?: string;
    telefone?: string;
    ativo: boolean;
};

type FuncionarioRow = {
    id: string;
    user_id: string | null;
    nome: string | null;
    email: string | null;
    cargo: string | null;
    telefone: string | null;
    ativo: boolean | null;
};

const COLUNAS = "id,user_id,nome,email,cargo,telefone,ativo";

const texto = (valor: string | null): string | undefined => valor?.trim() || undefined;

const paraFuncionario = (row: FuncionarioRow): CrmEmployee => ({
    id: row.id,
    userId: row.user_id ?? undefined,
    nome: texto(row.nome) || "Sem nome",
    email: texto(row.email),
    cargo: texto(row.cargo),
    telefone: texto(row.telefone),
    ativo: row.ativo !== false,
});

/** Equipe da empresa, sem os removidos (lixeira), em ordem alfabética. */
export const fetchEmployeesDirectory = async (): Promise<CrmEmployee[]> => {
    const { data, error } = await supabaseClient
        .from("funcionarios")
        .select(COLUNAS)
        .is("deleted_at", null)
        .order("nome", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as FuncionarioRow[]).map(paraFuncionario);
};

/** Funcionário cujo e-mail é o do login informado (null se não houver). */
export const fetchEmployeeByEmail = async (email?: string | null): Promise<CrmEmployee | null> => {
    const normalizado = email?.trim().toLowerCase();
    if (!normalizado) return null;

    const { data, error } = await supabaseClient
        .from("funcionarios")
        .select(COLUNAS)
        .eq("email", normalizado)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data ? paraFuncionario(data as FuncionarioRow) : null;
};
