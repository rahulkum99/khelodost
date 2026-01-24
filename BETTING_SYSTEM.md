# Betting Exchange System Documentation

## Overview

This is a multi-market betting exchange backend system that supports **5 different market types** across **3 sports** (Cricket, Soccer, Tennis). The system implements user-to-user betting with wallet-based exposure management and market-specific settlement logic.

---

## 🎯 Supported Market Types

### 1. **MATCH_ODDS** (Exchange Market)
- **Bet Types**: `back` | `lay`
- **Matching**: ❌ No matching (each user places own bet separately)
- **Odds**: Decimal odds required
- **Exposure**:
  - `back`: Exposure = `stake`
  - `lay`: Exposure = `(odds - 1) × stake`
- **Settlement**: Based on winner selection

### 2. **BOOKMAKERS_FANCY** (Fancy/Session Market)
- **Bet Types**: `yes` | `no`
- **Matching**: ❌ No matching (rate-based)
- **Rate**: Required (e.g., 95, 105)
- **Exposure**: Full `stake` locked
- **Settlement Logic**:
  - `yes` wins → Payout = `stake × rate / 100`
  - `no` wins → Stake returned
- **Example**: "India 50 runs in 6 overs?" YES @ 95, NO @ 105

### 3. **LINE_MARKET** (Over/Under Market)
- **Bet Types**: `over` | `under`
- **Matching**: ❌ No matching
- **Line Value**: Required (e.g., 160.5)
- **Exposure**: Full `stake` locked
- **Settlement**: Compares final value to line value
- **Example**: Line 160.5, bet Over/Under

### 4. **METER_MARKET** (Progressive Meter)
- **Bet Types**: `over` | `under`
- **Matching**: ❌ No matching
- **Line Value**: Required
- **Exposure**: Full `stake` locked
- **Settlement**: Settles when meter crosses line value
- **Example**: Runs Meter: 120 → 121 → 122

### 5. **KADO_MARKET** (Binary Market)
- **Bet Types**: `back` | `lay`
- **Matching**: ❌ No matching
- **Rate**: Multiplier (default: 2x)
- **Exposure**: Full `stake` locked
- **Settlement**: Binary win/lose with fixed multiplier
- **Market closes**: Instantly after trigger

---

## 💰 Wallet System

### Wallet Structure
```javascript
{
  balance: Number,        // Available balance (free funds)
  lockedBalance: Number,  // Amount locked in open bets
  currency: String,      // INR | USD | EUR
  isActive: Boolean,
  isLocked: Boolean
}
```

### Virtual Properties
- `availableBalance` = `balance` (free funds)
- `totalBalance` = `balance + lockedBalance` (total funds)

### Exposure Locking Rules
1. **Full exposure locked** at bet placement
2. **No partial exposure** - entire exposure amount is locked
3. **Unlock only on settlement** or cancellation
4. **Every change creates** a `WalletTransaction` record

### Transaction Types
- `bet_exposure_lock`: Lock exposure when placing bet
- `bet_settlement`: Unlock + credit/debit net win/loss

---

## 📡 API Endpoints

### Base URL
All endpoints are prefixed with `/api/bets` (or `/bets` depending on your router configuration)

### Authentication
All endpoints require authentication via `authenticate` middleware.

---

### 1. Place Bet

**Endpoint**: `POST /api/bets/place`

**Request Body**:
```json
{
  "sport": "cricket",              // Required: cricket | soccer | tennis
  "eventId": "550226920",          // Required: Event ID
  "marketId": "9101697825652",     // Required: Market ID
  "marketType": "match_odds",      // Required: See MARKET_TYPES
  "selectionId": "560180",         // Required: Selection/Team ID
  "selectionName": "Japan U19",    // Required: Selection name
  "betType": "back",               // Required: back | lay | yes | no | over | under
  "stake": 100,                    // Required: Bet amount (> 0)
  "odds": 4.7,                     // Optional: Required for MATCH_ODDS
  "rate": 95,                      // Optional: Required for BOOKMAKERS_FANCY
  "lineValue": 160.5               // Optional: Required for LINE_MARKET, METER_MARKET
}
```

**Response** (Success):
```json
{
  "success": true,
  "message": "Bet placed successfully",
  "data": {
    "_id": "bet_id",
    "userId": "user_id",
    "sport": "cricket",
    "eventId": "550226920",
    "marketId": "9101697825652",
    "marketType": "match_odds",
    "selectionId": "560180",
    "selectionName": "Japan U19",
    "betType": "back",
    "odds": 4.7,
    "stake": 100,
    "exposure": 100,
    "status": "open",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Response** (Error):
```json
{
  "success": false,
  "message": "Insufficient balance"
}
```

---

### 2. Get My Bets

**Endpoint**: `GET /api/bets/my-bets`

**Query Parameters**:
- `sport` (optional): `cricket` | `soccer` | `tennis`
- `status` (optional): `open` | `settled`
- `marketType` (optional): Market type filter
- `limit` (optional): Items per page (default: 50)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "_id": "bet_id",
      "sport": "cricket",
      "eventId": "550226920",
      "marketId": "9101697825652",
      "marketType": "match_odds",
      "selectionName": "Japan U19",
      "betType": "back",
      "odds": 4.7,
      "stake": 100,
      "exposure": 100,
      "status": "open",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 3. Get Today's Bets

**Endpoint**: `GET /api/bets/today-bets`

**Query Parameters**:
- `sport` (optional): `cricket` | `soccer` | `tennis`
- `status` (optional): `open` | `settled`
- `marketType` (optional): Market type filter
- `limit` (optional): Items per page (default: 100)

**Description**: Returns all bets placed today by the authenticated user (any status).

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "_id": "bet_id",
      "sport": "cricket",
      "eventId": "550226920",
      "marketId": "9101697825652",
      "marketType": "match_odds",
      "selectionName": "Japan U19",
      "betType": "back",
      "odds": 4.7,
      "stake": 100,
      "exposure": 100,
      "status": "open",
      "createdAt": "2024-01-21T10:30:00.000Z"
    }
  ]
}
```

---

### 4. Get Today's Open Bets

**Endpoint**: `GET /api/bets/today-open-bets`

**Query Parameters**:
- `sport` (optional): `cricket` | `soccer` | `tennis`
- `marketType` (optional): Market type filter
- `limit` (optional): Items per page (default: 100)

**Description**: Returns only open bets placed today by the authenticated user.

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "_id": "bet_id",
      "sport": "cricket",
      "eventId": "550226920",
      "marketId": "9101697825652",
      "marketType": "match_odds",
      "selectionName": "Japan U19",
      "betType": "back",
      "odds": 4.7,
      "stake": 100,
      "exposure": 100,
      "status": "open",
      "createdAt": "2024-01-21T10:30:00.000Z"
    }
  ]
}
```

---

### 5. Settle Market (Admin Only)

**Endpoint**: `POST /api/bets/settle`

**Required Role**: `ADMIN` or higher

**Request Body** (MATCH_ODDS):
```json
{
  "marketType": "match_odds",
  "eventId": "550226920",
  "marketId": "9101697825652",
  "winnerSelectionId": "560180"
}
```

**Request Body** (BOOKMAKERS_FANCY):
```json
{
  "marketType": "bookmakers_fancy",
  "eventId": "913074777",
  "marketId": "309257272418",
  "resultMap": {
    "9": "yes",
    "10": "no"
  }
}
```

**Request Body** (LINE_MARKET):
```json
{
  "marketType": "line_market",
  "eventId": "550226920",
  "marketId": "9101697825652",
  "finalValue": 165.5
}
```

**Request Body** (METER_MARKET):
```json
{
  "marketType": "meter_market",
  "eventId": "550226920",
  "marketId": "9101697825652",
  "finalMeterValue": 162
}
```

**Request Body** (KADO_MARKET):
```json
{
  "marketType": "kado_market",
  "eventId": "550226920",
  "marketId": "9101697825652",
  "winnerSelectionId": "560180"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Market settled successfully"
}
```

---

### 6. Get Live Markets

**Endpoint**: `GET /api/bets/markets/live`

**Response**:
```json
{
  "success": true,
  "data": {
    "cricket": [...],
    "soccer": [...],
    "tennis": [...]
  }
}
```

---

## 🔄 Bet Lifecycle

### 1. Place Bet
```
User Request → Validate → Calculate Exposure → Lock Wallet → Create Bet → Response
```

### 2. Settlement Flow
```
Admin Request → Validate → Fetch All Open Bets → Market-Specific Settlement → Unlock + Credit/Debit → Update Bet Status
```

---

## 🧮 Settlement Logic by Market Type

### MATCH_ODDS Settlement

**Back Bet**:
- If selection wins → Payout = `stake × odds`
- If selection loses → Lose `stake`

**Lay Bet**:
- If selection wins → Lose `(odds - 1) × stake`
- If selection loses → Win `stake`

### BOOKMAKERS_FANCY Settlement

**YES Bet**:
- If outcome = YES → Payout = `stake × rate / 100`
- If outcome = NO → Lose `stake`

**NO Bet**:
- If outcome = NO → Stake returned
- If outcome = YES → Lose `stake`

### LINE_MARKET Settlement

**Over Bet**:
- If `finalValue > lineValue` → Win
- If `finalValue <= lineValue` → Lose

**Under Bet**:
- If `finalValue < lineValue` → Win
- If `finalValue >= lineValue` → Lose

### METER_MARKET Settlement

Similar to LINE_MARKET, but settles when meter crosses the line value.

### KADO_MARKET Settlement

**Back Bet**:
- If selection wins → Payout = `stake × rate` (default 2x)
- If selection loses → Lose `stake`

**Lay Bet**:
- If selection loses → Win `stake`
- If selection wins → Lose `stake × (rate - 1)`

---

## 🔐 Data Safety Rules

1. **MongoDB Transactions**: All wallet operations use transactions
2. **Idempotent Settlement**: Same market can't be settled twice
3. **Prevent Double Settlement**: Checks `settlementResult` before processing
4. **Over-Exposure Prevention**: Validates balance before locking
5. **Negative Wallet Prevention**: All operations check for sufficient balance
6. **Decimal-Safe Math**: Uses integer arithmetic (paise) for calculations

---

## 📊 Database Models

### Bet Model
```javascript
{
  userId: ObjectId,
  sport: String,              // cricket | soccer | tennis
  eventId: String,
  marketId: String,
  marketType: String,         // match_odds | bookmakers_fancy | line_market | meter_market | kado_market
  selectionId: String,
  selectionName: String,
  betType: String,            // back | lay | yes | no | over | under
  odds: Number,               // For MATCH_ODDS
  rate: Number,               // For BOOKMAKERS_FANCY, KADO_MARKET
  lineValue: Number,          // For LINE_MARKET, METER_MARKET
  stake: Number,
  exposure: Number,           // Locked amount
  status: String,             // open | settled
  settlementResult: String,   // won | lost | void
  createdAt: Date,
  settledAt: Date
}
```

### Wallet Model
```javascript
{
  user: ObjectId,
  balance: Number,            // Available balance
  lockedBalance: Number,      // Locked exposure
  currency: String,           // INR | USD | EUR
  isActive: Boolean,
  isLocked: Boolean,
  lastTransactionAt: Date
}
```

---

## 🚀 Usage Examples

### Example 1: Place MATCH_ODDS Back Bet
```bash
curl -X POST http://localhost:5000/api/bets/place \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sport": "cricket",
    "eventId": "550226920",
    "marketId": "9101697825652",
    "marketType": "match_odds",
    "selectionId": "560180",
    "selectionName": "Japan U19",
    "betType": "back",
    "odds": 4.7,
    "stake": 100
  }'
```

### Example 2: Place BOOKMAKERS_FANCY YES Bet
```bash
curl -X POST http://localhost:5000/api/bets/place \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sport": "cricket",
    "eventId": "913074777",
    "marketId": "309257272418",
    "marketType": "bookmakers_fancy",
    "selectionId": "9",
    "selectionName": "Highest Run Scorer Runs of BBL",
    "betType": "yes",
    "rate": 95,
    "stake": 100
  }'
```

### Example 3: Admin Settle MATCH_ODDS Market
```bash
curl -X POST http://localhost:5000/api/bets/settle \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "marketType": "match_odds",
    "eventId": "550226920",
    "marketId": "9101697825652",
    "winnerSelectionId": "560180"
  }'
```

---

## ⚠️ Important Notes

1. **No Bet Matching**: Each user places their own bet separately. There is no user-to-user bet matching.

2. **Market Type Validation**: Each market type has specific requirements:
   - MATCH_ODDS requires `odds`
   - BOOKMAKERS_FANCY requires `rate`
   - LINE_MARKET/METER_MARKET require `lineValue`

3. **Settlement Idempotency**: The system prevents double settlement by checking if a market has already been settled.

4. **Wallet Locking**: Exposure is locked immediately on bet placement and only unlocked on settlement.

5. **Decimal Precision**: All monetary calculations use integer arithmetic (paise) to avoid floating-point errors.

---

## 🔧 Error Codes

| Status Code | Description |
|------------|-------------|
| 400 | Bad Request (validation errors, insufficient balance) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found (bet/wallet not found) |
| 500 | Internal Server Error |

---

## 📝 Changelog

### Version 1.1.0
- Removed bet matching functionality (each user places own bet)
- Removed bet cancellation feature
- Simplified bet statuses to `open` and `settled`

### Version 1.0.0
- Initial implementation
- Support for 5 market types
- Wallet exposure locking
- Market-specific settlement logic
- Basic bet placement

---

## 🤝 Contributing

When adding new market types or modifying settlement logic:
1. Update `Bet.MARKET_TYPES` enum in `src/models/Bet.js`
2. Add exposure calculation in `calculateExposure()` in `src/modules/bet/bet.service.js`
3. Implement settlement function in `settleMarket()`
4. Update validation rules in `src/modules/bet/bet.validation.js`

---

## 📧 Support

For issues or questions, please contact the development team.
