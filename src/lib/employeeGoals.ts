import { supabaseClient } from "../utility";
import { isSupabaseMissingRelation } from "./supabaseErrors";

export type GoalSourceMode = "current" | "legacy";

export type EmployeeGoalRecord = {
    id?: string;
    employee_id: string;
    goal_month: string;
    target_value: number;
    target_wins: number;
    notes?: string | null;
};

const dedupeGoals = (goals: EmployeeGoalRecord[]) => {
    const seen = new Set<string>();

    return goals.filter((goal) => {
        const key = `${goal.employee_id}:${goal.goal_month}`;
        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
};

const mapCurrentGoal = (row: any): EmployeeGoalRecord => ({
    id: row.id ? String(row.id) : undefined,
    employee_id: String(row.funcionario_id),
    goal_month: row.mes_referencia,
    target_value: Number(row.valor_meta || 0),
    target_wins: Number(row.target_wins || 0),
    notes: row.notes || null,
});

const mapLegacyGoal = (row: any): EmployeeGoalRecord => ({
    id: row.id ? String(row.id) : undefined,
    employee_id: String(row.employee_id),
    goal_month: row.goal_month,
    target_value: Number(row.target_value || 0),
    target_wins: Number(row.target_wins || 0),
    notes: row.notes || null,
});

export const loadEmployeeGoals = async (
    sourceMode: GoalSourceMode,
    monthStart: string,
): Promise<EmployeeGoalRecord[]> => {
    if (sourceMode === "current") {
        const { data, error } = await supabaseClient
            .from("metas")
            .select("*")
            .eq("mes_referencia", monthStart)
            .order("created_at", { ascending: false });

        if (error) {
            if (isSupabaseMissingRelation(error)) {
                return [];
            }
            throw error;
        }

        return dedupeGoals(((data || []) as any[]).map(mapCurrentGoal));
    }

    const { data, error } = await supabaseClient
        .from("crm_goals")
        .select("*")
        .eq("goal_month", monthStart)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false });

    if (error) {
        if (isSupabaseMissingRelation(error)) {
            return [];
        }
        throw error;
    }

    return dedupeGoals(((data || []) as any[]).map(mapLegacyGoal));
};

export const saveEmployeeGoal = async (
    sourceMode: GoalSourceMode,
    values: {
        employee_id: string;
        goal_month: string;
        target_value?: number | null;
        target_wins?: number | null;
        notes?: string | null;
    },
) => {
    if (sourceMode === "current") {
        const payload = {
            funcionario_id: values.employee_id,
            mes_referencia: values.goal_month,
            valor_meta: Number(values.target_value || 0),
        };

        const existingGoal = await supabaseClient
            .from("metas")
            .select("id")
            .eq("funcionario_id", values.employee_id)
            .eq("mes_referencia", values.goal_month)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (existingGoal.error) {
            throw existingGoal.error;
        }

        if (existingGoal.data?.id) {
            const { error } = await supabaseClient
                .from("metas")
                .update(payload)
                .eq("id", existingGoal.data.id);

            if (error) {
                throw error;
            }

            return;
        }

        const { error } = await supabaseClient.from("metas").insert(payload);
        if (error) {
            throw error;
        }

        return;
    }

    const payload = {
        employee_id: values.employee_id,
        goal_month: values.goal_month,
        target_value: Number(values.target_value || 0),
        target_wins: Number(values.target_wins || 0),
        notes: values.notes?.trim() || null,
        updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseClient.from("crm_goals").upsert(payload, {
        onConflict: "employee_id,goal_month",
    });

    if (error) {
        throw error;
    }
};
