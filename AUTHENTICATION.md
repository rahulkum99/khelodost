# Authentication & Authorization System

## Overview

This is a production-ready, highly secure role-based authentication and authorization system using JWT (JSON Web Tokens) with comprehensive user management features including commission tracking, exposure limits, and multi-currency support.

## User Model Fields

The system supports the following user fields:

### Required Fields
- **username** - Unique identifier (3-30 characters, alphanumeric + underscore)
- **password** - Secure password (min 8 chars, uppercase, lowercase, number)
- **mobileNumber** - Valid phone number format
- **commission** - Percentage (0-100%)
- **rollingCommission** - Percentage (0-100%)
- **currency** - Currency code (INR, USD, EUR) - defaults to INR
- **exposureLimit** - 10-digit number (0-9999999999)
- **role** - User role (defaults to "user")

### Optional Fields
- **name** - User's full name (3-30 characters)
- **email** - Email address (optional if provided)

## Role Hierarchy

The system supports 6 roles with hierarchical permissions:

1. **User** (Level 1) - Basic user access
2. **Agent** (Level 2) - Agent level access
3. **Master** (Level 3) - Master level access
4. **Super Master** (Level 4) - Super master level access
5. **Admin** (Level 5) - Administrative access
6. **Super Admin** (Level 6) - Full system access

**Higher level roles automatically have access to lower level permissions.**

## User Creation Hierarchy

**Important:** Users cannot register themselves. All users must be created by authorized users with appropriate role permissions.

### Role-Based User Creation Permissions

The system enforces strict hierarchical rules for user creation:

- **Super Admin** (Level 6) can create:
  - Admin, Super Master, Master, Agent, User

- **Admin** (Level 5) can create:
  - Super Master, Master, Agent, User

- **Super Master** (Level 4) can create:
  - Master, Agent, User

- **Master** (Level 3) can create:
  - Agent, User

- **Agent** (Level 2) can create:
  - User

- **User** (Level 1) cannot create any users

**Rules:**
- A user can only create users with roles lower than their own
- A user cannot create a user with the same or higher role level
- All user creation requires authentication
- The creator's ID is automatically tracked in the `createdBy` field

## Security Features

### ✅ Implemented Security Measures

1. **Password Security**
   - Bcrypt hashing with salt rounds (12)
   - Minimum 8 characters
   - Requires uppercase, lowercase, and number
   - Passwords never returned in API responses

2. **JWT Tokens**
   - Access tokens (15 minutes expiry)
   - Refresh tokens (7 days expiry)
   - Token rotation on refresh
   - Secure token storage

3. **Account Protection**
   - Account lockout after 5 failed login attempts (2 hours)
   - Login attempt tracking
   - Account activation status

4. **Rate Limiting**
   - Authentication routes: 5 requests per 15 minutes
   - General API: 100 requests per 15 minutes
   - Sensitive operations: 10 requests per hour

5. **Security Headers**
   - Helmet.js for security headers
   - CORS configuration
   - Content Security Policy

6. **Input Validation**
   - Express-validator for all inputs
   - Email format validation
   - Username format validation
   - Password strength validation
   - Commission percentage validation
   - Exposure limit validation (10 digits)

7. **Activity Logging & Account Statement**
   - Comprehensive activity tracking
   - Login/logout logging with IP and location
   - Failed login attempt tracking
   - Password change logging
   - Profile update tracking
   - IP geolocation (ISP, City, State, Country)
   - Device and browser detection
   - Account statement with statistics

## API Endpoints

### Public Endpoints

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "abc",
  "password": "SecurePass123"
}
```

**Note:** The `username` field can be:
- Username (e.g., "abc")
- Name (e.g., "John Doe")
- Email (e.g., "john@example.com")

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { ... },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### Refresh Token
```http
POST /api/auth/refresh-token
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Protected Endpoints (Require Authentication)

#### Create User (Register)
```http
POST /api/auth/register
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "username": "newuser",
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123",
  "mobileNumber": "+919876543210",
  "commission": 5.5,
  "rollingCommission": 2.5,
  "currency": "INR",
  "exposureLimit": 1000000000,
  "role": "user"
}
```

**Note:** 
- This endpoint requires authentication
- Users cannot register themselves
- The creator must have permission to create users with the specified role
- See [User Creation Hierarchy](#user-creation-hierarchy) for role-based permissions

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "user": {
      "_id": "...",
      "username": "newuser",
      "name": "John Doe",
      "email": "john@example.com",
      "mobileNumber": "+919876543210",
      "commission": 5.5,
      "rollingCommission": 2.5,
      "currency": "INR",
      "exposureLimit": 1000000000,
      "role": "user",
      "isActive": true,
      "createdBy": "..."
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Error Response (Insufficient Permissions):**
```json
{
  "success": false,
  "message": "You do not have permission to create a user with role 'admin'. Your role 'agent' can only create: user."
}
```

#### Get Profile
```http
GET /api/auth/profile
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "...",
      "username": "abc",
      "name": "John Doe",
      "email": "john@example.com",
      "mobileNumber": "+919876543210",
      "commission": 5.5,
      "rollingCommission": 2.5,
      "currency": "INR",
      "exposureLimit": 1000000000,
      "role": "user",
      "isActive": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

#### Update Profile
```http
PUT /api/auth/profile
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "name": "John Updated",
  "mobileNumber": "+919876543211"
}
```

#### Change Password
```http
PUT /api/auth/change-password
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "currentPassword": "OldPass123",
  "newPassword": "NewPass123"
}
```

#### Logout
```http
POST /api/auth/logout
Authorization: Bearer <accessToken>
```

#### Get Activity Logs
```http
GET /api/auth/activity-logs?page=1&limit=20&activityType=login&loginStatus=success&startDate=2024-01-01&endDate=2024-12-31&ipAddress=192.168.1.1
Authorization: Bearer <accessToken>
```

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)
- `activityType` - Filter by activity type (login, logout, login_failed, password_change, profile_update, token_refresh)
- `loginStatus` - Filter by login status (success, failed, locked)
- `startDate` - Start date filter (ISO format)
- `endDate` - End date filter (ISO format)
- `ipAddress` - Filter by IP address

**Response:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "_id": "...",
        "user": "...",
        "activityType": "login",
        "loginStatus": "success",
        "ipAddress": "192.168.1.1",
        "isp": "Airtel",
        "city": "Mumbai",
        "state": "Maharashtra",
        "country": "India",
        "userAgent": "Mozilla/5.0...",
        "device": "Desktop",
        "browser": "Chrome",
        "os": "Windows",
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "pages": 8
    }
  }
}
```

#### Get Account Statement
```http
GET /api/auth/account-statement?startDate=2024-01-01&endDate=2024-12-31
Authorization: Bearer <accessToken>
```

**Query Parameters:**
- `startDate` - Start date filter (ISO format, optional)
- `endDate` - End date filter (ISO format, optional)

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalActivities": 250,
      "byType": [
        {
          "_id": "login",
          "count": 180,
          "lastActivity": "2024-01-15T10:30:00.000Z"
        },
        {
          "_id": "logout",
          "count": 50,
          "lastActivity": "2024-01-15T09:20:00.000Z"
        }
      ],
      "loginStats": {
        "success": 175,
        "failed": 5
      },
      "uniqueIPs": 12,
      "uniqueLocations": 8
    },
    "recentActivities": [
      {
        "activityType": "login",
        "loginStatus": "success",
        "createdAt": "2024-01-15T10:30:00.000Z",
        "ipAddress": "192.168.1.1",
        "city": "Mumbai",
        "country": "India"
      }
    ]
  }
}
```

### Admin Endpoints (Require Admin Role or Higher)

#### Get All Users
```http
GET /api/user?page=1&limit=10&role=user&isActive=true&search=john
Authorization: Bearer <accessToken>
```

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 10)
- `role` - Filter by role
- `isActive` - Filter by active status (true/false)
- `search` - Search by username, name, email, or mobile number

**Response:**
```json
{
  "success": true,
  "data": {
    "users": [...],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 50,
      "pages": 5
    }
  }
}
```

#### Get User by ID
```http
GET /api/user/:id
Authorization: Bearer <accessToken>
```

#### Create User
```http
POST /api/user
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "username": "newuser",
  "name": "New User",
  "email": "newuser@example.com",
  "password": "SecurePass123",
  "mobileNumber": "+919876543210",
  "commission": 3.0,
  "rollingCommission": 1.5,
  "currency": "INR",
  "exposureLimit": 500000000,
  "role": "agent"
}
```

**Note:**
- Available to all authenticated users (not just Admin)
- The creator must have permission to create users with the specified role
- See [User Creation Hierarchy](#user-creation-hierarchy) for role-based permissions
- Same functionality as `/api/auth/register` endpoint

#### Update User
```http
PUT /api/user/:id
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "username": "updateduser",
  "name": "Updated Name",
  "email": "updated@example.com",
  "mobileNumber": "+919876543211",
  "commission": 6.0,
  "rollingCommission": 3.0,
  "currency": "USD",
  "exposureLimit": 2000000000,
  "role": "master",
  "isActive": true
}
```

#### Delete User
```http
DELETE /api/user/:id
Authorization: Bearer <accessToken>
```

#### Get User Statistics
```http
GET /api/user/stats
Authorization: Bearer <accessToken>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 100,
    "active": 95,
    "byRole": {
      "user": 50,
      "agent": 30,
      "master": 15,
      "admin": 5
    }
  }
}
```

## Usage Examples

### Frontend Integration

#### Create User (Requires Authentication)
```javascript
// First, ensure you're authenticated and have the proper role
const accessToken = localStorage.getItem('accessToken');

const response = await fetch('http://localhost:5000/api/auth/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  },
  body: JSON.stringify({
    username: 'newuser',
    name: 'John Doe',
    email: 'john@example.com',
    password: 'SecurePass123',
    mobileNumber: '+919876543210',
    commission: 5.5,
    rollingCommission: 2.5,
    currency: 'INR',
    exposureLimit: 1000000000,
    role: 'user' // Must be a role you have permission to create
  })
});

const data = await response.json();
if (data.success) {
  console.log('User created:', data.data.user);
  // New user's tokens are returned (optional to use)
} else {
  console.error('Error:', data.message);
}
```

**Note:** Users cannot register themselves. All user creation requires authentication and proper role permissions.

#### Login
```javascript
const response = await fetch('http://localhost:5000/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    username: 'abc', // Can be username, name, or email
    password: 'SecurePass123'
  })
});

const data = await response.json();
localStorage.setItem('accessToken', data.data.accessToken);
localStorage.setItem('refreshToken', data.data.refreshToken);
```

#### Authenticated Request
```javascript
const accessToken = localStorage.getItem('accessToken');

const response = await fetch('http://localhost:5000/api/auth/profile', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

const data = await response.json();
console.log('User profile:', data.data.user);
```

#### Refresh Token
```javascript
const refreshToken = localStorage.getItem('refreshToken');

const response = await fetch('http://localhost:5000/api/auth/refresh-token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ refreshToken })
});

const data = await response.json();
localStorage.setItem('accessToken', data.data.accessToken);
localStorage.setItem('refreshToken', data.data.refreshToken);
```

## Field Validation Rules

### Username
- Required
- 3-30 characters
- Only letters, numbers, and underscores
- Must be unique

### Name
- Optional
- 2-100 characters (if provided)

### Email
- Optional
- Valid email format (if provided)
- Must be unique (if provided)

### Password
- Required
- Minimum 8 characters
- Must contain:
  - At least one uppercase letter
  - At least one lowercase letter
  - At least one number

### Mobile Number
- Required
- Valid phone number format
- Supports international format with country code

### Commission
- Required
- Number between 0 and 100
- Represents percentage

### Rolling Commission
- Required
- Number between 0 and 100
- Represents percentage

### Currency
- Required
- Must be one of: INR, USD, EUR
- Defaults to INR

### Exposure Limit
- Required
- Number between 0 and 9999999999
- Maximum 10 digits

## Setup Instructions

### 1. Environment Variables

Create a `.env` file based on `.env.example`:

```env
PORT=5000
NODE_ENV=production
MONGO_URI=mongodb://localhost:27017/crickbackend
JWT_SECRET=your-super-secret-jwt-key-min-32-characters
JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-characters
JWT_EXPIRE=15m
JWT_REFRESH_EXPIRE=7d
CORS_ORIGIN=https://yourdomain.com

# Super Admin Configuration
SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_USERNAME=superadmin
SUPER_ADMIN_NAME=Super Admin
SUPER_ADMIN_PASSWORD=SecurePassword123
SUPER_ADMIN_MOBILE=+1234567890
```

### 2. Create Super Admin

```bash
npm run create-admin
```

### 3. Start Server

```bash
npm start
# or for development
npm run dev
```

## Middleware Usage

### Authentication Middleware
```javascript
const { authenticate } = require('./middlewares/auth.middleware');

router.get('/protected', authenticate, (req, res) => {
  // req.user is available here
  res.json({ user: req.user });
});
```

### Authorization Middleware
```javascript
const { authorize, requireMinRole, canCreateUserWithRole } = require('./middlewares/authorize.middleware');
const { ROLES } = require('./models/User');

// Specific roles
router.get('/admin-only', authenticate, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN), handler);

// Minimum role level
router.get('/agent-or-higher', authenticate, requireMinRole(ROLES.AGENT), handler);

// User creation with role-based permissions
router.post('/create-user', authenticate, canCreateUserWithRole, handler);
```

## Best Practices

1. **Always use HTTPS in production**
2. **Store refresh tokens securely** (HTTP-only cookies recommended)
3. **Implement token rotation** (already implemented)
4. **Monitor failed login attempts**
5. **Regular security audits**
6. **Keep dependencies updated**
7. **Use strong JWT secrets** (minimum 32 characters)
8. **Validate all user inputs** (already implemented)
9. **Implement 2FA for sensitive accounts** (future enhancement)
10. **Regularly backup user data**

## Security Checklist

- ✅ Password hashing with bcrypt
- ✅ JWT token authentication
- ✅ Refresh token rotation
- ✅ Account lockout mechanism
- ✅ Rate limiting
- ✅ Input validation
- ✅ Security headers
- ✅ CORS configuration
- ✅ Role-based access control
- ✅ Token expiry
- ✅ Secure password requirements
- ✅ Unique username validation
- ✅ Commission and exposure limit validation

## Troubleshooting

### Token Expired
- Use refresh token endpoint to get new access token
- If refresh token expired, user must login again

### Account Locked
- Wait 2 hours or contact administrator
- Account unlocks automatically after lock period

### Invalid Credentials
- Check username/password
- Username can be username, name, or email
- Account may be locked after 5 failed attempts

### Username Already Taken
- Username must be unique
- Try a different username

### Cannot Create User
- Ensure you are authenticated
- Check that your role has permission to create the specified role
- You cannot create users with the same or higher role level
- See [User Creation Hierarchy](#user-creation-hierarchy) for details

### Validation Errors
- Check all required fields are provided
- Ensure commission is between 0-100
- Ensure exposure limit is 10 digits or less
- Check currency is one of: INR, USD, EUR
- Verify the role you're trying to create is allowed for your role level

## Support

For issues or questions, please check the code documentation or contact the development team.
