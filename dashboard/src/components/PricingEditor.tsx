import type { RoutePricing } from "../api";

interface PricingEditorProps {
  pricing: RoutePricing;
  onChange: (pricing: RoutePricing) => void;
}

const PricingEditor = ({ pricing, onChange }: PricingEditorProps) => {
  const switchMode = (mode: RoutePricing["mode"]) => {
    if (mode === "metered") {
      const flatAmount = pricing.mode === "metered" ? pricing.flatAmount : 0.1;
      const currency = pricing.mode === "metered" ? pricing.currency ?? "USD" : "USD";
      onChange({ mode: "metered", flatAmount, currency });
    } else {
      const feature = pricing.mode === "subscription" ? pricing.feature ?? "default" : "default";
      const upgradeUrl = pricing.mode === "subscription" ? pricing.upgradeUrl : undefined;
      onChange({ mode: "subscription", feature, upgradeUrl });
    }
  };

  const updateFlatAmount = (value: string) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      onChange({ mode: "metered", flatAmount: 0, currency: pricing.mode === "metered" ? pricing.currency ?? "USD" : "USD" });
      return;
    }
    onChange({ mode: "metered", flatAmount: Math.max(parsed, 0), currency: pricing.mode === "metered" ? pricing.currency ?? "USD" : "USD" });
  };

  const updateFeature = (value: string) => {
    onChange({ mode: "subscription", feature: value.trim() || "default", upgradeUrl: pricing.mode === "subscription" ? pricing.upgradeUrl : undefined });
  };

  const updateUpgradeUrl = (value: string) => {
    const trimmed = value.trim();
    onChange({ mode: "subscription", feature: pricing.mode === "subscription" ? pricing.feature ?? "default" : "default", upgradeUrl: trimmed.length > 0 ? trimmed : undefined });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pricing Mode</label>
      <select
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
        value={pricing.mode}
        onChange={(event) => switchMode(event.target.value as RoutePricing["mode"])}
      >
        <option value="metered">Metered (flat)</option>
        <option value="subscription">Subscription required</option>
      </select>
      {pricing.mode === "metered" ? (
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase text-slate-500">Flat Amount</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={pricing.flatAmount ?? 0}
            onChange={(event) => updateFlatAmount(event.target.value)}
            className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
          <span className="text-xs text-slate-400">{pricing.currency ?? "USD"}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase text-slate-500">Feature Key</label>
            <input
              type="text"
              value={pricing.feature ?? ""}
              onChange={(event) => updateFeature(event.target.value)}
              placeholder="e.g. pro-tier"
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase text-slate-500">Upgrade URL (optional)</label>
            <input
              type="url"
              value={pricing.upgradeUrl ?? ""}
              onChange={(event) => updateUpgradeUrl(event.target.value)}
              placeholder="https://merchant.example.com/upgrade"
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PricingEditor;
