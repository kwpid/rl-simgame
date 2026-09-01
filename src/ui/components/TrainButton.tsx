import { useEffect, useState } from "react";

type State = "idle" | "training" | "done";

const HOUR_OPTIONS = [1, 2, 3];

export function TrainButton({ onTrain }: { onTrain: (hours: number) => number }) {
  const [state, setState] = useState<State>("idle");
  const [gain, setGain] = useState(0);
  const [hours, setHours] = useState(1);

  useEffect(() => {
    if (state === "training") {
      const t = setTimeout(() => {
        setGain(onTrain(hours));
        setState("done");
      }, 550);
      return () => clearTimeout(t);
    }
    if (state === "done") {
      const t = setTimeout(() => setState("idle"), 1300);
      return () => clearTimeout(t);
    }
  }, [state]);

  if (state === "training") {
    return <button className="train-btn train-btn-training">Training {hours}h…</button>;
  }
  if (state === "done") {
    return <button className="train-btn train-btn-done">+{gain}</button>;
  }

  return (
    <div className="train-btn-group">
      {HOUR_OPTIONS.map((h) => (
        <button
          key={h}
          className="train-btn train-btn-hour"
          onClick={() => {
            setHours(h);
            setState("training");
          }}
        >
          {h}h
        </button>
      ))}
    </div>
  );
}
