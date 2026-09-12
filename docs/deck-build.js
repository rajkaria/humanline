// docs/deck-build.js
//
// Regenerates docs/deck.pptx and docs/deck.pdf from the content in docs/DECK.md.
// The slide copy lives in this file, so edit DECK.md and this file together.
//
// Requires: bun, pptxgenjs, and LibreOffice for the PDF step.
//   bun add pptxgenjs
//   bun run docs/deck-build.js docs/deck.pptx
//   soffice --headless --convert-to pdf --outdir docs docs/deck.pptx
//
const pptxgen = require("pptxgenjs");

const BG="0A0E16", CARD="151C2A", CARD2="1E2738", TEXT="F2F5F9", MUTED="94A3B8",
      DIM="64748B", AMBER="F2A93B", CYAN="4EC9F5", RED="E5484D", GREEN="4ADE80", UNUSED="000000";
const STROKE="2A3448";
const H="Cambria", B="Calibri", M="Courier New";
const W=13.333, HT=7.5, MX=0.62;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Raj Karia";
pres.title = "Humanline";
pres.subject = "One human, one credit line";

function newSlide(n, notes){
  const s = pres.addSlide();
  s.background = { color: BG };
  if (n){
    s.addShape(pres.ShapeType.ellipse, {x:W-1.05, y:0.42, w:0.52, h:0.52,
      fill:{color:BG}, line:{color:AMBER, width:1.25}});
    s.addText(String(n), {x:W-1.05, y:0.42, w:0.52, h:0.52, align:"center", valign:"middle",
      fontSize:12, bold:true, color:AMBER, fontFace:B, isTextBox:true, margin:0});
  }
  s.addText("Humanline", {x:MX, y:HT-0.52, w:3, h:0.28, fontSize:9, color:DIM,
    fontFace:B, isTextBox:true, margin:0, charSpacing:1.5});
  if (notes) s.addNotes(notes);
  return s;
}

function title(s, t, sub){
  s.addText(t, {x:MX, y:0.45, w:W-2.0, h:0.72, fontSize:34, bold:true, color:TEXT,
    fontFace:H, isTextBox:true, margin:0, valign:"middle"});
  if (sub) s.addText(sub, {x:MX, y:1.17, w:W-2.0, h:0.34, fontSize:13, color:AMBER,
    fontFace:B, isTextBox:true, margin:0, italic:true});
}

function bullets(s, items, opt){
  const o = Object.assign({x:MX, y:1.75, w:6.0, h:4.6, fontSize:14, color:MUTED,
    fontFace:B, isTextBox:true, margin:0, paraSpaceAfter:11, lineSpacing:20}, opt||{});
  s.addText(items.map((t,i)=>({text:t, options:{bullet:{code:"25CF"}, breakLine:i<items.length-1}})), o);
}

function card(s, x, y, w, h, fill){
  s.addShape(pres.ShapeType.roundRect, {x, y, w, h, rectRadius:0.06,
    fill:{color: fill||CARD}, line:{color:STROKE, width:0.75}});
}

function chip(s, x, y, w, h, label, col){
  s.addShape(pres.ShapeType.roundRect, {x, y, w, h, rectRadius:0.08,
    fill:{color:CARD}, line:{color:col||STROKE, width:1}});
  s.addText(label, {x:x+0.06, y, w:w-0.12, h, align:"center", valign:"middle",
    fontSize:9.5, color: col||MUTED, fontFace:B, isTextBox:true, margin:0});
}

/* ---------------- 1. Hook ---------------- */
{
  const s = newSlide(null, "Cold open. Say the line, then stop talking. The whole pitch is in the second bullet.");
  s.addText("Humanline", {x:MX, y:0.7, w:7.2, h:0.5, fontSize:16, bold:true, color:AMBER,
    fontFace:B, isTextBox:true, margin:0, charSpacing:3});
  s.addText("A wallet is not a person.", {x:MX, y:1.35, w:7.4, h:1.5, fontSize:52, bold:true,
    color:TEXT, fontFace:H, isTextBox:true, margin:0});
  s.addText("One human, one credit line. World ID proof of personhood reaches Creditcoin through the Attestcoin Protocol, a zero-knowledge proof is verified on Creditcoin itself, and a verified human gets an uncollateralized credit line that follows the person, not the wallet.",
    {x:MX, y:3.0, w:7.0, h:1.5, fontSize:14, color:MUTED, fontFace:B, isTextBox:true, margin:0, lineSpacing:21});
  bullets(s, [
    "Creditcoin exists to give credit history to people the banking system cannot see.",
    "Every uncollateralized design on the chain scores a wallet, and a wallet is free.",
    "Ten wallets, ten perfect histories, then a default on the eleventh at full size.",
  ], {x:MX, y:4.55, w:7.0, h:1.9, fontSize:13});

  const cx1=9.4, cy1=3.67;
  s.addShape(pres.ShapeType.ellipse, {x:cx1-0.5, y:cy1-0.5, w:1.0, h:1.0, fill:{color:CARD}, line:{color:AMBER, width:2}});
  s.addText("1", {x:cx1-0.5, y:cy1-0.5, w:1.0, h:1.0, align:"center", valign:"middle", fontSize:24,
    bold:true, color:AMBER, fontFace:B, isTextBox:true, margin:0});
  s.addText("one person", {x:cx1-0.9, y:cy1+0.56, w:1.8, h:0.28, align:"center", fontSize:9.5,
    color:MUTED, fontFace:B, isTextBox:true, margin:0});
  const spineX=10.5, tx1=11.05, tw1=1.78, th1=0.34, tgap1=0.09, ty0=1.35;
  s.addShape(pres.ShapeType.line, {x:cx1+0.5, y:cy1, w:spineX-(cx1+0.5), h:0, line:{color:STROKE, width:1.25}});
  s.addShape(pres.ShapeType.line, {x:spineX, y:ty0+th1/2, w:0, h:10*(th1+tgap1), line:{color:STROKE, width:1.25}});
  for (let i=0;i<11;i++){
    const y = ty0 + i*(th1+tgap1), bad = (i===10);
    s.addShape(pres.ShapeType.line, {x:spineX, y:y+th1/2, w:tx1-spineX, h:0,
      line:{color: bad?RED:STROKE, width: bad?1.5:1, endArrowType:"triangle"}});
    s.addShape(pres.ShapeType.roundRect, {x:tx1, y, w:tw1, h:th1, rectRadius:0.14,
      fill:{color:CARD}, line:{color: bad?RED:STROKE, width: bad?1.5:0.75}});
    s.addText("wallet "+(i+1)+"  ·  "+(bad?"DEFAULT":"score 800"), {x:tx1, y, w:tw1, h:th1,
      align:"center", valign:"middle", fontSize:8, color: bad?RED:GREEN, fontFace:M, isTextBox:true, margin:0});
  }
  s.addText("eleven wallets, one human", {x:tx1-0.3, y:6.1, w:2.38, h:0.28, align:"center",
    fontSize:9.5, color:MUTED, fontFace:B, isTextBox:true, margin:0});
}

/* ---------------- 2. Problem ---------------- */
{
  const s = newSlide(2, "Aella runs BNPL for more than a million users on Creditcoin through Credal. This is the customer.");
  title(s, "Uncollateralized credit needs a unique borrower", "The market is real. The missing piece is not the ledger.");
  bullets(s, [
    "Aella records loans on Creditcoin through Credal and serves more than a million users.",
    "A lender without collateral has one question: will this person come back, and is there one of them.",
    "On-chain history answers the first. Nothing on Creditcoin answers the second.",
    "World ID has Orb-verified humans in Kenya, Argentina, Indonesia, the Philippines, Brazil and Malaysia. Those are Creditcoin's markets.",
    "But World ID's identity tree lives on Ethereum, and Creditcoin cannot see it.",
  ], {x:MX, y:1.85, w:6.1, h:4.3, fontSize:13.5});

  card(s, 7.15, 1.85, 5.55, 4.05);
  s.addText("The two ways across today", {x:7.45, y:2.0, w:4.95, h:0.32, fontSize:12, bold:true,
    color:TEXT, fontFace:B, isTextBox:true, margin:0});
  s.addShape(pres.ShapeType.roundRect, {x:7.45, y:2.55, w:2.2, h:1.0, rectRadius:0.08,
    fill:{color:CARD2}, line:{color:STROKE, width:0.75}});
  s.addText("Ethereum\nWorld ID tree", {x:7.45, y:2.55, w:2.2, h:1.0, align:"center", valign:"middle",
    fontSize:11, color:TEXT, fontFace:B, isTextBox:true, margin:0});
  s.addShape(pres.ShapeType.roundRect, {x:10.2, y:2.55, w:2.2, h:1.0, rectRadius:0.08,
    fill:{color:CARD2}, line:{color:STROKE, width:0.75}});
  s.addText("Creditcoin\nlender + borrower", {x:10.2, y:2.55, w:2.2, h:1.0, align:"center", valign:"middle",
    fontSize:11, color:TEXT, fontFace:B, isTextBox:true, margin:0});
  s.addShape(pres.ShapeType.line, {x:9.65, y:3.05, w:0.55, h:0, line:{color:RED, width:2, dashType:"dash"}});
  s.addText("trusted bridge", {x:7.45, y:3.82, w:4.95, h:0.3, fontSize:12, color:RED,
    fontFace:B, isTextBox:true, margin:0, strike:"sngStrike"});
  s.addText("trusted oracle", {x:7.45, y:4.22, w:4.95, h:0.3, fontSize:12, color:RED,
    fontFace:B, isTextBox:true, margin:0, strike:"sngStrike"});
  s.addText("Both are the exact thing the Attestcoin Protocol was built to remove. So we removed them.",
    {x:7.45, y:4.72, w:4.95, h:0.9, fontSize:12, color:AMBER, fontFace:B, isTextBox:true, margin:0, lineSpacing:18});
}

/* ---------------- 3. The 30-passport trap ---------------- */
{
  const s = newSlide(3, "87 submissions, read on 2026-09-12. Thirty are the same credit passport. None touch identity.");
  title(s, "The 30-passport trap", "87 submissions in this hackathon. About 30 build the same thing.");
  bullets(s, [
    "Read loan repayments on Sepolia, mint a score, call it a credit passport.",
    "Ten more are AI guardrails. Nine are escrow on proof.",
    "Zero touch identity. Zero use zero-knowledge proofs. Zero do proof of personhood.",
    "Every one of those passports can be forged by generating a new wallet. Not hacked. Generated.",
    "A perfect score that means nothing, because the thing being scored is not the thing that owes the money.",
  ], {x:MX, y:1.85, w:6.0, h:4.3, fontSize:13.5});

  const gx=7.15, gy=1.9, cols=12, cw=0.44, ch=0.34, gap=0.065;
  for (let i=0;i<87;i++){
    const c=i%cols, r=Math.floor(i/cols);
    const isPass = i<30, isUs = (i===86);
    s.addShape(pres.ShapeType.roundRect, {x:gx+c*(cw+gap), y:gy+r*(ch+gap), w:cw, h:ch, rectRadius:0.12,
      fill:{color: isUs?AMBER : (isPass? "2E3D59" : "121825")},
      line:{color: isUs?AMBER : (isPass? "4A5D85" : "1C2433"), width: isUs?1.5:0.6}});
  }
  const ly=5.26;
  s.addShape(pres.ShapeType.roundRect, {x:gx, y:ly+0.05, w:0.2, h:0.2, rectRadius:0.2, fill:{color:"2E3D59"}, line:{color:"4A5D85", width:0.6}});
  s.addText("30 credit passports", {x:gx+0.3, y:ly, w:2.4, h:0.3, fontSize:10, color:MUTED, fontFace:B, isTextBox:true, margin:0, valign:"middle"});
  s.addShape(pres.ShapeType.roundRect, {x:gx+2.85, y:ly+0.05, w:0.2, h:0.2, rectRadius:0.2, fill:{color:AMBER}, line:{color:AMBER, width:0.6}});
  s.addText("Humanline", {x:gx+3.15, y:ly, w:1.6, h:0.3, fontSize:10, bold:true, color:AMBER, fontFace:B, isTextBox:true, margin:0, valign:"middle"});
  card(s, gx, 5.66, 5.95, 0.85, CARD2);
  s.addText("0 identity    ·    0 zero-knowledge    ·    0 proof of personhood",
    {x:gx, y:5.66, w:5.95, h:0.85, align:"center", valign:"middle", fontSize:13.5, bold:true,
     color:AMBER, fontFace:B, isTextBox:true, margin:0});
}

/* ---------------- 4. Insight ---------------- */
{
  const s = newSlide(4, "This is the whole idea. If they remember one slide, it is this one.");
  title(s, "The nullifier is the human", "Bind the person. Never bind the key.");
  bullets(s, [
    "A World ID nullifier comes from an Orb iris scan and an action string. It is the same value whatever wallet the person uses.",
    "Every piece of state in Humanline is keyed by it. Nothing is keyed by an address.",
    "Re-bind to a new wallet and the identity, the limit and the history all move with the person.",
    "Default, and the freeze attaches to the nullifier. It survives a new wallet, a new key, a new device.",
    "The forgery that breaks every other credit passport costs nothing. Forging this costs a second iris.",
  ], {x:MX, y:1.85, w:6.1, h:4.3, fontSize:13.5});

  const cx=9.95, cy=3.55;
  s.addShape(pres.ShapeType.ellipse, {x:cx-1.35, y:cy-1.35, w:2.7, h:2.7,
    fill:{color:BG}, line:{color:STROKE, width:0.75, dashType:"dash"}});
  s.addShape(pres.ShapeType.ellipse, {x:cx-0.95, y:cy-0.62, w:1.9, h:1.24,
    fill:{color:CARD}, line:{color:AMBER, width:1.75}});
  s.addText("nullifier", {x:cx-0.95, y:cy-0.5, w:1.9, h:0.3, align:"center", fontSize:10,
    color:AMBER, fontFace:B, isTextBox:true, margin:0});
  s.addText("0x7a1c…9fe2", {x:cx-0.95, y:cy-0.18, w:1.9, h:0.32, align:"center", fontSize:11,
    bold:true, color:TEXT, fontFace:M, isTextBox:true, margin:0});
  s.addText("the human", {x:cx-0.95, y:cy+0.14, w:1.9, h:0.3, align:"center", fontSize:9,
    color:MUTED, fontFace:B, isTextBox:true, margin:0});

  const orbits=[["wallet A","unbound",DIM,-1.0,-1.85],["wallet B","current",CYAN,1.05,-1.85],["wallet C","future",DIM,0.02,1.5]];
  orbits.forEach(([n,st,col,dx,dy])=>{
    s.addShape(pres.ShapeType.roundRect, {x:cx+dx-0.72, y:cy+dy-0.28, w:1.44, h:0.56, rectRadius:0.1,
      fill:{color:CARD}, line:{color:col, width:1}});
    s.addText(n+"\n"+st, {x:cx+dx-0.72, y:cy+dy-0.28, w:1.44, h:0.56, align:"center", valign:"middle",
      fontSize:8.5, color:col, fontFace:B, isTextBox:true, margin:0});
  });
  s.addText("FROZEN", {x:cx-1.5, y:cy+0.62, w:3.0, h:0.4, align:"center", fontSize:16, bold:true,
    color:RED, fontFace:B, isTextBox:true, margin:0, charSpacing:4});
  s.addText("the freeze is on the hash, not on any address",
    {x:cx-2.0, y:cy+2.0, w:4.0, h:0.3, align:"center", fontSize:9.5, color:MUTED, fontFace:B, isTextBox:true, margin:0});
}

/* ---------------- 5. How it works ---------------- */
{
  const s = newSlide(5, "Five boxes. Do not go deeper than this in the room; the depth slide is next.");
  title(s, "How it works", "Roots come in through Attestcoin. Proofs are checked on Creditcoin. Credit follows the human.");
  const steps = [
    ["Ethereum mainnet", "World's sequencer calls registerIdentities about once an hour and emits TreeChanged with the old and new roots.", CYAN],
    ["Worker", "Tails both source chains, batches up to 10 Attestcoin proofs behind one continuity proof, relays them in order. Holds no privilege.", CYAN],
    ["AttestedWorldID", "0x0FD2 proves inclusion. The contract cross-checks calldata against the log, chains preRoot to the last known root, and guards on 0x0FD3 and 0x0FD4.", AMBER],
    ["HumanRegistry", "A Semaphore Groth16 proof verified natively on Creditcoin, on the bn128 precompiles, against that root. One nullifier, one wallet.", AMBER],
    ["CreditLine", "One line per nullifier. Repay on time and the limit grows a quarter. Repay late and it halves. Miss the grace window and it freezes.", GREEN],
  ];
  const bw=2.34, bh=3.45, gap=0.22, x0=MX;
  steps.forEach(([t,d,col],i)=>{
    const x = x0 + i*(bw+gap);
    card(s, x, 2.05, bw, bh);
    s.addShape(pres.ShapeType.ellipse, {x:x+0.22, y:2.28, w:0.42, h:0.42, fill:{color:BG}, line:{color:col, width:1.25}});
    s.addText(String(i+1), {x:x+0.22, y:2.28, w:0.42, h:0.42, align:"center", valign:"middle",
      fontSize:11, bold:true, color:col, fontFace:B, isTextBox:true, margin:0});
    s.addText(t, {x:x+0.22, y:2.84, w:bw-0.44, h:0.4, fontSize:12.5, bold:true, color:TEXT,
      fontFace:B, isTextBox:true, margin:0, valign:"top"});
    s.addText(d, {x:x+0.22, y:3.3, w:bw-0.44, h:2.0, fontSize:10, color:MUTED, fontFace:B,
      isTextBox:true, margin:0, lineSpacing:14, valign:"top"});
    if (i<4) s.addShape(pres.ShapeType.line, {x:x+bw+0.03, y:3.78, w:gap-0.06, h:0,
      line:{color:STROKE, width:1.25, endArrowType:"triangle"}});
  });
  s.addText("No owner. No pause. No upgrade path. Anyone can run the relay, and the contracts do not care who does.",
    {x:MX, y:5.95, w:W-2*MX, h:0.42, align:"center", fontSize:13, bold:true, color:AMBER,
     fontFace:B, isTextBox:true, margin:0});
}

/* ---------------- 6. Attestcoin depth ---------------- */
{
  const s = newSlide(6, "This is the scoring criterion. Ten surfaces, and every one is load-bearing.");
  title(s, "Attestcoin depth: ten surfaces, all load-bearing");
  const hdr = (t)=>({text:t, options:{bold:true, color:AMBER, fontSize:10.5, fill:{color:CARD2}}});
  const rows = [
    [hdr("Surface"), hdr("Where it runs"), hdr("Why it is load-bearing")],
    ["verifyAndEmit (0x0FD2)", "ASCBase.execute", "No root reaches the verifier without it"],
    ["Batch verification", "getBatchProof, executeBatch", "Up to 10 proofs under one continuity proof"],
    ["Calldata decoding", "decodeCommonTxFields(tx).data", "Yields postRoot and the count of humans added"],
    ["Log decoding", "getLogsByEventSignature", "The root itself"],
    ["Emitter and status binding", "to, log.address_, status", "Rejects look-alike events and reverted txs"],
    ["calculateTxIndex", "queryId, sourceTxIndex", "Replay key and ordering evidence"],
    ["ChainInfo (0x0FD3)", "Finality depth guard", "Accepted only 32 blocks behind the attested tip"],
    ["AttestorStash (0x0FD4)", "Quorum floor", "Refuses roots attested by a thin set"],
    ["Two source chains", "chainKey 3 and chainKey 1", "Production and judge-reproducible paths"],
    ["Zero-knowledge on top", "Semaphore over a relayed root", "Without Attestcoin the verifier has no root"],
  ];
  s.addTable(rows, {
    x:MX, y:1.6, w:W-2*MX, colW:[3.1, 3.3, 5.71], border:{type:"solid", color:STROKE, pt:0.5},
    fontFace:B, fontSize:10.2, color:MUTED, fill:{color:CARD}, rowH:0.385, valign:"middle",
    margin:0.06,
  });
  s.addText("Remove Attestcoin and Humanline has no roots, so no humans, so no credit. There is no degraded mode.",
    {x:MX, y:6.18, w:W-2*MX, h:0.42, align:"center", fontSize:13, bold:true, color:AMBER,
     fontFace:B, isTextBox:true, margin:0});
}

/* ---------------- 7. What is real ---------------- */
{
  const s = newSlide(7, "Judges check this first. Never soften it, and never add a third column.");
  title(s, "What is real", "Say the boring part out loud. It is what makes the rest credible.");
  card(s, MX, 1.85, 6.15, 4.45);
  s.addShape(pres.ShapeType.ellipse, {x:MX+0.3, y:2.1, w:0.34, h:0.34, fill:{color:BG}, line:{color:GREEN, width:1.25}});
  s.addText("Real, on chain, right now", {x:MX+0.78, y:2.08, w:5.1, h:0.38, fontSize:13, bold:true,
    color:GREEN, fontFace:B, isTextBox:true, margin:0, valign:"middle"});
  bullets(s, [
    "Ethereum mainnet World ID roots, produced by World's own sequencer about once an hour, relayed unattended.",
    "An Attestcoin proof verified by the 0x0FD2 precompile inside every relay transaction. No mock, no canned fixture.",
    "Groth16 Semaphore verification executing on Creditcoin CC3, on the bn128 precompiles, in one block.",
    "Sepolia staging roots and World simulator proofs, so a judge reproduces the whole flow without an Orb.",
  ], {x:MX+0.3, y:2.65, w:5.55, h:3.4, fontSize:11.5, color:MUTED});

  card(s, 7.05, 1.85, 5.65, 4.45);
  s.addShape(pres.ShapeType.ellipse, {x:7.35, y:2.1, w:0.34, h:0.34, fill:{color:BG}, line:{color:AMBER, width:1.25}});
  s.addText("Testnet only, and not claimed", {x:7.83, y:2.08, w:4.6, h:0.38, fontSize:13, bold:true,
    color:AMBER, fontFace:B, isTextBox:true, margin:0, valign:"middle"});
  bullets(s, [
    "hUSD is a test stablecoin we mint. Lender deposits are testnet funds.",
    "The demo deployment uses minute-long loan terms so a full cycle fits in a video.",
    "Attestcoin cannot prove a payment did not happen. We never pretend otherwise.",
    "A default is declared from a passed deadline plus the absence of a repayment on Creditcoin, which is native state, not a cross-chain absence claim.",
  ], {x:7.35, y:2.65, w:5.05, h:3.4, fontSize:11.5, color:MUTED});
  s.addText("Every green claim above links to a transaction on Etherscan or Blockscout from the live app.",
    {x:MX, y:6.5, w:W-2*MX, h:0.35, align:"center", fontSize:11, color:DIM, fontFace:B, isTextBox:true, margin:0});
}

/* ---------------- 8. Demo ---------------- */
{
  const s = newSlide(8, "Three minutes. Never speed up a confirmation; cut to the explorer instead.");
  title(s, "Demo", "Three minutes, six steps, every step an on-chain artifact.");
  const steps = [
    ["/relay", "A real Ethereum root landing on Creditcoin. Click through to both transactions and read the humans-added count decoded from the calldata.", "0:28"],
    ["/app", "Connect a Creditcoin wallet, verify with the World simulator, watch registration confirm in one block. The wallet becomes a human.", "1:05"],
    ["Credit", "Open a line at 25 hUSD, borrow 20, repay, limit grows to 31.25. Every action links to Blockscout.", "1:45"],
    ["Re-bind", "A second wallet, the same identity. The line and history follow the person. A second line is refused with LineExists.", "2:25"],
    ["/judge", "Run the negative-path suite live. Every attack rejected by a named error.", "2:40"],
    ["Counter", "N real roots relayed from Ethereum mainnet, M humans in the registry, zero trusted parties.", "2:52"],
  ];
  const cw=4.0, ch=2.05, gx=MX, gy=1.85, gapx=0.28, gapy=0.28;
  steps.forEach(([t,d,ts],i)=>{
    const x=gx+(i%3)*(cw+gapx), y=gy+Math.floor(i/3)*(ch+gapy);
    card(s, x, y, cw, ch, i===5?CARD2:CARD);
    s.addShape(pres.ShapeType.ellipse, {x:x+0.22, y:y+0.22, w:0.4, h:0.4, fill:{color:BG},
      line:{color: i===5?AMBER:CYAN, width:1.25}});
    s.addText(String(i+1), {x:x+0.22, y:y+0.22, w:0.4, h:0.4, align:"center", valign:"middle",
      fontSize:10.5, bold:true, color: i===5?AMBER:CYAN, fontFace:B, isTextBox:true, margin:0});
    s.addText(t, {x:x+0.74, y:y+0.22, w:2.2, h:0.4, fontSize:13, bold:true, color:TEXT,
      fontFace:B, isTextBox:true, margin:0, valign:"middle"});
    s.addText(ts, {x:x+cw-1.0, y:y+0.22, w:0.78, h:0.4, align:"right", fontSize:10, color:DIM,
      fontFace:M, isTextBox:true, margin:0, valign:"middle"});
    s.addText(d, {x:x+0.22, y:y+0.72, w:cw-0.44, h:1.15, fontSize:10.5, color:MUTED, fontFace:B,
      isTextBox:true, margin:0, lineSpacing:14.5, valign:"top"});
  });
  s.addText("Live at https://humanline.credit    ·    demo video linked from the submission", {x:MX, y:6.52, w:W-2*MX, h:0.35,
    align:"center", fontSize:11, color:DIM, fontFace:M, isTextBox:true, margin:0});
}

/* ---------------- 9. Security ---------------- */
{
  const s = newSlide(9, "Attestcoin proves two things. The other ten checks are ours. This is the slide a technical judge lingers on.");
  title(s, "What Attestcoin proves, and what we add", "Readability proofs are a primitive. A correct application still supplies its own ordering, binding and replay key.");
  card(s, MX, 1.95, 4.35, 1.5, CARD2);
  s.addText("Attestcoin proves", {x:MX+0.28, y:2.1, w:3.8, h:0.3, fontSize:10.5, color:AMBER,
    fontFace:B, isTextBox:true, margin:0, charSpacing:1.2});
  s.addText("inclusion  +  continuity", {x:MX+0.28, y:2.45, w:3.8, h:0.45, fontSize:17, bold:true,
    color:TEXT, fontFace:B, isTextBox:true, margin:0});
  s.addText("That is all it proves, and it is enough.", {x:MX+0.28, y:2.95, w:3.8, h:0.32,
    fontSize:10.5, color:MUTED, fontFace:B, isTextBox:true, margin:0});

  s.addText("Everything else is our job. Ten checks, in this order:", {x:MX, y:3.65, w:4.35, h:0.35,
    fontSize:12, bold:true, color:TEXT, fontFace:B, isTextBox:true, margin:0});
  const checks = ["receipt status","source contract","emitter binding","calldata vs log","root chaining",
                  "finality depth","attestor quorum","replay by queryId","root expiry","nullifier uniqueness"];
  checks.forEach((c,i)=>{
    const x = MX + (i%2)*2.2, y = 4.1 + Math.floor(i/2)*0.45;
    chip(s, x, y, 2.08, 0.37, (i+1)+".  "+c, MUTED);
  });

  card(s, 5.4, 1.95, 7.3, 4.45);
  s.addText("Attacks, and the error that stops them", {x:5.7, y:2.12, w:6.7, h:0.35, fontSize:12.5,
    bold:true, color:TEXT, fontFace:B, isTextBox:true, margin:0});
  const attacks = [
    ["Forged root or proof", "rejected at 0x0FD2, first"],
    ["Decoy TreeChanged from another contract", "skipped by the emitter filter"],
    ["Two genuine TreeChanged logs in one tx", "AmbiguousTreeChange"],
    ["Calldata that disagrees with the log", "CalldataLogMismatch"],
    ["A genuine root, out of sequence", "UnknownPreRoot"],
    ["A root shallow enough to be reorged", "NotFinal, 32 blocks of depth"],
    ["A thin or captured attestor set", "ThinQuorum, floor of 3"],
    ["Replaying a proof already relayed", "queryId already processed"],
    ["Stealing a proof from the mempool", "ProofInvalid, signal is caller"],
    ["A defaulted human with a fresh wallet", "LineFrozen, on the nullifier"],
  ];
  attacks.forEach(([a,d],i)=>{
    const y = 2.6 + i*0.375;
    s.addText(a, {x:5.7, y, w:3.05, h:0.34, fontSize:10, color:RED, fontFace:B, isTextBox:true, margin:0, valign:"middle"});
    s.addText(d, {x:8.82, y, w:3.6, h:0.34, fontSize:9, color:MUTED, fontFace:M, isTextBox:true, margin:0, valign:"middle"});
  });
  s.addText("No admin keys. Every constant is an immutable. Anyone can relay.",
    {x:MX, y:6.55, w:W-2*MX, h:0.35, align:"center", fontSize:11.5, bold:true, color:AMBER,
     fontFace:B, isTextBox:true, margin:0});
}

/* ---------------- 10. Market and business ---------------- */
{
  const s = newSlide(10, "The table numbers are modeled from the deployed contract parameters, not measured from borrowers. Say that.");
  title(s, "Market and business", "A personhood layer with a lending business on top, not a lending app with an identity feature.");
  s.addChart(pres.ChartType.bar, [{
    name: "Limit at draw, hUSD",
    labels: ["Term 1","Term 2","Term 3","Term 4","Term 5","Term 6"],
    values: [25, 31.25, 39.06, 48.83, 61.04, 76.29],
  }], {
    x:MX, y:1.95, w:6.3, h:3.6,
    barDir:"col", chartColors:[AMBER], showTitle:true, title:"Limit growth, 25 percent per on-time term",
    titleColor:TEXT, titleFontSize:12, titleFontFace:B,
    showValue:true, dataLabelPosition:"outEnd", dataLabelColor:MUTED, dataLabelFontSize:9, dataLabelFontFace:B,
    catAxisLabelColor:MUTED, catAxisLabelFontSize:9.5, catAxisLabelFontFace:B,
    valAxisLabelColor:MUTED, valAxisLabelFontSize:9, valAxisLabelFontFace:B, valAxisMinVal:0, valAxisMaxVal:90,
    valGridLine:{color:STROKE, size:0.5}, catGridLine:{style:"none"},
    showLegend:false, plotArea:{fill:{color:BG}}, chartArea:{fill:{color:BG}}, border:{pt:0, color:BG},
  });
  s.addText("One borrower, first year, modeled from the deployed contract parameters. Not measured.",
    {x:MX, y:5.6, w:6.3, h:0.3, fontSize:9.5, color:DIM, fontFace:B, isTextBox:true, margin:0});

  const stats = [["281 USD","cumulative draw across six terms"],["3.76 USD","revenue from one first-year borrower"],["1 percent","origination, plus a spread on the term fee"]];
  stats.forEach(([n,l],i)=>{
    const y = 1.95 + i*1.12;
    card(s, 7.2, y, 5.5, 0.96);
    s.addText(n, {x:7.5, y:y+0.08, w:2.3, h:0.8, fontSize:22, bold:true, color:AMBER, fontFace:H, isTextBox:true, margin:0, valign:"middle"});
    s.addText(l, {x:9.85, y:y+0.08, w:2.6, h:0.8, fontSize:10.5, color:MUTED, fontFace:B, isTextBox:true, margin:0, valign:"middle"});
  });
  bullets(s, [
    "Three lines: a 0.10 USD verification fee from the lender, 1 percent origination, and a spread on the pool.",
    "The compounding asset is the shared default record. Ten lenders on one registry is a credit bureau nobody operates.",
    "Every integration, every repayment and every root is Attestcoin volume.",
  ], {x:7.2, y:5.34, w:5.5, h:1.4, fontSize:10, lineSpacing:13.5, paraSpaceAfter:6, valign:"top"});
}

/* ---------------- 11. Roadmap and Periscope ---------------- */
{
  const s = newSlide(11, "Periscope is the part that is bigger than us. Lead with the roadmap, land on Periscope.");
  title(s, "Roadmap, and Periscope", "Every step adds Attestcoin volume instead of replacing it.");
  const ms = [
    ["Month 1", "AttestedWorldID and HumanRegistry on Creditcoin mainnet, published as a public read interface. First lender using isHuman as a sybil check through Credal. Two independent relayers.", CYAN],
    ["Month 3", "Lines funded by PenguinSwap LPs. Repay-from-Ethereum: a USDC transfer proven through Attestcoin and credited on Creditcoin. BSC as a source chain when chainKey 8 ships.", CYAN],
    ["Month 6", "Supervised pilot in Kenya and Argentina with a lending partner, and a published cohort loss curve for personhood-gated credit. Nobody has one.", AMBER],
  ];
  ms.forEach(([t,d,col],i)=>{
    const x = MX + i*(4.0+0.26);
    card(s, x, 1.9, 4.0, 2.5);
    s.addShape(pres.ShapeType.ellipse, {x:x+0.24, y:2.12, w:0.4, h:0.4, fill:{color:BG}, line:{color:col, width:1.25}});
    s.addText(String(i+1), {x:x+0.24, y:2.12, w:0.4, h:0.4, align:"center", valign:"middle", fontSize:10.5,
      bold:true, color:col, fontFace:B, isTextBox:true, margin:0});
    s.addText(t, {x:x+0.76, y:2.12, w:2.6, h:0.4, fontSize:14, bold:true, color:TEXT, fontFace:B,
      isTextBox:true, margin:0, valign:"middle"});
    s.addText(d, {x:x+0.24, y:2.62, w:3.5, h:1.6, fontSize:10.5, color:MUTED, fontFace:B,
      isTextBox:true, margin:0, lineSpacing:14.5, valign:"top"});
  });

  card(s, MX, 4.62, 12.09, 1.9, CARD2);
  s.addText("Periscope", {x:MX+0.32, y:4.8, w:2.4, h:0.4, fontSize:16, bold:true, color:AMBER,
    fontFace:H, isTextBox:true, margin:0, valign:"middle"});
  s.addText("World ID 4.0 verification lives on World Chain, an OP-Stack rollup whose output roots are posted to Ethereum. Attestcoin already attests Ethereum. Prove the posting and you have proven the rollup.",
    {x:MX+0.32, y:5.16, w:6.55, h:1.2, fontSize:11.5, color:MUTED, fontFace:B, isTextBox:true, margin:0, lineSpacing:16, valign:"top"});
  s.addText("This is not a Humanline feature. It gives Attestcoin reach into every OP-Stack rollup through a chain it already covers. We are just the first application that needs it.",
    {x:7.95, y:5.0, w:4.45, h:1.35, fontSize:11.5, bold:true, color:AMBER, fontFace:B, isTextBox:true, margin:0, lineSpacing:16, valign:"middle"});
}

/* ---------------- 12. The ask ---------------- */
{
  const s = newSlide(12, "Close on the counter line. Then stop.");
  title(s, "The ask", "The top three teams enter the CEIP fast-track. We are asking for that, and for three things through it.");
  const asks = [
    ["Capital", "A 6-month supervised pilot in Kenya and Argentina. The deliverable is a published cohort loss curve every Creditcoin lender can underwrite against.", AMBER],
    ["A lender introduction", "To Aella, or any Credal lender. The registry is one read call from being useful to a loan book that already exists.", CYAN],
    ["Engineering support", "Build Periscope with the Creditcoin team, bringing World Chain and every other OP-Stack rollup under Attestcoin.", GREEN],
  ];
  asks.forEach(([t,d,col],i)=>{
    const x = MX + i*(4.0+0.26);
    card(s, x, 1.95, 4.0, 2.4);
    s.addShape(pres.ShapeType.ellipse, {x:x+0.24, y:2.16, w:0.42, h:0.42, fill:{color:BG}, line:{color:col, width:1.5}});
    s.addText(String(i+1), {x:x+0.24, y:2.16, w:0.42, h:0.42, align:"center", valign:"middle",
      fontSize:10.5, bold:true, color:col, fontFace:B, isTextBox:true, margin:0});
    s.addText(t, {x:x+0.24, y:2.66, w:3.5, h:0.4, fontSize:15, bold:true, color:col, fontFace:H,
      isTextBox:true, margin:0, valign:"top"});
    s.addText(d, {x:x+0.24, y:3.12, w:3.5, h:1.1, fontSize:10.5, color:MUTED, fontFace:B,
      isTextBox:true, margin:0, lineSpacing:14.5, valign:"top"});
  });

  card(s, MX, 4.6, 12.09, 1.42, CARD2);
  const counters=[["15","real World ID roots relayed"],["600","World ID identities carried"],["1,000","hUSD in the lender pools"],["0","trusted parties"]];
  counters.forEach(([n,l],i)=>{
    const x = MX + 0.3 + i*3.0;
    s.addText(n, {x, y:4.75, w:2.8, h:0.55, fontSize:22, bold:true, color: i===3?AMBER:TEXT,
      fontFace:H, isTextBox:true, margin:0});
    s.addText(l, {x, y:5.31, w:2.8, h:0.35, fontSize:10, color:MUTED, fontFace:B, isTextBox:true, margin:0});
  });
  s.addText("One human, one credit line.", {x:MX, y:6.18, w:6.5, h:0.5, fontSize:22, bold:true,
    color:TEXT, fontFace:H, isTextBox:true, margin:0});
  s.addText("https://humanline.credit    ·    https://github.com/rajkaria/humanline", {x:6.5, y:6.24, w:6.2, h:0.4, align:"right",
    fontSize:11, color:AMBER, fontFace:M, isTextBox:true, margin:0, valign:"middle"});
}

pres.writeFile({ fileName: process.argv[2] || "humanline-deck.pptx" }).then(f=>console.log("wrote", f));
