import { ConfigProvider, theme, type ThemeConfig } from "antd";
import ptBR from "antd/locale/pt_BR";
import {
  type PropsWithChildren,
  createContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type ColorModeContextType = {
  mode: string;
  setMode: (mode: string) => void;
};

export const ColorModeContext = createContext<ColorModeContextType>(
  {} as ColorModeContextType
);

/**
 * Paleta "Navy & Gold" (ver src/styles/premium-theme.css). Os valores aqui
 * espelham os tokens --crm-* do CSS: o antd pinta os componentes a partir do
 * ConfigProvider e o CSS cuida do acabamento. Antes o tema usava o azul
 * genérico do Tailwind (#3b82f6) e o cinza do GitHub no escuro, que não
 * batiam com o CSS — botão, link, aba e foco saíam de outra cor.
 */
const MARCA = {
  navy900: "#0a1120",
  azul: "#2563eb", // azul do logo: ação primária
  azulHover: "#3d82f7",
  azulAtivo: "#1a4fc4",
  azulEscuro: "#4c8cf9", // no fundo escuro o azul precisa clarear para ter contraste
  dourado: "#f59e0b",
  sucesso: "#10b981",
  erro: "#ef4444",
} as const;

const SUPERFICIE = {
  claro: { layout: "#f6f8fc", container: "#ffffff", elevado: "#ffffff", cabecalhoTabela: "#eef2f8" },
  escuro: { layout: "#0b1018", container: "#131a26", elevado: "#1a2333", cabecalhoTabela: "#1a2333" },
} as const;

export const ColorModeContextProvider: React.FC<PropsWithChildren> = ({
  children,
}) => {
  const colorModeFromLocalStorage = localStorage.getItem("colorMode");
  const isSystemPreferenceDark = window?.matchMedia(
    "(prefers-color-scheme: dark)"
  ).matches;

  const systemPreference = isSystemPreferenceDark ? "dark" : "light";
  const [mode, setMode] = useState(
    colorModeFromLocalStorage || systemPreference
  );

  useEffect(() => {
    window.localStorage.setItem("colorMode", mode);
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  const setColorMode = () => {
    if (mode === "light") {
      setMode("dark");
    } else {
      setMode("light");
    }
  };

  const { darkAlgorithm, defaultAlgorithm } = theme;
  const isDark = mode === "dark";

  const mergedTheme = useMemo<ThemeConfig>(() => {
    const sup = isDark ? SUPERFICIE.escuro : SUPERFICIE.claro;
    const primaria = isDark ? MARCA.azulEscuro : MARCA.azul;
    return {
      algorithm: isDark ? darkAlgorithm : defaultAlgorithm,
      token: {
        colorPrimary: primaria,
        colorInfo: primaria,
        colorLink: primaria,
        colorSuccess: MARCA.sucesso,
        colorWarning: MARCA.dourado,
        colorError: MARCA.erro,
        borderRadius: 10,
        borderRadiusLG: 14,
        fontFamily: "'Inter', -apple-system, 'Segoe UI', sans-serif",
        fontSize: 14,
        lineHeight: 1.55,
        controlHeight: 36,
        colorBgLayout: sup.layout,
        colorBgContainer: sup.container,
        colorBgElevated: sup.elevado,
        ...(isDark
          ? {
              colorText: "#e8eef7",
              colorTextSecondary: "#aab7c8",
              colorTextTertiary: "#8b97a8",
              colorBorder: "rgba(232, 238, 247, 0.16)",
              colorBorderSecondary: "rgba(232, 238, 247, 0.09)",
            }
          : {
              colorPrimaryHover: MARCA.azulHover,
              colorPrimaryActive: MARCA.azulAtivo,
              colorText: "#0d1628",
              colorTextSecondary: "#556377",
              colorTextTertiary: "#64748b",
              colorBorder: "rgba(13, 22, 40, 0.16)",
              colorBorderSecondary: "rgba(13, 22, 40, 0.08)",
            }),
      },
      components: {
        Layout: {
          headerBg: MARCA.navy900,
          siderBg: MARCA.navy900,
          triggerBg: MARCA.navy900,
          bodyBg: sup.layout,
        },
        Menu: {
          itemBg: "transparent",
          subMenuItemBg: "transparent",
          itemColor: "rgba(163, 177, 198, 0.92)",
          itemHoverColor: "#e2e8f0",
          itemSelectedColor: "#fcd34d",
          itemSelectedBg: "rgba(245, 158, 11, 0.12)",
          iconSize: 16,
        },
        Button: {
          borderRadius: 10,
          controlHeight: 36,
          fontWeight: 500,
          primaryShadow: "none",
        },
        Card: {
          borderRadiusLG: 14,
          paddingLG: 20,
        },
        Input: { borderRadius: 10, controlHeight: 36 },
        InputNumber: { borderRadius: 10, controlHeight: 36 },
        Select: { borderRadius: 10, controlHeight: 36 },
        DatePicker: { borderRadius: 10, controlHeight: 36 },
        Table: {
          headerBg: sup.cabecalhoTabela,
          headerColor: isDark ? "#aab7c8" : "#556377",
          rowHoverBg: isDark ? "rgba(76, 140, 249, 0.06)" : "rgba(37, 99, 235, 0.035)",
        },
        Modal: {
          borderRadiusLG: 18,
          contentBg: sup.elevado,
          headerBg: sup.elevado,
        },
        Drawer: {
          colorBgElevated: sup.elevado,
        },
        Notification: {
          borderRadiusLG: 10,
        },
        Segmented: {
          borderRadius: 10,
        },
        Tabs: {
          inkBarColor: primaria,
          itemSelectedColor: primaria,
        },
      },
    };
  }, [isDark, darkAlgorithm, defaultAlgorithm]);

  return (
    <ColorModeContext.Provider
      value={{
        setMode: setColorMode,
        mode,
      }}
    >
      <ConfigProvider theme={mergedTheme} locale={ptBR}>
        {children}
      </ConfigProvider>
    </ColorModeContext.Provider>
  );
};
