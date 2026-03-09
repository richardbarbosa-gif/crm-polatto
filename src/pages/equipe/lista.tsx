import { useTable, EditButton } from "@refinedev/antd"; // <--- EditButton importado
import { Table, Typography, Tag, Button, Card, Space } from "antd"; // <--- Space importado
import { PlusOutlined, TeamOutlined } from "@ant-design/icons";

const { Title } = Typography;

export const EquipeList = () => {
    const { tableProps } = useTable({
        resource: "funcionarios",
        syncWithLocation: false,
    });

    return (
        <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <Title level={2} style={{ margin: 0, color: '#1e293b' }}>
                    <TeamOutlined style={{ marginRight: '10px', color: '#4c8bf5' }} />
                    Equipe e Funcionários
                </Title>
                <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#4c8bf5', borderRadius: '8px' }}>
                    Novo Membro
                </Button>
            </div>

            <Card bordered={false} style={{ borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
                <Table {...tableProps} rowKey="id" pagination={{ pageSize: 10 }}>
                    <Table.Column dataIndex="nome" title="Nome" />
                    <Table.Column dataIndex="email" title="E-mail" />
                    <Table.Column dataIndex="cargo" title="Cargo" />
                    
                    {/* <--- NOVA COLUNA DE META ---> */}
                    <Table.Column 
                        dataIndex="meta" 
                        title="Meta" 
                        render={(value) => value ? value : "-"} 
                    />

                    <Table.Column
                        dataIndex="ativo"
                        title="Status"
                        render={(value) => (
                            <Tag color={value ? "green" : "red"} style={{ borderRadius: '4px' }}>
                                {value ? "Ativo" : "Inativo"}
                            </Tag>
                        )}
                    />

                    {/* <--- NOVA COLUNA DE AÇÕES (CORRIGE O BUG DA EDIÇÃO EM BRANCO) ---> */}
                    <Table.Column
                        title="Ações"
                        dataIndex="id"
                        render={(_, record: any) => (
                            <Space>
                                <EditButton hideText size="small" recordItemId={record.id} />
                            </Space>
                        )}
                    />
                </Table>
            </Card>
        </div>
    );
};