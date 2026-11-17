import { unstableSetRender } from "antd";
import { createRoot, type Root } from "react-dom/client";

/**
 * O antd 5 desenha as janelas e avisos "estáticos" — message.success(),
 * Modal.confirm(), notification.error() — com uma API de renderização que o
 * React 19 removeu. Sem este ajuste eles falham EM SILÊNCIO: nenhum "salvo
 * com sucesso", nenhuma mensagem de erro e nenhuma confirmação de exclusão
 * aparecia (o "Excluir selecionados" simplesmente não fazia nada).
 *
 * É o mesmo ajuste do pacote oficial @ant-design/v5-patch-for-react-19,
 * escrito aqui para não depender de mais um pacote. Precisa ser importado
 * antes de qualquer tela (ver src/index.tsx). Quando o projeto for para o
 * antd 6, este arquivo sai.
 */
type ContainerComRaiz = (Element | DocumentFragment) & { __crmRaizReact?: Root };

unstableSetRender((elemento, container) => {
    const alvo = container as ContainerComRaiz;
    alvo.__crmRaizReact ??= createRoot(container);
    const raiz = alvo.__crmRaizReact;
    raiz.render(elemento);

    return async () => {
        // Deixa a animação de saída terminar antes de desmontar.
        await new Promise((resolve) => setTimeout(resolve, 0));
        raiz.unmount();
        delete alvo.__crmRaizReact;
    };
});
