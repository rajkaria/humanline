import Link from "next/link";

import { Wordmark } from "@/components/wordmark";
import { creditcoinTestnet } from "@/lib/chains";

export function SiteFooter() {
  return (
    <footer className="border-t border-foreground/10 bg-background">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="max-w-xs text-sm text-muted-foreground">
            One human, one credit line. Proof of personhood from World ID, carried to
            Creditcoin by Attestcoin, with no bridge and no oracle operator standing in
            between. Built by people who think a wallet was never a person.
          </p>
        </div>

        <FooterColumn title="Product">
          <FooterLink href="/app">Verify &amp; borrow</FooterLink>
          <FooterLink href="/relay">Root relay feed</FooterLink>
          <FooterLink href="/docs">Integration guide</FooterLink>
        </FooterColumn>

        <FooterColumn title="Verify us">
          <FooterLink href="/judge">Judge page</FooterLink>
          <FooterLink href="/docs#security">Security model</FooterLink>
          <FooterLink href="/docs#limitations">Known limitations</FooterLink>
        </FooterColumn>

        <FooterColumn title="Network">
          <FooterExternal href={creditcoinTestnet.blockExplorers.default.url}>
            CC3 Blockscout
          </FooterExternal>
          <FooterExternal href="https://etherscan.io">Etherscan</FooterExternal>
          <FooterExternal href="https://sepolia.etherscan.io">
            Sepolia Etherscan
          </FooterExternal>
        </FooterColumn>
      </div>

      <div className="border-t border-foreground/10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Built for BUIDL CTC 2026 Fall. Testnet only: hUSD is a test asset and
            lender deposits are testnet funds.
          </p>
          <p className="font-mono">
            chainId {creditcoinTestnet.id} · {creditcoinTestnet.name}
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">{title}</h3>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {children}
      </Link>
    </li>
  );
}

function FooterExternal({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {children}
      </a>
    </li>
  );
}
