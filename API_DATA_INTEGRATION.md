# API Data Integration Guide

This guide explains how to integrate the betting exchange system with the external API data format.

## Overview

The system now supports:
- ✅ Automatic market type mapping from API `gtype` and `mname`
- ✅ Market synchronization from API data
- ✅ Section and odds extraction from API data
- ✅ Decimal odds format validation (4.70)
- ✅ Market and section status validation
- ✅ Liquidity checking

---

## API Data Structure

### Response Format

```json
{
  "success": true,
  "msg": "Success",
  "status": 200,
  "data": [
    {
      "gmid": 550226920,        // Event ID
      "mid": 9101697825652,     // Market ID
      "mname": "MATCH_ODDS",    // Market Name
      "gtype": "match",         // Game Type
      "status": "OPEN",         // Market Status
      "section": [              // Betting Options
        {
          "sid": 560180,        // Section ID
          "nat": "Japan U19",   // Section Name
          "odds": [             // Available Odds
            {
              "odds": 470,      // Odds in API format (470)
              "otype": "back",  // Odds Type
              "size": 1.81      // Available Stake
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Market Type Mapping

The system automatically maps API `gtype` and `mname` to internal market types:

| gtype | mname | Internal Market Type |
|-------|-------|---------------------|
| `match` | `MATCH_ODDS` | `match_odds` |
| `match` | `TIED_MATCH` | `match_odds` |
| `match1` | `Bookmaker` | `bookmakers_fancy` |
| `fancy` | `Normal` | `bookmakers_fancy` |
| `fancy` | `Over By Over` | `bookmakers_fancy` |
| `oddeven` | `oddeven` | `line_market` |
| `cricketcasino` | `*CASINO*` | `kado_market` |

---

## Odds Format

The system accepts **both** API format and decimal format odds:

### API Format (values >= 101)
- `470` - API format (represents 4.70 decimal)
- `101` - Minimum odds (represents 1.01 decimal)
- `1000` - Example odds (represents 10.00 decimal)
- `100000` - Maximum odds (represents 1000.00 decimal)

### Decimal Format (values < 101)
- `4.70` - Decimal format
- `1.01` - Minimum odds
- `10.00` - Example odds
- `1000.00` - Maximum odds

### Usage

```javascript
// Option 1: API format
POST /api/bets/place
{
  "odds": 470    // API format (470) OR decimal format (4.70) - both accepted
}

// Option 2: Decimal format
POST /api/bets/place
{
  "odds": 4.70   // Decimal format
}
```

**Note**: The system automatically detects the format:
- If `odds >= 101` → treated as API format (converts to decimal internally)
- If `odds < 101` → treated as decimal format (used directly)
- Both formats are converted to decimal (1.01-1000) for calculations and storage

---

## Market Synchronization

### Sync Markets from API Data

**Endpoint**: `POST /api/markets/sync` (Admin only)

**Request**:
```json
{
  "apiData": {
    "success": true,
    "data": [ /* market array */ ]
  },
  "sportType": "cricket"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Synced 7 out of 7 markets",
  "data": {
    "synced": 7,
    "total": 7,
    "markets": [ /* synced markets */ ],
    "errors": []
  }
}
```

### Get Market Sections

**Endpoint**: `POST /api/markets/:marketId/sections` (Admin only)

**Request**:
```json
{
  "apiData": {
    "success": true,
    "data": [ /* market array */ ]
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "sections": [
      {
        "sectionId": "560180",
        "sectionName": "Japan U19",
        "status": "ACTIVE",
        "max": 0,
        "min": 0,
        "odds": [ /* odds array */ ]
      }
    ]
  }
}
```

---

## Placing Bets with API Data

### Step 1: Extract Market Information

```javascript
const market = apiData.data.find(m => m.mid === marketId);
const section = market.section.find(s => s.sid === sectionId);
const backOdd = section.odds.find(o => o.otype === 'back' && o.odds > 0);
```

### Step 2: Use Odds (Both Formats Supported)

```javascript
// Option 1: Use API format directly
const odds = backOdd.odds; // 470

// Option 2: Convert to decimal format
const odds = backOdd.odds / 100; // 4.70

// The system accepts both:
// API format: 470, 101, 1000 (auto-converted to decimal)
// Decimal format: 4.70, 1.01, 10.00 (used directly)
```

### Step 3: Place Bet

```javascript
POST /api/bets/place
{
  "marketId": "9101697825652",      // market.mid
  "sectionId": "560180",            // section.sid
  "eventId": "550226920",           // market.gmid
  "marketName": "MATCH_ODDS",       // market.mname
  "sectionName": "Japan U19",       // section.nat
  "marketType": "match_odds",       // Auto-mapped from gtype
  "type": "back",
  "odds": 470,                      // API format OR 4.70 (decimal) - both accepted
  "stake": 100
}
```

---

## Utility Functions

### Market Mapper (`src/utils/marketMapper.js`)

```javascript
const {
  mapGtypeToMarketType,
  convertApiOddsToDecimal,
  convertDecimalToApiOdds,
  isMarketOpen,
  isSectionActive,
  getBestOdds,
  getAvailableOdds,
  validateStake
} = require('../utils/marketMapper');

// Map market type
const marketType = mapGtypeToMarketType('match', 'MATCH_ODDS');
// Returns: 'match_odds'

// Convert odds from API format to decimal
const decimalOdds = convertApiOddsToDecimal(470);
// Returns: 4.70
// This is equivalent to: 470 / 100 = 4.70

// Get best odds
const bestBack = getBestOdds(section.odds, 'back');
// Returns: { odds: 4.70, size: 1.81, tier: 0, oname: 'back1' }

// Get all available odds
const available = getAvailableOdds(section.odds);
// Returns: { back: {...}, lay: {...} }
```

---

## Validation

### Odds Validation

The system accepts both API format and decimal format:

```javascript
// API format (>= 101)
odds: 470   ✅ (470 = 4.70 decimal, auto-converted)
odds: 101   ✅ (101 = 1.01 decimal, minimum)
odds: 100000 ✅ (100000 = 1000.00 decimal, maximum)

// Decimal format (< 101)
odds: 4.70  ✅ (used directly)
odds: 1.01  ✅ (minimum)
odds: 1000.00 ✅ (maximum)

// Invalid
odds: 0.5   ❌ (too low, must be >= 1.01 decimal or >= 101 API)
odds: 1001  ❌ (too high, must be <= 1000 decimal or <= 100000 API)
odds: 100   ❌ (invalid - too low for API format, too high for decimal)
```

### Market Status Validation

```javascript
// Only OPEN markets allow betting
if (market.status !== 'OPEN') {
  // Market is suspended/closed
}
```

### Section Status Validation

```javascript
// Only ACTIVE sections allow betting
if (section.gstatus !== 'ACTIVE' && section.gstatus !== '') {
  // Section is suspended
}
```

---

## Example: Complete Integration Flow

### 1. Receive API Data

```javascript
const apiResponse = {
  success: true,
  data: [ /* markets */ ]
};
```

### 2. Sync Markets

```javascript
POST /api/markets/sync
{
  "apiData": apiResponse,
  "sportType": "cricket"
}
```

### 3. Get Available Markets

```javascript
GET /api/markets/event/550226920
```

### 4. Extract Betting Information

```javascript
const market = apiResponse.data[0]; // MATCH_ODDS
const section = market.section[0];  // Japan U19
const backOdd = section.odds.find(o => o.otype === 'back' && o.odds > 0);
```

### 5. Place Bet

```javascript
POST /api/bets/place
{
  "marketId": market.mid.toString(),
  "sectionId": section.sid.toString(),
  "eventId": market.gmid.toString(),
  "marketName": market.mname,
  "sectionName": section.nat,
  "marketType": "match_odds",
  "type": "back",
  "odds": backOdd.odds,  // Use API format (470) OR convert to decimal (4.70) - both work
  "stake": 100
}
```

---

## Error Handling

### Common Errors

1. **Invalid Market Status**
   ```json
   {
     "success": false,
     "message": "Market is not open for betting"
   }
   ```

2. **Invalid Section Status**
   ```json
   {
     "success": false,
     "message": "Section is not active"
   }
   ```

3. **Invalid Odds Format**
   ```json
   {
     "success": false,
     "message": "Odds must be between 1.01 and 1000 (decimal) or 101 and 100000 (API format)"
   }
   ```
   
   **Solution**: Use either format:
   - **Decimal format**: 1.01 to 1000.00
   - **API format**: 101 to 100000
   - Examples: `4.70` or `470` (both represent the same odds)

4. **Insufficient Liquidity**
   ```json
   {
     "success": false,
     "message": "Insufficient available balance"
   }
   ```

---

## Best Practices

1. **Always sync markets** before allowing bets
2. **Check market status** before displaying to users
3. **Validate section status** before placing bets
4. **Use either odds format**: API format (470) or decimal format (4.70) - both accepted
5. **Check liquidity** (`size` field) before placing large bets
6. **Odds range**: 
   - Decimal: 1.01 to 1000.00
   - API format: 101 to 100000

---

## Testing

### Test Market Sync

```bash
curl -X POST http://localhost:5000/api/markets/sync \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "apiData": { "success": true, "data": [...] },
    "sportType": "cricket"
  }'
```

### Test Bet Placement

```bash
curl -X POST http://localhost:5000/api/bets/place \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "marketId": "9101697825652",
    "sectionId": "560180",
    "eventId": "550226920",
    "marketName": "MATCH_ODDS",
    "sectionName": "Japan U19",
    "marketType": "match_odds",
    "type": "back",
    "odds": 470,  // or 4.70 - both formats accepted
    "stake": 100
  }'
```

---

## Summary

The system now fully supports:
- ✅ API data format integration
- ✅ Automatic market type mapping from `gtype` and `mname`
- ✅ Market synchronization from API responses
- ✅ Section and odds extraction from API data
- ✅ Market and section status validation
- ✅ Liquidity checking (`size` field)
- ✅ Both odds formats accepted: API format (470) or decimal format (4.70) - auto-detected

## Key Points

1. **Odds Format**: Accepts both API format (470) and decimal format (4.70) - auto-detected
2. **Market Types**: Automatically mapped from `gtype` and `mname` fields
3. **Status Check**: Only `OPEN` markets and `ACTIVE` sections allow betting
4. **Market Sync**: Use `/api/markets/sync` to sync markets from API data
5. **Bet Placement**: Use either odds format (470 or 4.70) - both work

All betting operations work seamlessly with the external API data format!

---

## Quick Reference

### Odds Format Reference

| API Format | Decimal Format | Equivalent | Usage |
|------------|----------------|------------|-------|
| 101 | 1.01 | Same | Minimum odds |
| 150 | 1.50 | Same | Example odds |
| 200 | 2.00 | Same | Example odds |
| 470 | 4.70 | Same | Example odds |
| 1000 | 10.00 | Same | Example odds |
| 100000 | 1000.00 | Same | Maximum odds |

**Note**: You can use either format in requests:
- API format: `470` (auto-converted to 4.70)
- Decimal format: `4.70` (used directly)
- Both result in the same bet with odds of 4.70

### Market Type Quick Reference

| API gtype | API mname | Market Type |
|-----------|-----------|-------------|
| `match` | `MATCH_ODDS` | `match_odds` |
| `match` | `TIED_MATCH` | `match_odds` |
| `match1` | `Bookmaker` | `bookmakers_fancy` |
| `fancy` | `Normal` | `bookmakers_fancy` |
| `fancy` | `Over By Over` | `bookmakers_fancy` |
| `oddeven` | `oddeven` | `line_market` |
| `cricketcasino` | `*CASINO*` | `kado_market` |

### Status Values

| Status | Meaning | Allows Betting |
|--------|---------|----------------|
| `OPEN` | Market is open | ✅ Yes |
| `SUSPENDED` | Market is suspended | ❌ No |
| `ACTIVE` | Section is active | ✅ Yes |
| `SUSPENDED` | Section is suspended | ❌ No |
| `""` (empty) | Section status not set | ✅ Yes (treated as active) |
