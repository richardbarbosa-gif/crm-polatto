import { message, type FormInstance, type InputRef } from "antd";
import { useCallback, useRef, type ChangeEvent } from "react";
import { buscarEnderecoPorCep, formatarCep } from "../lib/cep";

const digitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/**
 * Campo CEP dos formulários do lead (Novo lead e Editar lead): formata ao
 * digitar, busca o endereço no ViaCEP e leva o foco ao número.
 *
 * Só aplica a resposta se o CEP no campo ainda for o consultado: digitando
 * rápido dois CEPs, a resposta atrasada do primeiro sobrescrevia o endereço
 * do segundo.
 */
export const useBuscaCep = (form: FormInstance) => {
    const numeroInputRef = useRef<InputRef>(null);

    const handleCepChange = useCallback(
        async (event: ChangeEvent<HTMLInputElement>) => {
            const cep = formatarCep(event.target.value);
            form.setFieldValue("cep", cep);
            const consultado = digitos(cep);
            if (consultado.length !== 8) return;

            const resultado = await buscarEnderecoPorCep(cep);
            if (digitos(form.getFieldValue("cep")) !== consultado) return;

            if (resultado.status === "ok") {
                form.setFieldValue("endereco_instalacao", resultado.endereco);
                message.success("Endereço encontrado.");
                setTimeout(() => numeroInputRef.current?.focus(), 100);
            } else if (resultado.status === "nao_encontrado") {
                message.warning("CEP não encontrado. Preencha o endereço manualmente.");
            } else {
                message.warning("Não foi possível buscar o CEP. Preencha o endereço manualmente.");
            }
        },
        [form],
    );

    return { numeroInputRef, handleCepChange };
};
