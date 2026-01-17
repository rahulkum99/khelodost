# Betting Exchange System Documentation

## Overview

This document describes the complete betting exchange system implementation for the cricket backend. The system allows users to place back and lay bets against each other, with automatic matching, balance management, and settlement functionality.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Database Models](#database-models)
3. [Market Types](#market-types)
4. [API Endpoints](#api-endpoints)
5. [Betting Flow](#betting-flow)
6. [Wallet Operations](#wallet-operations)
7. [Bet Matching Algorithm](#bet-matching-algorithm)
8. [Settlement Process](#settlement-process)
9. [Error Handling](#error-handling)
10. [Usage Examples](#usage-examples)

---

## System Architecture

### Components

- **Bet Model**: Stores all bet information
- **Wallet Model**: Manages user balances (available, locked, total)
- **WalletTransaction Model**: Logs all financial transactions
- **Bet Service**: Core business logic for betting operations
- **Bet Controller**: HTTP request handlers
- **Bet Routes**: API endpoint definitions

### Key Features

- ✅ Back and Lay betting system
- ✅ Automatic bet matching with best odds priority
- ✅ Balance locking/unlocking mechanism
- ✅ Transaction logging for all operations
- ✅ MongoDB transactions for data consistency
- ✅ Role-based access control
- ✅ Comprehensive validation

---

## Market Types

The system supports multiple market types for different betting scenarios:

### Supported Market Types

1. **Match Odds** (`match_odds`)
   - Standard match winner betting
   - Most common market type
   - Default market type if not specified
   - Settlement: Based on match winner

2. **Bookmakers Fancy** (`bookmakers_fancy`)
   - Fancy markets with custom rules
   - Special betting markets
   - Settlement: Custom rules defined per market

3. **Line Market** (`line_market`)
   - Line-based betting markets
   - Handicap-style betting
   - Settlement: Based on line/point difference

4. **Meter Market** (`meter_market`)
   - Meter-based betting markets
   - Performance-based metrics
   - Settlement: Based on meter/performance values

5. **Kado Market** (`kado_market`)
   - Kado-style betting markets
   - Special format markets
   - Settlement: Based on Kado market rules

### Market Management

Markets are managed through the Market model and can be:
- Created/updated by administrators
- Activated/deactivated
- Filtered by type and sport
- Tracked with statistics

---

## Database Models

### Bet Model

**Location**: `src/models/Bet.js`

**Schema**:
```javascript
{
  userId: ObjectId (ref: User),
  marketId: String,
  sectionId: String,
  eventId: String,
  marketName: String,
  sectionName: String,
  type: 'back' | 'lay',
  odds: Number (1.01 - 1000),
  stake: Number,
  status: 'pending' | 'matched' | 'partially_matched' | 'unmatched' | 'cancelled' | 'settled',
  matchedAmount: Number,
  unmatchedAmount: Number,
  profit: Number,
  liability: Number,
  matchedWith: [{
    betId: ObjectId,
    amount: Number,
    odds: Number,
    matchedAt: Date
  }],
  settlementResult: 'win' | 'lose' | null,
  settledAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `userId`, `status`, `createdAt` (compound)
- `marketId`, `sectionId`, `type`, `status`, `odds` (compound for matching)
- `eventId`, `status` (for settlement queries)

### Wallet Model

**Location**: `src/models/Wallet.js`

**Schema**:
```javascript
{
  user: ObjectId (ref: User, unique),
  balance: Number,
  availableBalance: Number,
  lockedBalance: Number,
  totalDeposit: Number,
  totalWithdrawal: Number,
  totalProfit: Number,
  totalLoss: Number,
  currency: 'INR' | 'USD' | 'EUR',
  isActive: Boolean,
  isLocked: Boolean,
  lockedReason: String,
  lastTransactionAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

**Balance Formula**: `balance = availableBalance + lockedBalance`

**Methods**:
- `lockBalance(amount)`: Locks amount from available to locked
- `unlockBalance(amount)`: Unlocks amount from locked to available
- `isAvailable()`: Checks if wallet is active and not locked
- `getOrCreateWallet(userId, currency)`: Static method to get or create wallet

### WalletTransaction Model

**Location**: `src/models/WalletTransaction.js`

**Transaction Types**:
- `credit`: Money added to wallet
- `debit`: Money deducted from wallet
- `transfer`: Transfer between wallets
- `refund`: Refund transaction
- `commission`: Commission earned
- `adjustment`: Manual adjustment
- `bet_placed`: Bet placed (balance locked)
- `bet_matched`: Bet matched (balance unlocked)
- `bet_settled`: Bet settled (profit/loss added)
- `bet_cancelled`: Bet cancelled (balance unlocked)

---

## API Endpoints

### Base URL
All betting endpoints are prefixed with `/api/bets`

### Authentication
All endpoints require authentication via Bearer token.

### Endpoints

#### 1. Place Bet

**Endpoint**: `POST /api/bets/place`

**Description**: Place a new back or lay bet

**Request Body**:
```json
{
  "marketId": "match_odds_123",
  "sectionId": "team_india",
  "eventId": "event_456",
  "marketName": "Match Odds",
  "sectionName": "India",
  "marketType": "match_odds",
  "type": "back",
  "odds": 2.0,
  "stake": 1000
}
```

**Note**: `marketType` is optional and defaults to `match_odds` if not provided.

**Response**:
```json
{
  "success": true,
  "message": "Bet placed successfully",
  "data": {
    "bet": {
      "_id": "...",
      "status": "matched",
      "matchedAmount": 1000,
      "unmatchedAmount": 0
    },
    "matchedBets": [
      {
        "betId": "...",
        "amount": 1000,
        "odds": 2.0
      }
    ],
    "wallet": {
      "balance": 9000,
      "availableBalance": 8000,
      "lockedBalance": 1000
    },
    "transaction": {...}
  }
}
```

**Validation**:
- `marketId`, `sectionId`, `eventId`, `marketName`, `sectionName`: Required strings
- `type`: Must be "back" or "lay"
- `odds`: Must be between 1.01 and 1000
- `stake`: Must be at least 0.01

#### 2. Get User Bets

**Endpoint**: `GET /api/bets/my-bets`

**Description**: Get all bets for the authenticated user

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20, max: 100)
- `status` (optional): Filter by status
- `type` (optional): Filter by type ("back" or "lay")
- `eventId` (optional): Filter by event ID
- `marketId` (optional): Filter by market ID

**Response**:
```json
{
  "success": true,
  "data": {
    "bets": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "pages": 3
    }
  }
}
```

#### 3. Get Bet by ID

**Endpoint**: `GET /api/bets/:betId`

**Description**: Get details of a specific bet

**Response**:
```json
{
  "success": true,
  "data": {
    "bet": {
      "_id": "...",
      "type": "back",
      "odds": 2.0,
      "stake": 1000,
      "status": "matched",
      "matchedWith": [...]
    }
  }
}
```

#### 4. Cancel Bet

**Endpoint**: `POST /api/bets/cancel/:betId`

**Description**: Cancel an unmatched bet

**Response**:
```json
{
  "success": true,
  "message": "Bet cancelled successfully",
  "data": {
    "bet": {...},
    "wallet": {...}
  }
}
```

**Note**: Only unmatched portions can be cancelled. Fully matched bets cannot be cancelled.

#### 5. Settle Event (Admin Only)

**Endpoint**: `POST /api/bets/settle`

**Description**: Settle all bets for an event (requires admin role)

**Request Body**:
```json
{
  "eventId": "event_456",
  "winningSectionId": "team_india"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Settled 25 bet(s) for event event_456",
  "data": {
    "settledCount": 25
  }
}
```

#### 6. Get Bets for User (Admin Only)

**Endpoint**: `GET /api/bets/user/:userId`

**Description**: Get all bets for a specific user (admin only)

**Query Parameters**: Same as "Get User Bets"

---

## Betting Flow

### 1. Place Back Bet

```
User places back bet: ₹1000 @ 2.0

Step 1: Validate inputs
Step 2: Check available balance (requires ₹1000)
Step 3: Lock balance
   - availableBalance: ₹10,000 → ₹9,000
   - lockedBalance: ₹0 → ₹1,000
   - balance: ₹10,000 (unchanged)
Step 4: Create bet record
   - status: 'pending'
   - unmatchedAmount: ₹1,000
Step 5: Attempt to match bet
Step 6: Create transaction (bet_placed)
```

### 2. Place Lay Bet

```
User places lay bet: ₹1000 @ 2.0

Step 1: Calculate required amount
   - Liability = ₹1000 × (2.0 - 1) = ₹1,000
   - Required = ₹1,000 + ₹1,000 = ₹2,000
Step 2: Check available balance (requires ₹2,000)
Step 3: Lock balance
   - availableBalance: ₹10,000 → ₹8,000
   - lockedBalance: ₹0 → ₹2,000
Step 4: Create bet record
   - liability: ₹1,000
   - unmatchedAmount: ₹1,000
Step 5: Attempt to match bet
```

### 3. Bet Matching

```
Back Bet: ₹1000 @ 2.0
Lay Bet: ₹800 @ 1.9

Matching Process:
1. Find compatible bets (opposite type, same market/section)
2. Check odds compatibility (lay odds ≤ back odds)
3. Match amount = min(₹1000, ₹800) = ₹800
4. Match odds = 1.9 (lay odds, better for back bettor)
5. Update both bets:
   - Back: matchedAmount = ₹800, unmatchedAmount = ₹200
   - Lay: matchedAmount = ₹800, unmatchedAmount = ₹0
6. Unlock balances:
   - Back: Unlock ₹800
   - Lay: Unlock ₹800 + ₹720 (liability) = ₹1,520
7. Create match transactions
```

### 4. Settlement

#### Back Bet Wins
```
Matched: ₹1000 @ 2.0
Winnings = ₹1000 × (2.0 - 1) = ₹1,000

Wallet Update:
- availableBalance: +₹1,000
- totalProfit: +₹1,000
- balance: +₹1,000
```

#### Lay Bet Wins
```
Matched: ₹1000 @ 2.0
Profit = ₹1,000 (stake kept)

Wallet Update:
- availableBalance: +₹1,000
- totalProfit: +₹1,000
- balance: +₹1,000
```

#### Back Bet Loses
```
Matched: ₹1000 @ 2.0
Loss = ₹1,000 (already deducted on place)

Wallet Update:
- totalLoss: +₹1,000
- (No balance change, already deducted)
```

#### Lay Bet Loses
```
Matched: ₹1000 @ 2.0
Liability = ₹1,000 × (2.0 - 1) = ₹1,000

Wallet Update:
- availableBalance: -₹1,000
- totalLoss: +₹1,000
- balance: -₹1,000
```

---

## Wallet Operations

### Balance Structure

```javascript
{
  balance: 10000,           // Total balance
  availableBalance: 8000,   // Available to bet
  lockedBalance: 2000      // Locked in pending bets
}
```

### Locking Balance

When placing a bet:
```javascript
// Back bet: Lock stake
wallet.availableBalance -= stake;
wallet.lockedBalance += stake;

// Lay bet: Lock stake + liability
const liability = stake × (odds - 1);
wallet.availableBalance -= (stake + liability);
wallet.lockedBalance += (stake + liability);
```

### Unlocking Balance

When bet is matched:
```javascript
// Back bet: Unlock matched amount
wallet.lockedBalance -= matchedAmount;
wallet.availableBalance += matchedAmount;

// Lay bet: Unlock matched amount + liability
const liability = matchedAmount × (matchOdds - 1);
wallet.lockedBalance -= (matchedAmount + liability);
wallet.availableBalance += (matchedAmount + liability);
```

---

## Bet Matching Algorithm

### Matching Rules

1. **Opposite Types**: Back bets match with Lay bets only
2. **Same Market**: Must be same `marketId` and `sectionId`
3. **Different Users**: Cannot match with own bets
4. **Odds Compatibility**:
   - Back bet matches with Lay bet if: `layOdds ≤ backOdds`
   - Lay bet matches with Back bet if: `backOdds ≥ layOdds`
5. **Status**: Both bets must be `pending` or `partially_matched`

### Matching Priority

1. **Best Odds First**:
   - For Back bets: Match with lowest Lay odds first
   - For Lay bets: Match with highest Back odds first
2. **Time Priority**: If same odds, match oldest bets first

### Example Matching

```
Available Bets:
- Lay Bet 1: ₹500 @ 1.8 (created first)
- Lay Bet 2: ₹300 @ 1.9
- Lay Bet 3: ₹200 @ 2.0

Back Bet: ₹1000 @ 2.0

Matching Order:
1. Match ₹500 with Lay Bet 1 @ 1.8
2. Match ₹300 with Lay Bet 2 @ 1.9
3. Match ₹200 with Lay Bet 3 @ 2.0

Result:
- Back bet: ₹1000 matched, ₹0 unmatched
- All lay bets fully matched
```

---

## Settlement Process

### Settlement Flow

1. **Event Completes**: Admin calls settle endpoint with winning section
2. **Find Bets**: Query all matched/partially_matched bets for event
3. **Calculate Results**: For each bet:
   - Determine if winner (sectionId matches winningSectionId)
   - Calculate profit/loss based on bet type
4. **Update Wallets**: Add profit or deduct loss
5. **Update Bets**: Mark as settled with result
6. **Create Transactions**: Log all settlement transactions

### Settlement Calculations

#### Back Bet Settlement

```javascript
if (sectionId === winningSectionId) {
  // Win
  winnings = matchedAmount × (odds - 1);
  wallet.availableBalance += winnings;
  wallet.totalProfit += winnings;
  bet.settlementResult = 'win';
} else {
  // Loss
  wallet.totalLoss += matchedAmount;
  bet.settlementResult = 'lose';
}
```

#### Lay Bet Settlement

```javascript
if (sectionId !== winningSectionId) {
  // Win (opposite lost)
  profit = matchedAmount;
  wallet.availableBalance += profit;
  wallet.totalProfit += profit;
  bet.settlementResult = 'win';
} else {
  // Loss (opposite won)
  liability = matchedAmount × (odds - 1);
  wallet.availableBalance -= liability;
  wallet.totalLoss += liability;
  bet.settlementResult = 'lose';
}
```

---

## Error Handling

### Common Errors

#### 1. Insufficient Balance
```json
{
  "success": false,
  "message": "Insufficient available balance. Required: 2000, Available: 1500"
}
```

#### 2. Invalid Odds
```json
{
  "success": false,
  "message": "Odds must be between 1.01 and 1000"
}
```

#### 3. Bet Already Settled
```json
{
  "success": false,
  "message": "Cannot cancel settled bet"
}
```

#### 4. Wallet Locked
```json
{
  "success": false,
  "message": "Wallet is locked. Reason: Account suspended"
}
```

### Error Response Format

All errors follow this format:
```json
{
  "success": false,
  "message": "Error description",
  "errors": [...] // Validation errors if applicable
}
```

---

## Usage Examples

### Example 1: Place Back Bet

```javascript
// Request
POST /api/bets/place
Authorization: Bearer <token>
Content-Type: application/json

{
  "marketId": "match_odds_123",
  "sectionId": "team_india",
  "eventId": "event_456",
  "marketName": "Match Odds",
  "sectionName": "India",
  "type": "back",
  "odds": 2.0,
  "stake": 1000
}

// Response
{
  "success": true,
  "message": "Bet placed successfully",
  "data": {
    "bet": {
      "_id": "507f1f77bcf86cd799439011",
      "status": "matched",
      "matchedAmount": 1000,
      "unmatchedAmount": 0
    },
    "matchedBets": [
      {
        "betId": "507f1f77bcf86cd799439012",
        "amount": 1000,
        "odds": 1.9
      }
    ]
  }
}
```

### Example 2: Place Lay Bet

```javascript
// Request
POST /api/bets/place
{
  "marketId": "match_odds_123",
  "sectionId": "team_india",
  "eventId": "event_456",
  "marketName": "Match Odds",
  "sectionName": "India",
  "marketType": "match_odds",
  "type": "lay",
  "odds": 2.0,
  "stake": 1000
}

// Response
{
  "success": true,
  "message": "Bet placed successfully",
  "data": {
    "bet": {
      "_id": "507f1f77bcf86cd799439013",
      "type": "lay",
      "liability": 1000,
      "status": "pending",
      "unmatchedAmount": 1000
    },
    "wallet": {
      "availableBalance": 8000,
      "lockedBalance": 2000,
      "balance": 10000
    }
  }
}
```

### Example 3: Get User Bets

```javascript
// Request
GET /api/bets/my-bets?status=matched&page=1&limit=10

// Response
{
  "success": true,
  "data": {
    "bets": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "type": "back",
        "odds": 2.0,
        "stake": 1000,
        "status": "matched",
        "matchedAmount": 1000,
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 25,
      "pages": 3
    }
  }
}
```

### Example 4: Get Markets by Event

```javascript
// Request
GET /api/markets/event/event_456?marketType=match_odds

// Response
{
  "success": true,
  "data": {
    "markets": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "marketId": "match_odds_123",
        "marketName": "Match Odds",
        "marketType": "match_odds",
        "eventId": "event_456",
        "sportType": "cricket",
        "isActive": true
      }
    ]
  }
}
```

### Example 5: Place Bet on Bookmakers Fancy Market

```javascript
// Request
POST /api/bets/place
{
  "marketId": "fancy_123",
  "sectionId": "over_150",
  "eventId": "event_456",
  "marketName": "Total Runs Fancy",
  "sectionName": "Over 150",
  "marketType": "bookmakers_fancy",
  "type": "back",
  "odds": 1.8,
  "stake": 500
}
```

### Example 6: Settle Event

```javascript
// Request (Admin only)
POST /api/bets/settle
{
  "eventId": "event_456",
  "winningSectionId": "team_india"
}

// Response
{
  "success": true,
  "message": "Settled 25 bet(s) for event event_456",
  "data": {
    "settledCount": 25
  }
}
```

---

## Key Points to Remember

1. **Balance Management**: Always use `availableBalance` for checking funds, `lockedBalance` for pending bets
2. **Atomic Operations**: All bet operations use MongoDB transactions for consistency
3. **Matching Priority**: Best odds first, then time priority
4. **Settlement**: Only matched bets are settled, unmatched bets remain pending
5. **Transaction Logging**: Every wallet operation creates a transaction record
6. **Status Updates**: Bet status automatically updates based on matched/unmatched amounts
7. **Market Types**: Always specify `marketType` when placing bets, defaults to `match_odds` if not provided
8. **Market Validation**: System validates market exists and is active before accepting bets
9. **Market Filtering**: Use market type filters to query specific market categories

---

## Testing

### Test Scenarios

1. **Place Back Bet**: Verify balance locking
2. **Place Lay Bet**: Verify liability calculation and locking
3. **Match Bets**: Verify automatic matching with best odds
4. **Cancel Bet**: Verify balance unlocking
5. **Settle Event**: Verify profit/loss calculations
6. **Edge Cases**: 
   - Insufficient balance
   - Invalid odds
   - Betting against self (should not match)
   - Partial matching

---

## Future Enhancements

- [ ] Commission calculation and deduction
- [ ] Bet history and statistics
- [ ] Real-time odds updates via WebSocket
- [ ] Bet limits and restrictions
- [ ] Multi-currency support
- [ ] Betting pools and markets management
- [ ] Automated settlement based on external data

---

## Support

For issues or questions, please refer to:
- Code documentation in `src/modules/bet/`
- Model schemas in `src/models/`
- API validation rules in `src/modules/bet/bet.validation.js`

---

**Last Updated**: 2024-01-15
**Version**: 1.0.0
