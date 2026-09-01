import { useState } from "react";
import { REGION_LABELS, isValidUsername, type Region } from "@/data/mockSave";
import { createSave, type NewSaveConfig, type SaveSummary } from "@/data/saveManager";

const REGIONS = Object.keys(REGION_LABELS) as Region[];
const MIN_YEAR = 2015;
const MAX_YEAR = 2026;

export function SaveCreateScreen({
  onCreated,
  onCancel,
}: {
  onCreated: (summary: SaveSummary) => void;
  onCancel: (() => void) | null;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [realName, setRealName] = useState("");
  const [age, setAge] = useState(18);
  const [region, setRegion] = useState<Region>("north_america");
  const [startYear, setStartYear] = useState(2017);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = isValidUsername(username.trim()) && displayName.trim().length > 0 && realName.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const config: NewSaveConfig = {
      username: username.trim(),
      displayName: displayName.trim(),
      realName: realName.trim(),
      age,
      region,
      startYear,
    };
    try {
      const summary = await createSave(config);
      onCreated(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create save.");
      setSubmitting(false);
    }
  }

  return (
    <div className="create-save">
      <div className="create-save-inner">
        <h1 className="create-save-title">New Save</h1>
        <p className="create-save-sub">Every field below shapes the career you're about to start.</p>

        <label className="create-field">
          <span>Username (your fixed ID, letters &amp; numbers only)</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
            placeholder="e.g. VoltKinetic17"
            maxLength={24}
          />
        </label>

        <label className="create-field">
          <span>Display Name (shown in-game, can be changed later)</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="What players will see in matches" maxLength={24} />
        </label>

        <label className="create-field">
          <span>Real name</span>
          <input value={realName} onChange={(e) => setRealName(e.target.value)} placeholder="Flavor only, shown on your profile" maxLength={40} />
        </label>

        <div className="create-row">
          <label className="create-field">
            <span>Age</span>
            <input
              type="number"
              min={13}
              max={60}
              value={age}
              onChange={(e) => setAge(Math.max(13, Math.min(60, Number(e.target.value) || 13)))}
            />
          </label>

          <label className="create-field">
            <span>Starting year</span>
            <input
              type="number"
              min={MIN_YEAR}
              max={MAX_YEAR}
              value={startYear}
              onChange={(e) => setStartYear(Math.max(MIN_YEAR, Math.min(MAX_YEAR, Number(e.target.value) || MIN_YEAR)))}
            />
          </label>
        </div>

        <label className="create-field">
          <span>Region</span>
          <select value={region} onChange={(e) => setRegion(e.target.value as Region)}>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {REGION_LABELS[r]}
              </option>
            ))}
          </select>
        </label>

        <div className="create-note">
          You'll start unranked at 600 MMR in every playlist, placements decide your first real rank. All
          stats, mechanics, and playlist knowledge start at zero, this is a fresh career.
        </div>

        {error && <div className="create-error">{error}</div>}

        <div className="create-actions">
          {onCancel && (
            <button className="create-btn create-btn-secondary" onClick={onCancel}>
              Back
            </button>
          )}
          <button className="create-btn create-btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? "Creating…" : "Create Save"}
          </button>
        </div>
      </div>

      <style>{`
        .create-save {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-app);
          padding: var(--space-5);
        }
        .create-save-inner {
          width: 100%;
          max-width: 420px;
        }
        .create-save-title {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 4px;
          text-align: center;
        }
        .create-save-sub {
          font-size: 13px;
          color: var(--text-secondary);
          text-align: center;
          margin: 0 0 var(--space-5);
        }
        .create-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: var(--space-3);
          flex: 1;
        }
        .create-field input,
        .create-field select {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-size: 14px;
          padding: 10px 12px;
          font-family: inherit;
        }
        .create-field input:focus,
        .create-field select:focus {
          outline: none;
          border-color: var(--accent);
        }
        .create-row {
          display: flex;
          gap: var(--space-3);
        }
        .create-note {
          font-size: 12px;
          color: var(--text-tertiary);
          background: var(--bg-surface-raised);
          border-radius: var(--radius-md);
          padding: var(--space-3);
          margin: var(--space-2) 0 var(--space-4);
        }
        .create-error {
          font-size: 12px;
          color: var(--danger);
          margin-bottom: var(--space-3);
        }
        .create-actions {
          display: flex;
          gap: var(--space-3);
        }
        .create-btn {
          flex: 1;
          border: none;
          border-radius: var(--radius-md);
          font-size: 14px;
          font-weight: 700;
          padding: 12px 0;
          cursor: pointer;
        }
        .create-btn-primary {
          background: var(--accent);
          color: #17181c;
        }
        .create-btn-primary:hover {
          background: var(--accent-hover);
        }
        .create-btn-primary:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .create-btn-secondary {
          background: var(--bg-surface-raised);
          color: var(--text-secondary);
          border: 1px solid var(--border-strong);
        }
      `}</style>
    </div>
  );
}
