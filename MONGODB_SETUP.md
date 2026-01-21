# MongoDB Transaction Setup Guide

## Problem

MongoDB transactions require a **replica set** (even a single-node replica set). If you're running MongoDB locally without a replica set, you'll see this error:

```
Transaction numbers are only allowed on a replica set member or mongos
```

## Solution Options

### Option 1: Single-Node Replica Set (Recommended for Development)

This is the **recommended approach** for local development. It enables transactions while still running MongoDB on a single machine.

#### Windows Setup

1. **Stop MongoDB** if it's running:
   ```powershell
   # If running as Windows Service
   net stop MongoDB
   
   # Or if running manually, stop the process
   ```

2. **Create MongoDB data directory** (if it doesn't exist):
   ```powershell
   mkdir C:\data\db
   ```

3. **Start MongoDB with replica set**:
   ```powershell
   mongod --replSet rs0 --dbpath C:\data\db --port 27017
   ```

4. **In a new terminal, initialize the replica set**:
   ```powershell
   mongosh
   ```

   Then run:
   ```javascript
   rs.initiate({
     _id: "rs0",
     members: [
       { _id: 0, host: "localhost:27017" }
     ]
   })
   ```

5. **Verify replica set status**:
   ```javascript
   rs.status()
   ```

   You should see `"stateStr": "PRIMARY"`

6. **Update your `.env` file**:
   ```
   MONGO_URI=mongodb://localhost:27017/your-database-name?replicaSet=rs0
   ```

#### Linux/Mac Setup

1. **Stop MongoDB**:
   ```bash
   sudo systemctl stop mongod
   # or
   brew services stop mongodb-community
   ```

2. **Edit MongoDB config file** (`/etc/mongod.conf` or `~/mongod.conf`):
   ```yaml
   replication:
     replSetName: "rs0"
   ```

3. **Start MongoDB**:
   ```bash
   sudo systemctl start mongod
   # or
   brew services start mongodb-community
   ```

4. **Initialize replica set**:
   ```bash
   mongosh
   ```

   Then run:
   ```javascript
   rs.initiate({
     _id: "rs0",
     members: [
       { _id: 0, host: "localhost:27017" }
     ]
   })
   ```

5. **Verify**:
   ```javascript
   rs.status()
   ```

### Option 2: Use MongoDB Atlas (Cloud - Production Ready)

MongoDB Atlas provides replica sets out of the box:

1. Sign up at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster (M0 tier)
3. Get your connection string
4. Update `.env`:
   ```
   MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/database-name?retryWrites=true&w=majority
   ```

### Option 3: Development Mode (No Transactions)

The code has been updated to **automatically detect** if transactions are supported. If not, it will:

- ⚠️ Run operations **without transactions** (less safe)
- ⚠️ Log a warning: `⚠️ Transactions not supported - running without transaction safety`

**This works for development but is NOT recommended for production.**

## Verification

After setting up a replica set, restart your Node.js server. You should see:

```
✅ MongoDB Connected
```

And when placing bets, you should **NOT** see the transaction error.

## Troubleshooting

### "Replica set not initialized"

If you see this error, make sure you ran `rs.initiate()` in mongosh.

### "Cannot connect to replica set"

Check that:
1. MongoDB is running
2. The replica set name matches in your connection string
3. The port is correct (default: 27017)

### "Still getting transaction errors"

1. Restart your Node.js server after setting up replica set
2. Verify replica set status: `rs.status()` in mongosh
3. Check your `MONGO_URI` includes `?replicaSet=rs0`

## Production Recommendations

For production environments:

1. ✅ Use MongoDB Atlas (managed replica set)
2. ✅ Or set up a proper multi-node replica set
3. ✅ Enable authentication
4. ✅ Use SSL/TLS connections
5. ✅ Set up backups
6. ✅ Monitor replica set health

## Quick Test

After setup, test transactions work:

```bash
# In mongosh
use your-database-name
db.test.insertOne({ test: "transaction test" })
```

If this works without errors, transactions are enabled!
