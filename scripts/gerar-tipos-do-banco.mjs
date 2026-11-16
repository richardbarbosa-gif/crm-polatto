#!/usr/bin/env node
// =====================================================================
// Gera src/types/database.generated.ts a partir do schema `public` de um
// Postgres com as migrations aplicadas, no formato que o supabase-js
// espera em createClient<Database>().
//
// Para que serve: com o cliente tipado, coluna que não existe, RPC com
// nome errado ou parâmetro faltando viram ERRO DE COMPILAÇÃO — em vez de
// uma tela quebrada em produção depois que uma migration muda o banco.
//
// Uso (as variáveis PG* apontam para o banco; o CI usa o banco que a
// suíte de migrations acabou de montar):
//   PGDATABASE=crmtest_novo node scripts/gerar-tipos-do-banco.mjs
//   PGDATABASE=crmtest_novo node scripts/gerar-tipos-do-banco.mjs --conferir
//
// --conferir não grava: sai com erro se o arquivo versionado estiver
// diferente do banco (migration nova sem regenerar os tipos).
//
// Equivale a `supabase gen types typescript`, sem depender do CLI nem de
// token: só de `psql`, que o CI já tem.
// =====================================================================
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESTINO = resolve(dirname(fileURLToPath(import.meta.url)), "../src/types/database.generated.ts");

// Funções auxiliares criadas pelas suítes de teste no banco do CI.
const FUNCOES_DE_TESTE = ["assert", "login_como", "login_admin", "login_anon"];

const CONSULTA = `
with tabelas as (
    select c.oid, c.relname, c.relkind,
           exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal
                     and (t.tgtype & 64) <> 0 and (t.tgtype & 4) <> 0) as view_insere,
           exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal
                     and (t.tgtype & 64) <> 0 and (t.tgtype & 16) <> 0) as view_altera,
           -- o trigger set_tenant_id preenche a empresa no INSERT (migration 02)
           exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal
                     and t.tgname = 'set_tenant_id') as tenant_pelo_banco
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
), colunas as (
    select a.attrelid, a.attname, a.attnum, a.attnotnull,
           (a.atthasdef or a.attidentity <> '') as tem_default,
           a.attgenerated = 's' as gerada,
           case when t.typcategory = 'A' then e.typname else t.typname end as tipo,
           t.typcategory = 'A' as vetor
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    left join pg_type e on e.oid = t.typelem
    where a.attnum > 0 and not a.attisdropped
), funcoes as (
    select p.oid, p.proname, p.proretset, p.pronargdefaults, p.pronargs,
           coalesce(p.proargnames, '{}') as nomes,
           coalesce(p.proargmodes::text[], '{}') as modos,
           -- proargtypes é um oidvector (índice começa em 0): refaz como array
           -- comum, para casar posição a posição com proargnames.
           coalesce(
               p.proallargtypes,
               array(select u.t from unnest(p.proargtypes::oid[]) with ordinality as u(t, o) order by u.o)
           ) as tipos,
           rt.typname as retorno, rt.typtype as retorno_tipo, rt.typcategory = 'A' as retorno_vetor,
           re.typname as retorno_elemento
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type rt on rt.oid = p.prorettype
    left join pg_type re on re.oid = rt.typelem
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      -- só o que a API expõe a um usuário logado
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname <> all (string_to_array('${FUNCOES_DE_TESTE.join(",")}', ','))
)
select jsonb_build_object(
    'tabelas', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'nome', t.relname, 'view', t.relkind in ('v', 'm'),
            'insere', t.view_insere, 'altera', t.view_altera, 'tenant_pelo_banco', t.tenant_pelo_banco,
            'colunas', (
                select jsonb_agg(jsonb_build_object(
                    'nome', c.attname, 'tipo', c.tipo, 'vetor', c.vetor,
                    'obrigatoria', c.attnotnull, 'default', c.tem_default, 'gerada', c.gerada
                ) order by c.attname)
                from colunas c where c.attrelid = t.oid
            )
        ) order by t.relname), '[]'::jsonb)
        from tabelas t
    ),
    'funcoes', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'nome', f.proname, 'conjunto', f.proretset, 'ndefaults', f.pronargdefaults, 'nargs', f.pronargs,
            'retorno', f.retorno, 'retorno_tipo', f.retorno_tipo, 'retorno_vetor', f.retorno_vetor,
            'retorno_elemento', f.retorno_elemento,
            'args', (
                select coalesce(jsonb_agg(jsonb_build_object(
                    'nome', f.nomes[i], 'modo', coalesce(f.modos[i], 'i'),
                    'tipo', case when at.typcategory = 'A' then ae.typname else at.typname end,
                    'vetor', at.typcategory = 'A'
                ) order by i), '[]'::jsonb)
                from generate_subscripts(f.tipos, 1) as i
                join pg_type at on at.oid = f.tipos[i]
                left join pg_type ae on ae.oid = at.typelem
            )
        ) order by f.proname, f.oid), '[]'::jsonb)
        from funcoes f
    )
)::text;
`;

const NUMEROS = new Set(["int2", "int4", "int8", "float4", "float8", "numeric", "oid", "money"]);
const TEXTOS = new Set([
    "text", "varchar", "bpchar", "char", "name", "citext", "uuid", "date", "time", "timetz",
    "timestamp", "timestamptz", "interval", "inet", "cidr", "macaddr", "bytea", "regclass", "regprocedure",
]);

const tipoTs = (tipo, vetor) => {
    let base;
    if (NUMEROS.has(tipo)) base = "number";
    else if (tipo === "bool") base = "boolean";
    else if (tipo === "json" || tipo === "jsonb") base = "Json";
    else if (TEXTOS.has(tipo)) base = "string";
    else if (tipo === "void") base = "undefined";
    else base = "unknown";
    return vetor ? `${base}[]` : base;
};

const chave = (nome) => (/^[a-z_][a-z0-9_]*$/i.test(nome) ? nome : JSON.stringify(nome));

const linhasDeColunas = (colunas, modo, ehView, tenantPeloBanco = false) =>
    colunas
        .filter((c) => !(c.gerada && modo !== "Row"))
        .map((c) => {
            const tipo = tipoTs(c.tipo, c.vetor);
            // Em view o Postgres não sabe dizer se a coluna aceita nulo.
            const anulavel = ehView || !c.obrigatoria;
            const preenchidaPeloBanco = tenantPeloBanco && c.nome === "tenant_id";
            const opcional =
                modo === "Update" || (modo === "Insert" && (anulavel || c.default || preenchidaPeloBanco));
            return `                    ${chave(c.nome)}${opcional ? "?" : ""}: ${tipo}${anulavel ? " | null" : ""};`;
        })
        .join("\n");

const blocoDeTabela = (t) => {
    const partes = [`                Row: {\n${linhasDeColunas(t.colunas, "Row", t.view)}\n                };`];
    if (!t.view || t.insere) {
        partes.push(
            `                Insert: {\n${linhasDeColunas(t.colunas, "Insert", t.view, t.tenant_pelo_banco)}\n                };`,
        );
    }
    if (!t.view || t.altera) {
        partes.push(`                Update: {\n${linhasDeColunas(t.colunas, "Update", t.view)}\n                };`);
    }
    partes.push("                Relationships: [];");
    return `            ${chave(t.nome)}: {\n${partes.join("\n")}\n            };`;
};

const assinaturaDeFuncao = (f) => {
    const entradas = f.args.filter((a) => a.modo === "i" || a.modo === "b" || a.modo === "v");
    const saidas = f.args.filter((a) => a.modo === "t" || a.modo === "o");
    const primeiroOpcional = entradas.length - f.ndefaults;
    const args = entradas.length
        ? `{ ${entradas
              // Parâmetro com DEFAULT pode ser omitido ou receber null (vira NULL
              // no SQL); os obrigatórios exigem valor.
              .map((a, i) => {
                  const opcional = i >= primeiroOpcional;
                  return `${chave(a.nome || `arg${i + 1}`)}${opcional ? "?" : ""}: ${tipoTs(a.tipo, a.vetor)}${opcional ? " | null" : ""}`;
              })
              .join("; ")} }`
        : "Record<PropertyKey, never>";

    let retorno;
    if (saidas.length) {
        retorno = `{ ${saidas.map((a) => `${chave(a.nome)}: ${tipoTs(a.tipo, a.vetor)}`).join("; ")} }`;
    } else if (f.retorno_tipo === "c") {
        retorno = "Record<string, unknown>";
    } else {
        retorno = f.retorno_vetor ? tipoTs(f.retorno_elemento, true) : tipoTs(f.retorno, false);
    }
    if (f.conjunto) retorno = `${retorno}[]`;
    return `{ Args: ${args}; Returns: ${retorno} }`;
};

const gerar = () => {
    let bruto;
    try {
        bruto = execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", CONSULTA], {
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (erro) {
        const motivo = String(erro?.stderr || erro?.message || erro).trim().split("\n")[0];
        console.error(`Não foi possível ler o schema do banco (confira PGHOST/PGPORT/PGUSER/PGDATABASE): ${motivo}`);
        process.exit(2);
    }
    const { tabelas, funcoes } = JSON.parse(bruto);

    const porNome = new Map();
    funcoes.forEach((f) => porNome.set(f.nome, [...(porNome.get(f.nome) ?? []), assinaturaDeFuncao(f)]));
    const blocoFuncoes = [...porNome.entries()]
        .map(([nome, assinaturas]) => `            ${chave(nome)}: ${assinaturas.join("\n                | ")};`)
        .join("\n");

    const bloco = (lista) => lista.map(blocoDeTabela).join("\n") || "            [_ in never]: never;";

    return `// =====================================================================
// ARQUIVO GERADO — não edite à mão.
// Fonte: schema public de um Postgres com as migrations de database/
// aplicadas. Regerar depois de qualquer migration:
//   PGDATABASE=<banco> node scripts/gerar-tipos-do-banco.mjs
// O CI falha se este arquivo estiver diferente do banco.
// =====================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
    public: {
        Tables: {
${bloco(tabelas.filter((t) => !t.view))}
        };
        Views: {
${bloco(tabelas.filter((t) => t.view))}
        };
        Functions: {
${blocoFuncoes || "            [_ in never]: never;"}
        };
        Enums: {
            [_ in never]: never;
        };
        CompositeTypes: {
            [_ in never]: never;
        };
    };
};

type Publico = Database["public"];

/** Linha lida de uma tabela ou view. */
export type Linha<T extends keyof (Publico["Tables"] & Publico["Views"])> = (Publico["Tables"] &
    Publico["Views"])[T]["Row"];
/** Payload de inserção em uma tabela. */
export type Insercao<T extends keyof Publico["Tables"]> = Publico["Tables"][T]["Insert"];
/** Payload de alteração em uma tabela. */
export type Alteracao<T extends keyof Publico["Tables"]> = Publico["Tables"][T]["Update"];
`;
};

const conteudo = gerar();
if (process.argv.includes("--conferir")) {
    let atual = "";
    try {
        atual = readFileSync(DESTINO, "utf8");
    } catch {
        // arquivo ausente: cai no erro abaixo
    }
    if (atual !== conteudo) {
        console.error(
            "src/types/database.generated.ts está diferente do banco.\n" +
                "Uma migration mudou o schema: rode `node scripts/gerar-tipos-do-banco.mjs` e ajuste o front.",
        );
        process.exit(1);
    }
    console.log("Tipos do banco em dia.");
} else {
    writeFileSync(DESTINO, conteudo);
    console.log(`Gerado: ${DESTINO}`);
}
