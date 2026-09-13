"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, PlusIcon, VoteIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { ConnectButton } from "@/components/connect-button";
import { GasCard } from "@/components/gas-card";
import { HashLink } from "@/components/hash-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { humanPollAbi } from "@/lib/abi";
import { creditcoinTestnet } from "@/lib/chains";
import { useHuman } from "@/lib/hooks/use-human";
import { useMounted } from "@/lib/hooks/use-mounted";
import { useNow } from "@/lib/hooks/use-now";
import { useTx } from "@/lib/hooks/use-tx";
import { readBallots, readPolls, validateDraft, viewOf, type PollView } from "@/lib/poll";
import { useProfile } from "@/lib/profile-context";
import { getPublicClient } from "@/lib/public-client";

const DURATIONS = [
  { label: "1 hour", seconds: 3_600 },
  { label: "1 day", seconds: 86_400 },
  { label: "1 week", seconds: 604_800 },
];

function remaining(closesAt: number, now: number): string {
  const s = closesAt - now;
  if (s <= 0) return "closed";
  if (s < 3_600) return `${Math.ceil(s / 60)} min left`;
  if (s < 172_800) return `${Math.round(s / 3_600)} h left`;
  return `${Math.round(s / 86_400)} days left`;
}

/**
 * `/vote`: polls on `HumanPoll`. Reading needs no wallet; voting and opening a poll need a verified
 * human, and the contract, not this page, is what stops a second ballot.
 */
export function VotePanel() {
  const mounted = useMounted();
  const { isConnected } = useAccount();
  const { profile } = useProfile();
  const pollAddress = profile.deployment.contracts.humanPoll.address;
  const human = useHuman();
  const now = Math.floor(useNow(15_000) / 1000);

  const polls = useQuery({
    queryKey: ["polls", pollAddress],
    enabled: Boolean(pollAddress),
    refetchInterval: 15_000,
    queryFn: () => readPolls(getPublicClient(), pollAddress!, 20),
  });

  const ids = useMemo(() => (polls.data ?? []).map((p) => p.id), [polls.data]);
  const ballots = useQuery({
    queryKey: ["ballots", pollAddress, human.nullifierHash.toString(), ids.map(String).join(",")],
    enabled: Boolean(pollAddress) && human.nullifierHash > 0n && ids.length > 0,
    queryFn: () => readBallots(getPublicClient(), pollAddress!, human.nullifierHash, ids),
  });

  const refresh = useCallback(() => {
    void polls.refetch();
    void ballots.refetch();
  }, [polls, ballots]);

  if (!pollAddress) {
    return <p className="text-sm text-muted-foreground">HumanPoll is not deployed on this profile yet.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-1 text-sm">
          <span className="text-muted-foreground">
            Contract <HashLink value={pollAddress} scope="creditcoin" kind="address" /> on {profile.label}
          </span>
          {mounted && !isConnected ? (
            <ConnectButton />
          ) : mounted && !human.isHuman ? (
            <span>
              This wallet is not a verified human yet.{" "}
              <Link className="underline" href="/app">
                Verify once
              </Link>{" "}
              and every poll here is open to you.
            </span>
          ) : mounted ? (
            <span className="flex items-center gap-1.5">
              <CheckIcon className="size-4 text-success" aria-hidden /> Verified human: one ballot per poll.
            </span>
          ) : null}
        </CardContent>
      </Card>

      <GasCard />

      {human.isHuman ? <CreatePoll address={pollAddress} onCreated={refresh} /> : null}

      {polls.isLoading ? <p className="text-sm text-muted-foreground">Reading polls from Creditcoin…</p> : null}
      {polls.error ? <p className="text-sm text-destructive">Could not read polls: {String(polls.error)}</p> : null}
      {polls.data && polls.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No polls yet. A verified human can open the first one.</p>
      ) : null}

      {(polls.data ?? []).map((p) => (
        <PollCard
          key={p.id.toString()}
          poll={viewOf(p, now)}
          now={now}
          address={pollAddress}
          canVote={human.isHuman}
          ballot={ballots.data?.get(p.id) ?? null}
          onVoted={refresh}
        />
      ))}
    </div>
  );
}

function PollCard({
  poll,
  now,
  address,
  canVote,
  ballot,
  onVoted,
}: {
  poll: PollView;
  now: number;
  address: `0x${string}`;
  canVote: boolean;
  ballot: number | null;
  onVoted: () => void;
}) {
  const tx = useTx({ label: "Voting", onConfirmed: onVoted });
  const voted = ballot !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{poll.question}</CardTitle>
        <CardDescription>
          #{poll.id.toString()} · {poll.voters.toString()} {poll.voters === 1n ? "human" : "humans"} voted ·{" "}
          {remaining(poll.closesAt, now)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {poll.options.map((option, i) => (
          <div key={option} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                {ballot === i ? <CheckIcon className="size-4 text-success" aria-label="your vote" /> : null}
                {option}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {poll.tally[i]?.toString()} · {poll.percent[i]}%
              </span>
            </div>
            <Progress value={poll.percent[i] ?? 0} />
            {poll.open && canVote && !voted ? (
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                disabled={tx.isBusy}
                onClick={() =>
                  void tx.send({
                    address,
                    abi: humanPollAbi,
                    functionName: "vote",
                    args: [poll.id, BigInt(i)],
                    chainId: creditcoinTestnet.id,
                  })
                }
              >
                <VoteIcon /> Vote
              </Button>
            ) : null}
          </div>
        ))}
        {voted ? <p className="text-xs text-muted-foreground">Your ballot is recorded against your World ID, not this wallet.</p> : null}
        {tx.error ? <p className="text-xs text-destructive">{tx.error}</p> : null}
      </CardContent>
    </Card>
  );
}

function CreatePoll({ address, onCreated }: { address: `0x${string}`; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["Yes", "No"]);
  const [duration, setDuration] = useState(DURATIONS[1]!.seconds);
  const problems = validateDraft(question, options, duration);
  const tx = useTx({
    label: "Opening poll",
    onConfirmed: () => {
      setQuestion("");
      setOptions(["Yes", "No"]);
      setOpen(false);
      onCreated();
    },
  });

  if (!open) {
    return (
      <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
        <PlusIcon /> Open a poll
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Open a poll</CardTitle>
        <CardDescription>Any verified human can ask; every verified human gets one ballot.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="poll-question">Question</Label>
          <Input id="poll-question" value={question} maxLength={280} onChange={(e) => setQuestion(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Options</Label>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`Option ${i + 1}`}
                value={o}
                maxLength={64}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {options.length > 2 ? (
                <Button size="icon" variant="ghost" aria-label="Remove option" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                  <XIcon />
                </Button>
              ) : null}
            </div>
          ))}
          {options.length < 8 ? (
            <Button size="sm" variant="ghost" className="self-start" onClick={() => setOptions([...options, ""])}>
              <PlusIcon /> Add option
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <Button key={d.seconds} size="sm" variant={d.seconds === duration ? "default" : "outline"} onClick={() => setDuration(d.seconds)}>
              {d.label}
            </Button>
          ))}
        </div>
        {question && problems.length > 0 ? (
          <ul className="text-xs text-destructive">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <Button
            disabled={problems.length > 0 || tx.isBusy}
            onClick={() =>
              void tx.send({
                address,
                abi: humanPollAbi,
                functionName: "createPoll",
                args: [question.trim(), options.map((o) => o.trim()), BigInt(duration)],
                chainId: creditcoinTestnet.id,
              })
            }
          >
            Open poll
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
        {tx.error ? <p className="text-xs text-destructive">{tx.error}</p> : null}
      </CardContent>
    </Card>
  );
}
