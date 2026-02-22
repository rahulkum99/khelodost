## Profit & Loss APIs

This document describes the **profit/loss** and **settled-bets** APIs implemented in the `bet` module for both users and admins.

---

## User APIs

### 1. `GET /api/bets/my-profit-loss`

**Purpose**: User’s own profit/loss **grouped by event**.

**Query params**
- `sport` (optional): `cricket | soccer | tennis`
- `from` (optional, ISO date)
- `to` (optional, ISO date)
- `limit` (optional, default `200`, max `500`)

**Response (per event)**
```json
{
  "success": true,
  "data": [
    {
      "sport": "cricket",
      "eventId": "711190356",
      "eventName": "South Africa v United Arab Emirates / Feb 18 2026 11:00AM (IST)",
      "profitLoss": 460,
      "bets": 4,
      "lastSettledAt": "2026-02-18T05:56:55.875Z",
      "result": "won",
      "display": "460 won"
    }
  ]
}
```

---

### 2. `GET /api/bets/my-event-profit-loss`

**Purpose**: User’s own profit/loss **inside a single event**.

**Query params**
- `eventId` (required)
- `marketId` (optional) – filter to a single market
- `by` (optional):
  - `bet` (default) → **one row per bet**
  - `market` → one row per market (aggregated)
- `sport`, `from`, `to`, `limit` (optional, as above)

**Per-bet response example (`by=bet`)**
```json
{
  "success": true,
  "data": [
    {
      "sport": "cricket",
      "eventId": "711190356",
      "eventName": "South Africa v United Arab Emirates / Feb 18 2026 11:00AM (IST)",
      "marketId": "8145401868429",
      "marketName": "MATCH_ODDS",
      "selectionName": "United Arab Emirates",
      "betType": "back",
      "odd": 8.6,
      "stake": 100,
      "placedDate": "2026-02-18T05:50:27.379Z",
      "bets": 1,
      "lastSettledAt": "2026-02-18T05:56:55.875Z",
      "profitLoss": 760,
      "result": "won",
      "display": "760 won",
      "settlementtime": "2026-02-18T05:56:55.875Z"
    }
  ]
}
```

---

## Admin APIs – Single User

### 3. `GET /api/bets/admin/user-profit-loss`

**Purpose**: Profit/loss **by event** for a specific user (under admin’s hierarchy).

**Query params**
- `userId` (required) – target user
- `sport`, `from`, `to`, `limit` (optional)

**Response**: Same shape as `/my-profit-loss`, but for the specified user.

---

### 4. `GET /api/bets/admin/user-event-profit-loss`

**Purpose**: Profit/loss for a specific user **inside a single event**.

**Query params**
- `userId` (required)
- `eventId` (required)
- `marketId` (optional)
- `by` (optional): `bet` (per bet) or `market` (per market)
- `sport`, `from`, `to`, `limit` (optional)

**Per-bet response** is the same shape as `/my-event-profit-loss` (with one row per bet).

---

## Admin APIs – Hierarchy (All Users Under Admin)

### 5. `GET /api/bets/admin/hierarchy-profit-loss`

**Purpose**: Profit/loss **by event across all users** in the admin’s hierarchy.

**Query params**
- `sport` (optional)
- `from`, `to` (optional)
- `limit` (optional)

**Response (per event)**
```json
{
  "success": true,
  "data": [
    {
      "bets": 4,
      "lastSettledAt": "2026-02-18T05:56:55.875Z",
      "sport": "cricket",
      "eventId": "711190356",
      "eventName": "South Africa v United Arab Emirates / Feb 18 2026 11:00AM (IST)",
      "profitLoss": 460
    }
  ]
}
```

---

### 6. `GET /api/bets/admin/hierarchy-settled-bets`

**Purpose**: **Settled bets list** (one row per bet) for **all users** under the admin, including `username`.

**Query params**
- `sport` (optional)
- `eventId` (optional)
- `marketId` (optional)
- `userId` (optional – restrict to a single user)
- `from`, `to` (optional)
- `limit` (optional)

**Response (per bet)**
```json
{
  "success": true,
  "data": [
    {
      "sport": "cricket",
      "username": "abcd889",
      "eventId": "711190356",
      "eventName": "South Africa v United Arab Emirates / Feb 18 2026 11:00AM (IST)",
      "marketId": "8145401868429",
      "marketName": "MATCH_ODDS",
      "selectionName": "United Arab Emirates",
      "betType": "back",
      "odd": 8.6,
      "stake": 100,
      "placedDate": "2026-02-18T05:50:27.379Z",
      "bets": 1,
      "lastSettledAt": "2026-02-18T05:56:55.875Z",
      "profitLoss": 760,
      "result": "won",
      "display": "760 won",
      "settlementtime": "2026-02-18T05:56:55.875Z"
    }
  ]
}
```

---

## Profit vs Loss Logic

- `profitLoss > 0` → **profit**
- `profitLoss < 0` → **loss**
- `profitLoss == 0` → **no profit / no loss**

Many responses also include:
- `result`: `"won" | "lost" | "void"` (based on bet settlement)
- `display`: e.g. `"760 won"` or `"100 lost"` for UI display.

