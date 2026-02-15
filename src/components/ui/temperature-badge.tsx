import {
    LEAD_TEMPERATURE_LABELS,
    type LeadTemperature,
} from "../../lib/leadTemperature";
import { Badge } from "./badge";

type Props = {
    value?: LeadTemperature | null;
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

    return <Badge tone="hot">{LEAD_TEMPERATURE_LABELS[value]}</Badge>;
};
