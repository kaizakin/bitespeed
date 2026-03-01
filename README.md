# Bitespeed Backend Task: Identity Reconciliation

This project implements the `/identify` endpoint for reconciling customer identity across multiple contact records (email/phone combinations), as specified in the Bitespeed assignment.

The implementation is written to be easy to review:
- clear request validation at the API boundary
- deterministic reconciliation rules (new, append, merge)
- transactional writes for graph consistency
- stable response formatting with primary-first ordering

## Tech stack

- Node.js + TypeScript
- Express
- Prisma ORM
- PostgreSQL
- Zod for runtime validation

## How to run

```bash
pnpm install
pnpm prisma migrate deploy
pnpm prisma generate
pnpm seed
pnpm start
```

Service runs at: `http://localhost:3000`

## Data model strategy

`Contact` is a self-referencing table:
- `linkPrecedence = "primary" | "secondary"`
- secondaries point to the primary using `linkedId`
- oldest primary in a connected component remains canonical

Indexes:
- `@@index([email])`
- `@@index([phoneNumber])`
- `@@index([linkedId])`

These indexes are important because reconciliation repeatedly searches by email/phone and traverses linked records.

## Validation strategy (fail-fast)

Incoming payload for `/identify`:

```json
{
  "email": "string | null (optional)",
  "phoneNumber": "string | null (optional)"
}
```

Validation guarantees:
- at least one of `email` or `phoneNumber` must be present and non-null
- unknown fields are rejected
- malformed payload returns `400` before business logic runs
- emails are normalized to lowercase before reconciliation

## Reconciliation logic

Inside a single `prisma.$transaction`, the service handles:

1. Scenario A: New  
No match by email/phone -> create one new primary record.

2. Scenario B: Append  
Match exists, but request introduces unseen info (new email or new phone) -> create one secondary linked to oldest primary.

3. Scenario C: Merge  
Request touches records that map to different primaries -> oldest primary wins, newer primary (and its children) are re-linked as secondary to oldest primary.

This transaction-first approach avoids partially updated identity graphs.

## Response formatter

After write operations complete, the service fetches the full cluster for the resolved primary and returns:

```json
{
  "contact": {
    "primaryContatctId": 0,
    "emails": [],
    "phoneNumbers": [],
    "secondaryContactIds": []
  }
}
```

Formatting rules:
- `emails[0]` is primary contact email (if available)
- `phoneNumbers[0]` is primary contact phone (if available)
- remaining emails/phones are deduplicated and appended in cluster order
- `secondaryContactIds` includes all non-primary IDs in that cluster

## Seed query for testing

This repo includes a seed SQL query file:
- `prisma/seed.sql`

Command:

```bash
pnpm seed
```

What it does:
- truncates `Contact`
- inserts deterministic sample records for append/merge scenarios
- resets the `Contact.id` sequence to avoid PK collisions in later inserts

## Sample test cases (Input JSON -> Output JSON)

Important:
- run `pnpm seed` before each independent test case to reset state
- all calls are `POST /identify`

### Case 1: Existing cluster lookup (same as assignment baseline)

Input JSON:
```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```
Output JSON:
```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": [
      "lorraine@hillvalley.edu",
      "mcfly@hillvalley.edu"
    ],
    "phoneNumbers": [
      "123456"
    ],
    "secondaryContactIds": [
      23
    ]
  }
}
```
Why this output:
- both inputs touch the same identity cluster
- `id=1` is older primary
- `id=23` remains secondary

### Case 2: New identity
Input JSON:
```json
{
  "email": "newdoc@hillvalley.edu",
  "phoneNumber": "808080"
}

```


Output JSON:
```json
{
  "contact": {
    "primaryContatctId": 28,
    "emails": [
      "newdoc@hillvalley.edu"
    ],
    "phoneNumbers": [
      "808080"
    ],
    "secondaryContactIds": []
  }
}


```

Why this output:
- no records match either field
- system creates a new primary contact

### Case 3: Append new info to existing cluster
Input JSON:
```json
{
  "email": "fresh@hillvalley.edu",
  "phoneNumber": "123456"
}

```

Output JSON:
```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": [
      "lorraine@hillvalley.edu",
      "mcfly@hillvalley.edu",
      "fresh@hillvalley.edu"
    ],
    "phoneNumbers": [
      "123456"
    ],
    "secondaryContactIds": [
      23,
      28
    ]
  }
}

```
Why this output:
- `phoneNumber=123456` matches existing cluster
- `fresh@hillvalley.edu` is new information
- one new secondary is created under primary `1`

### Case 4: Merge two primaries
Input JSON:
```json
{
  "email": "george@hillvalley.edu",
  "phoneNumber": "717171"
}

```

Output JSON:
```json
{
  "contact": {
    "primaryContatctId": 11,
    "emails": [
      "george@hillvalley.edu",
      "biffsucks@hillvalley.edu"
    ],
    "phoneNumbers": [
      "919191",
      "717171"
    ],
    "secondaryContactIds": [
      27
    ]
  }
}

```
Why this output:
- email maps to primary `11`, phone maps to primary `27`
- two clusters are connected by the request
- older primary (`11`) remains primary, newer primary (`27`) becomes secondary

### Case 5: Invalid request
Input JSON:
```json
{
  "email": null,
  "phoneNumber": null
}

```

Output JSON:
```json
{
  "message": "Invalid request body",
  "errors": {
    "formErrors": [
      "At least one of email or phoneNumber must be provided"
    ],
    "fieldErrors": {}
  }
}

```
Why this output:
- request violates API contract (both values are null)
- rejected by Zod middleware before reconciliation logic executes
