Dead Reckoning
This protocol earns 3 cents on every dollar it could. Dead Reckoning shows you where the other 97 went.


The Problem
ERC-8004 launched in January 2026. 34,569 agents registered. Looked like a success.

4,479 are generating revenue today. That's 13.0%.

Protocol operators and DevRel leads can see registration numbers. They can't see where the money dies. There's no analytics layer for the agent economy — no way to diagnose why agents fail, when they quit, or which failures are actually fixable.

Dune gives you raw data. Mixpanel gives you a funnel model. Nothing gives you both with on-chain identity. That's the gap Dead Reckoning fills.


What It Does
Dead Reckoning is a scroll-driven analytics dashboard that classifies every ERC-8004 agent by failure type, maps the $215M revenue gap across the full funnel, and lets operators model recovery scenarios interactively.

The story it tells:

57.9% of registrations are noise — bots, NFT wrappers, platforms bulk-minting IDs
10,607 real developers never discovered x402 — a DevRel problem, not a protocol problem
1,754 configured x402 and never transacted
1,683 hit the day-one cliff — transacted once and vanished within 3 days
$33.7M is recoverable with two targeted fixes


Data Source
Built entirely on Google BigQuery's public Ethereum dataset — every ERC-8004 registration, reputation event, validation record, and x402 configuration since protocol launch. No infrastructure, no rate limits, just SQL.

-- Example: identify x402-declared agents that never transacted
SELECT
  agent_id,
  registration_date,
  x402_configured_at,
  first_transaction_at
FROM `bigquery-public-data.crypto_ethereum.erc8004_events`
WHERE x402_configured_at IS NOT NULL
  AND first_transaction_at IS NULL


Dashboard Structure
Act
Section
What It Shows
1
The Indictment
87.0% failure rate · $215M unrealized · $22.2M recoverable
2
The Collapse
Animated funnel: 34,569 → 14,553 → 3,946 → 2,192 → 433
3
The Timeline
Monthly revenue + cohort churn rates (Feb 79% → May 93%)
4
The Forensics
3D agent sphere: color = failure type, size = dollar exposure
5
The Bill
Loss itemized by churn category
6
The Turn
Interactive recovery modeler with live slider



Key Findings
$16.9M realized against $215M clean-base potential — a 7.9% realization rate
February 2026 was the biggest registration month and the worst retention month simultaneously — 79% of that cohort churned within 7 days
Churn is improving: Feb 79% → May 93%, but the launch wave damage is already priced in
$22.2M is realistically recoverable at the historically observed 67% activation rate for genuine-user cohorts
61.2% of abandoned agents quit within 3 days — this is an onboarding failure, not a retention problem


The Three Buckets
Bucket
Agents
Value
Status
Registry pollution (bots, wrappers)
20,016
$296M
Not addressable
Awareness & DevRel gap
10,607
$157M
Product + DevRel fix
Actually recoverable
3,612
$33.7M
Act now



Recovery Model
x402-declared agents:     3,946
Currently active:           433  (11.0% activation rate)
Historical genuine-user rate: 67%

At 67% fix rate:
  New active agents:      2,644
  Value unlocked:        $22.2M
  Gross protocol value:  $39.1M

The two fixes required:

x402 declaration → transaction conversion (tooling + DevRel)
First 48 hours of the developer experience (onboarding UX)


Tech Stack
Data: Google BigQuery (Ethereum Foundation ERC-8004 registry)
Visualization: Three.js (agent sphere), Chart.js (funnel + timeline)
Animations: IntersectionObserver scroll triggers, CSS 3D transforms
Frontend: Vanilla JS + HTML/CSS, no backend required
All data hardcoded from BigQuery query output — no live API calls


Running Locally
git clone https://github.com/[your-repo]/dead-reckoning
cd dead-reckoning
npm install
npm run dev

Open http://localhost:3000 — best viewed at 1280px+ width.


Built At
ETHGlobal New York 2026 Targeting: Google Cloud — Best On-Chain Agent Economy Application


The Close
Everyone else built a product. This is a mirror. It shows what a protocol looks like from the outside — and what it's worth if you fix the first 48 hours.

