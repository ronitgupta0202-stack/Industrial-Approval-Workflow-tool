/**
 * statemachine.js - State machine rules, role permissions, and SLA configuration
 *
 * Official workflow:
 *   SUBMITTED -> DEPT_A_REVIEW -> DEPT_B_REVIEW -> APPROVED
 *
 * Rejection:
 *   DEPT_A_REVIEW -> REJECTED
 *   DEPT_B_REVIEW -> REJECTED
 *
 * Terminal states: APPROVED, REJECTED (no further transitions)
 */

const STATUS = {
  SUBMITTED:     'SUBMITTED',
  DEPT_A_REVIEW: 'DEPT_A_REVIEW',
  DEPT_B_REVIEW: 'DEPT_B_REVIEW',
  APPROVED:      'APPROVED',
  REJECTED:      'REJECTED',
};

const ROLES = {
  APPLICANT: 'APPLICANT',
  DEPT_A:    'DEPT_A',
  DEPT_B:    'DEPT_B',
  ADMIN:     'ADMIN',
};

// Easy-to-find demo SLA (seconds). Not applied to APPROVED / REJECTED.
const SLA_THRESHOLDS = {
  DEPT_A_REVIEW: 60,
  DEPT_B_REVIEW: 60,
};

const TERMINAL_STATUSES = new Set([STATUS.APPROVED, STATUS.REJECTED]);

const TRANSITIONS = {
  [STATUS.DEPT_A_REVIEW]: { approve: STATUS.DEPT_B_REVIEW, reject: STATUS.REJECTED },
  [STATUS.DEPT_B_REVIEW]: { approve: STATUS.APPROVED,      reject: STATUS.REJECTED },
};

const RESPONSIBLE_ROLE = {
  [STATUS.DEPT_A_REVIEW]: ROLES.DEPT_A,
  [STATUS.DEPT_B_REVIEW]: ROLES.DEPT_B,
};

const VALID_ROLES = new Set(Object.values(ROLES));

/**
 * Role permissions for approve/reject (backend-enforced).
 * APPLICANT: submit + view only
 * DEPT_A:    act only when current_status === DEPT_A_REVIEW
 * DEPT_B:    act only when current_status === DEPT_B_REVIEW
 * ADMIN:     monitoring only - cannot bypass the state machine
 */
const ROLE_PERMISSIONS = {
  [ROLES.APPLICANT]: new Set(),
  [ROLES.DEPT_A]:    new Set([STATUS.DEPT_A_REVIEW]),
  [ROLES.DEPT_B]:    new Set([STATUS.DEPT_B_REVIEW]),
  [ROLES.ADMIN]:     new Set(),
};

function normalizeRole(role) {
  if (!role) return '';
  const cleaned = String(role).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (cleaned === 'DEPARTMENT_A' || cleaned === 'DEPT_A' || cleaned === 'DEPARTMENTA') return ROLES.DEPT_A;
  if (cleaned === 'DEPARTMENT_B' || cleaned === 'DEPT_B' || cleaned === 'DEPARTMENTB') return ROLES.DEPT_B;
  if (cleaned === 'APPLICANT') return ROLES.APPLICANT;
  if (cleaned === 'ADMIN' || cleaned === 'ADMINISTRATOR') return ROLES.ADMIN;
  return cleaned;
}

function isValidRole(role) {
  return VALID_ROLES.has(normalizeRole(role));
}

function resolveTransition(currentStatus, action) {
  if (TERMINAL_STATUSES.has(currentStatus)) {
    throw new Error('Application is already in a terminal state: ' + currentStatus);
  }
  const map = TRANSITIONS[currentStatus];
  if (!map) {
    throw new Error('No transitions are allowed from status: ' + currentStatus);
  }
  if (action !== 'approve' && action !== 'reject') {
    throw new Error('Unknown action: ' + action + '. Must be "approve" or "reject".');
  }
  const next = map[action];
  if (!next) {
    throw new Error('Action "' + action + '" is not allowed from status: ' + currentStatus);
  }
  return next;
}

function canRoleAct(role, currentStatus) {
  if (TERMINAL_STATUSES.has(currentStatus)) return false;
  const normalized = normalizeRole(role);
  const allowed = ROLE_PERMISSIONS[normalized];
  if (!allowed) return false;
  return allowed.has(currentStatus);
}

function elapsedSeconds(stageEnteredAt) {
  if (!stageEnteredAt) return 0;
  const time = new Date(stageEnteredAt).getTime();
  if (isNaN(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 1000));
}

function isSlaBreached(currentStatus, stageEnteredAt) {
  return getSlaStatus(currentStatus, stageEnteredAt) === 'BREACHED';
}

/**
 * Returns ON_TRACK | APPROACHING | BREACHED | null (no SLA on terminal / SUBMITTED).
 * APPROACHING = more than 75% of SLA time elapsed.
 */
function getSlaStatus(currentStatus, stageEnteredAt) {
  const threshold = SLA_THRESHOLDS[currentStatus];
  if (threshold === undefined) return null;
  const elapsed = elapsedSeconds(stageEnteredAt);
  if (elapsed > threshold) return 'BREACHED';
  if (elapsed > threshold * 0.75) return 'APPROACHING';
  return 'ON_TRACK';
}

function responsibleRole(currentStatus) {
  return RESPONSIBLE_ROLE[currentStatus] || null;
}

module.exports = {
  STATUS,
  ROLES,
  VALID_ROLES,
  SLA_THRESHOLDS,
  TERMINAL_STATUSES,
  TRANSITIONS,
  ROLE_PERMISSIONS,
  RESPONSIBLE_ROLE,
  normalizeRole,
  isValidRole,
  resolveTransition,
  canRoleAct,
  isSlaBreached,
  elapsedSeconds,
  getSlaStatus,
  responsibleRole,
};
