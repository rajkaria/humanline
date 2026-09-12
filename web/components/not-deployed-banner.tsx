import { TriangleAlertIcon } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import {
  deploymentStatus,
  type ContractKey,
  CONTRACTS,
} from "@/lib/contracts";

/**
 * The honest empty state.
 *
 * When `deployments/cc3-testnet.json` has not been written and no
 * `NEXT_PUBLIC_*_ADDRESS` is set, every data view renders this instead of
 * silently showing zeros — a demo that shows "0 humans" because it is pointed at
 * nothing is worse than one that says so.
 */
export function NotDeployedBanner({
  need,
  className,
}: {
  /** Only warn about the contracts this view actually reads. */
  need?: ContractKey[];
  className?: string;
}) {
  const missing = (need ? need.map((k) => CONTRACTS[k]) : deploymentStatus.undeployed).filter(
    (c) => !c.address,
  );
  if (missing.length === 0) return null;

  return (
    <div
      role="status"
      className={`flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Not deployed yet</p>
          <p className="text-sm text-muted-foreground">
            {missing.length === 1
              ? `${missing[0].name} has no address on Creditcoin CC3 testnet.`
              : `${missing.length} contracts have no address on Creditcoin CC3 testnet.`}{" "}
            Addresses resolve from <code className="font-mono text-xs">deployments/cc3-testnet.json</code>{" "}
            first, then from environment variables. This view has nothing to read until one of
            them is present.
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-1 border-t border-warning/20 pt-3">
        {missing.map((contract) => (
          <li
            key={contract.key}
            className="flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <span className="text-muted-foreground">{contract.name}</span>
            <span className="inline-flex items-center gap-1">
              <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]">
                {contract.envVar}
              </code>
              <CopyButton value={contract.envVar} label={`Copy ${contract.envVar}`} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
