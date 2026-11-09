import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { rotuloDoPapel } from "../../lib/permissions";
import { Alert, Col, Form, Input, Row, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { Button, Card } from "../../components/ui";
import { useCrmAccess } from "../../hooks/useCrmAccess";
import {
    lerRespostaPerfil,
    SENHA_MAXIMA,
    SENHA_MINIMA,
    validarNome,
    validarNovaSenha,
    validarTelefonePerfil,
} from "../../lib/perfil";
import { supabaseClient } from "../../utility";

const { Title, Text } = Typography;

type DadosPerfil = { nome: string; telefone?: string };
type DadosSenha = { senha: string; confirmacao: string };

/**
 * Meu perfil: o próprio usuário troca nome e telefone (RPC
 * atualizar_meu_perfil, migration 16 — nunca cargo, papel ou empresa) e a
 * senha (Supabase Auth). O telefone fica em funcionarios.telefone, pronto
 * para o rodapé da proposta.
 */
export const PerfilPage = () => {
    const { employee, identity, roleCandidate, isLoadingAccess } = useCrmAccess();
    const [formPerfil] = Form.useForm<DadosPerfil>();
    const [formSenha] = Form.useForm<DadosSenha>();
    const [salvandoPerfil, setSalvandoPerfil] = useState(false);
    const [salvandoSenha, setSalvandoSenha] = useState(false);

    const telefoneAtual = typeof employee?.raw?.telefone === "string" ? employee.raw.telefone : "";

    useEffect(() => {
        if (employee) formPerfil.setFieldsValue({ nome: employee.nome, telefone: telefoneAtual });
    }, [employee, formPerfil, telefoneAtual]);

    const salvarPerfil = async (valores: DadosPerfil) => {
        setSalvandoPerfil(true);
        try {
            const { data, error } = await supabaseClient.rpc("atualizar_meu_perfil", {
                p_nome: valores.nome.trim(),
                p_telefone: valores.telefone?.trim() || null,
            });
            const resposta = error ? { ok: false, mensagem: "Não foi possível salvar o perfil." } : lerRespostaPerfil(data);
            if (resposta.ok) message.success(resposta.mensagem);
            else message.error(resposta.mensagem);
        } finally {
            setSalvandoPerfil(false);
        }
    };

    const trocarSenha = async (valores: DadosSenha) => {
        setSalvandoSenha(true);
        try {
            const { error } = await supabaseClient.auth.updateUser({ password: valores.senha });
            if (error) {
                message.error(
                    /same|different/i.test(error.message)
                        ? "A nova senha precisa ser diferente da atual."
                        : "Não foi possível trocar a senha. Entre de novo e tente outra vez.",
                );
                return;
            }
            formSenha.resetFields();
            message.success("Senha alterada.");
        } finally {
            setSalvandoSenha(false);
        }
    };

    const regra = (validar: (v: string) => string | null) => ({
        validator: (_: unknown, valor: string) => {
            const erro = validar(valor);
            return erro ? Promise.reject(new Error(erro)) : Promise.resolve();
        },
    });

    return (
        <div className="crm-page-shell">
            <div className="crm-page-header">
                <div>
                    <Title level={2} className="crm-page-header-title">
                        <UserOutlined style={{ marginRight: 10, color: "#64748b" }} />
                        Meu perfil
                    </Title>
                    <Text className="crm-page-header-subtitle">Seus dados de contato e sua senha de acesso.</Text>
                </div>
            </div>

            <Row gutter={[14, 14]}>
                <Col xs={24} lg={12}>
                    <Card title={<Text strong>Dados pessoais</Text>}>
                        {!isLoadingAccess && !employee ? (
                            <Alert
                                type="info"
                                showIcon
                                style={{ marginBottom: 16 }}
                                message="Seu cadastro de funcionário não foi encontrado nesta empresa. Fale com o gerente."
                            />
                        ) : null}
                        <Form form={formPerfil} layout="vertical" onFinish={salvarPerfil} disabled={!employee}>
                            <Form.Item label="E-mail de acesso">
                                <Input value={identity?.email ?? employee?.email ?? ""} disabled />
                            </Form.Item>
                            <Form.Item label="Papel" extra="O papel e o cargo são definidos pelo gerente, em Equipe.">
                                <Input value={roleCandidate ? rotuloDoPapel(roleCandidate) : "—"} disabled />
                            </Form.Item>
                            <Form.Item label="Nome" name="nome" rules={[regra((v) => validarNome(v))]}>
                                <Input maxLength={120} autoComplete="name" />
                            </Form.Item>
                            <Form.Item
                                label="Telefone"
                                name="telefone"
                                rules={[regra((v) => validarTelefonePerfil(v))]}
                                extra="Aparece para o cliente como seu contato (por exemplo, no rodapé da proposta)."
                            >
                                <Input maxLength={30} autoComplete="tel" placeholder="(11) 98888-7777" />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" loading={salvandoPerfil}>
                                Salvar dados
                            </Button>
                        </Form>
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card title={<Text strong>Trocar senha</Text>}>
                        <Form form={formSenha} layout="vertical" onFinish={trocarSenha}>
                            <Form.Item
                                label="Nova senha"
                                name="senha"
                                rules={[regra((v) => validarNovaSenha(v, v))]}
                                extra={`Mínimo de ${SENHA_MINIMA} caracteres.`}
                            >
                                <Input.Password
                                    prefix={<LockOutlined />}
                                    maxLength={SENHA_MAXIMA}
                                    autoComplete="new-password"
                                />
                            </Form.Item>
                            <Form.Item
                                label="Confirme a nova senha"
                                name="confirmacao"
                                dependencies={["senha"]}
                                rules={[
                                    ({ getFieldValue }) => ({
                                        validator: (_: unknown, valor: string) => {
                                            const erro = validarNovaSenha(getFieldValue("senha"), valor);
                                            return erro ? Promise.reject(new Error(erro)) : Promise.resolve();
                                        },
                                    }),
                                ]}
                            >
                                <Input.Password
                                    prefix={<LockOutlined />}
                                    maxLength={SENHA_MAXIMA}
                                    autoComplete="new-password"
                                />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" loading={salvandoSenha}>
                                Trocar senha
                            </Button>
                        </Form>
                    </Card>
                </Col>
            </Row>
        </div>
    );
};
