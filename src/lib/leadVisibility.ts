const STORAGE_KEY = "crm-polatto:recent-created-leads:v1";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 200;

type RecentCreatedMap = Record<string, string>;

const toStorageKey = (id?: string | number | null): string | undefined => {
    if (id === null || id === undefined) {
        return undefined;
    }

    return String(id);
};

const safeNow = (): number => Date.now();

const readStorage = (): RecentCreatedMap => {
    if (typeof window === "undefined") {
        return {};
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const now = safeNow();
        const map: RecentCreatedMap = {};

        Object.entries(parsed).forEach(([id, value]) => {
            if (typeof value !== "string") {
                return;
            }

            const createdAt = new Date(value).getTime();
            if (Number.isNaN(createdAt)) {
                return;
            }

            if (now - createdAt > TTL_MS) {
                return;
            }

            map[id] = value;
        });

        return map;
    } catch {
        return {};
    }
};

const writeStorage = (map: RecentCreatedMap) => {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        // No-op on storage failures.
    }
};

export const markLeadAsRecentlyCreated = (id: string | number): void => {
    const key = toStorageKey(id);
    if (!key) {
        return;
    }

    const map = readStorage();
    map[key] = new Date().toISOString();

    const sorted = Object.entries(map)
        .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime())
        .slice(0, MAX_ITEMS);

    writeStorage(Object.fromEntries(sorted));
};

export const isLeadRecentlyCreated = (id?: string | number | null): boolean => {
    const key = toStorageKey(id);
    if (!key) {
        return false;
    }

    const map = readStorage();
    return Boolean(map[key]);
};
