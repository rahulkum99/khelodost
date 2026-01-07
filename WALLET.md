# Wallet System Documentation

## Overview

This is a highly secure, production-ready wallet system with comprehensive transaction tracking, role-based access control, and complete audit trails. The wallet system supports multiple currencies and enforces strict permission rules to ensure only authorized users can manage wallets.

## Key Features

### ✅ Core Features

1. **Automatic Wallet Creation**
   - Wallets are automatically created when users are registered
   - Each user gets one wallet in their default currency
   - Wallet is linked to user account

2. **Multi-Currency Support**
   - Supports INR, USD, EUR
   - Currency matches user's default currency
   - All transactions are in the wallet's currency

3. **Transaction Tracking**
   - Complete audit trail for all transactions
   - Transaction types: Credit, Debit, Transfer, Refund, Commission, Adjustment
   - Transaction status: Pending, Completed, Failed, Cancelled
   - Unique reference IDs for each transaction

4. **Security Features**
   - Role-based access control
   - Wallet lock/unlock mechanism
   - Balance validation before operations
   - MongoDB transactions for atomic operations
   - IP address and user agent tracking

5. **Permission System**
   - **ONLY Super Admin** can add amount to wallets (creates money from system)
   - All other roles can **transfer** amount from their own wallet to other wallets
   - Upper-level admins can transfer from wallets of users they created
   - Admin can only manage wallets of users they created
   - Super Admin can manage anyone's wallet
   - Users can only view their own wallet

## Wallet Model

### Wallet Fields

- **user** (ObjectId, required, unique) - Reference to User
- **balance** (Number, required, default: 0) - Current wallet balance
- **currency** (String, required, default: 'INR') - Currency code (INR, USD, EUR)
- **isActive** (Boolean, default: true) - Wallet active status
- **isLocked** (Boolean, default: false) - Wallet lock status
- **lockedReason** (String, optional) - Reason for wallet lock
- **lastTransactionAt** (Date, optional) - Last transaction timestamp
- **createdAt** (Date, auto) - Wallet creation timestamp
- **updatedAt** (Date, auto) - Last update timestamp

### Wallet Methods

- `isAvailable()` - Check if wallet is active and not locked
- `lock(reason)` - Lock the wallet with optional reason
- `unlock()` - Unlock the wallet
- `getOrCreateWallet(userId, currency)` - Static method to get or create wallet

## Transaction Model

### Transaction Types

- **credit** - Money added to wallet
- **debit** - Money deducted from wallet
- **transfer** - Transfer between wallets
- **refund** - Refund transaction
- **commission** - Commission earned
- **adjustment** - Manual adjustment by admin

### Transaction Status

- **pending** - Transaction is pending
- **completed** - Transaction completed successfully
- **failed** - Transaction failed
- **cancelled** - Transaction cancelled

### Transaction Fields

- **wallet** (ObjectId, required) - Reference to Wallet
- **user** (ObjectId, required) - Reference to User
- **transactionType** (String, required) - Type of transaction
- **amount** (Number, required) - Transaction amount
- **balanceBefore** (Number, required) - Balance before transaction
- **balanceAfter** (Number, required) - Balance after transaction
- **currency** (String, required) - Currency code
- **status** (String, default: 'completed') - Transaction status
- **description** (String, required, max: 500) - Transaction description
- **referenceId** (String, unique) - Unique transaction reference ID
- **performedBy** (ObjectId, required) - User who performed the transaction
- **relatedTransaction** (ObjectId, optional) - Related transaction reference
- **metadata** (Object, optional) - Additional transaction metadata
- **ipAddress** (String, optional) - IP address of requester
- **userAgent** (String, optional) - User agent of requester
- **createdAt** (Date, auto) - Transaction timestamp

## Permission Rules

### Wallet Management Permissions

1. **Super Admin** (Level 6)
   - **ONLY role that can ADD amount** to wallets (creates money from system)
   - Can deduct amount from any user's wallet
   - Can transfer from any wallet to any wallet
   - Can lock/unlock any wallet
   - Can view any wallet and transactions

2. **Admin** (Level 5)
   - **CANNOT add amount** (only Super Admin can)
   - Can transfer from their own wallet to wallets of users they created
   - Can transfer from wallets of users they created to other users they created
   - Can deduct amount only from wallets of users they created
   - Can lock/unlock wallets of users they created
   - Can view wallets and transactions of users they created

3. **Super Master** (Level 4)
   - **CANNOT add amount** (only Super Admin can)
   - Can transfer from their own wallet to wallets of users they created
   - Can transfer from wallets of users they created to other users they created
   - Can deduct amount only from wallets of users they created
   - Can lock/unlock wallets of users they created
   - Can view wallets and transactions of users they created

4. **Master** (Level 3)
   - **CANNOT add amount** (only Super Admin can)
   - Can transfer from their own wallet to wallets of users they created
   - Can transfer from wallets of users they created to other users they created
   - Can deduct amount only from wallets of users they created
   - Can lock/unlock wallets of users they created
   - Can view wallets and transactions of users they created

5. **Agent** (Level 2)
   - **CANNOT add amount** (only Super Admin can)
   - Can transfer from their own wallet to wallets of users they created
   - Can deduct amount only from wallets of users they created
   - Can lock/unlock wallets of users they created
   - Can view wallets and transactions of users they created

6. **User** (Level 1)
   - **CANNOT add amount** (only Super Admin can)
   - Can transfer from their own wallet to other users' wallets (if they have permission)
   - Can only view their own wallet
   - Can view their own transactions
   - Cannot deduct amount from other wallets
   - Cannot lock/unlock wallet

### Rules

- **ONLY Super Admin can add amount** - This creates money from the system
- **All other roles must transfer** - They can only move existing funds between wallets
- Users can transfer from their own wallet to other wallets
- Upper-level roles can transfer from wallets of users they created
- Admin can only manage wallets of users they created (checked via `createdBy` field)
- Users can only access their own wallet
- All wallet operations require authentication
- Transfers require sufficient balance in sender's wallet
- Transfers must be between wallets with matching currencies

## API Endpoints

### User Endpoints (Require Authentication)

#### Get My Wallet
```http
GET /api/wallet/me
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "wallet": {
      "_id": "...",
      "user": {
        "_id": "...",
        "username": "john",
        "name": "John Doe",
        "email": "john@example.com",
        "role": "user"
      },
      "balance": 1000.50,
      "currency": "INR",
      "isActive": true,
      "isLocked": false,
      "lastTransactionAt": "2024-01-15T10:30:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

#### Get My Balance
```http
GET /api/wallet/me/balance
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "balance": 1000.50,
    "currency": "INR",
    "isActive": true,
    "isLocked": false
  }
}
```

#### Get My Transactions
```http
GET /api/wallet/me/transactions?page=1&limit=20&transactionType=credit&status=completed&startDate=2024-01-01&endDate=2024-12-31
Authorization: Bearer <accessToken>
```

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `transactionType` - Filter by type (credit, debit, transfer, refund, commission, adjustment)
- `status` - Filter by status (pending, completed, failed, cancelled)
- `startDate` - Start date filter (ISO format)
- `endDate` - End date filter (ISO format)

**Response:**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "_id": "...",
        "wallet": "...",
        "user": "...",
        "transactionType": "credit",
        "amount": 500.00,
        "balanceBefore": 500.50,
        "balanceAfter": 1000.50,
        "currency": "INR",
        "status": "completed",
        "description": "Amount added by admin",
        "referenceId": "TXN17053122000001234",
        "performedBy": {
          "_id": "...",
          "username": "admin",
          "name": "Admin User",
          "role": "admin"
        },
        "metadata": {
          "addedBy": "admin",
          "targetUser": "john"
        },
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0...",
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "pages": 3
    }
  }
}
```

#### Get My Wallet Statistics
```http
GET /api/wallet/me/stats
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "wallet": {
      "_id": "...",
      "balance": 1000.50,
      "currency": "INR",
      "isActive": true,
      "isLocked": false
    },
    "stats": {
      "credit": {
        "totalAmount": 2000.00,
        "count": 5
      },
      "debit": {
        "totalAmount": 999.50,
        "count": 3
      }
    },
    "totalCredits": 2000.00,
    "totalDebits": 999.50,
    "netAmount": 1000.50
  }
}
```

#### Transfer Amount Between Wallets
```http
POST /api/wallet/transfer
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "fromUserId": "507f1f77bcf86cd799439011",
  "toUserId": "507f1f77bcf86cd799439012",
  "amount": 500.00,
  "description": "Payment for services"
}
```

**Request Body:**
- `fromUserId` (String, optional) - User ID to transfer from (defaults to current user if not provided)
- `toUserId` (String, required) - User ID to transfer to
- `amount` (Number, required) - Amount to transfer (0.01 to 9999999999)
- `description` (String, optional, max: 500) - Transaction description

**Note:**
- Available to all authenticated users
- If `fromUserId` is not provided, it defaults to the current user's wallet
- Users can transfer from their own wallet
- Admins can transfer from wallets of users they created
- Both wallets must have the same currency
- Sender must have sufficient balance

**Response:**
```json
{
  "success": true,
  "message": "Amount transferred successfully",
  "data": {
    "fromWallet": {
      "_id": "...",
      "balance": 500.50,
      "currency": "INR"
    },
    "toWallet": {
      "_id": "...",
      "balance": 1500.50,
      "currency": "INR"
    },
    "debitTransaction": {
      "_id": "...",
      "transactionType": "debit",
      "amount": 500.00,
      "balanceBefore": 1000.50,
      "balanceAfter": 500.50,
      "referenceId": "TXN17053122000001234"
    },
    "creditTransaction": {
      "_id": "...",
      "transactionType": "credit",
      "amount": 500.00,
      "balanceBefore": 1000.50,
      "balanceAfter": 1500.50,
      "referenceId": "TXN17053122000001235"
    },
    "fromBalanceBefore": 1000.50,
    "fromBalanceAfter": 500.50,
    "toBalanceBefore": 1000.50,
    "toBalanceAfter": 1500.50
  }
}
```

**Error Response (Insufficient Balance):**
```json
{
  "success": false,
  "message": "Insufficient balance in sender wallet"
}
```

**Error Response (Currency Mismatch):**
```json
{
  "success": false,
  "message": "Currency mismatch. Cannot transfer from INR to USD"
}
```

**Error Response (Permission Denied):**
```json
{
  "success": false,
  "message": "You can only transfer from wallets of users you created"
}
```

### Super Admin Endpoints (Require Super Admin Role)

#### Add Amount to Wallet
```http
POST /api/wallet/add
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "userId": "507f1f77bcf86cd799439011",
  "amount": 500.00,
  "description": "Bonus credit"
}
```

**Request Body:**
- `userId` (String, required) - User ID to add amount to
- `amount` (Number, required) - Amount to add (0.01 to 9999999999)
- `description` (String, optional, max: 500) - Transaction description

**Note:** This endpoint is **ONLY available to Super Admin**. It creates money from the system.

**Response:**
```json
{
  "success": true,
  "message": "Amount added successfully",
  "data": {
    "wallet": {
      "_id": "...",
      "balance": 1500.50,
      "currency": "INR"
    },
    "transaction": {
      "_id": "...",
      "transactionType": "credit",
      "amount": 500.00,
      "balanceBefore": 1000.50,
      "balanceAfter": 1500.50,
      "referenceId": "TXN17053122000001234"
    },
    "balanceBefore": 1000.50,
    "balanceAfter": 1500.50
  }
}
```

**Error Response (Insufficient Permissions):**
```json
{
  "success": false,
  "message": "Only Super Admin can add amount to wallets. Use transfer to move funds between wallets."
}
```

### Admin Endpoints (Require Admin Role or Higher)

#### Deduct Amount from Wallet
```http
POST /api/wallet/deduct
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "userId": "507f1f77bcf86cd799439011",
  "amount": 200.00,
  "description": "Service charge"
}
```

**Request Body:**
- `userId` (String, required) - User ID to deduct amount from
- `amount` (Number, required) - Amount to deduct (0.01 to 9999999999)
- `description` (String, optional, max: 500) - Transaction description

**Response:**
```json
{
  "success": true,
  "message": "Amount deducted successfully",
  "data": {
    "wallet": {
      "_id": "...",
      "balance": 800.50,
      "currency": "INR"
    },
    "transaction": {
      "_id": "...",
      "transactionType": "debit",
      "amount": 200.00,
      "balanceBefore": 1000.50,
      "balanceAfter": 800.50,
      "referenceId": "TXN17053122000001235"
    },
    "balanceBefore": 1000.50,
    "balanceAfter": 800.50
  }
}
```

**Error Response (Insufficient Balance):**
```json
{
  "success": false,
  "message": "Insufficient wallet balance"
}
```

#### Lock Wallet
```http
POST /api/wallet/lock
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "userId": "507f1f77bcf86cd799439011",
  "reason": "Suspicious activity detected"
}
```

**Request Body:**
- `userId` (String, required) - User ID to lock wallet
- `reason` (String, optional, max: 200) - Reason for locking

**Response:**
```json
{
  "success": true,
  "message": "Wallet locked successfully",
  "data": {
    "wallet": {
      "_id": "...",
      "isLocked": true,
      "lockedReason": "Suspicious activity detected"
    }
  }
}
```

#### Unlock Wallet
```http
POST /api/wallet/unlock
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "userId": "507f1f77bcf86cd799439011"
}
```

**Request Body:**
- `userId` (String, required) - User ID to unlock wallet

**Response:**
```json
{
  "success": true,
  "message": "Wallet unlocked successfully",
  "data": {
    "wallet": {
      "_id": "...",
      "isLocked": false,
      "lockedReason": null
    }
  }
}
```

#### Get Wallet for Specific User
```http
GET /api/wallet/:userId
Authorization: Bearer <accessToken>
```

**Response:** Same format as "Get My Wallet"

#### Get Transactions for Specific User
```http
GET /api/wallet/:userId/transactions?page=1&limit=20
Authorization: Bearer <accessToken>
```

**Response:** Same format as "Get My Transactions"

#### Get Wallet Statistics for Specific User
```http
GET /api/wallet/:userId/stats
Authorization: Bearer <accessToken>
```

**Response:** Same format as "Get My Wallet Statistics"

## Usage Examples

### Frontend Integration

#### Get Wallet Balance
```javascript
const accessToken = localStorage.getItem('accessToken');

const response = await fetch('http://localhost:5000/api/wallet/me/balance', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

const data = await response.json();
console.log('Balance:', data.data.balance);
console.log('Currency:', data.data.currency);
```

#### Transfer Amount Between Wallets
```javascript
const accessToken = localStorage.getItem('accessToken');

// Transfer from current user's wallet to another user
const response = await fetch('http://localhost:5000/api/wallet/transfer', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    // fromUserId is optional - defaults to current user if not provided
    toUserId: '507f1f77bcf86cd799439011',
    amount: 500.00,
    description: 'Payment for services'
  })
});

const data = await response.json();
if (data.success) {
  console.log('Amount transferred:', data.data.debitTransaction.amount);
  console.log('From balance:', data.data.fromBalanceAfter);
  console.log('To balance:', data.data.toBalanceAfter);
} else {
  console.error('Error:', data.message);
}
```

#### Add Amount to Wallet (Super Admin Only)
```javascript
const accessToken = localStorage.getItem('accessToken');

// Only Super Admin can use this endpoint
const response = await fetch('http://localhost:5000/api/wallet/add', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    userId: '507f1f77bcf86cd799439011',
    amount: 500.00,
    description: 'System credit'
  })
});

const data = await response.json();
if (data.success) {
  console.log('Amount added:', data.data.transaction.amount);
  console.log('New balance:', data.data.balanceAfter);
} else {
  console.error('Error:', data.message);
}
```

#### Get Transaction History
```javascript
const accessToken = localStorage.getItem('accessToken');

const response = await fetch('http://localhost:5000/api/wallet/me/transactions?page=1&limit=20&transactionType=credit', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

const data = await response.json();
data.data.transactions.forEach(transaction => {
  console.log(`${transaction.transactionType}: ${transaction.amount} ${transaction.currency}`);
  console.log(`Balance: ${transaction.balanceBefore} → ${transaction.balanceAfter}`);
  console.log(`Reference: ${transaction.referenceId}`);
});
```

#### Lock User's Wallet (Admin)
```javascript
const accessToken = localStorage.getItem('accessToken');

const response = await fetch('http://localhost:5000/api/wallet/lock', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    userId: '507f1f77bcf86cd799439011',
    reason: 'Suspicious activity detected'
  })
});

const data = await response.json();
if (data.success) {
  console.log('Wallet locked successfully');
}
```

## Security Features

### ✅ Implemented Security Measures

1. **Role-Based Access Control**
   - Strict permission checks for all wallet operations
   - Admin can only manage wallets of users they created
   - Upper-level roles can manage lower-level user wallets

2. **Transaction Security**
   - MongoDB transactions ensure atomic operations
   - Balance validation before deductions
   - Wallet lock mechanism for security

3. **Audit Trail**
   - Complete transaction history
   - IP address and user agent tracking
   - Performer tracking for all operations
   - Unique reference IDs for transactions

4. **Input Validation**
   - Amount validation (0.01 to 9999999999)
   - User ID validation (MongoDB ObjectId)
   - Description length validation (max 500 characters)

5. **Wallet Protection**
   - Wallet lock/unlock mechanism
   - Active status checking
   - Balance validation before operations

## Error Handling

### Common Error Responses

#### Insufficient Permissions
```json
{
  "success": false,
  "message": "You can only add amount to users you created"
}
```

#### Insufficient Balance
```json
{
  "success": false,
  "message": "Insufficient wallet balance"
}
```

#### Wallet Locked
```json
{
  "success": false,
  "message": "Wallet is locked. Wallet locked by administrator."
}
```

#### Wallet Not Found
```json
{
  "success": false,
  "message": "Wallet not found"
}
```

#### Invalid Amount
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "msg": "Amount must be between 0.01 and 9999999999",
      "param": "amount",
      "location": "body"
    }
  ]
}
```

## Best Practices

1. **Always Check Permissions**
   - Verify user has permission before wallet operations
   - Check if wallet is locked before transactions
   - Validate user created the target user (for admins)

2. **Transaction Management**
   - Use MongoDB transactions for atomic operations
   - Always log transactions with proper descriptions
   - Track IP address and user agent for audit

3. **Balance Management**
   - Validate balance before deductions
   - Check wallet status before operations
   - Handle insufficient balance gracefully

4. **Security**
   - Lock wallets for suspicious activity
   - Monitor transaction patterns
   - Keep audit trail for all operations

5. **Error Handling**
   - Provide clear error messages
   - Log all errors for debugging
   - Handle edge cases gracefully

## Transaction Reference IDs

Each completed transaction gets a unique reference ID in the format:
- Format: `TXN{timestamp}{random}`
- Example: `TXN17053122000001234`
- Used for transaction tracking and reconciliation

## Wallet Lifecycle

1. **Creation**
   - Wallet is automatically created when user is registered
   - Initial balance is 0
   - Currency matches user's default currency

2. **Operations**
   - Credits increase balance
   - Debits decrease balance
   - All operations are logged

3. **Locking**
   - Wallet can be locked by admin
   - Locked wallets cannot perform transactions
   - Lock reason is stored for audit

4. **Unlocking**
   - Wallet can be unlocked by admin
   - Unlocking restores normal operations

## Integration with User System

- Wallets are automatically created for new users
- Wallet currency matches user's default currency
- Wallet operations respect user role hierarchy
- Admin can only manage wallets of users they created

## Troubleshooting

### Wallet Not Created
- Check if user was created successfully
- Verify wallet creation in database
- Check for errors in user registration process

### Cannot Add Amount
- **Only Super Admin can add amount** - All other roles must use transfer
- Verify you are logged in as Super Admin
- Verify wallet is not locked
- Check if amount is within valid range

### Cannot Transfer Amount
- Verify you have permission to transfer from the sender wallet
- Check if you're transferring from your own wallet or from a user you created
- Verify both wallets have sufficient balance
- Check if both wallets have the same currency
- Verify wallets are not locked
- Check if amount is within valid range

### Insufficient Balance
- Check current wallet balance
- Verify amount being deducted
- Ensure wallet is active and not locked

### Transaction Not Appearing
- Check transaction status
- Verify user has permission to view transactions
- Check date filters if applied

## Support

For issues or questions about the wallet system, please check the code documentation or contact the development team.

