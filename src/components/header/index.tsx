import { BellOutlined, MoonOutlined, SunOutlined, UserOutlined } from "@ant-design/icons";
import { useGetIdentity } from "@refinedev/core";
import { Avatar, Badge, Button, Layout as AntdLayout, Popover, Switch, Typography } from "antd";
import dayjs from "dayjs";
import { useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ColorModeContext } from "../../contexts/color-mode";
import { useTenant } from "../../contexts/tenant";
import { supabaseClient } from "../../utility";
import { CompanySelector } from "./company-selector";

const { Text } = Typography;

interface TarefaPendente {
    id: string | number;
    titulo?: string | null;
    data_vencimento?: string | null;
    tipo?: string | null;
    cliente_id?: string | number | null;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const formatarDuracao = (minutos: number) => {
    const abs = Math.max(Math.abs(minutos), 1);
    if (abs < 60) return `${abs}min`;
    if (abs < 60 * 24) return `${Math.floor(abs / 60)}h`;
    return `${Math.floor(abs / (60 * 24))}d`;
};

const NotificationBell = () => {
    const navigate = useNavigate();
    const { tenantId } = useTenant();
    const [tarefas, setTarefas] = useState<TarefaPendente[]>([]);
    const [hidden, setHidden] = useState(false);
    const [popoverOpen, setPopoverOpen] = useState(false);

    const carregarTarefas = useCallback(async () => {
        try {
            const { data, error } = await supabaseClient
                .from("tarefas")
                .select("id,titulo,data_vencimento,tipo,cliente_id")
                .eq("concluido", false)
                .lt("data_vencimento", dayjs().add(24, "hour").toISOString())
                .order("data_vencimento", { ascending: true })
                .limit(20);

            if (error) {
                setHidden(true);
                return;
            }

            setHidden(false);
            setTarefas((data as TarefaPendente[]) || []);
        } catch {
            setHidden(true);
        }
    }, []);

    useEffect(() => {
        carregarTarefas();
        const timer = setInterval(carregarTarefas, REFRESH_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [carregarTarefas, tenantId]);

    if (hidden) return null;

    const agora = dayjs();
    const atrasadas = tarefas.filter(
        (tarefa) => tarefa.data_vencimento && dayjs(tarefa.data_vencimento).isBefore(agora)
    ).length;

    const content = (
        <div className="crm-topbar-notifications" style={{ width: 300 }}>
            {tarefas.length === 0 ? (
                <Text type="secondary">Nenhuma pendência</Text>
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        maxHeight: 320,
                        overflowY: "auto",
                    }}
                >
                    {tarefas.map((tarefa) => {
                        const vencimento = tarefa.data_vencimento ? dayjs(tarefa.data_vencimento) : null;
                        const atrasada = Boolean(vencimento?.isBefore(agora));
                        const minutos = vencimento ? vencimento.diff(agora, "minute") : 0;

                        return (
                            <div key={String(tarefa.id)}>
                                <Text strong style={{ display: "block", fontSize: 13 }}>
                                    {tarefa.titulo || "Tarefa sem título"}
                                </Text>
                                <Text type={atrasada ? "danger" : "secondary"} style={{ fontSize: 12 }}>
                                    {vencimento
                                        ? atrasada
                                            ? `Atrasada há ${formatarDuracao(minutos)}`
                                            : `Vence em ${formatarDuracao(minutos)}`
                                        : "Sem data definida"}
                                </Text>
                            </div>
                        );
                    })}
                </div>
            )}
            <Button
                type="link"
                size="small"
                style={{ paddingInline: 0, marginTop: 10 }}
                onClick={() => {
                    setPopoverOpen(false);
                    navigate("/agenda");
                }}
            >
                Ver agenda
            </Button>
        </div>
    );

    return (
        <>
            <Popover
                content={content}
                title="Tarefas pendentes"
                trigger="click"
                placement="bottomRight"
                open={popoverOpen}
                onOpenChange={setPopoverOpen}
            >
                <Badge count={atrasadas} size="small" offset={[-4, 4]}>
                    <Button
                        type="text"
                        icon={<BellOutlined />}
                        aria-label="Notificações de tarefas"
                        className="crm-focusable"
                    />
                </Badge>
            </Popover>

            <div className="crm-topbar-divider" />
        </>
    );
};

export const Header = () => {
    const { data } = useGetIdentity<any>();
    const { mode, setMode } = useContext(ColorModeContext);

    const userName = data?.name || "Usuário";
    const userEmail = data?.email || "";

    return (
        <AntdLayout.Header className="crm-topbar">
            <div className="crm-topbar-inner">
                <div className="crm-topbar-actions">
                    <NotificationBell />

                    {/* Seletor de empresa */}
                    <CompanySelector />

                    <div className="crm-topbar-divider" />

                    <Switch
                        checked={mode === "dark"}
                        checkedChildren={<MoonOutlined />}
                        unCheckedChildren={<SunOutlined />}
                        onChange={() => setMode(mode === "light" ? "dark" : "light")}
                        aria-label="Alternar tema"
                    />

                    <div className="crm-topbar-divider" />

                    <div className="crm-topbar-user-profile">
                        <div className="crm-topbar-user-info">
                            <Text className="crm-topbar-user-name">{userName}</Text>
                            <Text className="crm-topbar-user-email">{userEmail}</Text>
                        </div>
                        <Avatar
                            size={36}
                            className="crm-topbar-avatar"
                            icon={!data?.avatar ? <UserOutlined /> : undefined}
                            src={data?.avatar}
                        >
                            {!data?.avatar && userName.charAt(0).toUpperCase()}
                        </Avatar>
                    </div>
                </div>
            </div>
        </AntdLayout.Header>
    );
};
