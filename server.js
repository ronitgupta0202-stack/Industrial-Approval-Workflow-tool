/**
 * server.js - Express backend for the Industrial Approval Workflow tool
 * Uses sql.js (pure WASM SQLite) via db.js helpers.
 */
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');
const {
  STATUS,
  ROLES,
  SLA_THRESHOLDS,
  TERMINAL_STATUSES,
  resolveTransition,
  canRoleAct,
  isValidRole,
  normalizeRole,
  isSlaBreached,
  elapsedSeconds,
  getSlaStatus,
  responsibleRole,
} = require('./statemachine');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function enrichApp(row) {
  const sla = getSlaStatus(row.current_status, row.stage_entered_at);
  return {
    ...row,
    id:                 Number(row.id),
    application_id:     Number(row.id),
    title:              row.title || '',
    updated_at:         row.updated_at || row.created_at,
    sla_breached:       isSlaBreached(row.current_status, row.stage_entered_at),
    sla_status:         sla,
    elapsed_seconds:    elapsedSeconds(row.stage_entered_at),
    is_terminal:        TERMINAL_STATUSES.has(row.current_status),
    responsible_role:   responsibleRole(row.current_status),
    sla_threshold_sec:  SLA_THRESHOLDS[row.current_status] || null,
  };
}

function migrateSubmittedApplications() {
  const stuck = db.query("SELECT * FROM applications WHERE current_status = 'SUBMITTED'");
  stuck.forEach(row => {
    const now = new Date().toISOString();
    db.run(
      `UPDATE applications
       SET current_status = ?, stage_entered_at = ?, updated_at = ?
       WHERE id = ?`,
      [STATUS.DEPT_A_REVIEW, now, now, row.id]
    );
    db.run(
      `INSERT INTO status_history (application_id, from_status, to_status, changed_at, changed_by_role)
       VALUES (?, ?, ?, ?, ?)`,
      [row.id, STATUS.SUBMITTED, STATUS.DEPT_A_REVIEW, now, 'system']
    );
  });
}

app.get('/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    message: 'Industrial Workflow Approval Tool API is running',
  });
});

app.post('/applications', (req, res) => {
  const { applicant_name, description, title } = req.body || {};
  if (!applicant_name || !description) {
    return res.status(400).json({ error: 'applicant_name and description are required' });
  }
  const now = new Date().toISOString();
  const appTitle = (title && String(title).trim()) || 'Untitled Application';
  try {
    const appId = db.run(
      `INSERT INTO applications
        (applicant_name, title, description, current_status, stage_entered_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [String(applicant_name).trim(), appTitle, String(description).trim(), STATUS.SUBMITTED, now, now, now]
    );
    db.run(
      `INSERT INTO status_history (application_id, from_status, to_status, changed_at, changed_by_role)
       VALUES (?, NULL, ?, ?, ?)`,
      [appId, STATUS.SUBMITTED, now, ROLES.APPLICANT]
    );

    db.run(
      `UPDATE applications
       SET current_status = ?, stage_entered_at = ?, updated_at = ?
       WHERE id = ?`,
      [STATUS.DEPT_A_REVIEW, now, now, appId]
    );
    db.run(
      `INSERT INTO status_history (application_id, from_status, to_status, changed_at, changed_by_role)
       VALUES (?, ?, ?, ?, ?)`,
      [appId, STATUS.SUBMITTED, STATUS.DEPT_A_REVIEW, now, 'system']
    );

    const row = db.queryOne('SELECT * FROM applications WHERE id = ?', [appId]);
    return res.status(201).json(enrichApp(row));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/applications', (req, res) => {
  try {
    const rows = db.query('SELECT * FROM applications ORDER BY created_at DESC');
    return res.status(200).json(rows.map(enrichApp));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/applications/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid application id' });
    }
    const row = db.queryOne('SELECT * FROM applications WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Application not found' });
    const history = db.query(
      'SELECT * FROM status_history WHERE application_id = ? ORDER BY changed_at ASC, id ASC',
      [id]
    );
    return res.status(200).json({ ...enrichApp(row), history });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/applications/:id/transition', (req, res) => {
  const { action, role } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action is required (approve | reject)' });
  if (!role) return res.status(400).json({ error: 'role is required' });

  const normalizedRole = normalizeRole(role);
  if (!isValidRole(normalizedRole)) {
    return res.status(400).json({ error: 'Unknown role: ' + role });
  }

  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid application id' });
    }
    const row = db.queryOne('SELECT * FROM applications WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Application not found' });

    if (TERMINAL_STATUSES.has(row.current_status)) {
      return res.status(400).json({
        error: 'Application is already in a terminal state: ' + row.current_status,
      });
    }

    if (!canRoleAct(normalizedRole, row.current_status)) {
      return res.status(403).json({
        error: 'Unauthorized: role ' + normalizedRole + ' cannot act on status ' + row.current_status,
      });
    }

    let nextStatus;
    try {
      nextStatus = resolveTransition(row.current_status, action);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const now = new Date().toISOString();
    db.run(
      'UPDATE applications SET current_status = ?, stage_entered_at = ?, updated_at = ? WHERE id = ?',
      [nextStatus, now, now, id]
    );
    db.run(
      `INSERT INTO status_history (application_id, from_status, to_status, changed_at, changed_by_role)
       VALUES (?, ?, ?, ?, ?)`,
      [id, row.current_status, nextStatus, now, normalizedRole]
    );

    const updated = db.queryOne('SELECT * FROM applications WHERE id = ?', [id]);
    const history = db.query(
      'SELECT * FROM status_history WHERE application_id = ? ORDER BY changed_at ASC, id ASC',
      [id]
    );
    return res.status(200).json({ ...enrichApp(updated), history });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

db.initDb().then(() => {
  migrateSubmittedApplications();
  app.listen(PORT, () => {
    console.log(`\n  Industrial Approval Workflow`);
    console.log(`  Running at: http://localhost:${PORT}`);
    console.log(`  Database:   workflow.db\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
