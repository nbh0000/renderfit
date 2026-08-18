import { getPlan, type PlanId } from "@/config/plans";

export function PlanBadge({ plan, className = "" }: { plan: PlanId; className?: string }) {
  const label = getPlan(plan).label;
  const tone =
    plan === "pro"
      ? "border-accent/30 bg-accent-soft text-accent"
      : "border-line bg-sunken text-muted";
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium tracking-tight ${tone} ${className}`}
    >
      {label}
    </span>
  );
}
