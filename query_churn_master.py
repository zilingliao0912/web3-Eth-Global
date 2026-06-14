#!/usr/bin/env python3
"""Run ERC-8004 agent churn master query and write churn_master.csv."""

from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent

CHURN_MASTER_SQL = """-- ============================================================
-- ERC-8004 AGENT CHURN MASTER TABLE
-- ============================================================
-- Grain       : one row per agent_id
-- Churn def   : inactive > 60 days OR never activated
-- Platform op : agents_per_owner > 50
-- Fan-out risk: agents_per_owner > 10 (failure metrics are
--               wallet-level; inflate if owner has multiple agents)
-- Intent      : behavioral takes priority when agent has any txns,
--               falls back to declared (keyword match), then 'unknown'
-- Pool        : block_timestamp >= '2025-01-01' — remove or push
--               earlier to expand (see comments throughout)
-- ============================================================

WITH

-- ────────────────────────────────────────────────────────────
-- SOURCE 1: IdentityRegistry registration events (logs)
-- ────────────────────────────────────────────────────────────
registrations_raw AS (
  SELECT
    SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)        AS agent_id,
    CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))  AS owner_address,
    SAFE_CONVERT_BYTES_TO_STRING(FROM_HEX(SUBSTR(
      data, 131,
      2 * SAFE_CAST(CONCAT('0x', SUBSTR(data, 67, 64)) AS INT64)
    )))                                               AS agent_uri,
    block_timestamp                                   AS registered_at,
    transaction_hash                                  AS registration_tx
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`
  WHERE address = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432'
    AND topics[SAFE_OFFSET(0)] = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'
    AND block_timestamp >= TIMESTAMP '2025-01-01'  -- EXPAND: remove or set earlier
),

-- ────────────────────────────────────────────────────────────
-- Noise signals via window functions + URI type classification
-- ────────────────────────────────────────────────────────────
registrations AS (
  SELECT
    *,
    COUNT(*) OVER (PARTITION BY registration_tx) AS agents_from_same_tx,
    COUNT(*) OVER (PARTITION BY owner_address)   AS agents_per_owner,
    CASE
      WHEN agent_uri IS NULL OR agent_uri = '' THEN 1
      ELSE COUNT(*) OVER (PARTITION BY agent_uri)
    END                                          AS duplicate_uri_count,
    CASE
      WHEN STARTS_WITH(agent_uri, 'data:application/json;base64,') THEN 'on-chain'
      WHEN STARTS_WITH(agent_uri, 'ipfs://')                       THEN 'ipfs'
      WHEN STARTS_WITH(agent_uri, 'https://')                      THEN 'https'
      WHEN agent_uri = '' OR agent_uri IS NULL                     THEN 'no-uri'
      ELSE                                                              'other'
    END                                          AS uri_type,
    REGEXP_EXTRACT(agent_uri, r'https://([^/]+)') AS uri_hostname
  FROM registrations_raw
),

-- ────────────────────────────────────────────────────────────
-- Decode base64 JSON once per agent (avoids repeated FROM_BASE64)
-- ────────────────────────────────────────────────────────────
decoded_onchain AS (
  SELECT
    agent_id,
    SAFE_CONVERT_BYTES_TO_STRING(
      SAFE.FROM_BASE64(SUBSTR(agent_uri, LENGTH('data:application/json;base64,') + 1))
    ) AS raw_json
  FROM registrations
  WHERE STARTS_WITH(agent_uri, 'data:application/json;base64,')
),

-- ────────────────────────────────────────────────────────────
-- SOURCE 2: ReputationRegistry feedback events (logs)
-- ────────────────────────────────────────────────────────────
reputation_agg AS (
  SELECT
    SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64) AS agent_id,
    COUNT(*)                                   AS total_reviews,
    ROUND(AVG(
      SAFE_CAST(CONCAT('0x', SUBSTR(data, 3, 64)) AS INT64)
    ), 2)                                      AS avg_score
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`
  WHERE address = '0x8004f9a168b4bde48adaef5bf9dc1e5e6f05e300'
    AND topics[SAFE_OFFSET(0)] = '0xde5b7e6641890114f1b3ed42fcb0e0932b5b256f27dca1d76e3b8a19a84a395a'
    AND block_timestamp >= TIMESTAMP '2025-01-01'  -- EXPAND: match registrations filter
    AND SUBSTR(data, 67, 1) != 'f'                -- exclude signed-int overflow artifacts
  GROUP BY agent_id
),

-- ────────────────────────────────────────────────────────────
-- SOURCE 3: Outbound transaction counts + function selectors
-- Excludes calls to the 3 ERC-8004 registry contracts
-- ────────────────────────────────────────────────────────────
agent_transactions AS (
  SELECT
    from_address                                       AS owner_address,
    COUNT(*)                                           AS total_txns,
    COUNTIF(SUBSTR(input, 1, 10) IN (
      '0x7ff36ab5',  -- swapExactETHForTokens (Uniswap v2)
      '0x38ed1739',  -- swapExactTokensForTokens (Uniswap v2)
      '0x18cbafe5',  -- swapExactTokensForETH (Uniswap v2)
      '0x5ae401dc',  -- multicall (Uniswap v3 router — proxy, wraps many ops)
      '0x414bf389',  -- exactInputSingle (Uniswap v3 direct — most common v3 swap)
      '0xc04b8d59'   -- exactInput multi-hop (Uniswap v3 direct)
    ))                                                 AS swap_count,
    COUNTIF(SUBSTR(input, 1, 10) IN (
      '0x6e553f65',  -- deposit (ERC-4626)
      '0xe8eda9df',  -- deposit (AAVE v2)
      '0x617ba037'   -- supply (AAVE v3)
    ))                                                 AS deposit_count,
    COUNTIF(SUBSTR(input, 1, 10) IN (
      '0x56591d59',  -- lockTokens (protocol-specific bridge, approximate)
      '0x8119c065'   -- depositETH (protocol-specific bridge, approximate)
      -- NOTE: 0x23b872dd REMOVED — that is ERC-20 transferFrom, not a bridge call
      -- Bridge coverage is intentionally narrow; treat bridge_count as lower-bound signal
    ))                                                 AS bridge_count,
    MIN(block_timestamp)                               AS first_txn_at,
    MAX(block_timestamp)                               AS last_txn_at
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.transactions`
  WHERE block_timestamp >= TIMESTAMP '2025-01-28'
    AND to_address NOT IN (
      '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432',   -- IdentityRegistry
      '0x8004f9a168b4bde48adaef5bf9dc1e5e6f05e300',   -- ReputationRegistry
      '0x8004c64083c6d9b4d21c0e7b0f5cc5a96c4ad500'    -- ValidationRegistry
    )
  GROUP BY from_address
),

-- ────────────────────────────────────────────────────────────
-- SOURCE 4a: Successful ETH flows (error IS NULL)
-- Captures ETH that actually moved through agent wallet
-- ────────────────────────────────────────────────────────────
success_eth AS (
  SELECT
    action.from_address                                AS owner_address,
    ROUND(SUM(action.value) / 1e18, 6)                AS eth_in_successful_calls
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.traces`
  WHERE error IS NULL
    AND trace_type = 'call'
    AND action.value > 0
    AND block_timestamp >= TIMESTAMP '2025-01-01'
  GROUP BY action.from_address
),

-- ────────────────────────────────────────────────────────────
-- SOURCE 4b: Failure signals (error IS NOT NULL)
-- Captures failed DeFi calls with error type and monetary scale
-- ────────────────────────────────────────────────────────────
failure_signals AS (
  SELECT
    action.from_address                                AS owner_address,
    -- Error type counts
    COUNT(*)                                           AS failed_call_count,
    COUNTIF(LOWER(error) LIKE '%revert%')             AS revert_count,
    COUNTIF(LOWER(error) LIKE '%out of gas%')         AS out_of_gas_count,
    COUNTIF(LOWER(error) LIKE '%insufficient%')       AS insufficient_balance_count,
    -- Failed calls by DeFi action type
    COUNTIF(SUBSTR(action.input, 1, 10) IN (
      '0x6e553f65','0xe8eda9df','0x617ba037'
    ))                                                 AS failed_deposit_count,
    COUNTIF(SUBSTR(action.input, 1, 10) IN (
      '0x7ff36ab5','0x38ed1739','0x18cbafe5',  -- Uniswap v2
      '0x5ae401dc','0x414bf389','0xc04b8d59'   -- Uniswap v3 (multicall + direct)
    ))                                                 AS failed_swap_count,
    COUNTIF(SUBSTR(action.input, 1, 10) IN (
      '0x56591d59','0x8119c065'
      -- 0x23b872dd REMOVED: ERC-20 transferFrom, not a bridge call
    ))                                                 AS failed_bridge_count,
    -- Monetary: ETH attached to failed calls (exact — ETH is returned but shows scale)
    ROUND(SUM(IF(action.value > 0, action.value, 0)) / 1e18, 6) AS eth_in_failed_calls,
    -- Monetary: token-based failures (count proxy — exact amount needs ABI decoding)
    COUNTIF(
      action.value = 0
      AND SUBSTR(action.input, 1, 10) IN (
        '0x6e553f65','0xe8eda9df','0x617ba037',          -- deposits
        '0x7ff36ab5','0x38ed1739','0x18cbafe5',          -- v2 swaps
        '0x5ae401dc','0x414bf389','0xc04b8d59',          -- v3 swaps
        '0x56591d59'                                     -- bridge
      )
    )                                                  AS failed_calls_token_only
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.traces`
  WHERE error IS NOT NULL
    AND trace_type = 'call'
    AND block_timestamp >= TIMESTAMP '2025-01-01'
  GROUP BY action.from_address
),

-- ────────────────────────────────────────────────────────────
-- BASE: All sources joined, plus raw intent buckets computed
-- separately so enriched CTE can reference them cleanly
-- ────────────────────────────────────────────────────────────
base AS (
  SELECT
    -- identity + registration
    r.agent_id,
    r.owner_address,
    r.registered_at,
    r.registration_tx,
    r.agent_uri,
    r.uri_type,
    r.uri_hostname,
    r.agents_from_same_tx,
    r.agents_per_owner,
    r.duplicate_uri_count,
    d.raw_json,

    -- reputation
    COALESCE(rep.total_reviews, 0)                    AS total_reviews,
    rep.avg_score,

    -- activity
    COALESCE(tx.total_txns, 0)                        AS total_txns,
    COALESCE(tx.swap_count, 0)                        AS swap_count,
    COALESCE(tx.deposit_count, 0)                     AS deposit_count,
    COALESCE(tx.bridge_count, 0)                      AS bridge_count,
    tx.first_txn_at,
    tx.last_txn_at,

    -- monetary: success
    COALESCE(s.eth_in_successful_calls, 0)            AS eth_in_successful_calls,

    -- failures
    COALESCE(f.failed_call_count, 0)                  AS failed_call_count,
    COALESCE(f.revert_count, 0)                       AS revert_count,
    COALESCE(f.out_of_gas_count, 0)                   AS out_of_gas_count,
    COALESCE(f.insufficient_balance_count, 0)         AS insufficient_balance_count,
    COALESCE(f.failed_deposit_count, 0)               AS failed_deposit_count,
    COALESCE(f.failed_swap_count, 0)                  AS failed_swap_count,
    COALESCE(f.failed_bridge_count, 0)                AS failed_bridge_count,
    COALESCE(f.eth_in_failed_calls, 0)                AS eth_in_failed_calls,
    COALESCE(f.failed_calls_token_only, 0)            AS failed_calls_token_only,

    -- INTENT BUCKET A: behavioral (from what the wallet actually did)
    -- Only populated when total_txns > 0; highest-signal action wins
    CASE
      WHEN COALESCE(tx.total_txns, 0) > 0
        THEN CASE
          WHEN COALESCE(tx.swap_count, 0) >= COALESCE(tx.deposit_count, 0)
               AND COALESCE(tx.swap_count, 0) >= COALESCE(tx.bridge_count, 0)
               AND tx.swap_count > 0                              THEN 'trading_bot'
          WHEN COALESCE(tx.deposit_count, 0) > 0                 THEN 'yield_agent'
          WHEN COALESCE(tx.bridge_count, 0) > 0                  THEN 'bridge_agent'
          WHEN tx.total_txns > 5                                  THEN 'active_general'
          ELSE                                                         'low_activity'
        END
      ELSE NULL
    END                                               AS behavioral_bucket,

    -- INTENT BUCKET B: declared (from description keywords, on-chain agents only)
    -- Only populated when a non-empty description is readable in SQL
    CASE
      WHEN JSON_VALUE(d.raw_json, '$.description') IS NOT NULL
           AND TRIM(JSON_VALUE(d.raw_json, '$.description')) != ''
        THEN CASE
          WHEN REGEXP_CONTAINS(LOWER(JSON_VALUE(d.raw_json, '$.description')),
               r'(defi|trad|swap|vault|yield|arbitrage|hedge)')  THEN 'defi_trading'
          WHEN REGEXP_CONTAINS(LOWER(JSON_VALUE(d.raw_json, '$.description')),
               r'(borrow|lend|loan|credit|collateral)')          THEN 'lending'
          WHEN REGEXP_CONTAINS(LOWER(JSON_VALUE(d.raw_json, '$.description')),
               r'(bridge|cross.chain|multichain|l2|rollup)')     THEN 'cross_chain'
          WHEN REGEXP_CONTAINS(LOWER(JSON_VALUE(d.raw_json, '$.description')),
               r'(seo|content|market|optim|copywr)')             THEN 'content_marketing'
          WHEN REGEXP_CONTAINS(LOWER(JSON_VALUE(d.raw_json, '$.description')),
               r'(security|threat|fraud|vuln|encrypt|audit)')    THEN 'security'
          WHEN REGEXP_CONTAINS(LOWER(JSON_VALUE(d.raw_json, '$.description')),
               r'(data|analyt|insight|monitor|sensor)')          THEN 'data_analytics'
          WHEN REGEXP_CONTAINS(LOWER(JSON_VALUE(d.raw_json, '$.description')),
               r'(chatbot|assistant|task|coordinat|schedule)')   THEN 'general_assistant'
          ELSE                                                        'other_described'
        END
      ELSE NULL
    END                                               AS declared_bucket

  FROM registrations r
  LEFT JOIN decoded_onchain    d   ON r.agent_id      = d.agent_id
  LEFT JOIN reputation_agg     rep ON r.agent_id      = rep.agent_id
  LEFT JOIN agent_transactions tx  ON r.owner_address = tx.owner_address
  LEFT JOIN success_eth        s   ON r.owner_address = s.owner_address
  LEFT JOIN failure_signals    f   ON r.owner_address = f.owner_address
),

-- ────────────────────────────────────────────────────────────
-- ENRICHED: Derive all computed columns from base
-- Separating this from base lets churn_type reference
-- funnel_stage and days_inactive without repeating expressions
-- ────────────────────────────────────────────────────────────
enriched AS (
  SELECT
    *,

    -- Quality flags
    (agents_from_same_tx > 1)                         AS is_bulk_mint,
    (JSON_VALUE(raw_json, '$.nftOrigin.contract') IS NOT NULL
     OR REGEXP_CONTAINS(agent_uri, r'(freaks\\.one|normies\\.art|koalified)'))
                                                      AS is_nft_wrapped,
    (duplicate_uri_count > 1)                         AS is_duplicate_uri,
    (agents_per_owner > 50)                           AS is_platform_operator,
    (agents_per_owner > 10)                           AS fan_out_risk,

    -- Platform origin
    CASE uri_hostname
      WHEN 'api.freaks.one'           THEN 'FreaksOne'
      WHEN 'api.normies.art'          THEN 'Normies'
      WHEN 'koalified-web.vercel.app' THEN 'Koalified'
      WHEN 'ens8004.xyz'              THEN 'ENS8004'
      WHEN 'agnt.social'              THEN 'AGNT.social'
      WHEN 'groundtruth.grm.wtf'      THEN 'GroundTruth'
      ELSE
        CASE
          WHEN STARTS_WITH(agent_uri, 'data:application/json;base64,')
            THEN COALESCE(
              REGEXP_EXTRACT(JSON_VALUE(raw_json, '$.registeredVia'), r'https://([^/]+)'),
              'direct_onchain'
            )
          WHEN STARTS_WITH(agent_uri, 'ipfs://') THEN 'ipfs_direct'
          WHEN agent_uri IS NULL OR agent_uri = '' THEN NULL
          ELSE 'other_https'
        END
    END                                               AS platform_detected,

    -- Funnel stage (current on-chain state = highest ever reached)
    CASE
      WHEN total_reviews > 0                          THEN '5_reviewed'
      WHEN COALESCE(
        JSON_VALUE(raw_json, '$.x402Support'),
        JSON_VALUE(raw_json, '$.x402support')
      ) = 'true'                                      THEN '4_monetized'
      WHEN raw_json IS NOT NULL
           AND JSON_VALUE(raw_json, '$.services[0].name') IS NOT NULL
                                                      THEN '3_callable'
      WHEN uri_type NOT IN ('no-uri', 'other')        THEN '2_listed'
      ELSE                                                 '1_ghost'
    END                                               AS funnel_stage,

    -- Service protocol + monetization flag
    JSON_VALUE(raw_json, '$.services[0].name')        AS primary_service_protocol,
    COALESCE(
      JSON_VALUE(raw_json, '$.x402Support'),
      JSON_VALUE(raw_json, '$.x402support')
    )                                                 AS x402_support,

    -- Intent: single category (behavioral > declared > unknown)
    COALESCE(behavioral_bucket, declared_bucket, 'unknown')
                                                      AS intent_category,
    CASE
      WHEN behavioral_bucket IS NOT NULL              THEN 'behavioral'
      WHEN declared_bucket   IS NOT NULL              THEN 'declared'
      ELSE                                                 'unknown'
    END                                               AS intent_source,

    -- Intent conflict: both signals present but point different directions
    (behavioral_bucket IS NOT NULL
     AND declared_bucket IS NOT NULL
     AND NOT (
         (behavioral_bucket = 'trading_bot'
          AND declared_bucket IN ('defi_trading', 'lending'))
      OR (behavioral_bucket = 'yield_agent'
          AND declared_bucket IN ('defi_trading', 'lending'))
      OR (behavioral_bucket = 'bridge_agent'
          AND declared_bucket = 'cross_chain')
      OR (behavioral_bucket IN ('active_general', 'low_activity')
          AND declared_bucket IN ('general_assistant', 'content_marketing',
                                  'security', 'data_analytics', 'other_described'))
    ))                                                AS intent_conflict,

    -- Monetary flags
    (eth_in_failed_calls > 0)                         AS has_eth_at_risk,
    (failed_calls_token_only > 0)                     AS has_token_failures,

    -- Time dimensions
    DATE_DIFF(CURRENT_DATE(), DATE(registered_at), DAY)   AS days_since_registration,
    DATE_DIFF(CURRENT_DATE(), DATE(last_txn_at), DAY)     AS days_inactive

  FROM base
)

-- ────────────────────────────────────────────────────────────
-- FINAL: Master churn table
-- All 9 blocks + churn classification
-- No noise pre-filter applied — use quality flag columns to
-- filter in your BI tool or downstream query as needed
-- ────────────────────────────────────────────────────────────
SELECT

  -- ── BLOCK 1: Identity ──────────────────────────────────────
  agent_id,
  owner_address,
  registered_at,
  days_since_registration,

  -- ── BLOCK 2: Origin & Quality ──────────────────────────────
  uri_type,
  platform_detected,
  is_bulk_mint,
  is_nft_wrapped,
  is_duplicate_uri,
  agents_per_owner,
  is_platform_operator,   -- TRUE when agents_per_owner > 50
  fan_out_risk,           -- TRUE when agents_per_owner > 10 (failure metrics inflated)

  -- ── BLOCK 3: Funnel Stage ──────────────────────────────────
  funnel_stage,           -- 1_ghost / 2_listed / 3_callable / 4_monetized / 5_reviewed

  -- ── BLOCK 4: Intent ────────────────────────────────────────
  intent_category,        -- single label; behavioral if txns exist, else declared, else unknown
  intent_source,          -- 'behavioral' / 'declared' / 'unknown'
  intent_conflict,        -- TRUE when behavioral and declared disagree
  x402_support,           -- 'true' / 'false' / NULL (not declared)
  primary_service_protocol,

  -- ── BLOCK 5: Activity ──────────────────────────────────────
  total_txns,
  swap_count,
  deposit_count,
  bridge_count,
  first_txn_at,
  last_txn_at,
  days_inactive,          -- NULL when agent has never transacted

  -- ── BLOCK 6: Failures ──────────────────────────────────────
  -- Note: wallet-level; see fan_out_risk if owner has multiple agents
  failed_call_count,
  revert_count,
  out_of_gas_count,
  insufficient_balance_count,
  failed_deposit_count,
  failed_swap_count,
  failed_bridge_count,

  -- ── BLOCK 7: Monetary Value ────────────────────────────────
  eth_in_successful_calls,     -- ETH that actually moved (success path)
  eth_in_failed_calls,         -- ETH attached to failed calls (returned to sender, but shows scale)
  has_eth_at_risk,             -- TRUE if any failed calls had ETH attached
  failed_calls_token_only,     -- Count of token-based failures (exact amount needs ABI decoding)
  has_token_failures,          -- TRUE if any token-based DeFi calls failed

  -- ── BLOCK 8: Reputation ────────────────────────────────────
  total_reviews,
  avg_score,

  -- ── BLOCK 9: Churn Classification ──────────────────────────
  CASE
    -- 1. Active: has transactions AND last one was within 60 days
    WHEN total_txns > 0
         AND days_inactive <= 60
                                                      THEN 'active'

    -- 2. Never activated: no transactions AND stuck at ghost or listed
    WHEN total_txns = 0
         AND funnel_stage IN ('1_ghost', '2_listed')
                                                      THEN 'never_activated'

    -- 3. Stalled mid-funnel: built a callable/monetized/reviewed agent
    --    but the wallet never sent a real transaction
    WHEN total_txns = 0
         AND funnel_stage IN ('3_callable', '4_monetized', '5_reviewed')
                                                      THEN 'stalled_mid_funnel'

    -- 4. Gas failure: majority of their on-chain failures were out-of-gas errors
    WHEN failed_call_count > 0
         AND out_of_gas_count > failed_call_count * 0.5
                                                      THEN 'gas_failure'

    -- 5. Timeout: failure rate > 70% of all txns AND then went dark within 30 days
    --    Approximates mempool timeout pattern (true timeouts invisible on-chain)
    WHEN failed_call_count > total_txns * 0.7
         AND days_inactive > 30
                                                      THEN 'timeout'

    -- 6. Intent mismatch: behavioral and declared signals conflict AND now inactive 60+ days
    WHEN intent_conflict = TRUE
         AND days_inactive > 60
                                                      THEN 'intent_mismatch'

    -- 7. Abandoned: was genuinely active, then stopped for 60+ days
    WHEN total_txns > 0
         AND days_inactive > 60
                                                      THEN 'abandoned'

    ELSE 'unknown'
  END                                                 AS churn_type,

  -- is_churned: simple boolean derived from churn_type
  CASE
    WHEN total_txns > 0 AND days_inactive <= 60       THEN FALSE
    ELSE                                                   TRUE
  END                                                 AS is_churned,

  -- days_to_churn: how long the agent was active before going dark
  -- NULL if it never transacted
  DATE_DIFF(DATE(last_txn_at), DATE(registered_at), DAY)
                                                      AS days_to_churn

FROM enriched
ORDER BY registered_at DESC;
"""


def _validate_env() -> int | None:
    """Return None if OK, else exit code 1 after printing errors to stderr."""
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")

    project_id = os.environ.get("GCP_PROJECT_ID")
    creds_raw = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")

    errs: list[str] = []
    if not project_id or not str(project_id).strip():
        errs.append("ERROR: GCP_PROJECT_ID is missing or empty (set it in .env or the environment).")
    if not creds_raw or not str(creds_raw).strip():
        errs.append(
            "ERROR: GOOGLE_APPLICATION_CREDENTIALS is missing or empty (set it in .env or the environment)."
        )
    else:
        creds_path = Path(creds_raw).expanduser().resolve()
        if not creds_path.is_file():
            errs.append(
                f"ERROR: GOOGLE_APPLICATION_CREDENTIALS file does not exist or is not a file: {creds_path}"
            )

    if errs:
        for line in errs:
            print(line, file=sys.stderr)
        return 1
    return None


def main() -> int:
    try:
        bad = _validate_env()
        if bad is not None:
            return bad

        from dotenv import load_dotenv
        from google.cloud import bigquery

        load_dotenv(ROOT / ".env")
        project_id = os.environ["GCP_PROJECT_ID"].strip()

        client = bigquery.Client(project=project_id)
        query_job = client.query(CHURN_MASTER_SQL)
        df = query_job.result().to_dataframe(create_bqstorage_client=False)

        out_path = ROOT / "churn_master.csv"
        df.to_csv(out_path, index=False)

        n = len(df)
        bytes_processed = query_job.total_bytes_processed
        if bytes_processed is None:
            bytes_processed = 0

        print(f"Rows returned: {n}")
        print(f"Bytes processed: {bytes_processed}")
        print("Wrote: churn_master.csv")
        print("Preview (top 5 rows):")
        print(df.head(5).to_string())
        return 0
    except Exception:
        print("ERROR: query_churn_master failed.", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
