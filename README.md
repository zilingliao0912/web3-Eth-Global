# Dead Reckoning

> **The Agent Adoption Copilot**
>
> Dead Reckoning identifies which ERC-8004 agents are failing, why they're failing, and what intervention is most likely to recover them.

🎥 **Demo Video:** https://www.loom.com/share/c6cea9569b49492cbf07ee0d51f54ed6 


---

## The Problem

The agent economy has a visibility problem.

Protocol teams can see registrations.
They can see transactions.
They cannot see everything in between.

When agent adoption stalls, every problem looks like a growth problem:

- Is onboarding broken?
- Did developers never discover x402?
- Did they configure payments but never activate?
- Did they churn after first use?
- Which wallets are actually recoverable?

Today, no tool answers those questions.

Dead Reckoning reconstructs the entire agent lifecycle directly from public on-chain data.

---

## What Dead Reckoning Does

Dead Reckoning is a diagnostic and recovery engine for the ERC-8004 ecosystem.

For every wallet, it:

### 1. Classifies

Identifies where an agent sits in the lifecycle:

```text
Registered
↓
Listed
↓
Callable
↓
Monetized
↓
Reviewed
```

### 2. Diagnoses

Determines why adoption failed:

- Never Activated
- Stalled Mid-Funnel
- Gas Failure
- Timeout
- Intent Mismatch
- Abandoned

### 3. Prescribes

Generates the highest-leverage recovery action:

- Re-onboarding campaign
- Subsidized gas grant
- Human DevRel outreach
- SDK implementation guide
- Expansion opportunity

> Most analytics tools stop at diagnosis.
>
> **Dead Reckoning recommends what to do next.**

---

## Why This Matters

Most ecosystems respond to weak monetization by acquiring more users.

Dead Reckoning shows that the biggest opportunity often already exists inside the funnel.

Instead of asking:

> How do we acquire more agents?

It asks:

> Which agents are recoverable right now?

And:

> What intervention creates the highest recovery value?

The result is a shift from reporting metrics to driving action.

---

## Key Insights

### Insight #1: The Ecosystem Appears Larger Than It Is

57.9% of registrations are noise.

The raw registration count includes:

- Bulk mints
- NFT wrappers
- Platform-generated registrations
- Duplicate metadata

Dead Reckoning filters these signals to isolate genuine participants.

### Insight #2: Activation Is the Biggest Bottleneck

10,607 qualified agents never reached x402 activation.

The largest opportunity is not retention.

It's helping agents reach their first value moment.

### Insight #3: The First 48 Hours Matter Most

1,683 agents churned within 3 days.

Most abandonment happens immediately after onboarding, suggesting the problem is activation and developer experience rather than long-term engagement.

### Insight #4: Churn Is Not Permanent

$33.7M of protocol value appears recoverable through targeted interventions.

Not all churned wallets are lost.

Many simply need the right intervention at the right stage.

---

## Example Recovery Workflow

When an operator selects a wallet, Dead Reckoning does more than display metrics.

It generates a diagnosis and recommended action.

Example:

```text
Wallet Status:
Never Activated

Likely Failure Mode:
Awareness Gap

Recommended Intervention:
Trigger re-onboarding with subsidized gas grant

Estimated Recovery Value:
$14,800

Confidence:
82%
```

The goal is not to identify failed wallets.

The goal is to identify **recoverable wallets**.

---

## Technical Architecture

Dead Reckoning is powered by an explainable on-chain classification engine.

### Inputs

- ERC-8004 Identity Registry
- ERC-8004 Reputation Registry
- Ethereum transaction history
- Trace-level failure signals
- x402 metadata declarations
- Agent metadata and service definitions

### Pipeline

```text
Raw On-Chain Events
↓
Noise Filtering
↓
Lifecycle Reconstruction
↓
Intent Classification
↓
Failure Diagnosis
↓
Recovery Recommendation
```

### Noise Filtering

The system identifies:

- Bulk mints
- Duplicate URIs
- NFT-wrapped agents
- Platform operators
- High fan-out wallets

This separates vanity metrics from meaningful adoption signals.

### Lifecycle Reconstruction

Every agent is assigned a funnel stage:

```text
1. Ghost
2. Listed
3. Callable
4. Monetized
5. Reviewed
```

These stages are derived entirely from public on-chain activity.

### Intent Classification

Dead Reckoning combines:

**Behavioral Intent**
- Trading bots
- Yield agents
- Bridge agents
- General-purpose agents

**Declared Intent**
- Parsed from ERC-8004 metadata descriptions

When behavioral and declared intent disagree, the system flags an intent mismatch.

> Behavior beats biography.

### Failure Classification

Each wallet is assigned a failure mode:

- Never Activated
- Stalled Mid-Funnel
- Gas Failure
- Timeout
- Intent Mismatch
- Abandoned
- Active

Unlike a black-box machine learning model, every classification can be traced directly to observable on-chain behavior.

---

## Why Blockchain?

The data required to diagnose agent adoption only exists on-chain.

Every registration, service declaration, x402 configuration, reputation event, transaction, and period of inactivity leaves an immutable trail.

Traditional analytics tools require teams to manually instrument events.

Dead Reckoning reconstructs the entire lifecycle from public blockchain data alone.

---

## Dashboard Structure

| Section | Purpose |
|----------|----------|
| The Indictment | Quantifies unrealized protocol value |
| The Collapse | Reconstructs the agent adoption funnel |
| The Timeline | Reveals cohort-level churn behavior |
| The Forensics | Visualizes wallet failure clusters |
| The Bill | Attributes value loss by failure type |
| The Recovery Engine | Models intervention scenarios and recovered value |

---

## Origin Story

Dead Reckoning began as a completely different project.

After spending ETHGlobal week speaking with founders, protocol operators, ecosystem teams, and infrastructure providers, one pattern emerged repeatedly:

> Nobody knew where agent adoption was breaking.

The project evolved through multiple iterations before focusing on the problem that surfaced consistently across conversations:

**The ecosystem lacked visibility into activation, churn, and recovery opportunities.**

Dead Reckoning was built to answer that question.

---

## Tech Stack

- Google BigQuery
- Ethereum Public Datasets
- SQL-based Classification Engine
- Vanilla JavaScript
- HTML/CSS
- Three.js
- Chart.js

No indexing infrastructure.
No custom subgraphs.
No proprietary data.

Just public blockchain data and an explainable analytics engine.

---

## Running Locally

```bash
git clone https://github.com/zilingliao0912/web3-Eth-Global
cd web3-Eth-Global
python3 -m http.server
```

Open:

```text
http://localhost:8000/index_real.html
```

Generate the dataset:

```bash
python query_churn_master.py
```

---

## Built At

**ETHGlobal New York 2026**

Built using Google BigQuery and the Ethereum Foundation ERC-8004 registries.

---

## The Vision

Most teams are building agents.

Dead Reckoning helps ecosystems understand why agents succeed, fail, and churn.

Today it diagnoses adoption failures.

Tomorrow it becomes an adoption copilot that automatically recommends—or executes—the highest-leverage intervention.

Because the agent economy doesn't have a growth problem.

**It has a visibility problem.**
