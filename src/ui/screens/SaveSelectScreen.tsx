import { useState } from "react";
import { Icon } from "@/ui/components/Icon";
import { REGION_LABELS } from "@/data/mockSave";
import { MAX_SAVES, type SaveSummary } from "@/data/saveManager";

export function SaveSelectScreen({
  saves,
  onSelect,
  onDelete,
  onCreateNew,
}: {
  saves: SaveSummary[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <div className="save-select">
      <div className="save-select-inner">
        <h1 className="save-select-title">Rocket League Sim</h1>
        <p className="save-select-sub">Choose a save to continue, or start a new career.</p>

        <div className="save-list">
          {saves.map((save) => (
            <div key={save.id} className="save-card">
              <button className="save-card-main" onClick={() => onSelect(save.id)}>
                <div className="save-card-icon">
                  <Icon name="ranked" size={22} />
                </div>
                <div className="save-card-info">
                  <div className="save-card-name">{save.displayName}</div>
                  <div className="save-card-meta">
                    Level {save.level} &middot; {REGION_LABELS[save.region]} &middot; Started {save.startYear}
                  </div>
                </div>
              </button>
              {confirmingId === save.id ? (
                <div className="save-card-confirm">
                  <span>Delete this save?</span>
                  <button
                    className="save-card-confirm-btn save-card-confirm-yes"
                    onClick={() => {
                      onDelete(save.id);
                      setConfirmingId(null);
                    }}
                  >
                    Delete
                  </button>
                  <button className="save-card-confirm-btn" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="save-card-delete" onClick={() => setConfirmingId(save.id)} title="Delete save">
                  <Icon name="trash" size={16} />
                </button>
              )}
            </div>
          ))}

          {saves.length < MAX_SAVES && (
            <button className="save-card save-card-new" onClick={onCreateNew}>
              <Icon name="plus" size={18} />
              <span>New Save</span>
            </button>
          )}
        </div>

        <div className="save-select-count">{saves.length} / {MAX_SAVES} saves</div>
      </div>

      <style>{`
        .save-select {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-app);
          padding: var(--space-5);
        }
        .save-select-inner {
          width: 100%;
          max-width: 440px;
        }
        .save-select-title {
          font-size: 24px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 4px;
          text-align: center;
        }
        .save-select-sub {
          font-size: 13px;
          color: var(--text-secondary);
          text-align: center;
          margin: 0 0 var(--space-5);
        }
        .save-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }
        .save-card {
          display: flex;
          align-items: center;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }
        .save-card-main {
          flex: 1;
          display: flex;
          align-items: center;
          gap: var(--space-3);
          background: none;
          border: none;
          padding: var(--space-4);
          cursor: pointer;
          text-align: left;
        }
        .save-card-main:hover {
          background: var(--bg-surface-hover);
        }
        .save-card-icon {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-md);
          background: var(--accent-muted);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .save-card-name {
          font-size: 15px;
          font-weight: 650;
          color: var(--text-primary);
        }
        .save-card-meta {
          font-size: 12px;
          color: var(--text-tertiary);
          margin-top: 2px;
        }
        .save-card-delete {
          background: none;
          border: none;
          color: var(--text-tertiary);
          padding: var(--space-4);
          cursor: pointer;
          flex-shrink: 0;
        }
        .save-card-delete:hover {
          color: var(--danger);
        }
        .save-card-confirm {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 var(--space-4);
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
        }
        .save-card-confirm-btn {
          background: var(--bg-surface-raised);
          border: 1px solid var(--border-strong);
          color: var(--text-primary);
          border-radius: var(--radius-sm);
          font-size: 12px;
          padding: 5px 10px;
          cursor: pointer;
        }
        .save-card-confirm-yes {
          background: rgba(217,100,91,0.16);
          color: var(--danger);
          border-color: transparent;
        }
        .save-card-new {
          justify-content: center;
          gap: var(--space-2);
          color: var(--text-secondary);
          font-size: 14px;
          font-weight: 600;
          padding: var(--space-4);
          cursor: pointer;
          border-style: dashed;
        }
        .save-card-new:hover {
          color: var(--accent);
          border-color: var(--accent);
        }
        .save-select-count {
          text-align: center;
          font-size: 12px;
          color: var(--text-tertiary);
          margin-top: var(--space-4);
        }
      `}</style>
    </div>
  );
}
