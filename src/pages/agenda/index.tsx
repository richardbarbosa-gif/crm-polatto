import { useList } from "@refinedev/core";
import { Calendar, Card, Badge, Skeleton, Typography } from "antd";
import dayjs from "dayjs";

export const AgendaPage = () => {
    const listResult = useList({ resource: "tarefas", pagination: { mode: "off" } }) as any;
    const { data, isLoading } = listResult.query || listResult;
    const tarefas = data?.data || [];

    const dateCellRender = (value: dayjs.Dayjs) => {
        const tarefasDoDia = tarefas.filter((t: any) => 
            dayjs(t.data_vencimento).format("YYYY-MM-DD") === value.format("YYYY-MM-DD")
        );
        return (
            <ul style={{ listStyle: "none", padding: 0 }}>
                {tarefasDoDia.map((t: any) => (
                    <li key={t.id}><Badge status="warning" text={t.titulo} /></li>
                ))}
            </ul>
        );
    };

    if (isLoading) return <Skeleton active />;

    return (
        <div style={{ padding: 20 }}>
            <Typography.Title level={2}>📅 Agenda</Typography.Title>
            <Card><Calendar dateCellRender={dateCellRender} /></Card>
        </div>
    );
};