# 🏭 Industrial Approval Workflow Tool

A lightweight multi-stage industrial approval workflow system built for a hackathon. The application models an approval chain from submission through multiple departments to final approval.

## 📌 Problem Statement

The system models a multi-step approval workflow:

**Applicant → Department A → Department B → Final Approval**

It tracks the application's status at every stage and monitors SLA breaches.

## ✨ Features

- Multi-stage approval workflow
- State machine-based transitions
- Department-wise approval process
- Approve and Reject actions
- Role-Based Access Control (RBAC)
- SLA monitoring
- SLA breach detection
- Application status tracking
- Status transition history
- Persistent SQLite database
- Live workflow dashboard

## 🔄 Workflow State Machine

```text
SUBMITTED
    ↓
DEPT_A_REVIEW
    ↓
DEPT_B_REVIEW
    ↓
APPROVED
