import type { IconName } from "@/ui/components/Icon";
import type { QueueMode } from "./mockSave";

export const QUEUES: QueueMode[] = ["1v1", "2v2", "3v3"];

export const QUEUE_LABELS: Record<QueueMode, string> = {
  "1v1": "Ranked Duel",
  "2v2": "Ranked Doubles",
  "3v3": "Ranked Standard",
};

export const QUEUE_ICONS: Record<QueueMode, IconName> = {
  "1v1": "solo",
  "2v2": "duos",
  "3v3": "trios",
};
