import type { Json } from "../types/database.generated";

/**
 * Entrega um objeto do app a um parâmetro/coluna JSON do banco.
 *
 * O tipo Json do Supabase não aceita `unknown` nem interfaces com campos
 * opcionais, embora tudo que chega aqui seja serializável (é o que o
 * supabase-js faz com o corpo da requisição). A conversão fica neste único
 * ponto, em vez de espalhar casts pelas telas.
 */
export const comoJson = (valor: unknown): Json => valor as Json;
