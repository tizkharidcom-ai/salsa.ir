'use strict';
/**
 * WESTO Finance — Approval Engine (ported from NEEM)
 * Multi-level approval workflows, threshold-based auto-approval.
 */
const { toInt } = require('./money');

function ensureApprovals(acc) {
  if (!Array.isArray(acc.approvalQueue)) acc.approvalQueue = [];
  if (!acc.approvalSettings) {
    acc.approvalSettings = {
      autoApproveThreshold: 500000,
      levels: [
        { level: 1, role: 'accountant', label: 'حسابدار' },
        { level: 2, role: 'manager', label: 'مدیر' },
        { level: 3, role: 'owner', label: 'مالک' },
      ],
    };
  }
  return acc;
}

function submitForApproval(acc, { type, entityId, description, amount, submittedBy }) {
  ensureApprovals(acc);
  const amt = toInt(amount);
  if (amt <= toInt(acc.approvalSettings.autoApproveThreshold)) {
    return { status: 'auto_approved', entityId };
  }
  const id = `apv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const item = {
    id, type, entityId, description, amount: amt, submittedBy,
    submittedAt: new Date().toISOString(), status: 'pending',
    currentLevel: 1, approvals: [],
  };
  acc.approvalQueue.push(item);
  return { status: 'pending', approvalId: id };
}

function approveItem(acc, approvalId, { userId, role, comment }) {
  ensureApprovals(acc);
  const item = acc.approvalQueue.find(a => a.id === approvalId);
  if (!item) return { error: 'مورد تأیید یافت نشد.' };
  if (item.status !== 'pending') return { error: 'این مورد قبلاً پردازش شده.' };

  item.approvals.push({ userId, role, action: 'approved', comment, at: new Date().toISOString() });
  const maxLevel = acc.approvalSettings.levels.length;
  if (item.currentLevel >= maxLevel) {
    item.status = 'approved';
    item.approvedAt = new Date().toISOString();
  } else {
    item.currentLevel++;
  }
  return { ok: true, item };
}

function rejectItem(acc, approvalId, { userId, role, comment }) {
  ensureApprovals(acc);
  const item = acc.approvalQueue.find(a => a.id === approvalId);
  if (!item) return { error: 'مورد تأیید یافت نشد.' };
  item.status = 'rejected';
  item.rejectedAt = new Date().toISOString();
  item.approvals.push({ userId, role, action: 'rejected', comment, at: new Date().toISOString() });
  return { ok: true, item };
}

function listPending(acc, role) {
  ensureApprovals(acc);
  return acc.approvalQueue.filter(a => {
    if (a.status !== 'pending') return false;
    if (!role) return true;
    const levelDef = acc.approvalSettings.levels.find(l => l.level === a.currentLevel);
    return levelDef && levelDef.role === role;
  });
}

module.exports = { ensureApprovals, submitForApproval, approveItem, rejectItem, listPending };
