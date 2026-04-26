
const mongoose = require('mongoose');

const FinancialRequestSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // ID from User model
  userName: String, // Snapshot of name at request time
  shortId: { type: Number }, // Sequential ID for receipts
  type: { type: String, enum: ['DEPOSIT', 'WITHDRAWAL'], required: true },
  paymentMethod: { type: String },
  amount: { type: Number, required: true, min: 0.01 },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  details: String,
  timestamp: { type: Date, default: Date.now },
  adminComment: String,
  processedBy: { type: String }, // User ID of the admin who processed this request
  approverName: { type: String } // Name of the admin who processed this request
});

// ===== INDEX OPTIMIZATION =====
// Compound index for admin dashboard (filter by status, sort by date)
FinancialRequestSchema.index({ status: 1, timestamp: -1 });

// Index for user's request history
FinancialRequestSchema.index({ userId: 1, timestamp: -1 });

// TTL index: Auto-delete approved/rejected requests after 90 days
FinancialRequestSchema.index(
  { timestamp: 1 },
  {
    expireAfterSeconds: 7776000, // 90 days
    partialFilterExpression: { status: { $in: ['APPROVED', 'REJECTED'] } }
  }
);

module.exports = mongoose.model('FinancialRequest', FinancialRequestSchema);
