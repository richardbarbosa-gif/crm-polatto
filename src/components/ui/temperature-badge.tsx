import {
    LEAD_TEMPERATURE_LABELS,
    type LeadTemperatureTag,
} from "../../lib/leadTemperature";
import { Badge } from "./badge";

type Props = {
    value?: LeadTemperatureTag | null;
    emptyLabel?: string;
};

export const TemperatureBadge = ({ value, emptyLabel = "Sem temperatura" }: Props) => {
    if (!value) {
        return <Badge tone="neutral">{emptyLabel}</Badge>;
    }

    if (value === "frio") {
        return <Badge tone="cold">{LEAD_TEMPERATURE_LABELS[value]}</Badge>;
    }

    if (value === "morno") {
        return <Badge tone="warm">{LEAD_TEMPERATURE_LABELS[value]}</Badge>;
    }

    if (value === "fechado") {
        return <Badge tone="success">{LEAD_TEMPERATURE_LABELS[value]}</Badge>;
    }

    if (value === "perdido") {
        return <Badge tone="danger">{LEAD_TEMPERATURE_LABELS[value]}</Badge>;
    }

    return <Badge tone="hot">{LEAD_TEMPERATURE_LABELS[value]}</Badge>;
};
