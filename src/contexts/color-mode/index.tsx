import { RefineThemes } from "@refinedev/antd";
import { ConfigProvider, theme } from "antd";
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

  const mergedTheme = useMemo(
    () => ({
      ...RefineThemes.Blue,
      algorithm: isDark ? darkAlgorithm : defaultAlgorithm,
      token: {
        ...RefineThemes.Blue.token,
        colorPrimary: "#3b82f6",
        colorPrimaryHover: "#2563eb",
        colorPrimaryActive: "#1d4ed8",
        colorInfo: "#3b82f6",
        colorSuccess: "#10b981",
        colorWarning: "#f59e0b",
        colorError: "#ef4444",
        borderRadius: 10,
        borderRadiusLG: 14,
        fontFamily: "'Inter', -apple-system, 'Segoe UI', sans-serif",
        fontSize: 14,
        lineHeight: 1.55,
        controlHeight: 36,
        // Cores dinâmicas — dark algorithm cuida do resto
        ...(isDark
          ? {
              colorBgLayout: "#0d1117",
              colorBgContainer: "#161b22",
              colorBorder: "rgba(240,246,252,0.1)",
            }
          : {
              colorText: "#0f172a",
              colorTextSecondary: "#64748b",
              colorBgLayout: "#f7f9fb",
              colorBgContainer: "#ffffff",
              colorBorder: "rgba(15,23,42,0.06)",
            }),
      },
      components: {
        Layout: {
          headerBg: "#0a1120",
          siderBg: "#0a1120",
          triggerBg: "#0a1120",
          bodyBg: isDark ? "#0d1117" : "#f7f9fb",
        },
        Menu: {
          itemBg: "transparent",
          subMenuItemBg: "transparent",
          itemColor: "rgba(148,163,184,0.85)",
          itemHoverColor: "#e2e8f0",
          itemSelectedColor: "#ffffff",
          itemSelectedBg: "rgba(255,255,255,0.07)",
          iconSize: 16,
        },
        Button: {
          borderRadius: 8,
          controlHeight: 36,
          fontWeight: 500,
        },
        Card: {
          borderRadiusLG: 14,
          paddingLG: 20,
        },
        Input: { borderRadius: 8, controlHeight: 36 },
        Select: { borderRadius: 8, controlHeight: 36 },
        Table: {
          headerBg: isDark ? "#161b22" : "#f7f9fb",
          headerColor: isDark ? "#8b949e" : "#64748b",
          rowHoverBg: isDark ? "rgba(255,255,255,0.04)" : "rgba(248,250,252,0.7)",
        },
        Modal: {
          borderRadiusLG: 18,
        },
        Drawer: {
          colorBgElevated: isDark ? "#161b22" : "#ffffff",
        },
        Notification: {
          borderRadiusLG: 10,
        },
        Progress: {
          defaultColor: "#3b82f6",
        },
        Segmented: {
          borderRadius: 10,
        },
      },
    }),
    [isDark, darkAlgorithm, defaultAlgorithm],
  );

  return (
    <ColorModeContext.Provider
      value={{
        setMode: setColorMode,
        mode,
      }}
    >
      <ConfigProvider theme={mergedTheme}>
        {children}
      </ConfigProvider>
    </ColorModeContext.Provider>
  );
};
