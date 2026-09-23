# AI Teammate Matching

## Goal

Help a project owner/manager discover potentially compatible candidates using structured data plus an explainable AI-assisted layer.

The feature is advisory.

## Pipeline

### 1. Eligibility filter
Server selects only candidates who:
- are allowed to be discovered;
- are active/not suspended;
- are not already project members;
- satisfy any hard project constraints;
- have sufficient profile data.

### 2. Deterministic score

Initial weighted score:

```text
Skills        50%
Interests     20%
Availability  20%
Profile fit   10%
```

Weights are versioned and may later become project-configurable.

Skill matching should consider:
- required skills;
- importance;
- proficiency thresholds;
- complementary coverage.

### 3. Optional semantic/AI enrichment

AI may:
- summarize why a candidate appears relevant;
- identify complementary skills from structured inputs;
- produce a concise human-readable explanation.

AI must not:
- invent private facts;
- infer sensitive traits;
- autonomously change project state;
- override hard eligibility rules.

### 4. Validate and persist safe result

Store:
- algorithm version;
- component scores;
- final score;
- rank;
- short explanation;
- provider/model identifier;
- usage/cost metadata when available.

Do not store prompts containing unnecessary private data.

## Reliability

If AI provider fails:
- deterministic scores may still be shown;
- the core application remains usable;
- retry behavior is bounded;
- error messages do not leak provider secrets.

## Cost controls

Before production:
- per-user/project rate limits;
- candidate cap per run;
- token limits;
- cached/reusable results for unchanged inputs;
- usage metrics;
- model selected for cost/quality rather than prestige.

## Evaluation

Create a small test/evaluation dataset of synthetic profiles/projects and verify:
- required skills materially influence score;
- unavailable candidates do not outrank eligible ones due to explanation quality;
- explanations reflect structured data;
- no private fields leak;
- repeated runs are stable enough to be understandable.
