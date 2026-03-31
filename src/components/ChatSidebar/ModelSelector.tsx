import type { AiModelOption } from "../../types";

interface ModelSelectorProps {
  currentModel: string;
  models: AiModelOption[];
  onModelChange: (model: string) => void;
}

export function ModelSelector({ currentModel, models, onModelChange }: ModelSelectorProps) {
  return (
    <div className="provider-setup-model">
      <label htmlFor="model-select">Model</label>
      <select
        id="model-select"
        value={currentModel}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
